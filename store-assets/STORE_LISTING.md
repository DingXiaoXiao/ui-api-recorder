# Chrome Web Store 上架材料 — UI + API Recorder v0.3.4

> 全部文案/字段已按 Chrome Web Store Developer Dashboard 表单顺序排好,直接复制粘贴即可。中英双版,按你的目标市场二选一(或都填,Chrome 支持多语言 listing)。

---

## 1. 基本信息(Store listing)

### 名称 Name
- **中文**:UI + API 录制器
- **English**: UI + API Recorder

### 摘要 Summary(最多 132 字符)
- **中文**:一键录屏 + 抓 API + 抓前端操作 + 自动生成 Playwright 脚本。四类产物可独立开关,本地处理,零上传。
- **English**: One-click capture: tab video, network calls, UI actions, and a ready-to-run Playwright spec. All local, nothing uploaded.

### 类别 Category
- Primary: **Developer Tools**
- Secondary (可选):**Productivity**

### 语言 Languages
- Default: `English`
- Additional: `Chinese (Simplified)`

---

## 2. 详细描述 Detailed Description

### 中文版(粘贴到 zh-CN listing)

```
UI + API Recorder 是为前端 / 测试 / QA 工程师设计的"一次操作,四份产物"录制工具。点一次「开始」,同时拿到:

✅ 屏幕录像 (video.webm)
✅ 后端 API 时间线 (events.json + api-details.json)
✅ 前端操作步骤 (events.json,含 role + accessible name,Playwright 同款定位)
✅ 可直接 npx playwright test 跑起来的 test.spec.ts

—— 全程本地处理,不上传任何数据。

【核心特性】

▸ Playwright Codegen 同款 selector 优先级
  testid → role+name → label → placeholder → text → cssPath
  生成的脚本 100% 兼容 @playwright/test。

▸ Hover 触发的弹框/菜单自动捕捉(v0.3.1+)
  鼠标悬浮 → 弹框浮出 → 点击菜单项的场景,自动把 hover 步骤也录下来,
  click 事件挂 triggeredBy 字段。回放时不会因缺 hover 而失败。

▸ 单 tab 录制状态可视化(v0.3.2+)
  录制目标 tab 显示红色 ●,非目标 tab 显示灰色 ◐,
  popup 同步橙色 warning,告诉你"你看的不是被录的那个 tab"。

▸ 产物粒度独立开关
  视频/API/UI/Playwright 脚本各自有开关,可按需勾选,
  产出文件可按"前缀-时间戳"自动命名,方便归档。

▸ API 过滤 (include/exclude 正则)
  只录关心的接口,不污染 events.json。

▸ 时间线 viewer (viewer.html)
  打开就能看的可交互回放页,API + UI 事件按时间轴并排,
  没有任何外部依赖,断网也能用。

【适用场景】

• E2E 自动化测试用例生成:把手动操作录下来,Agent / 人工补全
• 前后端联调:UI 操作 → API 调用一一对应,定位"哪个点击触发了哪个接口"
• Bug 复现:把视频 + 网络 + 操作打包一份,直接发给负责人
• 接口契约审查:API 时间线 + 请求/响应留档,review 时回看

【隐私 & 安全】

• 完全本地处理,不上传任何数据到任何远程服务器
• 不读取浏览器历史、书签、密码、cookie 等敏感数据
• 录制仅在用户点击「开始」后启动,「停止」后立即结束
• 不集成任何分析 SDK,不联网,不广告
• 源代码开源可审计

完整隐私政策见商店 listing 的「Privacy practices」标签页。

【系统要求】

• Chrome / Edge / Brave 等 Chromium 内核 ≥ 109
• 不依赖任何外部服务

【开源 & 反馈】

源码与 issue 见:<在此填入你的 GitHub 仓库 URL>
```

### English version

