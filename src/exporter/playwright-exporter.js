/**
 * Playwright spec 生成器
 *
 * 输入:events(按 ts 排序的 ui/nav/meta 事件列表) + 配置
 * 输出:test.spec.ts 字符串
 *
 * locator 优先级(对齐 Playwright codegen):
 *   testid → role+name → label → placeholder → text → cssPath
 *
 * 动作映射:
 *   click  → .click()
 *   dblclick → .dblclick()
 *   fill   → .fill('...')
 *   select → .selectOption(...)
 *   press  → .press('Key') / 全局 keyboard.press 处理 ControlOrMeta+c
 *   check/uncheck → .check() / .uncheck()
 *   navigate → // 注释,用 waitForURL 兜底
 */

function jsStr(s) { return JSON.stringify(String(s == null ? '' : s)); }

/** 生成 getByRole 的 name 选项;短名走 string,长名走 RegExp,exact 由调用方控制 */
function nameOpt(name, { exact = false } = {}) {
  if (!name) return '';
  if (name.length <= 30) {
    return exact ? `, { name: ${jsStr(name)}, exact: true }` : `, { name: ${jsStr(name)} }`;
  }
  // 太长截断,避免 spec 难读
  return `, { name: ${jsStr(name.slice(0, 30))} }`;
}

function locatorFor(target, cfg) {
  if (!target) return null;
  const testidAttrs = (cfg.pwTestidAttr || 'data-testid')
    .split(',').map(s => s.trim()).filter(Boolean);

  // 1) testid
  if (target.testid && testidAttrs.includes(target.testid.attr)) {
    return `getByTestId(${jsStr(target.testid.value)})`;
  }
  // 2) role + name (v0.3.0: 优先 computedName)
  const nm = target.computedName || target.name;
  if (target.role && nm) {
    return `getByRole(${jsStr(target.role)}${nameOpt(nm)})`;
  }
  // 3) label
  if (target.label) return `getByLabel(${jsStr(target.label)})`;
  // 4) placeholder
  if (target.placeholder) return `getByPlaceholder(${jsStr(target.placeholder)})`;
  // 5) text(短文本)
  if (target.text && target.text.length <= 50) {
    return `getByText(${jsStr(target.text)}, { exact: true })`;
  }
  // 6) role only(无 name 但有 role,如点了空 button)
  if (target.role) return `getByRole(${jsStr(target.role)})`;
  // 7) css 兜底(v0.3.0 字段名为 selector,旧字段 css 兼容保留)
  const sel = target.selector || target.css;
  if (sel) return `locator(${jsStr(sel)})`;
  return null;
}

function pageOrFrame(target) {
  if (target && target.frameUrl) {
    return `page.frameLocator(${jsStr('// TODO: frame for ' + target.frameUrl)})`;
  }
  return 'page';
}

