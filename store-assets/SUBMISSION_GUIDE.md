# Chrome Web Store 提交逐项指引

> 本文件按 Chrome Web Store Developer Dashboard 的表单顺序排列。每个字段直接告诉你"填什么"或"复制哪段"。
> 跟着做即可,不需要任何主观判断。

---

## 准备工作(开始前 30 分钟搞定)

### A. 准备一个公开 URL 用于隐私政策(必须公开可访问)

最快方案 — **GitHub Pages**(免费,5 分钟搞定):

```bash
# 1. 在 GitHub 创建一个 public repo,例如:ui-api-recorder
# 2. 把当前项目所有文件 push 上去
cd /path/to/your/local/clone
git init
git add .
git commit -m "Initial public release v0.3.4"
git branch -M main
git remote add origin https://github.com/<your-username>/ui-api-recorder.git
git push -u origin main

# 3. 在 GitHub 网页:
#    Settings -> Pages -> Source: Deploy from a branch
#    Branch: main, Folder: /store-assets
#    Save
# 4. 等 1~2 分钟,Pages 会给你一个 URL,长这样:
#    https://<your-username>.github.io/ui-api-recorder/
# 5. 隐私政策最终 URL 就是:
#    https://<your-username>.github.io/ui-api-recorder/
#    (index.html 自动作为首页)
```

**校验**:在隐身窗口打开这个 URL,能看到 "Privacy Policy - UI + API Recorder" 页面,就 OK。

### B. 准备支持邮箱

Chrome Web Store 要求一个公开的 support email。可以用:
- 你的工作邮箱
- 一个 Gmail 别名(推荐 `<你的名字>+chrome-store@gmail.com`)
- 项目专用邮箱

这个邮箱会显示在 listing 公开页,谁都能看到。

### C. 检查 developer account 状态

打开 https://chrome.google.com/webstore/devconsole

- 如果是第一次,会要求付 $5 USD 注册费(信用卡)
- 完成手机验证、地址验证
- 你说已经注册好,跳过这一步

---

## 提交流程(按顺序)

### Step 1 - 创建 item

1. 进入 Developer Dashboard -> 点击右上 **+ New item**
2. 上传 `ui-api-recorder-0.3.4.zip`(我重新打包的最终版,见本指引末尾下载链接)
3. 等待上传完成,自动进入 listing 编辑页面

### Step 2 - Store listing 标签页

依次填这些字段:

#### 2.1 Product details

