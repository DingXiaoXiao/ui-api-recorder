"""Render 5 Chrome Web Store screenshots at exactly 1280x800 PNG.

Each screenshot is a high-fidelity mock that mirrors what a user will see
when they actually install the extension. We use Pillow rather than headless
Chrome because the sandbox does not have a browser available.
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.dirname(os.path.abspath(__file__))
W, H = 1280, 800
NAVY = (10, 22, 40)
TEAL = (0, 212, 170)
AMBER = (255, 91, 58)
GREY = (140, 150, 165)
LIGHT = (240, 244, 248)
WHITE = (255, 255, 255)
DARK = (24, 32, 48)
PANEL = (28, 38, 56)
BORDER = (60, 70, 88)

FNT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FNT_BLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FNT_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FNT_CJK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"


def f(path, size):
    return ImageFont.truetype(path, size)


def rounded_rect(d, xy, radius, fill=None, outline=None, width=1):
    d.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def header_bar(d, title, subtitle):
    # Top hero bar 1280x120
    d.rectangle([0, 0, W, 120], fill=NAVY)
    d.text((48, 30), title, fill=WHITE, font=f(FNT_BLD, 32))
    d.text((48, 76), subtitle, fill=TEAL, font=f(FNT_REG, 18))
    # version chip
    chip_x = W - 200
    rounded_rect(d, (chip_x, 40, chip_x + 152, 80), 20, fill=TEAL)
    d.text((chip_x + 18, 50), "v0.3.4", fill=NAVY, font=f(FNT_BLD, 20))


def footer_caption(d, text):
    d.rectangle([0, H - 60, W, H], fill=DARK)
    d.text((48, H - 44), text, fill=LIGHT, font=f(FNT_REG, 18))


# ===== Screenshot 1: Popup main UI =====
def shot1():
    img = Image.new("RGB", (W, H), LIGHT)
    d = ImageDraw.Draw(img)
    header_bar(d, "UI + API Recorder", "All-in-one capture: video + API + actions + Playwright spec")

    # Chrome browser frame
    bx, by, bw, bh = 60, 160, 1160, 580
    rounded_rect(d, (bx, by, bx + bw, by + bh), 12, fill=DARK)
    # Tab bar
    d.rectangle([bx, by, bx + bw, by + 44], fill=(48, 56, 72))
    for i, (color, _) in enumerate([(AMBER, "*"), (GREY, "x"), (GREY, "x")]):
        d.ellipse((bx + 18 + i * 18, by + 18, bx + 30 + i * 18, by + 30), fill=color)
    # URL bar
    rounded_rect(d, (bx + 100, by + 12, bx + bw - 200, by + 36), 6, fill=(70, 80, 96))
    d.text((bx + 116, by + 16), "https://example-app.com/dashboard", fill=LIGHT, font=f(FNT_MONO, 14))

    # Toolbar with extension icon highlighted
    icon_x = bx + bw - 80
    rounded_rect(d, (icon_x, by + 10, icon_x + 32, by + 38), 6, outline=TEAL, width=2)
    d.text((icon_x + 8, by + 14), "REC", fill=TEAL, font=f(FNT_BLD, 12))

    # Page content placeholder
    d.rectangle([bx, by + 44, bx + bw, by + bh], fill=(20, 26, 38))
    # popup panel coming out of toolbar
    px, py, pw, ph = bx + bw - 340, by + 60, 320, 500
    rounded_rect(d, (px, py, px + pw, py + ph), 10, fill=PANEL, outline=BORDER, width=1)

    # popup header
    rounded_rect(d, (px + 16, py + 16, px + 100, py + 44), 14, fill=AMBER)
    d.text((px + 28, py + 22), "RECORDING", fill=WHITE, font=f(FNT_BLD, 12))
    d.text((px + 116, py + 22), "0 reqs * 0 kept * 0 dropped", fill=GREY, font=f(FNT_REG, 11))

    # sections (compact)
    sections = [
        ("Capture", [("[x] Screen video (video.webm)", True),
                     ("[x] Backend API calls", True),
                     ("[x] Frontend UI actions", True),
                     ("[x] Generate Playwright spec", True)]),
        ("Export filters", [("[x] Include API events", True),
                            ("[x] Include UI events", True)]),
        ("Hover capture (v0.3.1+)", [("[x] Enable hover -> click rebinding", True),
                                     ("TTL: 3000 ms    Distance: 240 px", False)]),
    ]
    y = py + 60
    for title, items in sections:
        d.text((px + 16, y), title, fill=TEAL, font=f(FNT_BLD, 13))
        y += 22
        for txt, on in items:
            color = WHITE if on else GREY
            d.text((px + 20, y), txt, fill=color, font=f(FNT_REG, 12))
            y += 20
        y += 6

    # Buttons
    by2 = py + ph - 50
    for i, (label, fill, fg) in enumerate([("Start", AMBER, WHITE), ("Stop", BORDER, GREY), ("Export", TEAL, NAVY)]):
        bxn = px + 16 + i * 100
        rounded_rect(d, (bxn, by2, bxn + 92, by2 + 32), 6, fill=fill)
        d.text((bxn + 28, by2 + 8), label, fill=fg, font=f(FNT_BLD, 14))

    # Annotation arrow + label
    d.line([(px - 60, py + 100), (px + 10, py + 30)], fill=AMBER, width=3)
    d.text((bx + 40, py + 70), "One popup,\nfour artifacts.", fill=WHITE, font=f(FNT_BLD, 22))

    footer_caption(d, "1 / 5  -  Popup: every artifact has its own toggle. Configure once, record forever.")
    img.save(os.path.join(OUT, "screenshot-1-popup.png"), "PNG", optimize=True)
    print("shot1 ok")


# ===== Screenshot 2: Recording indicator on the recorded tab =====
def shot2():
    img = Image.new("RGB", (W, H), LIGHT)
    d = ImageDraw.Draw(img)
    header_bar(d, "Honest single-tab recording UI", "Always know which tab is being recorded")

    bx, by, bw, bh = 60, 160, 1160, 580
    rounded_rect(d, (bx, by, bx + bw, by + bh), 12, fill=WHITE, outline=BORDER, width=1)
    # tab strip with two tabs
    d.rectangle([bx, by, bx + bw, by + 44], fill=(220, 226, 234))
    # active tab
    rounded_rect(d, (bx + 12, by + 8, bx + 250, by + 44), 6, fill=WHITE)
    d.ellipse((bx + 22, by + 20, bx + 36, by + 34), fill=AMBER)
    d.text((bx + 44, by + 18), "Dashboard - Recorded", fill=DARK, font=f(FNT_BLD, 13))
    # inactive tab
    rounded_rect(d, (bx + 260, by + 8, bx + 480, by + 44), 6, fill=(200, 208, 218))
    d.text((bx + 274, by + 18), "Settings (not recorded)", fill=DARK, font=f(FNT_REG, 13))

    # URL bar
    rounded_rect(d, (bx + 16, by + 56, bx + bw - 16, by + 88), 6, fill=(240, 244, 250))
    d.text((bx + 32, by + 64), "https://example-app.com/dashboard", fill=DARK, font=f(FNT_MONO, 14))

    # page content placeholder
    d.rectangle([bx + 16, by + 100, bx + bw - 16, by + bh - 16], fill=(248, 250, 252))
    # Fake content
    for i in range(4):
        rounded_rect(d, (bx + 40, by + 130 + i * 80, bx + bw - 40, by + 190 + i * 80), 8, fill=WHITE, outline=(220, 226, 234), width=1)
        d.text((bx + 60, by + 148 + i * 80), f"Order #{1000 + i}", fill=DARK, font=f(FNT_BLD, 16))
        d.text((bx + 60, by + 168 + i * 80), "Tap to view details", fill=GREY, font=f(FNT_REG, 12))

    # The red badge indicator (shadow DOM) bottom-right
    ix = bx + bw - 240
    iy = by + bh - 80
    rounded_rect(d, (ix, iy, ix + 220, iy + 56), 28, fill=DARK)
    d.ellipse((ix + 16, iy + 18, ix + 36, iy + 38), fill=AMBER)
    d.text((ix + 48, iy + 16), "Recording this tab", fill=WHITE, font=f(FNT_BLD, 14))
    d.text((ix + 48, iy + 34), "v0.3.4", fill=TEAL, font=f(FNT_REG, 11))

    # Annotation
    d.line([(ix - 80, iy + 28), (ix + 6, iy + 28)], fill=AMBER, width=3)
    d.polygon([(ix + 6, iy + 28), (ix - 4, iy + 22), (ix - 4, iy + 34)], fill=AMBER)
    d.text((bx + 60, iy - 30), "Shadow-DOM badge (does NOT pollute page CSS)", fill=AMBER, font=f(FNT_BLD, 16))

    footer_caption(d, "2 / 5  -  Red dot = this tab is being recorded. Grey dot on other tabs. Never lose track.")
    img.save(os.path.join(OUT, "screenshot-2-indicator.png"), "PNG", optimize=True)
    print("shot2 ok")


# ===== Screenshot 3: Viewer timeline =====
def shot3():
    img = Image.new("RGB", (W, H), LIGHT)
    d = ImageDraw.Draw(img)
    header_bar(d, "Built-in timeline viewer", "API + UI events on one timeline, works offline")

    bx, by, bw, bh = 60, 160, 1160, 580
    rounded_rect(d, (bx, by, bx + bw, by + bh), 12, fill=PANEL, outline=BORDER, width=1)
    d.text((bx + 24, by + 20), "viewer.html  -  recording-2026-06-09T10-30-12", fill=WHITE, font=f(FNT_BLD, 18))
    d.text((bx + 24, by + 50), "33 events  -  12 API calls  -  18 UI actions  -  3 navigations", fill=TEAL, font=f(FNT_REG, 13))

    # Timeline lanes
    lane_y = by + 100
    lane_h = 80
    for i, lane in enumerate(["UI", "API", "NAV"]):
        d.rectangle([bx + 24, lane_y + i * lane_h, bx + bw - 24, lane_y + i * lane_h + lane_h - 10], fill=DARK, outline=BORDER)
        d.text((bx + 36, lane_y + i * lane_h + 8), lane, fill=GREY, font=f(FNT_BLD, 12))

    # Events on lanes
    import random
    random.seed(42)
    colors = {0: TEAL, 1: AMBER, 2: (180, 120, 255)}
    for lane in range(3):
        count = [12, 10, 3][lane]
        positions = sorted(random.sample(range(50, bw - 80), count))
        for x in positions:
            cx = bx + x
            cy = lane_y + lane * lane_h + 36
            d.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), fill=colors[lane])

    # Highlight one event with tooltip
    hx = bx + 600
    hy = lane_y + 36
    d.ellipse((hx - 14, hy - 14, hx + 14, hy + 14), outline=WHITE, width=2)
    tx, ty = hx + 30, hy - 60
    rounded_rect(d, (tx, ty, tx + 280, ty + 90), 8, fill=WHITE)
    d.text((tx + 12, ty + 8), "click  button  \"Submit\"", fill=DARK, font=f(FNT_BLD, 14))
    d.text((tx + 12, ty + 30), "computedName: Submit", fill=DARK, font=f(FNT_MONO, 11))
    d.text((tx + 12, ty + 46), "ancestors: form#order-form", fill=DARK, font=f(FNT_MONO, 11))
    d.text((tx + 12, ty + 62), "triggeredBy: h_a8c4 (hover)", fill=AMBER, font=f(FNT_MONO, 11))

    # Bottom event detail panel
    py2 = by + bh - 160
    d.rectangle([bx + 24, py2, bx + bw - 24, by + bh - 24], fill=DARK, outline=BORDER)
    d.text((bx + 36, py2 + 12), "POST /api/orders  -  200 OK  -  142 ms", fill=TEAL, font=f(FNT_BLD, 14))
    sample = [
        '{ "orderId": "ord_8821", "items": [...], "total": 49.90 }',
        "x-trace-id: 9c3f...   user-agent: Mozilla/5.0 ...",
        "Triggered by UI event: click \"Submit\" at t=12,304ms",
    ]
    for i, line in enumerate(sample):
        d.text((bx + 36, py2 + 38 + i * 22), line, fill=LIGHT, font=f(FNT_MONO, 12))

    footer_caption(d, "3 / 5  -  Standalone HTML viewer. No server, no upload. Double-click to replay.")
    img.save(os.path.join(OUT, "screenshot-3-viewer.png"), "PNG", optimize=True)
    print("shot3 ok")


# ===== Screenshot 4: Generated Playwright spec =====
def shot4():
    img = Image.new("RGB", (W, H), LIGHT)
    d = ImageDraw.Draw(img)
    header_bar(d, "Generated test.spec.ts", "Playwright-codegen-grade selectors, ready for npx playwright test")

    bx, by, bw, bh = 60, 160, 1160, 580
    rounded_rect(d, (bx, by, bx + bw, by + bh), 12, fill=DARK, outline=BORDER, width=1)
    # editor tab bar
    d.rectangle([bx, by, bx + bw, by + 36], fill=(40, 48, 64))
    rounded_rect(d, (bx + 12, by + 6, bx + 180, by + 36), 4, fill=DARK)
    d.text((bx + 24, by + 12), "test.spec.ts", fill=TEAL, font=f(FNT_BLD, 13))

    # gutter
    d.rectangle([bx, by + 36, bx + 48, by + bh], fill=(20, 26, 38))
    code = [
        "import { test, expect } from '@playwright/test';",
        "",
        "test('order submit flow', async ({ page }) => {",
        "  await page.goto('https://example-app.com/dashboard');",
        "",
        "  // hover -> popup -> click  (auto-captured)",
        "  await page.getByText('Order #1003').hover();",
        "  await page.getByRole('menuitem', { name: 'View Claw Details' }).click();",
        "",
        "  await page.getByLabel('Quantity').fill('3');",
        "  await page.getByRole('button', { name: 'Submit' }).click();",
        "",
        "  await expect(page.getByText('Order placed')).toBeVisible();",
        "  await expect(page).toHaveURL(/\\/orders\\/ord_\\d+/);",
        "});",
    ]
    # syntax-ish coloring
    KW = {"import", "from", "test", "expect", "async", "await", "const", "let"}
    STR_COLOR = (152, 195, 121)
    KW_COLOR = (198, 120, 221)
    FN_COLOR = (97, 175, 239)
    CMT_COLOR = (110, 120, 138)
    for i, line in enumerate(code):
        ly = by + 56 + i * 26
        d.text((bx + 14, ly), str(i + 1).rjust(3), fill=GREY, font=f(FNT_MONO, 12))
        # very lightweight coloring: render entire line in WHITE then overlay comments/strings
        color = LIGHT
        if line.strip().startswith("//"):
            color = CMT_COLOR
        d.text((bx + 60, ly), line, fill=color, font=f(FNT_MONO, 15))

    # Side panel with annotations
    ax = bx + 760
    ay = by + 60
    rounded_rect(d, (ax, ay, bx + bw - 16, by + bh - 16), 10, fill=PANEL)
    d.text((ax + 16, ay + 14), "Selector priority", fill=TEAL, font=f(FNT_BLD, 16))
    selectors = ["testid", "role + name", "label", "placeholder", "text", "cssPath"]
    for i, sel in enumerate(selectors):
        d.text((ax + 16, ay + 44 + i * 26), f"{i + 1}. {sel}", fill=WHITE, font=f(FNT_REG, 14))
    d.text((ax + 16, ay + 220), "Hover -> click is auto-bound", fill=AMBER, font=f(FNT_BLD, 14))
    d.text((ax + 16, ay + 244), "No more flaky \"element not found\"", fill=GREY, font=f(FNT_REG, 12))

    footer_caption(d, "4 / 5  -  Run with: npm i -D @playwright/test && npx playwright test")
    img.save(os.path.join(OUT, "screenshot-4-spec.png"), "PNG", optimize=True)
    print("shot4 ok")


# ===== Screenshot 5: Exported zip contents =====
def shot5():
    img = Image.new("RGB", (W, H), LIGHT)
    d = ImageDraw.Draw(img)
    header_bar(d, "One zip. Four artifacts.", "All exported to your local Downloads folder")

    bx, by, bw, bh = 60, 160, 1160, 580
    rounded_rect(d, (bx, by, bx + bw, by + bh), 12, fill=WHITE, outline=BORDER, width=1)

    # File tree on left
    tx, ty = bx + 32, by + 32
    d.text((tx, ty), "recording-2026-06-09T10-30-12.zip", fill=DARK, font=f(FNT_BLD, 18))
    files = [
        ("video.webm", "8.2 MB", "Tab screen recording", TEAL),
        ("events.json", "31 KB", "Slim event timeline (UI + API + nav)", AMBER),
        ("api-details.json", "126 KB", "Full request/response bodies", (180, 120, 255)),
        ("test.spec.ts", "4.1 KB", "Ready-to-run Playwright spec", (97, 175, 239)),
        ("viewer.html", "62 KB", "Offline interactive replay", GREY),
        ("a11y/", "(optional)", "Accessibility snapshots per page", GREY),
    ]
    for i, (name, size, desc, color) in enumerate(files):
        ly = ty + 50 + i * 88
        rounded_rect(d, (tx, ly, tx + 540, ly + 76), 10, fill=LIGHT, outline=(220, 226, 234), width=1)
        # icon block
        rounded_rect(d, (tx + 14, ly + 14, tx + 62, ly + 62), 8, fill=color)
        d.text((tx + 80, ly + 12), name, fill=DARK, font=f(FNT_BLD, 17))
        d.text((tx + 80, ly + 36), size, fill=GREY, font=f(FNT_MONO, 12))
        d.text((tx + 80, ly + 54), desc, fill=DARK, font=f(FNT_REG, 12))

    # Right side: privacy claim card
    px, py = bx + 620, by + 60
    rounded_rect(d, (px, py, bx + bw - 32, by + bh - 32), 14, fill=NAVY)
    d.text((px + 32, py + 24), "100% local", fill=TEAL, font=f(FNT_BLD, 36))
    d.text((px + 32, py + 76), "Zero network calls from this extension.", fill=WHITE, font=f(FNT_REG, 15))
    d.text((px + 32, py + 100), "Your recordings never leave your machine.", fill=WHITE, font=f(FNT_REG, 15))

    bullets = [
        "[x]  No analytics SDK",
        "[x]  No telemetry",
        "[x]  No ads",
        "[x]  Open source, auditable",
        "[x]  Recording is user-initiated only",
        "[x]  Supports incognito (split mode)",
    ]
    for i, b in enumerate(bullets):
        d.text((px + 32, py + 160 + i * 32), b, fill=LIGHT, font=f(FNT_REG, 16))

    footer_caption(d, "5 / 5  -  All processed in your browser. Nothing uploaded. Ever.")
    img.save(os.path.join(OUT, "screenshot-5-export.png"), "PNG", optimize=True)
    print("shot5 ok")


if __name__ == "__main__":
    shot1()
    shot2()
    shot3()
    shot4()
    shot5()
    print("DONE")
