/**
 * background service worker
 *
 * 职责：
 *  - 管理录制生命周期（start / stop / export）
 *  - 根据配置开关启用各 collector：
 *      captureApi    → 通过 chrome.debugger 抓 Network
 *      captureActions → 由 content script 上报 fe-event
 *      recordVideo   → 由 offscreen 用 MediaRecorder 录
 *      emitPlaywright → 在 export 时把 ui 事件转 .spec.ts
 *  - 所有产物由 offscreen 统一通过 <a download> 写入同一 recording-* 目录
 *    （SW 自身没有 URL.createObjectURL，所以不能在 SW 端直接下文件）
 */
import { MSG, compileFilter, nowTs, loadConfig, saveConfig, DEFAULT_CONFIG } from '../common/utils.js';
import { generatePlaywrightSpec } from '../exporter/playwright-exporter.js';

class Session {
  constructor(tabId, config) {
    this.tabId = tabId;            // 主 tab(录制起点)
    this.primaryTabId = tabId;
    // v0.3.4: 录制可以跟随"从录制 tab 打开的新标签页"。
    // tabIds = 本次录制纳入范围的所有 tab;attachedTabs = 已成功 attach debugger 的 tab。
    this.tabIds = new Set([tabId]);
    this.attachedTabs = new Set();
    this.startedAt = nowTs();
    this.endedAt = 0;
    this.config = config;
    this.events = [];
    this.pendingRequests = new Map();
    this.stats = { total: 0, kept: 0, dropped: 0 };
    this.filter = compileFilter(config.apiInclude, config.apiExclude);
    // v0.2.8: baseName 由用户自定义前缀(去除非法字符) + 时间戳组成
    const prefix = sanitizePrefix(config.exportPrefix);
    this.baseName = `${prefix}-${new Date(this.startedAt).toISOString().replace(/[:.]/g, '-')}`;
    this.startUrl = '';
    // v0.2.7: 累积式 a11y 快照(start / 每次 nav / stop)
    this.a11ySnapshots = [];
    // v0.2.7: 完整 API 详情(req/resp headers + body),与精简版分离
    this.apiDetails = [];
  }
  push(ev) { this.events.push(ev); }
}

// 把用户输入的前缀清理成可作为文件名的字符串
// v0.2.9: 允许中文/Unicode,仅过滤真正非法的文件名字符
function sanitizePrefix(p) {
  let s = String(p || '').trim();
  // 仅替换 Windows/macOS 上真正非法的文件名字符 + 控制字符
  // 允许字母数字、中日韩、emoji、点、下划线、连字符、空格等
  s = s.replace(/[\\/:*?"<>|\x00-\x1F]+/g, '_');
  // 空格统一为下划线,便于命令行
  s = s.replace(/\s+/g, '_');
  s = s.replace(/^[._]+|[._]+$/g, '');
  if (!s) s = 'recording';
  if (s.length > 50) s = s.slice(0, 50);
  return s;
}

let session = null;
let lastFinishedSession = null;  // 录制结束后保留，供 export 使用
let stopping = false;   // 防重入
let videoFinalizing = null; // 视频 finalize Promise（异步，不阻塞 stop 返回）

// ---------- 生命周期 ----------
async function startRecording(tabId) {
  // "开始 = 重新开始"：有任何旧会话直接强制停掉
  if (session) {
    try { await stopRecording({ silent: true, force: true }); } catch (e) { console.warn('[recorder] forced stop failed', e); }
  }
  // 等上一次 video finalize 跑完，避免新旧 baseName 冲突
  if (videoFinalizing) {
    try { await Promise.race([videoFinalizing, new Promise(r => setTimeout(r, 1500))]); } catch {}
    videoFinalizing = null;
  }

  const config = await loadConfig();

  // 提前校验目标 tab 是否可录(chrome:// / edge:// / web store / 文件协议等是禁区)
  let tabUrl = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    tabUrl = tab?.url || tab?.pendingUrl || '';
  } catch {}
  const blockedRe = /^(chrome|edge|about|chrome-extension|devtools|view-source):/i;
  const isWebStore = /^https?:\/\/chrome\.google\.com\/webstore/i.test(tabUrl)
    || /^https?:\/\/chromewebstore\.google\.com/i.test(tabUrl);
  if (!tabUrl || blockedRe.test(tabUrl) || isWebStore) {
    session = null;
    throw new Error(
      `当前页面不支持录制(${tabUrl || '空白页'})。\n` +
      `Chrome 不允许扩展操作 chrome:// / 扩展商店 / 新标签页等内部页面。\n` +
      `请先在地址栏打开你要测试的 http(s) 网页,让该标签停在最前面,再点"开始"。`
    );
  }

  session = new Session(tabId, config);
  stopping = false;
  session.startUrl = tabUrl;

  // captureApi → debugger
  // v0.2.7: 即使不抓 API,也要短暂 attach 以便拉 Accessibility 树
  const needDebugger = !!config.captureApi || !!config.captureActions;
  session.debuggerAttached = false;
  if (needDebugger) {
    try {
      await attachDebuggerAndEnable(tabId, config);
      session.debuggerAttached = true;
      session.attachedTabs.add(tabId);
      console.log('[recorder] debugger attached, captureApi=', config.captureApi);
      // 录制开始时抓一次 a11y 快照
      captureA11ySnapshot(session, 'start').catch(e => console.warn('[recorder] a11y snap (start) failed', e));
    } catch (e) {
      console.error('[recorder] debugger attach failed', e);
      // 仅在用户明确要 captureApi 时把异常往上抛
      if (config.captureApi) { session = null; throw e; }
    }
  }

  // captureActions → 通过 storage 同步给所有 frame(包含未来注入的子 frame)
  // storage 比 sendMessage 更可靠:任何时刻注入的 content script 都能立即读到当前状态
  if (config.captureActions) {
    await chrome.storage.local.set({
      recorderState: { recording: true, config, tabId, startedAt: session.startedAt },
    });
    // 主动把 content script 注入到所有 frame —— 解决"扩展刚装/页面早于扩展加载,
    // content_scripts 没生效"的场景。已注入过会被 __actionRecorderInjected 守卫,不重复绑定。
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['src/content/content.js'],
      });
      console.log('[recorder] content script injected to all frames');
    } catch (e) {
      console.warn('[recorder] executeScript failed (页面可能受限,如 chrome:// 或 web store)', e);
    }
    // 兜底再用 sendMessage 通知一遍,加快当前已注入 frame 的开关响应
    try {
      await broadcastToAllFrames(tabId, { cmd: MSG.START, config });
    } catch (e) {
      console.warn('[recorder] notify content failed', e);
    }
  } else {
    await chrome.storage.local.set({ recorderState: { recording: false, config } });
  }

  // recordVideo → 预创建 offscreen（streamId 获取要在 popup 那边的用户手势里）
  if (config.recordVideo) {
    await ensureOffscreen();
  }

  await broadcastStatus();
  console.log('[recorder] started', { tabId, baseName: session.baseName, config });
}