| 字段 | 填什么 |
|---|---|
| **Item title** | `UI + API Recorder` |
| **Summary** (132 chars max) | `One-click capture: tab video, network calls, UI actions, and a ready-to-run Playwright spec. All local, nothing uploaded.` |
| **Description** | 粘贴下方 [Description 完整版](#description-完整版) |
| **Category** | `Developer Tools` |
| **Language** | `English` (然后下方可以 Add language -> Chinese (Simplified)) |

#### 2.2 Graphic assets

| 资源 | 上传哪个文件 |
|---|---|
| Store icon (128x128) | `icons/icon128.png` |
| Screenshots (1280x800,至少 1 张,推荐 5 张) | `store-assets/screenshot-1-popup.png` 到 `screenshot-5-export.png`(按编号顺序) |
| Small promotional tile (440x280) | `store-assets/promo-small-440x280.png` |
| Marquee promotional tile (1400x560) | `store-assets/promo-marquee-1400x560.png`(可选,但有就有机会上首页推荐位) |

#### 2.3 Additional fields

| 字段 | 填什么 |
|---|---|
| **Official URL** | 你的 GitHub repo URL,例如 `https://github.com/<your-username>/ui-api-recorder` |
| **Homepage URL** | 同上,或 GitHub Pages URL |
| **Support URL** | `https://github.com/<your-username>/ui-api-recorder/issues` |
| **Mature content** | 选 `No` |

---

### Step 3 - Privacy practices 标签页

#### 3.1 Single purpose

复制粘贴(精确这段,不要改):

```
Capture a screen recording, network request log, UI action log, and a generated Playwright test spec from a single browser tab the user explicitly starts recording, and save them as a local zip file.
```

#### 3.2 Permission justifications

每个权限都会出现一个文本框,逐个粘贴:

**debugger**
```
Required to attach the Chrome DevTools Protocol Network domain to the user-started recording tab. This is the only documented Chrome API that exposes complete request and response bodies, which is essential to producing the api-details.json artifact this extension is built to deliver. The attachment only happens after the user clicks Start, and only on the specific tab the user clicked Start on.
```

**tabCapture**
```
Required to capture the visible tab's video frames so the extension can produce the video.webm artifact. The stream is consumed in-process by an offscreen MediaRecorder and never transmitted to any server.
```

**activeTab**
```
Required to identify which specific tab the user clicked Start on, so recording is scoped to a single tab the user explicitly chose.
```

**tabs**
```
Required to read the recording tab's URL for navigation events (the nav entries in events.json) and to detect when the recording tab is closed so recording can stop cleanly.
```

**scripting**
```
Required to inject the content script that records DOM events (clicks, inputs, navigations) on the recording tab the user started.
```

**storage**
```
Required to persist user configuration (toggles, filters, naming prefix, hover settings) across browser restarts. Stores only configuration values, never any recording content or page content.
```

**downloads**
```
Required to save the final recording-<timestamp>.zip to the user's local Downloads folder via chrome.downloads.download. No upload occurs.
```

**offscreen**
```
Required because Manifest V3 service workers cannot create object URLs needed by MediaRecorder. The offscreen document hosts the recorder so video can be captured locally.
```

**webNavigation**
```
Required to detect SPA route changes (history.pushState and replaceState) on the recording tab so the generated Playwright spec includes correct page.goto and page.waitForURL steps.
```

**host_permissions: <all_urls>**
```
The user must be able to record any site they choose. The content script is injected only into the specific tab the user clicked Start on; it does not run background scans across all sites. The broad host pattern is the standard way Chrome extensions express "the user can pick any site."
```

#### 3.3 Data usage disclosures

按下表勾选/选填:

| 问题 | 答案 |
|---|---|
| Does your extension collect or use personally identifiable information? | **No** |
| Health information | **No** |
| Financial and payment information | **No** |
| Authentication information | **No** |
| Personal communications | **No** |
| Location | **No** |
| Web history | **No** |
| User activity | **No** |
| Website content | **No** |

> **重要**:Google 对这些字段的定义是"你的代码主动读取并处理这类数据"。我们的扩展只在用户主动点 Start 后录制用户选定的那一个 tab,且全部数据留在本地不上传 - 这种情况按 Chrome Web Store 政策不算"collect"。如果审核员追问,引用上方权限说明里的"only on the user-started tab, never transmitted"即可。

#### 3.4 Certifications(三项必勾)

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

#### 3.5 Privacy policy URL

填上 Step 1 准备好的那个 URL,例如:
```
https://<your-username>.github.io/ui-api-recorder/
```

---

### Step 4 - Distribution 标签页

| 字段 | 推荐填法 |
|---|---|
| **Visibility** | 首次提交建议选 `Unlisted`(只有拿到链接的人能看到,先小范围测试),通过后改成 `Public` |
| **Distribution** | `All regions` 或按需选择(没有特别限制就选 all) |
| **Pricing** | `Free` |
| **Mature content** | `No` |

---

### Step 5 - Submit for review

1. 顶部 **Submit for review** 按钮
2. 弹窗确认 -> Submit
3. 状态变成 `Pending review`

**审核时间**:
- 简单扩展:1-3 工作日
- 含 `debugger` + `tabCapture` 的:**5-10 工作日**(我们这种)
- 邮件通知结果

---

## Description 完整版

直接粘贴到 Store listing 的 Description 框(支持基本格式,无 Markdown):

```
UI + API Recorder is a one-click capture tool for frontend, QA, and SDET engineers. Press Start once and get four artifacts in a single zip:

* Tab screen recording (video.webm)
* Network call timeline (events.json + api-details.json)
* UI action steps with role + accessible name (events.json)
* A ready-to-run Playwright spec (test.spec.ts)

All processed locally. Nothing is uploaded anywhere.

KEY FEATURES

* Playwright-codegen-grade selector priority
  testid -> role+name -> label -> placeholder -> text -> cssPath
  Generated spec is 100% compatible with @playwright/test.

* Hover-triggered popups and menus are captured (v0.3.1+)
  For "mouse over -> popup appears -> click menu item" flows, the hover step is recorded too, and the click carries a triggeredBy field so replay won't fail for missing hover.

* Honest single-tab recording UI (v0.3.2+)
  The recording tab shows a red dot badge; other tabs show a grey dot. The popup shows an orange warning if you're viewing a non-target tab.

* Per-artifact toggles
  Video, API, UI, Playwright spec each have their own switch. Output zip uses "<prefix>-<timestamp>" naming for easy archival.

* API filtering via include / exclude regex
  Capture only the endpoints you care about.

* Built-in timeline viewer (viewer.html)
  Open-and-play interactive viewer with API and UI events on one timeline. Zero external dependencies. Works offline.

USE CASES

* E2E test scaffolding - record manual flows, let your agent or yourself fill in the assertions
* Frontend-backend handoff - see exactly which click triggered which API call
* Bug reproduction - ship one zip with video + network + steps to your colleague
* API contract review - keep the request/response trail for review

PRIVACY AND SECURITY

* 100% local processing, zero outbound network requests from the extension
* Does not read browser history, bookmarks, passwords, or cookies
* Recording only runs while you explicitly press Start
* No analytics SDK, no ads, no telemetry
* Open source and auditable

See the Privacy practices tab for the full policy.

INCOGNITO SUPPORT

Supports incognito (split) mode - recordings made in incognito stay in incognito; the extension cannot read data across the regular/incognito boundary.

SYSTEM REQUIREMENTS

* Chromium 109+ (Chrome, Edge, Brave, Arc, etc.)
* No external services required

OPEN SOURCE AND FEEDBACK

Source code and issue tracker: <https://github.com/your-username/ui-api-recorder>
```

> 提交前把最后一行的 `your-username` 改成你的真实 GitHub 用户名。

---

## 被打回时的应对

如果收到拒信,常见 3 类原因 + 对应回复模板:

### 情况 A:权限说明不充分(Insufficient permission justification)

在 dashboard 编辑权限说明,把上方 §3.2 对应权限的文本框再多写一句"用户场景":

```
[原说明] + Example user flow: a QA engineer clicks Start on tab A; the extension attaches CDP only to tab A; when the user clicks Stop, the extension detaches and saves a local zip. No other tab is touched at any time.
```

### 情况 B:Single purpose 模糊(Vague single purpose)

不要扩写,**反而要缩写**到 1 句话:

```
Records one browser tab the user selects and exports the recording as a local zip file.
```

### 情况 C:隐私政策 URL 失效或内容空洞

确认 GitHub Pages URL 在隐身窗口能打开,内容不是 README 而是结构化的 Privacy Policy。我已经生成了符合要求的 `index.html`(在 store-assets/)。

---

## 发布后(approved)

1. 立刻在隐身窗口安装一次自己,确认安装流程正常
2. 把 Chrome Web Store URL 加到 GitHub README 顶部(替换占位):
   ```markdown
   [![Chrome Web Store](https://img.shields.io/chrome-web-store/v/<your-extension-id>)](https://chrome.google.com/webstore/detail/<your-extension-id>)
   ```
3. 如果选了 Unlisted,确认稳定后到 Distribution 改成 Public,需要再次审核(通常更快,1-2 天)
4. 后续每次更新代码 -> 在 Package 标签页上传新 zip -> Submit for review

---

## 文件清单(我帮你准备好的全部产物)

提交时只需要这些文件:

- `ui-api-recorder-0.3.4.zip` - 扩展包本身(Step 1 上传)
- `store-assets/icon128.png` - 商店图标
- `store-assets/screenshot-1-popup.png` 到 `screenshot-5-export.png` - 5 张截图
- `store-assets/promo-small-440x280.png` - 小宣传图
- `store-assets/promo-marquee-1400x560.png` - 大宣传图
- `store-assets/index.html` - 部署到 GitHub Pages 作为隐私政策
- 本文件 `SUBMISSION_GUIDE.md` - 全程对照参考
