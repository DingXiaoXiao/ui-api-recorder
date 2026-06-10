# UI + API Recorder v0.3.3

Chrome Manifest V3 扩展。一次操作同时产出 4 类资料,每类**独立开关**,可二次开发。

## v0.3.3 更新(Hover 捕捉真实修复)

通过用户实测发现 v0.3.1 默认参数过紧 + 几何中心计算偏差 → hover 几乎全部 prune,events.json 看不到 `action: 'hover'`。本版本针对性修复:

- **默认 TTL: 800ms → 3000ms**:实际 hover→popup 浮出→看清→click 链路常 1.5~2.5 秒
- **TTL 自动续期**:出现 reveal candidate 后,TTL 自动再加 2×(给用户充分阅读决定时间)
- **trigger 锚点修正**:不再 pre-`semanticAncestor`,直接用 `e.target` 作为 trigger,几何中心更准
- **同 anchor 去重**:用 `nearestContainer` 判等,避免 hover 在嵌套元素之间冒泡产生 N 条重复记录
- **scanRoots 加强**:portal 容器扩到末尾 8 个 + 向下 2 层 + 全局 `[role=tooltip|menu|dialog|menuitem]` querySelectorAll 兜底
- **fingerprint 距离阈值放宽**:`×1` → `×1.5`(popup 离 trigger 偏远是常见的)
- **诊断模式**:popup 新增 "诊断日志" 开关 → 在被录页面 DevTools 控制台打 `[recorder.hover]` 日志
- **hoverAttributionExpired warning**:bindClick 失败但最近确实有 hover 被 prune → click 事件挂 `warnings: ['hoverAttributionExpired']`,提示用户调大 TTL
- **ancestor-role 兜底策略**:click 元素的祖先 8 层内有 `[role=tooltip|menu|dialog]` → 算 low-confidence 命中,挂 `hoverAttributionByFingerprint`

## v0.3.2 更新

- **录制状态诚实化**:
  - 页面右下角新增浮层指示器(Shadow DOM 隔离,不污染页面样式)
    - 🔴 红色 ● **正在录制此页** → 此 tab 就是录制目标
    - ⚫ 灰色 ◐ **录制中(此页不被录,切回原 tab 才会记录)** → 有 session 在跑但此 tab 不是目标
    - 隐藏 → 无 session
  - popup 顶部新增橙色 warning:`⚠ 你正在看 tab #N,但录制目标是 tab #M`
  - 修复了"切到另一个 tab 看不出来是不是还在录"的 UX 问题
- **架构限制说明(未改动)**:录制依然是单 tab 绑定的;切到其他 tab 期间的操作和 API 不会进 events.json。要"切到哪录到哪"需要做方案 B(跟随激活 tab,重新 attach debugger),本版本未实现。

## v0.3.1 更新

- **hover 触发的弹框/按钮捕捉**:点击菜单项/tooltip/下拉按钮前,自动把对应的 hover 也记录下来(`action: 'hover'`),click 事件挂 `triggeredBy: <hover_event_id>`,Playwright 回放时不会因缺 hover 而失败
  - 策略:延迟 emit + TTL 滑动窗口(默认 800ms)
  - 检测机制:`MutationObserver`(portal 注入)+ 可见性扫描(纯 CSS `:hover`)
  - 防误绑:几何中心距离阈值(默认 200px)+ role+name 指纹双重校验
  - 多 hover 命中标 `attribution.ambiguous: true`
  - 无后续 click 的 hover 全部丢弃,events.json 不污染
- popup 增加 3 个新配置项:`captureHover`、`hoverTtlMs`、`hoverGeomThreshold`

## v0.3.0 更新

- `events.json` 自洽:每个 UI 事件补 `computedName` / `uniquenessHints` / `semanticPeers` / `ancestors[].anchor`,Agent 不再依赖 a11y.json
- `a11y/<page>.json` 默认**不导出**(体积大,Agent 上下文成本高),需要时勾选 `outA11y`

## 产物