async function stopRecording({ silent, force } = {}) {
  if (!session) return;
  if (stopping && !force) {
    console.log('[recorder] stop already in progress');
    return;
  }
  stopping = true;
  const sess = session;
  const tabId = sess.tabId;

  // 关键：先把 session 置空，让 UI 立刻回到"空闲"状态，按钮立即可用
  sess.endedAt = nowTs();
  // 但保留 lastFinishedSession 用于 export
  lastFinishedSession = sess;
  session = null;
  await broadcastStatus();

  // 1) 先在 detach 前抓一次结束态 a11y 快照(主 tab),再 detach 所有已 attach 的 tab
  if (sess.debuggerAttached && tabId != null) {
    try { await captureA11ySnapshot(sess, 'stop'); } catch (e) { console.warn('[recorder] a11y snap (stop) failed', e); }
  }
  // v0.3.4: 逐个 detach 本次录制纳入的所有 tab(主 tab + 跟随的新标签页)
  for (const tid of sess.attachedTabs) {
    try { await chrome.debugger.detach({ tabId: tid }); } catch {}
  }
  // 2) 通知所有 tab 的 content script 停止 + 清 storage
  await chrome.storage.local.set({ recorderState: { recording: false, config: sess.config } });
  if (sess.config.captureActions) {
    for (const tid of sess.tabIds) {
      try { await broadcastToAllFrames(tid, { cmd: MSG.STOP }); } catch {}
    }
  }

  // 3) 视频 finalize 放后台跑，不阻塞 stop 返回
  if (sess.config.recordVideo) {
    videoFinalizing = (async () => {
      try {
        await chrome.runtime.sendMessage({ cmd: MSG.OFFSCREEN_STOP, target: 'offscreen' });
        console.log('[recorder] video finalized');
      } catch (e) {
        console.warn('[recorder] OFFSCREEN_STOP failed', e);
      }
    })();
  }

  stopping = false;
  console.log('[recorder] stopped (sync part). events:', sess.events.length, 'stats:', sess.stats);
}

// ---------- debugger attach helper ----------
// v0.3.4: 把 attach + 各域 enable 抽成可复用函数,供 start 和"导航后重连"共用。
// 跨域同标签页导航会触发 Chrome 渲染进程切换,旧的 debugger 会被 detach,
// 必须重新 attach 并重新 Network.enable,否则新页面的 API 抓不到。
async function attachDebuggerAndEnable(tabId, config) {
  await chrome.debugger.attach({ tabId }, '1.3');
  if (config.captureApi) {
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
  }
  // a11y 域始终启用,用于抓全树
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Accessibility.enable');
    await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
  } catch (e) { console.warn('[recorder] a11y enable failed', e); }
}

