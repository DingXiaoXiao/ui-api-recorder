import { MSG, DEFAULT_CONFIG } from '../common/utils.js';

const $ = id => document.getElementById(id);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const CHECKBOXES = [
  'recordVideo', 'captureApi', 'captureActions', 'emitPlaywright',
  'exportApi', 'exportActions',
  // v0.2.8: 产物级开关
  'outVideo', 'outEvents', 'outA11y', 'outApiDetails', 'outSpec',
  // v0.3.1: hover 捕捉
  'captureHover',
  // v0.3.3: hover 诊断日志
  'hoverDebug',
];
const TEXT_FIELDS = {
  'api-include': 'apiInclude',
  'api-exclude': 'apiExclude',
  'pw-baseurl': 'pwBaseUrl',
  'pw-testid': 'pwTestidAttr',
  'export-prefix': 'exportPrefix',
};
const NUM_FIELDS = {
  'hover-ttl': 'hoverTtlMs',
  'hover-geom': 'hoverGeomThreshold',
};
const TOGGLES = { 'pw-networkidle': 'pwWaitForNetworkIdle' };

async function init() {
  const cfg = (await chrome.runtime.sendMessage({ cmd: MSG.CONFIG_GET })) || DEFAULT_CONFIG;

  for (const k of CHECKBOXES) $(`cb-${k}`).checked = !!cfg[k];
  for (const [id, key] of Object.entries(TEXT_FIELDS)) $(id).value = cfg[key] ?? '';
  for (const [id, key] of Object.entries(NUM_FIELDS)) $(id).value = cfg[key] ?? '';
  for (const [id, key] of Object.entries(TOGGLES)) $(id).checked = !!cfg[key];

  // 联动：emitPlaywright 依赖 captureActions；exportApi/exportActions 依赖对应的 capture*
  function syncDeps() {
    const ca = $('cb-captureActions').checked;
    const capi = $('cb-captureApi').checked;
    $('cb-emitPlaywright').disabled = !ca;
    if (!ca) $('cb-emitPlaywright').checked = false;
    $('cb-exportActions').disabled = !ca;
    if (!ca) $('cb-exportActions').checked = false;
    $('cb-exportApi').disabled = !capi;
    if (!capi) $('cb-exportApi').checked = false;

    // v0.2.8 产物开关依赖:
    //  outVideo       依赖 recordVideo
    //  outApiDetails  依赖 captureApi
    //  outSpec        依赖 emitPlaywright (而 emitPlaywright 又依赖 captureActions)
    //  outEvents/outA11y 与采集解耦,即使没采集也可以选(只是会是空文件/没快照)
    const rv = $('cb-recordVideo').checked;
    const ep = $('cb-emitPlaywright').checked;
    $('cb-outVideo').disabled = !rv;
    if (!rv) $('cb-outVideo').checked = false;
    $('cb-outApiDetails').disabled = !capi;
    if (!capi) $('cb-outApiDetails').checked = false;
    $('cb-outSpec').disabled = !ep;
    if (!ep) $('cb-outSpec').checked = false;
  }
  syncDeps();

  // 全部即时保存
  for (const k of CHECKBOXES) {
    $(`cb-${k}`).addEventListener('change', e => {
      saveOne(k, e.target.checked);
      syncDeps();
    });
  }
  for (const [id, key] of Object.entries(TEXT_FIELDS)) {
    $(id).addEventListener('input', e => saveOne(key, e.target.value));
  }
  for (const [id, key] of Object.entries(NUM_FIELDS)) {
    $(id).addEventListener('input', e => {
      const v = Number(e.target.value);
      if (Number.isFinite(v) && v > 0) saveOne(key, v);
    });
  }
  for (const [id, key] of Object.entries(TOGGLES)) {
    $(id).addEventListener('change', e => saveOne(key, e.target.checked));
  }

  await refresh();
  setInterval(refresh, 1000);
}

async function saveOne(key, value) {
  await chrome.runtime.sendMessage({ cmd: MSG.CONFIG_SET, patch: { [key]: value } });
}

async function refresh() {
  const tab = await activeTab();
  const state = await chrome.runtime.sendMessage({ cmd: MSG.GET_STATE, tabId: tab.id });
  setStatus(state, tab);
}

function setStatus(state, activeTabObj) {
  const rec = !!state?.recording;
  const el = $('status');
  el.textContent = rec ? '录制中' : '空闲';
  el.className = `status ${rec ? 'recording' : 'idle'}`;
  $('btn-start').disabled = rec;
  $('btn-stop').disabled = !rec;
  if (state?.stats) {
    $('stats').textContent = `请求 ${state.stats.total} · 命中 ${state.stats.kept} · 过滤 ${state.stats.dropped}`;
  }
  if (state?.filter) {
    $('filter-info').textContent = `include=${state.filter.include} | exclude=${state.filter.exclude}`;
  }
  // v0.3.2: 提示用户当前激活 tab 是否就是被录的那个
  const warn = $('tab-warn');
  if (rec && state?.tabId != null && activeTabObj && state.tabId !== activeTabObj.id) {
    warn.style.display = '';
    warn.textContent = `⚠ 你正在看 tab #${activeTabObj.id},但录制目标是 tab #${state.tabId}。切走的页面不会被记录。`;
  } else {
    warn.style.display = 'none';
    warn.textContent = '';
  }
}

$('btn-start').addEventListener('click', async () => {
  const tab = await activeTab();
  $('btn-start').disabled = true;
  $('hint').textContent = '';
  try {
    const r = await chrome.runtime.sendMessage({ cmd: MSG.START, tabId: tab.id });
    if (!r?.ok) throw new Error(r?.error || 'start failed');

    // 视频必须在 popup 的用户手势上下文里取 streamId
    const cfg = await chrome.runtime.sendMessage({ cmd: MSG.CONFIG_GET });
    if (cfg.recordVideo) {
      const streamId = await new Promise((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, id => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(id);
        });
      });
      if (!streamId) throw new Error('tabCapture.getMediaStreamId 返回空');
      const ack = await chrome.runtime.sendMessage({
        cmd: MSG.OFFSCREEN_START,
        streamId,
        tabId: tab.id,
      });
      if (!ack?.ok) throw new Error('视频启动失败：' + (ack?.error || ''));
    }
    await refresh();
  } catch (e) {
    alert('启动失败：' + (e?.message || e));
    console.error('[popup] start error', e);
    try { await chrome.runtime.sendMessage({ cmd: MSG.STOP }); } catch {}
    $('btn-start').disabled = false;
  }
});

$('btn-stop').addEventListener('click', async () => {
  $('btn-stop').disabled = true;
  $('hint').textContent = '正在 finalize 视频…';
  await chrome.runtime.sendMessage({ cmd: MSG.STOP });
  $('hint').textContent = '已停止。点"导出"生成 events.json/test.spec.ts';
  await refresh();
});

$('btn-export').addEventListener('click', async () => {
  $('hint').textContent = '正在打包…';
  const r = await chrome.runtime.sendMessage({ cmd: MSG.EXPORT });
  if (!r?.ok) {
    alert('导出失败：' + (r?.error || 'unknown'));
    $('hint').textContent = '';
  } else {
    $('hint').textContent = `已下载 ${r.baseName}.zip → 浏览器"下载"目录 (Ctrl/⌘+J 查看)`;
  }
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg.cmd === MSG.STATUS) {
    activeTab().then(t => setStatus(msg, t));
  }
});

init();