export function generatePlaywrightSpec(events, opts = {}) {
  const cfg = {
    pwBaseUrl: opts.pwBaseUrl || '',
    pwWaitForNetworkIdle: !!opts.pwWaitForNetworkIdle,
    pwTestidAttr: opts.pwTestidAttr || 'data-testid',
  };

  const meta = events.find(e => e.type === 'meta' && e.action === 'start');
  const startUrl = cfg.pwBaseUrl || meta?.url || 'about:blank';
  const title = (meta?.title || 'recorded test').replace(/[^\w\s一-龥-]/g, '').slice(0, 60) || 'recorded test';
  const viewport = meta?.viewport;

  const lines = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(`test(${jsStr(title)}, async ({ page }) => {`);
  if (viewport) {
    lines.push(`  await page.setViewportSize({ width: ${viewport.w}, height: ${viewport.h} });`);
  }
  lines.push(`  await page.goto(${jsStr(startUrl)});`);
  if (cfg.pwWaitForNetworkIdle) lines.push(`  await page.waitForLoadState('networkidle');`);

  // 统计是否有可操作事件;若全无,给一个清晰提示
  let hasUi = false;

  for (const ev of events) {
    if (ev.type === 'meta') continue;
    if (ev.type === 'api') continue;
    if (ev.type === 'nav' && ev.action === 'navigate') {
      lines.push(`  // navigate: ${ev.from} → ${ev.to}`);
      lines.push(`  await page.waitForURL(${jsStr(ev.to)});`);
      if (cfg.pwWaitForNetworkIdle) lines.push(`  await page.waitForLoadState('networkidle');`);
      continue;
    }
    if (ev.type !== 'ui') continue;

    // 全局组合键(没有具体目标元素)走 page.keyboard
    if (ev.action === 'press' && Array.isArray(ev.modifiers) && ev.modifiers.length) {
      const mods = ev.modifiers.map(m => m === 'Meta' || m === 'Control' ? 'ControlOrMeta' : m);
      // 去重
      const uniq = [...new Set(mods)];
      const combo = uniq.concat([ev.key]).join('+');
      // 如果 target 还有 role/name,优先打到目标元素
      const loc = locatorFor(ev.target, cfg);
      const base = pageOrFrame(ev.target);
      if (loc && ev.target && (ev.target.role || ev.target.testid)) {
        lines.push(`  await ${base}.${loc}.press(${jsStr(combo)});`);
      } else {
        lines.push(`  await page.keyboard.press(${jsStr(combo)});`);
      }
      hasUi = true;
      continue;
    }

    const loc = locatorFor(ev.target, cfg);
    if (!loc) {
      lines.push(`  // [skipped: no locator] ${ev.action}`);
      continue;
    }
    const base = pageOrFrame(ev.target);
    const head = `${base}.${loc}`;

    switch (ev.action) {
      case 'click': {
        const o = [];
        if (ev.button === 1) o.push(`button: 'middle'`);
        else if (ev.button === 2) o.push(`button: 'right'`);
        if (ev.modifiers && ev.modifiers.length) {
          const mods = ev.modifiers.map(m => m === 'Meta' || m === 'Control' ? 'ControlOrMeta' : m);
          const uniq = [...new Set(mods)];
          o.push(`modifiers: [${uniq.map(jsStr).join(', ')}]`);
        }
        lines.push(`  await ${head}.click(${o.length ? `{ ${o.join(', ')} }` : ''});`);
        hasUi = true;
        break;
      }
      case 'dblclick': {
        lines.push(`  await ${head}.dblclick();`);
        hasUi = true;
        break;
      }
      case 'fill': {
        lines.push(`  await ${head}.fill(${jsStr(ev.value || '')});`);
        hasUi = true;
        break;
      }
      case 'select': {
        if (Array.isArray(ev.value)) {
          const arr = ev.value.map(o => `{ value: ${jsStr(o.value)} }`).join(', ');
          lines.push(`  await ${head}.selectOption([${arr}]);`);
        } else if (ev.value) {
          lines.push(`  await ${head}.selectOption({ value: ${jsStr(ev.value.value)} });`);
        }
        hasUi = true;
        break;
      }
      case 'check': {
        lines.push(`  await ${head}.check();`);
        hasUi = true;
        break;
      }
      case 'uncheck': {
        lines.push(`  await ${head}.uncheck();`);
        hasUi = true;
        break;
      }
      case 'press': {
        lines.push(`  await ${head}.press(${jsStr(ev.key || '')});`);
        hasUi = true;
        break;
      }
      default:
        lines.push(`  // [unknown action] ${ev.action}`);
    }

    if (cfg.pwWaitForNetworkIdle) lines.push(`  await page.waitForLoadState('networkidle');`);
  }

  if (!hasUi) {
    lines.push(`  // [empty] 录制期间未捕获到任何前端操作。`);
    lines.push(`  // 可能原因:captureActions 未开启,或 content script 未注入页面(extension 列表里"刷新"扩展并刷新被测页面后重试)。`);
  }

  lines.push('});');
  lines.push('');
  return lines.join('\n');
}