// v0.3.4: 跨域同标签页导航后,渲染进程切换会让 debugger 掉线 / Network 域失效。
// 关键经验:跨进程导航时即使 debugger 仍"挂着",对旧进程的 Network.enable 也绑不到新进程,
// 新页面的 Network 事件一条都不来。所以这里统一做"强制 detach → 重新 attach → 重新 enable",
// 而不是只补发一次 enable。这是 0.3.3 漏抓 page2 API 的真正修复点。
let reattaching = false;
async function reattachAfterNavigation(tabId, source = 'nav') {
  if (!session || !session.tabIds.has(tabId)) return;
  if (!session.config.captureApi && !session.config.captureActions) return;
  if (reattaching) { console.log('[recorder] reattach skipped (in progress)'); return; }
  reattaching = true;
  console.log(`[recorder] reattach start (source=${source}) tab=${tabId}`);
  try {
    // 1) 先强制 detach(忽略"未挂载"错误),清掉对旧进程的绑定
    try { await chrome.debugger.detach({ tabId }); console.log('[recorder] old debugger detached'); }
    catch (e) { /* 本来就没挂 */ }
    session.attachedTabs.delete(tabId);
    if (tabId === session.tabId) session.debuggerAttached = false;
    // 2) 重新 attach 到当前(新)进程并重发各域 enable
    await attachDebuggerAndEnable(tabId, session.config);
    session.attachedTabs.add(tabId);
    if (tabId === session.tabId) session.debuggerAttached = true;
    console.log('[recorder] debugger re-attached after navigation, tab=', tabId, 'captureApi=', session.config.captureApi);
    // 3) 导航后补一张 a11y 快照(仅主 tab,避免子 tab 树太多)
    if (tabId === session.tabId) captureA11ySnapshot(session, 'nav').catch(() => {});
  } catch (e) {
    console.warn('[recorder] reattach after navigation FAILED', e);
  } finally {
    reattaching = false;
  }
}

// v0.3.4: 把"从录制 tab 打开的新标签页"也纳入录制范围,attach debugger 抓它的 API。
// chrome.debugger 是按 tabId 绑定的,只 attach 主 tab 时,新标签页的 Network 一条都收不到
// (而 UI 事件因为 content script 注入到每个 tab + storage 共享状态,所以照常上报)。
// 这就是"新页签里 UI 有记录、API 没记录"的真正原因。
const attachingTabs = new Set();
async function attachFollowerTab(tabId, source = 'newtab') {
  if (!session) return;
  if (session.attachedTabs.has(tabId) || attachingTabs.has(tabId)) return;
  if (!session.config.captureApi && !session.config.captureActions) return;
  attachingTabs.add(tabId);
  session.tabIds.add(tabId);
  console.log(`[recorder] attach follower tab=${tabId} (source=${source})`);
  // 新 tab 刚创建时进程/文档可能还没就绪,attach 容易抛错,做几次重试。
  for (let i = 0; i < 5; i++) {
    try {
      // 跳过受限页面(chrome:// / web store 等)
      let url = '';
      try { const t = await chrome.tabs.get(tabId); url = t?.url || t?.pendingUrl || ''; } catch {}
      const blockedRe = /^(chrome|edge|about|chrome-extension|devtools|view-source):/i;
      if (url && blockedRe.test(url)) { console.log('[recorder] follower tab is restricted, skip', url); break; }
      await attachDebuggerAndEnable(tabId, session.config);
      session.attachedTabs.add(tabId);
      console.log('[recorder] follower tab debugger attached', tabId);
      break;
    } catch (e) {
      const msg = String(e?.message || e);
      // 已经 attach 了就当成功
      if (/already attached|Another debugger/i.test(msg)) { session.attachedTabs.add(tabId); break; }
      if (i === 4) { console.warn('[recorder] follower tab attach failed (gave up)', msg); }
      await new Promise(r => setTimeout(r, 300));
    }
  }
  attachingTabs.delete(tabId);
}

// ---------- offscreen ----------
async function ensureOffscreen() {
  const url = chrome.runtime.getURL('src/offscreen/offscreen.html');
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url],
  });
  if (existing && existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url,
    reasons: ['USER_MEDIA', 'BLOBS'],
    justification: '录制 tab 视频并触发下载',
  });
  console.log('[recorder] offscreen created');
}