```
UI + API Recorder is a one-click capture tool for frontend, QA, and SDET engineers. Press Start once, and you get four artifacts in a single zip:

✅ Tab screen recording (video.webm)
✅ Network call timeline (events.json + api-details.json)
✅ UI action steps with role + accessible name (events.json)
✅ A ready-to-run Playwright spec (test.spec.ts)

— All processed locally. Nothing is uploaded anywhere.

【Key features】

▸ Playwright-codegen-grade selector priority
  testid → role+name → label → placeholder → text → cssPath
  Generated spec is 100% compatible with @playwright/test.

▸ Hover-triggered popups & menus are captured (v0.3.1+)
  For "mouse over → popup appears → click menu item" flows,
  the hover step is recorded too, and the click carries a
  triggeredBy field so replay won't fail for missing hover.

▸ Honest single-tab recording UI (v0.3.2+)
  The recording tab shows a red ● badge; other tabs show grey ◐.
  Popup shows an orange warning if you're viewing a non-target tab.

▸ Per-artifact toggles
  Video / API / UI / Playwright spec each have a switch.
  Output zip uses "<prefix>-<timestamp>" for easy archival.

▸ API filtering via include / exclude regex
  Capture only the endpoints you care about.

▸ Built-in timeline viewer (viewer.html)
  Open-and-play interactive viewer with API + UI on one timeline.
  Zero external dependencies, works offline.

【Use cases】

• E2E test scaffolding — record manual flows, let your agent or
  yourself fill in the assertions
• Frontend/backend handoff — see exactly which click triggered
  which API call
• Bug reproduction — ship one zip with video + network + steps
• API contract review — keep the request/response trail for review

【Privacy & security】

• 100% local processing, zero outbound network requests from the extension
• Does not read browser history, bookmarks, passwords, or cookies
• Recording only runs while you explicitly press Start
• No analytics SDK, no ads, no telemetry
• Open source and auditable

See "Privacy practices" tab on the store listing for the full policy.

【System requirements】

• Chromium 109+ (Chrome, Edge, Brave, Arc, etc.)
• No external services required

【Open source & feedback】

Source and issues: <put your GitHub repo URL here>
```

---

## 3. 隐私 Practices(Privacy practices 表单)

### Single purpose
```
Capture a screen recording, network request log, UI action log, and a generated Playwright test spec from a single browser tab the user explicitly starts recording, and save them as a local zip file.
```

### Permission justifications

| Permission | Justification |
|---|---|
| `debugger` | Required to attach the Chrome DevTools Protocol `Network` domain to the user-started recording tab. This is the only documented Chrome API that exposes complete request and response bodies, which is essential to producing the api-details.json artifact this extension is built to deliver. |
| `tabCapture` | Required to capture the visible tab's video frames so the extension can produce the video.webm artifact. The stream is consumed in-process by an offscreen MediaRecorder and never transmitted. |
| `activeTab` | Required to identify which specific tab the user clicked Start on, so recording is scoped to a single tab the user chose. |
| `tabs` | Required to read the recording tab's URL for navigation events (the `nav` entries in events.json) and to detect when the recording tab is closed so recording can stop cleanly. |
| `scripting` | Required to inject the content script that records DOM events (clicks, inputs, navigations) on the recording tab. |
| `storage` | Required to persist user configuration (toggles, filters, naming prefix, hover settings) across browser restarts. Stores only configuration, never recording content. |
| `downloads` | Required to save the final recording-<timestamp>.zip to the user's local Downloads folder via chrome.downloads.download. |
| `offscreen` | Required because Manifest V3 service workers cannot create object URLs needed by MediaRecorder; the offscreen document hosts the recorder. |
| `webNavigation` | Required to detect SPA route changes (history.pushState/replaceState) on the recording tab so the generated Playwright spec includes correct page.goto / page.waitForURL steps. |
| `host_permissions: <all_urls>` | The user must be able to record any site they choose. The content script is injected only into the tab the user explicitly starts recording on; it does not run background scans across all sites. |

### Data usage disclosures(逐项填表)

