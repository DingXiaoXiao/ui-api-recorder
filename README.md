# UI + API Recorder

Chrome Manifest V3 扩展。一次操作，同时产出 4 类录制资料 —— 屏幕录像、后端 API 调用、前端操作步骤、可直接运行的 Playwright 测试脚本。每一类**独立开关**，全部本地处理，不上传任何数据。

当前版本：**v0.3.5**

---

## 产物

| 产物 | 文件 | 控制开关 |
|---|---|---|
| 屏幕录像 | `video.webm` | `recordVideo` |
| 后端 API 调用 | `events.json` 内 `type=api` 事件 | `captureApi` |
| 前端操作步骤 | `events.json` 内 `type=ui` / `nav` / `meta` 事件 | `captureActions` |
| Playwright 测试脚本 | `test.spec.ts` | `emitPlaywright`（依赖 `captureActions`） |
| 时间线 viewer | `viewer.html` | 始终生成 |

四个产物全部落到同一个 `recording-<时间戳>/` 目录（浏览器下载根目录下）。

---

## 安装

1. 打开 `chrome://extensions`，开启右上角「开发者模式」
2. 点「加载已解压的扩展程序」，选择本目录
3. 点击工具栏图标，打开弹窗

## 使用

1. 弹窗里勾选要录制的内容（任意组合）
2. 点「开始」→ 操作页面 → 点「停止」（等 1~2 秒让视频 finalize）
3. 点「导出」，在浏览器下载里得到完整目录

> 录制过程中如果页面跳转、或在新标签页中打开链接，扩展会自动跟随并继续录制（见下方「多标签录制」）。

---

## 核心能力

### 多标签录制（v0.3.4）

录制起点的标签页称为「主标签」。当被录页面跳转到新源、或在新标签页中打开链接时，扩展会自动把 debugger 附加到新标签，继续采集其 API 与 UI 事件，无需手动重新开始。

- 主标签关闭 → 录制停止
- 跟随标签关闭 → 仅从会话中移除，录制继续
- 录制状态浮层（页面右下角，Shadow DOM 隔离）：
  - 🔴 正在录制此页
  - ⚫ 录制中（此页不被录）
  - 隐藏 → 无会话

### hover 触发的弹框/按钮捕捉

点击菜单项 / tooltip / 下拉按钮前，自动把对应的 hover 也记录下来（`action: 'hover'`），click 事件挂 `triggeredBy: <hover_event_id>`，Playwright 回放时不会因缺 hover 而失败。

- 延迟 emit + TTL 滑动窗口（默认 3000ms，出现候选后自动续期）
- 检测：`MutationObserver`（portal 注入）+ CSS `:hover` 可见性扫描
- 防误绑：几何中心距离阈值 + role+name 指纹双重校验
- 无后续 click 的 hover 全部丢弃，不污染 `events.json`
- 诊断模式：popup 勾「诊断日志」→ 被录页 DevTools 控制台打 `[recorder.hover]`

### 自洽的 events.json

每个 UI 事件自带 `computedName` / `uniquenessHints` / `semanticPeers` / `ancestors[].anchor`，下游 Agent 无需依赖 `a11y.json`（后者体积大，默认不导出，需要时勾 `outA11y`）。

---

## 关于 Playwright 脚本生成

Playwright 官方的 codegen 是 Node.js 进程，扩展内无法直接调用。本扩展自研生成器，selector 优先级与 codegen 完全对齐：

```
testid → role+name → label → placeholder → text → cssPath
```

输出 100% 兼容 Playwright Test：

```ts
import { test, expect } from '@playwright/test';
test('...', async ({ page }) => {
  await page.goto('https://example.com');
  await page.getByRole('button', { name: '提交' }).click();
  await page.getByLabel('用户名').fill('foo');
  await page.press('Enter');
});
```

运行：`npm i -D @playwright/test && npx playwright test`。

### selector 已知局限

- **闭合 Shadow DOM**：抓不到内部元素，落到兜底 css selector
- **跨源 iframe**：content script 能进，但 spec 里会注释 `// TODO: frame for ...`，需手动改成 `page.frameLocator(...)`
- **文件上传**（`<input type=file>`）：路径无法获取，仅输出 click，需手动改成 `setInputFiles(...)`
- **拖拽**：暂不录制，需要可在 `content/content.js` 加 `dragstart/drop` 监听

---

## 二次开发

### 目录结构

```
src/
├── background/background.js      消息总线 + 生命周期 + 多标签 CDP Network
├── content/content.js            前端事件 collector（各开关在内部分支）
├── offscreen/offscreen.js        视频录制 + 文件下载
├── popup/                        UI
├── exporter/
│   └── playwright-exporter.js    Playwright spec 生成
├── viewer/viewer-standalone.html 时间线回放（独立 HTML，无外部依赖）
└── common/
    ├── utils.js                  消息常量、配置 schema、过滤器
    └── selector.js               Playwright 同款 locator 推断
```

### 加一个新事件类型

1. `content/content.js` 增加监听并 `send({ type: 'xxx', ... })`
2. `viewer-standalone.html` 的 `describe()` / 过滤器加分支
3. 若要进 Playwright spec，在 `exporter/playwright-exporter.js` 的 switch 加 case

### 加一个新开关

1. `common/utils.js` 的 `DEFAULT_CONFIG` 加默认值
2. `popup/popup.html` 加勾选框
3. `popup/popup.js` 把 id 加进 `CHECKBOXES` / `TEXT_FIELDS` / `TOGGLES`
4. `background/background.js` 在合适位置 `if (config.xxx) ...`

### 修改 selector 优先级

改 `exporter/playwright-exporter.js` 的 `locatorFor` 顺序；或改 `common/selector.js`（注：content.js 内有简化副本，需同步改）。

### 调试

- Service Worker 日志：`chrome://extensions` → 点「Service Worker」
- offscreen 日志：`chrome://extensions` → 点「检查视图: offscreen.html」
- content script 日志：被录页面的 DevTools Console

---

## 已知边界

- 录制时不要在被录标签上手动开 F12 —— Chrome 同一标签只允许一个 debugger 客户端
- `chrome.tabCapture` 的 streamId 必须在 popup 用户手势上下文里取（已处理，别改）
- 视频 mime 走 `video/webm;codecs=vp9` → vp8 → 默认。webm duration 头为 Infinity 是 MediaRecorder 通病，viewer 能正常播放

---

## 更新历史

- **v0.3.5** — 移除未使用的 `downloads` 权限（下载始终走 offscreen 的 `<a download>`，不依赖 `chrome.downloads`）
- **v0.3.4** — 多标签录制：页面跳转 / 新标签打开链接时自动跟随并继续采集 API 与 UI 事件
- **v0.3.3** — hover 捕捉修复：默认 TTL 800ms→3000ms 并自动续期、trigger 锚点改用 `e.target`、同 anchor 去重、scanRoots 加强、指纹距离阈值放宽、新增诊断模式与 `hoverAttributionExpired` 提示
- **v0.3.2** — 录制状态浮层指示器（Shadow DOM）+ popup 跨标签 warning
- **v0.3.1** — hover 触发的弹框/按钮捕捉（`action: 'hover'` + `triggeredBy`）
- **v0.3.0** — `events.json` 自洽（补 `computedName` 等字段）；`a11y.json` 默认不导出

---

## 许可

见 [LICENSE](./LICENSE)。所有录制数据仅在本地处理，扩展不发起任何外部网络请求。