async function waitOffscreenReady(timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await chrome.runtime.sendMessage({ cmd: MSG.OFFSCREEN_PING, target: 'offscreen' });
      if (r && r.alive) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

// ---------- CDP Network ----------
chrome.debugger.onEvent.addListener(async (src, method, params) => {
  // v0.3.4: 接受本次录制纳入的任意 tab(主 tab + 跟随打开的新标签页)
  if (!session || !session.tabIds.has(src.tabId)) return;
  if (!session.config.captureApi) return;

  try {
    if (method === 'Network.requestWillBeSent') {
      const url = params.request.url;
      session.stats.total++;
      const r = session.filter.test(url);
      if (!r.ok) {
        session.stats.dropped++;
        return;
      }
      session.stats.kept++;
      // 详情(完整 headers/body)
      const detail = {
        requestId: params.requestId,
        ts: nowTs(),
        url,
        method: params.request.method,
        reqHeaders: params.request.headers || {},
        reqBody: params.request.postData || null,
        resourceType: params.type,
        initiator: params.initiator || null,
      };
      session.pendingRequests.set(params.requestId, detail);
    } else if (method === 'Network.responseReceived') {
      const r = session.pendingRequests.get(params.requestId);
      if (!r) return;
      r.status = params.response.status;
      r.statusText = params.response.statusText;
      r.respHeaders = params.response.headers || {};
      r.mimeType = params.response.mimeType;
      r.remoteIp = params.response.remoteIPAddress;
    } else if (method === 'Network.loadingFinished') {
      const r = session.pendingRequests.get(params.requestId);
      if (!r) return;
      if (isTextLike(r.mimeType)) {
        try {
          const body = await chrome.debugger.sendCommand(
            { tabId: src.tabId },
            'Network.getResponseBody',
            { requestId: params.requestId },
          );
          r.respBody = body.base64Encoded
            ? `[base64 ${body.body.length}b]`
            : (body.body || '').slice(0, 20000);
        } catch (e) {
          r.respBodyError = String(e?.message || e);
        }
      }
      r.endTs = nowTs();
      // v0.2.7: events 里只保留精简描述,详情写到 apiDetails
      session.push({
        type: 'api',
        ts: r.ts,
        endTs: r.endTs,
        requestId: r.requestId,
        url: r.url,
        method: r.method,
        status: r.status,
        statusText: r.statusText,
        resourceType: r.resourceType,
        mimeType: r.mimeType,
      });
      session.apiDetails.push(r);
      session.pendingRequests.delete(params.requestId);
    } else if (method === 'Network.loadingFailed') {
      const r = session.pendingRequests.get(params.requestId);
      if (!r) return;
      r.failed = true;
      r.errorText = params.errorText;
      r.endTs = nowTs();
      session.push({
        type: 'api',
        ts: r.ts,
        endTs: r.endTs,
        requestId: r.requestId,
        url: r.url,
        method: r.method,
        failed: true,
        errorText: r.errorText,
        resourceType: r.resourceType,
      });
      session.apiDetails.push(r);
      session.pendingRequests.delete(params.requestId);
    }
  } catch (err) {
    console.warn('[recorder] CDP handler error', err);
  }
});

function isTextLike(mime = '') {
  return /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql))/i.test(mime);
}

// ---------- v0.2.7: Accessibility 全树快照 ----------
async function captureA11ySnapshot(sess, reason) {
  if (!sess || !sess.debuggerAttached) return;
  const tabId = sess.tabId;
  let tree = null;
  let url = '';
  let title = '';
  try {
    const t = await chrome.tabs.get(tabId);
    url = t?.url || '';
    title = t?.title || '';
  } catch {}
  try {
    // 优先 getFullAXTree(返回 nodes 数组,含 role/name/value/parentId/childIds 等)
    const r = await chrome.debugger.sendCommand({ tabId }, 'Accessibility.getFullAXTree', {});
    tree = r?.nodes || null;
  } catch (e) {
    console.warn('[recorder] getFullAXTree failed', e?.message || e);
  }
  if (!tree) return;
  sess.a11ySnapshots.push({
    reason,                // 'start' | 'stop' | 'nav' | 'manual'
    ts: nowTs(),
    url, title,
    nodeCount: tree.length,
    nodes: tree,
  });
  console.log('[recorder] a11y snapshot captured', reason, 'nodes=', tree.length);
}

// debugger 自动 detach 兜底
// v0.3.4: 跨域同标签页导航(渲染进程切换)也会触发 detach,reason 常见为
// 'target_closed' / 'Render process gone.' / 'Target navigated' 等。
// 旧逻辑只要 reason !== 'target_closed' 就直接 stopRecording,导致页面跳转后整段录制被掐断,
// 新页面的 API 全部丢失。现在改为:tab 仍在 → 尝试重连;tab 真没了 → 由 onRemoved 处理。
chrome.debugger.onDetach.addListener(async (src, reason) => {
  console.warn('[recorder] debugger detached, reason=', reason, 'tab=', src.tabId);
  if (!session || !session.tabIds.has(src.tabId)) return;
  session.attachedTabs.delete(src.tabId);
  if (src.tabId === session.tabId) session.debuggerAttached = false;
  if (reason === 'target_closed') return; // tab/target 关闭,交给 onRemoved
  // 确认 tab 还在,再决定重连还是收尾
  let tabAlive = false;
  try { const t = await chrome.tabs.get(src.tabId); tabAlive = !!t; } catch {}
  if (tabAlive) {
    // 导航/进程切换引起的掉线 —— 重连,不要停录制
    await reattachAfterNavigation(src.tabId, 'onDetach:' + reason);
  } else if (src.tabId === session.tabId && session.config.captureApi) {
    try { await stopRecording({ silent: true }); } catch {}
  }
});

