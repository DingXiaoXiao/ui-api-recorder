# Privacy Policy — UI + API Recorder

_Last updated: 2026-06-03_

## Summary (TL;DR)

**This extension does not collect, transmit, sell, or share any personal data.** All recording artifacts (video, network logs, UI events, generated Playwright scripts) are processed entirely inside your local browser and downloaded to your local disk. Nothing is sent to any remote server operated by the developer or any third party.

## What the extension does

UI + API Recorder is a developer tool that captures, on a single browser tab the user explicitly starts recording on:

- A screen recording of the tab (via `chrome.tabCapture`)
- HTTP/HTTPS request/response metadata from that tab (via `chrome.debugger` + CDP `Network` domain)
- User interactions on that tab — clicks, inputs, navigations (via a content script)
- A generated Playwright `test.spec.ts` derived from the above

The output is packaged into a single `.zip` file and saved to the user's local Downloads folder using a standard `<a download>` link in an offscreen document. No `chrome.downloads` permission is used.

## Data the extension handles

| Category | Source | Where it goes |
|---|---|---|
| Tab video frames | `chrome.tabCapture` MediaStream | In-memory `MediaRecorder` → local `video.webm` in the downloaded zip |
| Network request URLs, headers, bodies, responses | CDP `Network.*` events from the user-recorded tab | Local `events.json` / `api-details.json` in the downloaded zip |
| DOM events (clicks, inputs, keypresses) and accessible names | Content script on the user-recorded tab | Local `events.json` in the downloaded zip |
| Extension configuration (toggles, filters, prefix) | `chrome.storage.local` | Stored locally in the browser profile, never transmitted |

All processing happens inside the user's browser. No network requests are made by the extension to any external service.

## Data the extension does NOT collect

- No analytics, telemetry, crash reports, or usage statistics
- No personally identifying information about the user (no email, name, IP, device ID, or account identifiers are read or transmitted by this extension)
- No data is sold or shared with third parties
- No advertising identifiers
- No data is used to train AI/ML models
- No background recording — recording only runs while the user explicitly clicks **Start** and stops when the user clicks **Stop** or closes the tab

## Permissions and why they are needed

| Permission | Purpose |
|---|---|
| `debugger` | Attach CDP to the recorded tab to read `Network` events (the only documented way for an extension to capture request bodies). Used only for the tab the user starts recording on. |
| `tabCapture` | Capture the visible tab's video stream for `video.webm`. Stream is consumed entirely in-process. |
| `tabs`, `activeTab` | Identify which tab the user starts recording on, and route events from that tab only. |
| `scripting` | Inject the content script that records UI events on the recorded tab. |
| `storage` | Persist user toggles (capture filters, output prefix, hover settings) across browser restarts. |
| `offscreen` | Run the `MediaRecorder` in an offscreen document (required because MV3 service workers cannot create `Blob` URLs for recording), and trigger the final zip download via a standard `<a download>` link. |
| `webNavigation` | Detect SPA route changes (`history.pushState`) so the generated Playwright script includes `page.goto(...)` steps. |
| `host_permissions: <all_urls>` | The user may need to record any site; the content script attaches to the recorded tab only on user action (Start). It does not run background scans of other tabs. |

The `"incognito": "split"` manifest entry ensures that Incognito and regular browsing sessions are isolated from each other — the extension cannot read data across that boundary.

## Data retention

- Recording artifacts exist only as long as the user keeps the downloaded `.zip` on disk. The user controls retention and deletion.
- The extension does not retain past recordings inside the browser profile beyond the duration of an active session.
- `chrome.storage.local` keeps only the user's configuration (toggles, filters, prefix) — no recording content.

## Third-party services

None. The extension does not load any remote script, font, or analytics SDK, and does not make any outbound network request.

## Open source

The full source code is auditable. Reviewers can verify the claims above by inspecting:

- `src/background/background.js` — CDP attach pipeline
- `src/content/content.js` — DOM event capture, runs only on the recorded tab
- `src/offscreen/offscreen.js` — MediaRecorder lifecycle
- `manifest.json` — declared permissions

Search the codebase for `fetch(`, `XMLHttpRequest`, `navigator.sendBeacon` — there are zero outbound calls from the extension itself.

## Children's privacy

The extension is a developer tool and is not directed at children under 13. It does not knowingly collect any data from any user.

## Changes to this policy

Material changes will be reflected in the extension's GitHub repository and the "Last updated" date above. Continued use after an update constitutes acceptance.

## Contact

For privacy questions or to report a concern, open an issue at the project's repository (URL provided on the Chrome Web Store listing) or email the address listed on the listing's "Support" tab.
