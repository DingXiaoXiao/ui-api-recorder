/**
 * 通用：消息常量、过滤器、配置 schema。
 */

export const MSG = {
  // popup ↔ background
  START: 'recorder/start',
  STOP: 'recorder/stop',
  EXPORT: 'recorder/export',
  GET_STATE: 'recorder/get-state',
  STATUS: 'recorder/status',
  CONFIG_GET: 'recorder/config-get',
  CONFIG_SET: 'recorder/config-set',

  // content → background
  FE_EVENT: 'recorder/fe-event',

  // background ↔ offscreen
  OFFSCREEN_START: 'offscreen/start',
  OFFSCREEN_STOP: 'offscreen/stop',
  OFFSCREEN_PING: 'offscreen/ping',
  OFFSCREEN_DOWNLOAD: 'offscreen/download',  // 让 offscreen 用 <a download> 触发下载
  OFFSCREEN_DOWNLOAD_ZIP: 'offscreen/download-zip',  // base64 → blob → 下载
  OFFSCREEN_GET_VIDEO: 'offscreen/get-video',        // 取最近一次录制视频的 base64
};

/** 默认配置：每个开关独立可关 */
export const DEFAULT_CONFIG = {
  // 模块开关(采集)
  recordVideo: true,         // 屏幕录像
  captureApi: true,          // 抓后端 HTTP（CDP Network）
  captureActions: true,      // 抓前端操作（click/input/keydown/...）
  emitPlaywright: true,      // 生成 Playwright .spec.ts（依赖 captureActions）

  // 导出开关(决定 events.json 里包含哪些 type)
  exportApi: true,           // 导出时是否包含 type=api(依赖 captureApi)
  exportActions: true,       // 导出时是否包含 type=ui/nav(依赖 captureActions)

  // v0.2.8: 产物级开关 — 决定 zip 里是否落每个文件
  // v0.3.0: a11y 体积大且对 Agent 上下文不友好,默认关闭;events.json 已自洽
  outVideo: true,            // video.webm
  outEvents: true,           // events.json (单文件自洽,含 computedName / uniquenessHints / semanticPeers / ancestors)
  outA11y: false,            // a11y/<page>.json — 调试用,默认关闭
  outApiDetails: true,       // api-details.json
  outSpec: true,             // test.spec.ts

  // v0.2.8: 导出包名前缀(留空=用 'recording')
  exportPrefix: 'recording',

  // 过滤(每行/每条逗号项是一条独立子表达式,空行忽略;任意命中即算 include/exclude)
  apiInclude: '',
  apiExclude: '\\.(png|jpg|jpeg|gif|webp|css|js|mjs|woff2?|svg|ico|map)(\\?|$)\nhot-update\nsockjs\nsentry',

  // Playwright 选项
  pwBaseUrl: '',                          // 留空则用录制开始时 tab 的 origin
  pwWaitForNetworkIdle: false,            // 每个动作前是否等 networkidle
  pwTestidAttr: 'data-testid',            // testid 属性名（多个用逗号分隔，按序匹配）

  // v0.3.1: hover 触发的弹框/按钮捕捉
  // 业务约束:hover 后必然伴随 click;无后续 click 的 hover 全部丢弃。
  // v0.3.3: TTL 默认放宽到 3000ms(用户实际 hover→popup→click 常 1.5~2.5 秒);
  //         有 reveal candidate 出现后自动续期 2× TTL,避免硬性截断。
  captureHover: true,                     // 启用 hover→click 回溯绑定
  hoverTtlMs: 3000,                       // hover reveal 捕获窗口(出现 candidate 后自动 ×2)
  hoverGeomThreshold: 240,                // trigger 与 reveal 几何中心距离阈值(px)
  hoverDebug: false,                      // 打开后在 DevTools 控制台打 [hover] 诊断日志
};

/** 把"多行/逗号分隔"的过滤字符串拆成单条数组,忽略空行和 # 开头的注释 */
export function splitPatterns(s) {
  if (!s) return [];
  return String(s)
    .split(/[\n,]/)
    .map(t => t.trim())
    .filter(t => t && !t.startsWith('#'));
}

/** 把多条子模式合并成"任意命中"的单一正则,自动跳过非法条目 */
function buildAnyOf(patterns) {
  const ok = [];
  for (const p of patterns) {
    try { new RegExp(p); ok.push(p); }
    catch { /* skip invalid pattern, don't break the whole filter */ }
  }
  if (!ok.length) return null;
  try { return new RegExp(ok.map(p => `(?:${p})`).join('|')); }
  catch { return null; }
}

export function compileFilter(includeRaw, excludeRaw) {
  const incList = splitPatterns(includeRaw);
  const excList = splitPatterns(excludeRaw);
  const inc = buildAnyOf(incList);
  const exc = buildAnyOf(excList);
  return {
    test(url) {
      if (exc && exc.test(url)) return { ok: false, reason: 'exclude' };
      if (inc && !inc.test(url)) return { ok: false, reason: 'not-included' };
      return { ok: true };
    },
    desc: {
      include: incList.length ? incList.join(' | ') : '(none)',
      exclude: excList.length ? excList.join(' | ') : '(none)',
    },
  };
}

export function nowTs() { return Date.now(); }

export async function loadConfig() {
  const raw = await chrome.storage.local.get('config');
  return { ...DEFAULT_CONFIG, ...(raw.config || {}) };
}

export async function saveConfig(patch) {
  const cur = await loadConfig();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ config: next });
  return next;
}