// v0.3.4: 顶层 frame 导航提交后主动重连 debugger + 重新 Network.enable。
// onDetach 在某些时序下不会触发(debugger 仍"挂着"但 Network 域绑在旧进程,新页面事件不来),
// 所以这里用 webNavigation.onCommitted 做主动兜底,双保险。对本次录制的任意 tab 生效。
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (!session) return;
  if (details.frameId !== 0) return;          // 只关心顶层导航
  if (!session.tabIds.has(details.tabId)) return;
  // 排除同文档导航(history.pushState / hash 不切进程,无需重连)
  const quals = details.transitionQualifiers || [];
  if (details.transitionType === 'reference_fragment' || quals.includes('same_document')) {
    console.log('[recorder] onCommitted same-document, skip reattach');
    return;
  }
  console.log('[recorder] onCommitted top-frame nav →', details.tabId, details.url);
  await reattachAfterNavigation(details.tabId, 'onCommitted');
});

// v0.3.4: 录制 tab 用 target=_blank / window.open / 中键点击打开的新标签页,
// 也要 attach debugger 才能抓到它的 API。两条路径都监听,谁先到谁负责(attachFollowerTab 幂等)。
chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  if (!session) return;
  if (!session.tabIds.has(details.sourceTabId)) return;  // 由录制范围内的 tab 打开
  console.log('[recorder] new tab opened from recorded tab →', details.tabId, details.url);
  await attachFollowerTab(details.tabId, 'navTarget');
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!session || tab.id == null) return;
  if (tab.openerTabId != null && session.tabIds.has(tab.openerTabId)) {
    console.log('[recorder] tabs.onCreated opener in session →', tab.id);
    await attachFollowerTab(tab.id, 'onCreated');
  }
});


chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (!session) return;
  if (tabId === session.tabId) {
    console.warn('[recorder] primary tab closed, stopping');
    try { await stopRecording({ silent: true }); } catch {}
  } else if (session.tabIds.has(tabId)) {
    // 跟随的新标签页被关掉:仅移出录制范围,不影响整段录制
    console.log('[recorder] follower tab closed, dropping', tabId);
    session.tabIds.delete(tabId);
    session.attachedTabs.delete(tabId);
  }
});