| Question | Answer |
|---|---|
| Personally identifiable information | **No** |
| Health information | **No** |
| Financial and payment information | **No** |
| Authentication information | **No**(extension itself never reads cookies, auth headers, or passwords; the user may choose to record a tab that contains such data, but the data stays on the user's local disk inside the downloaded zip and is never transmitted by the extension) |
| Personal communications | **No** |
| Location | **No** |
| Web history | **No**(only the URL of the single tab the user is actively recording is logged into the local events.json) |
| User activity | **No**(same caveat — captured on the recording tab only, stored locally) |
| Website content | **No**(same caveat) |

### Certifications(必勾)

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL
```
<把仓库里 store-assets/PRIVACY_POLICY.md 部署到 GitHub Pages / 你的官网,然后填那个 URL>
示例:https://<your-github-user>.github.io/ui-api-recorder/PRIVACY_POLICY
```

---

## 4. 视觉素材清单 Visual assets

| 资源 | 尺寸 | 数量 | 状态 |
|---|---|---|---|
| Store icon | 128×128 PNG | 1 | ✅ 已有 `icons/icon128.png` |
| Small promo tile | 440×280 PNG | 1 (推荐) | ⚠️ 待生成(下方有 prompt 模板) |
| Marquee promo tile | 1400×560 PNG | 1 (可选,首页推荐位需要) | ⚠️ 待生成 |
| Screenshots | 1280×800 或 640×400 PNG | 至少 1 张,最多 5 张 | ⚠️ 待截图(下方有清单) |

### 推荐截图清单(5 张,按这个顺序最有说服力)

1. **popup 主界面** — 展示所有开关、过滤器、Playwright 选项,1280×800 截 Chrome 工具栏弹窗
2. **录制中红色 ● 指示器 + 网页正常浏览** — 展示 v0.3.2 的"录制状态诚实化"
3. **viewer.html 时间线** — 展示 API + UI 事件并排回放
4. **生成的 test.spec.ts 截图** — VS Code / 任意编辑器打开,体现"开箱即用 Playwright"
5. **导出 zip 解压后的目录结构** — 4 个产物清晰可见

### 截图制作脚本(Mac/Linux)
```bash
# 推荐用 Chromium DevTools 的 device toolbar 切到 1280×800
# 或 macOS 自带 cmd+shift+4 选区截图后用 sips 缩放
sips -z 800 1280 input.png --out screenshot-1280x800.png
```

---

## 5. 发布前最终检查清单 Pre-submit checklist

```
□ 把 manifest.json 里的 "description" 改成商店摘要(<= 132 字符 完全一致)
□ 把源码里所有 console.log 调试日志清理掉(hoverDebug 由用户开关控制,保留 OK)
□ README.md 顶部加 Chrome Web Store 徽章占位
□ 准备一个公开的 GitHub repo 或 gist,把 PRIVACY_POLICY.md 部署到 Pages
□ 准备一个支持邮箱(Web Store 必填,会公开显示)
□ 商家身份验证(developer account 一次性 $5 USD,信用卡支付)
□ 申请 incognito split 模式审核:在 description 里加一句
  "Supports incognito (split) mode — recordings made in incognito stay incognito"
□ 拍 5 张截图 + 1 张 440×280 promo tile + (可选) 1 张 1400×560 marquee
□ 提交时勾选 "Visibility: Public" 或 "Unlisted"(私链分享)
□ 首次提交 → Google 审核 1~5 工作日(权限多 + debugger 通常更慢)
```

---

## 6. 审核常见拒绝点与规避建议 Common rejection reasons

| 拒绝点 | 触发条件 | 我们的规避 |
|---|---|---|
| **Excessive permissions** | 申请的权限超出 single purpose 说明 | `permissions` 已经是最小必需集;在 justification 表里逐条说明 |
| **Use of `debugger` API** | 高敏感 API,常被打回 | description / justification 里反复强调"only on the tab the user explicitly Started recording on" |
| **Remote code execution** | 加载 CDN 脚本会被秒拒 | 我们没有 `eval`、`new Function`、外部 `<script src>`,纯本地脚本 |
| **Privacy policy missing or vague** | URL 404 / 内容空洞 | 使用 store-assets/PRIVACY_POLICY.md 模板,部署到 GitHub Pages 后填 URL |
| **Misleading metadata** | 名称/描述/截图与实际功能不符 | 文案严格对齐实际功能,截图是真实运行界面 |
| **Single purpose violation** | 一个扩展做多件不相关的事 | 已统一表述为"capture + export";所有开关都服务于这一目的 |

---

## 7. 后续可选优化

- 考虑做一个 30 秒 demo 视频(YouTube unlisted)放到 listing 的 "Promotional video" 字段 — 转化率显著高于纯截图
- 在 GitHub repo 顶部加 Chrome Web Store install badge(发布后才有真实 URL)
- 国际化:目前 popup UI 是中文为主,考虑加 `_locales/en/messages.json` 把按钮文案做成 i18n;Chrome Store 审核员通常是英文使用者,UI 是英文能减少误解

---

文件清单一览:
- `store-assets/PRIVACY_POLICY.md` — 隐私政策(待部署到 Pages)
- `store-assets/STORE_LISTING.md` — 本文件(上架文案 + 检查清单)
- `store-assets/promo-*.png` — 待生成(见下一步)