| 产物 | 文件 | 控制开关 |
|---|---|---|
| 屏幕录像 | `video.webm` | `recordVideo` |
| 后端 API 调用 | `events.json` 内 `type=api` 事件 | `captureApi` |
| 前端操作步骤 | `events.json` 内 `type=ui` / `nav` / `meta` 事件 | `captureActions` |
| Playwright 测试脚本 | `test.spec.ts` | `emitPlaywright`(依赖 `captureActions`) |
| 时间线 viewer | `viewer.html` | 始终生成 |

四个产物全部落到同一个 `recording-时间戳/` 目录(下载根目录下)。

## 安装

1. `chrome://extensions` → 打开"开发者模式"
2. "加载已解压的扩展程序" → 选本目录
3. 工具栏图标点开,进入弹窗

## 使用

1. 弹窗里勾选要录制的内容(任意组合)
2. 点"开始" → 操作页面 → 点"停止"(等 1~2 秒视频 finalize)
3. 点"导出" → 浏览器下载里得到完整目录

## 关于 Playwright Codegen

**做不到的**:Playwright codegen 是 Node.js 进程,扩展内无法直接调用。

**做了什么替代**:扩展自研生成器,selector 优先级与 codegen 完全对齐:

```
testid → role+name → label → placeholder → text → cssPath
```

输出格式 100% 兼容 Playwright Test:
```ts
import { test, expect } from '@playwright/test';
test('...', async ({ page }) => {
  await page.goto('https://example.com');
  await page.getByRole('button', { name: '提交' }).click();
  await page.getByLabel('用户名').fill('foo');
  await page.press('Enter');
});
```

跑这份脚本:`npm i -D @playwright/test && npx playwright test`。

### 已知 selector 局限

- **闭合 Shadow DOM**:抓不到内部元素,会落到兜底 css selector
- **跨源 iframe**:content script 能进,但生成 spec 时会注释 `// TODO: frame for ...`,需要手动改成 `page.frameLocator(...)`
- **文件上传**(`<input type=file>`):路径没法获取,生成器只输出 click,需要手动改成 `setInputFiles(...)`
- **拖拽**:目前不录,需要可以改 `content/content.js` 加 `dragstart/drop` 监听

## 二次开发

### 目录

```
src/
├── background/background.js      消息总线 + 生命周期 + CDP Network
├── content/content.js            前端事件 collector(各开关在内部分支)
├── offscreen/offscreen.js        视频录制 + 文件下载(SW 没 createObjectURL,统一走这里)
├── popup/                        UI
├── exporter/
│   └── playwright-exporter.js    Playwright spec 生成
├── viewer/viewer-standalone.html 时间线回放(独立 HTML,无外部依赖)
└── common/
    ├── utils.js                  消息常量、配置 schema、过滤器
    └── selector.js               Playwright 同款 locator 推断(供生成器复用)
```

### 加一个新事件类型

1. 在 `content/content.js` 增加监听并 `send({ type: 'xxx', ... })`
2. 在 `viewer-standalone.html` 的 `describe()` / 过滤器里加分支
3. 如果要进 Playwright spec,在 `exporter/playwright-exporter.js` 的 switch 里加 case

### 加一个新开关

1. `common/utils.js` 的 `DEFAULT_CONFIG` 加默认值
2. `popup/popup.html` 加勾选框
3. `popup/popup.js` 把 id 加进 `CHECKBOXES` / `TEXT_FIELDS` / `TOGGLES`
4. `background/background.js` 在合适的位置 `if (config.xxx) ...`

### 修改 selector 优先级

改 `exporter/playwright-exporter.js` 的 `locatorFor` 函数顺序;或修改 `common/selector.js`(注:content.js 内有简化副本,需要同步改)。

### 调试

- Service Worker 日志:`chrome://extensions` → 点"Service Worker"
- offscreen 日志:`chrome://extensions` → 点"检查视图: offscreen.html"
- content script 日志:就在被录制页面的 DevTools Console 里

## 已知边界

- 录制时不要刷新被录制 tab,debugger 会 detach
- chrome.tabCapture 的 streamId **必须**在 popup 的用户手势上下文里取(已处理,提示一下别改)
- 视频 mime 走 `video/webm;codecs=vp9` → vp8 → 默认。webm duration 头是 Infinity 是 MediaRecorder 通病,viewer 能正常播放