// ---------- 消息总线 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.target === 'offscreen') return false;

  (async () => {
    try {
      switch (msg.cmd) {
        case MSG.START: {
          const tabId = msg.tabId ?? sender.tab?.id;
          await startRecording(tabId);
          sendResponse({ ok: true });
          break;
        }
        case MSG.STOP: {
          await stopRecording();
          sendResponse({ ok: true });
          break;
        }
        case MSG.EXPORT: {
          const baseName = await exportSession();
          sendResponse({ ok: true, baseName });
          break;
        }
        case MSG.GET_STATE: {
          sendResponse({
            recording: !!session,
            tabId: session?.tabId,
            stats: session?.stats,
            filter: session?.filter?.desc,
          });
          break;
        }
        case MSG.CONFIG_GET: {
          sendResponse(await loadConfig());
          break;
        }
        case MSG.CONFIG_SET: {
          const next = await saveConfig(msg.patch || {});
          sendResponse(next);
          break;
        }
        case MSG.OFFSCREEN_START: {
          await ensureOffscreen();
          const ready = await waitOffscreenReady(3000);
          if (!ready) {
            sendResponse({ ok: false, error: 'offscreen not ready' });
            break;
          }
          const r = await chrome.runtime.sendMessage({
            cmd: MSG.OFFSCREEN_START,
            target: 'offscreen',
            streamId: msg.streamId,
            baseName: session?.baseName,
          });
          sendResponse(r || { ok: false, error: 'no offscreen response' });
          break;
        }
        case MSG.FE_EVENT: {
          if (session && session.config.captureActions) {
            const ev = { ...msg.event, ts: msg.event.ts || nowTs() };
            session.push(ev);
            if ((session.events.length % 10) === 1) {
              console.log('[recorder] fe-event #', session.events.length, ev.type, ev.action);
            }
            // v0.2.7: 导航后延迟 600ms 抓一次 a11y(等新页面 a11y 构建完成)
            if (ev.type === 'nav' && session.debuggerAttached) {
              setTimeout(() => {
                captureA11ySnapshot(session, 'nav').catch(() => {});
              }, 600);
            }
          } else {
            console.warn('[recorder] FE_EVENT dropped: session=', !!session, 'captureActions=', session?.config?.captureActions);
          }
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'unknown cmd: ' + msg.cmd });
      }
    } catch (e) {
      console.error('[recorder] msg handler error', e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});

async function broadcastStatus() {
  try {
    await chrome.runtime.sendMessage({
      cmd: MSG.STATUS,
      recording: !!session,
      tabId: session?.tabId,
      stats: session?.stats,
      filter: session?.filter?.desc,
    });
  } catch {}
}

// ---------- 导出 ----------
async function exportSession() {
  // 优先用刚结束的会话；若仍在录制则用当前会话
  const sess = session || lastFinishedSession;
  if (!sess) throw new Error('当前没有可导出的录制(请先开始一次录制并停止)');

  // 等视频 finalize（最多 8s）
  if (sess.config.recordVideo && videoFinalizing) {
    try { await Promise.race([videoFinalizing, new Promise(r => setTimeout(r, 8000))]); } catch {}
  }

  // 导出时读取**最新**配置(可能用户录完才调 exportApi/exportActions)
  const liveCfg = await loadConfig();
  // 真正写出的开关:必须同时满足"采集时开了" + "导出时开了"
  const includeApi      = !!sess.config.captureApi     && !!liveCfg.exportApi;
  const includeActions  = !!sess.config.captureActions && !!liveCfg.exportActions;
  const includeMeta     = includeApi || includeActions;  // 都关就连 meta:start 也省了
  const includeNav      = includeActions;

  const allEvents = [...sess.events].sort((a, b) => a.ts - b.ts);
  const events = allEvents.filter(e => {
    if (e.type === 'api')  return includeApi;
    if (e.type === 'ui')   return includeActions;
    if (e.type === 'nav')  return includeNav;
    if (e.type === 'meta') return includeMeta;
    return true;
  });
  // v0.2.9: 在 export 时重算 baseName,这样用户即使录完才填前缀也能生效
  const livePrefix = sanitizePrefix(liveCfg.exportPrefix);
  const baseName = `${livePrefix}-${new Date(sess.startedAt).toISOString().replace(/[:.]/g, '-')}`;
  // cfg 用于"导出器/Playwright 选项",这里直接用 liveCfg 即可(用户在 stop 之后才改 baseUrl 也想生效)
  const cfg = { ...sess.config, ...liveCfg };

  // 按 type 分桶统计(同时给出过滤前/过滤后两份)
  const bucket = arr => arr.reduce((m, e) => { m[e.type] = (m[e.type] || 0) + 1; return m; }, {});
  const eventStats = { raw: bucket(allEvents), exported: bucket(events) };
  console.log('[recorder] export stats:', eventStats,
    'includeApi=', includeApi, 'includeActions=', includeActions);

  // v0.2.8: 产物级开关(用户在"产物开关"段控制 zip 里出现哪些文件)
  const wantVideo       = !!cfg.outVideo       && !!cfg.recordVideo;
  const wantEvents      = !!cfg.outEvents;
  const wantA11y        = !!cfg.outA11y;
  const wantApiDetails  = !!cfg.outApiDetails  && includeApi;
  const wantSpec        = !!cfg.outSpec        && !!cfg.emitPlaywright && includeActions;

  // 1) events.json (主时间线 — api 事件只含 url/method/status 等精简字段)
  let eventsJson = null;
  if (wantEvents) {
    eventsJson = JSON.stringify({
      meta: {
        version: '0.3.4',
        startedAt: sess.startedAt,
        endedAt: sess.endedAt || nowTs(),
        tabId: sess.tabId,
        startUrl: sess.startUrl,
        stats: sess.stats,
        eventStats,
        files: {
          events: 'events.json',
          apiDetails: wantApiDetails ? 'api-details.json' : null,
          a11yDir: wantA11y ? 'a11y/' : null,
          spec: wantSpec ? 'test.spec.ts' : null,
          video: wantVideo ? 'video.webm' : null,
          viewer: 'viewer.html',
        },
        config: {
          recordVideo: cfg.recordVideo,
          captureApi: cfg.captureApi,
          captureActions: cfg.captureActions,
          emitPlaywright: cfg.emitPlaywright,
          exportApi: includeApi,
          exportActions: includeActions,
          outVideo: wantVideo, outEvents: wantEvents, outA11y: wantA11y,
          outApiDetails: wantApiDetails, outSpec: wantSpec,
          exportPrefix: cfg.exportPrefix,
          apiInclude: cfg.apiInclude,
          apiExclude: cfg.apiExclude,
          pwTestidAttr: cfg.pwTestidAttr,
        },
      },
      events,
    }, null, 2);
  }

  // 2) api-details.json (完整 req/resp headers + body, 与 events 通过 requestId 关联)
  let apiDetailsJson = null;
  if (wantApiDetails && sess.apiDetails && sess.apiDetails.length) {
    // 只导出已被 filter 命中并出现在 events 里的那些 requestId
    const keepIds = new Set(events.filter(e => e.type === 'api').map(e => e.requestId));
    const details = sess.apiDetails.filter(d => keepIds.has(d.requestId));
    apiDetailsJson = JSON.stringify({
      meta: {
        version: '0.3.4',
        count: details.length,
        note: '通过 requestId 与 events.json 中的 type=api 事件关联',
      },
      details,
    }, null, 2);
  }

  // 3) a11y/<page>.json — 按页面拆分(同一 url 的多次快照合并到该文件的 snapshots 数组)
  // 同时生成一个 index.json 列出所有页面文件
  const a11yFiles = [];
  if (wantA11y && sess.a11ySnapshots && sess.a11ySnapshots.length) {
    const byPage = new Map(); // url -> [snapshot...]
    for (const snap of sess.a11ySnapshots) {
      const key = snap.url || '(unknown)';
      if (!byPage.has(key)) byPage.set(key, []);
      byPage.get(key).push(snap);
    }
    // 处理重名(不同 url 经 urlToSafeFilename 后碰撞)
    const usedNames = new Map();
    const pageIndex = [];
    for (const [url, snaps] of byPage) {
      let fname = urlToSafeFilename(url);
      const n = usedNames.get(fname) || 0;
      usedNames.set(fname, n + 1);
      if (n > 0) fname = `${fname}_${n + 1}`;
      const data = JSON.stringify({
        meta: {
          version: '0.3.4',
          url,
          title: snaps[0]?.title || '',
          snapshotCount: snaps.length,
          reasons: snaps.map(s => s.reason),
          source: 'CDP Accessibility.getFullAXTree',
        },
        snapshots: snaps,
      }, null, 2);
      a11yFiles.push({ name: `a11y/${fname}.json`, data });
      pageIndex.push({ file: `a11y/${fname}.json`, url, title: snaps[0]?.title || '', snapshotCount: snaps.length });
    }
    // index 方便快速查找
    a11yFiles.push({
      name: 'a11y/index.json',
      data: JSON.stringify({
        meta: { version: '0.3.4', pageCount: pageIndex.length },
        pages: pageIndex,
      }, null, 2),
    });
  }

  // 4) test.spec.ts (Playwright codegen 风格示例代码)
  let spec = null;
  if (wantSpec) {
    spec = generatePlaywrightSpec(events, {
      pwBaseUrl: cfg.pwBaseUrl || originOf(sess.startUrl),
      pwWaitForNetworkIdle: cfg.pwWaitForNetworkIdle,
      pwTestidAttr: cfg.pwTestidAttr,
    });
  }

  // 5) viewer.html (始终带,体积小)
  const viewerHtml = await fetchExt('src/viewer/viewer-standalone.html');

  const filesText = [
    { name: 'viewer.html', data: viewerHtml, type: 'text' },
  ];
  if (eventsJson)     filesText.push({ name: 'events.json',     data: eventsJson });
  if (apiDetailsJson) filesText.push({ name: 'api-details.json', data: apiDetailsJson });
  if (spec)           filesText.push({ name: 'test.spec.ts',     data: spec });
  for (const f of a11yFiles) filesText.push(f);

  // 让 offscreen 把当前缓存的视频 Blob 转成 base64 发回来（如果有的话）
  let videoB64 = null;
  if (wantVideo) {
    try {
      const r = await chrome.runtime.sendMessage({ cmd: MSG.OFFSCREEN_GET_VIDEO, target: 'offscreen' });
      if (r?.ok && r.base64) videoB64 = r.base64;
    } catch (e) { console.warn('[recorder] OFFSCREEN_GET_VIDEO failed', e); }
  }

  // 拼 zip：每个 entry 都放在 baseName/ 子目录下
  const entries = filesText.map(f => ({
    name: `${baseName}/${f.name}`,
    bytes: textEncoder.encode(f.data),
  }));
  if (videoB64) {
    entries.push({
      name: `${baseName}/video.webm`,
      bytes: base64ToBytes(videoB64),
    });
  }
  const zipBytes = buildZipStored(entries);

  // 让 offscreen 用 <a download> 把 zip 写出去
  const zipB64 = bytesToBase64(zipBytes);
  await ensureOffscreen();
  await waitOffscreenReady(3000);
  await chrome.runtime.sendMessage({
    cmd: MSG.OFFSCREEN_DOWNLOAD_ZIP,
    target: 'offscreen',
    filename: `${baseName}.zip`,
    base64: zipB64,
  });

  console.log('[recorder] exported zip', baseName, 'size=', zipBytes.length);
  return baseName;
}

const textEncoder = new TextEncoder();

function originOf(u) {
  try { return new URL(u).origin; } catch { return ''; }
}

// v0.2.8: 把 URL 转成可作为文件名的字符串 (按页面拆分 a11y 用)
function urlToSafeFilename(u) {
  try {
    const x = new URL(u);
    // host + pathname; 去掉协议; 替换非法字符
    let s = (x.host + x.pathname).replace(/\/+$/, '');
    // hash 也带上(SPA 路由常见)
    if (x.hash) s += x.hash;
    if (x.search) s += x.search;
    s = s.replace(/[^a-zA-Z0-9._\-]+/g, '_');
    // 防止过长
    if (s.length > 120) s = s.slice(0, 60) + '__' + hash32(s).toString(16);
    return s || 'index';
  } catch {
    return 'page_' + hash32(String(u || '')).toString(16);
  }
}

function hash32(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

async function fetchExt(path) {
  const resp = await fetch(chrome.runtime.getURL(path));
  return resp.text();
}

/** 把消息发给 tab 内所有 frame(顶层 + 子 frame),失败的 frame 静默跳过 */
async function broadcastToAllFrames(tabId, msg) {
  let frames = [];
  try { frames = await chrome.webNavigation.getAllFrames({ tabId }) || []; } catch {}
  if (!frames.length) {
    // 退化:至少发一次给顶层
    try { await chrome.tabs.sendMessage(tabId, msg); } catch {}
    return;
  }
  await Promise.all(frames.map(f =>
    chrome.tabs.sendMessage(tabId, msg, { frameId: f.frameId }).catch(() => {})
  ));
}

// ---------- ZIP (stored, no compression) ----------
// CRC32 表
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 构建一个 ZIP 文件（stored / 不压缩）。entries: [{name, bytes}]。
 * 返回 Uint8Array。
 */
function buildZipStored(entries) {
  const enc = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.bytes);
    const size = e.bytes.length;

    // local file header
    const local = new Uint8Array(30 + nameBytes.length);
    const dvL = new DataView(local.buffer);
    dvL.setUint32(0, 0x04034b50, true);
    dvL.setUint16(4, 20, true);            // version needed
    dvL.setUint16(6, 0, true);             // flags
    dvL.setUint16(8, 0, true);             // method=stored
    dvL.setUint16(10, 0, true);            // mod time
    dvL.setUint16(12, 0x21, true);         // mod date (any)
    dvL.setUint32(14, crc, true);
    dvL.setUint32(18, size, true);
    dvL.setUint32(22, size, true);
    dvL.setUint16(26, nameBytes.length, true);
    dvL.setUint16(28, 0, true);            // extra len
    local.set(nameBytes, 30);
    localChunks.push(local, e.bytes);

    // central dir entry
    const central = new Uint8Array(46 + nameBytes.length);
    const dvC = new DataView(central.buffer);
    dvC.setUint32(0, 0x02014b50, true);
    dvC.setUint16(4, 20, true);            // version made by
    dvC.setUint16(6, 20, true);            // version needed
    dvC.setUint16(8, 0, true);
    dvC.setUint16(10, 0, true);
    dvC.setUint16(12, 0, true);
    dvC.setUint16(14, 0x21, true);
    dvC.setUint32(16, crc, true);
    dvC.setUint32(20, size, true);
    dvC.setUint32(24, size, true);
    dvC.setUint16(28, nameBytes.length, true);
    dvC.setUint16(30, 0, true);            // extra
    dvC.setUint16(32, 0, true);            // comment
    dvC.setUint16(34, 0, true);            // disk
    dvC.setUint16(36, 0, true);            // internal attrs
    dvC.setUint32(38, 0, true);            // external attrs
    dvC.setUint32(42, offset, true);       // local header offset
    central.set(nameBytes, 46);
    centralChunks.push(central);

    offset += local.length + e.bytes.length;
  }

  const centralSize = centralChunks.reduce((s, c) => s + c.length, 0);
  const centralOffset = offset;

  const eocd = new Uint8Array(22);
  const dvE = new DataView(eocd.buffer);
  dvE.setUint32(0, 0x06054b50, true);
  dvE.setUint16(4, 0, true);
  dvE.setUint16(6, 0, true);
  dvE.setUint16(8, entries.length, true);
  dvE.setUint16(10, entries.length, true);
  dvE.setUint32(12, centralSize, true);
  dvE.setUint32(16, centralOffset, true);
  dvE.setUint16(20, 0, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of localChunks) { out.set(c, p); p += c.length; }
  for (const c of centralChunks) { out.set(c, p); p += c.length; }
  out.set(eocd, p);
  return out;
}

function bytesToBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
