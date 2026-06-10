/**
 * Playwright 同款 locator 推断算法。
 * 优先级：testid → role+name → label → placeholder → text → cssPath。
 *
 * 这里只覆盖最常见的 ARIA 角色映射；要扩展可在 ROLE_MAP 增补。
 * accessible name 算法是简化版（W3C ARIA 1.2 完整算法过于复杂），
 * 覆盖：aria-labelledby > aria-label > 关联 label > placeholder > 自身 textContent。
 */

const ROLE_MAP = {
  A: el => el.hasAttribute('href') ? 'link' : null,
  BUTTON: () => 'button',
  INPUT: el => {
    const t = (el.type || 'text').toLowerCase();
    if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return 'button';
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'range') return 'slider';
    if (t === 'search') return 'searchbox';
    if (t === 'email' || t === 'tel' || t === 'url' || t === 'text' || t === 'password' || t === 'number') return 'textbox';
    return 'textbox';
  },
  TEXTAREA: () => 'textbox',
  SELECT: el => el.multiple ? 'listbox' : 'combobox',
  OPTION: () => 'option',
  IMG: el => el.alt ? 'img' : null,
  NAV: () => 'navigation',
  HEADER: () => 'banner',
  FOOTER: () => 'contentinfo',
  MAIN: () => 'main',
  ASIDE: () => 'complementary',
  H1: () => 'heading', H2: () => 'heading', H3: () => 'heading',
  H4: () => 'heading', H5: () => 'heading', H6: () => 'heading',
  UL: () => 'list', OL: () => 'list', LI: () => 'listitem',
  DIALOG: () => 'dialog',
  TABLE: () => 'table',
};

export function inferRole(el) {
  if (!el || el.nodeType !== 1) return null;
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.split(/\s+/)[0];
  const fn = ROLE_MAP[el.tagName];
  return fn ? fn(el) : null;
}

export function accessibleName(el) {
  if (!el || el.nodeType !== 1) return '';
  // 1) aria-labelledby
  const lblIds = el.getAttribute('aria-labelledby');
  if (lblIds) {
    const parts = lblIds.split(/\s+/).map(id => {
      const r = el.ownerDocument.getElementById(id);
      return r ? cleanText(r.textContent) : '';
    }).filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  // 2) aria-label
  const aria = el.getAttribute('aria-label');
  if (aria) return cleanText(aria);
  // 3) 关联 label
  if (el.labels && el.labels.length) {
    const t = cleanText([...el.labels].map(l => l.textContent).join(' '));
    if (t) return t;
  }
  // 4) <input type=submit value=...>
  if (el.tagName === 'INPUT') {
    const t = (el.type || '').toLowerCase();
    if ((t === 'button' || t === 'submit' || t === 'reset') && el.value) return cleanText(el.value);
    if (el.alt) return cleanText(el.alt);
  }
  // 5) <img alt>
  if (el.tagName === 'IMG' && el.alt) return cleanText(el.alt);
  // 6) title
  if (el.title) return cleanText(el.title);
  // 7) 文本（限制长度）
  const t = cleanText(el.textContent || '');
  return t.length > 80 ? t.slice(0, 80) : t;
}

function cleanText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

export function associatedLabel(el) {
  if (!el.labels || !el.labels.length) return '';
  return cleanText([...el.labels].map(l => l.textContent).join(' '));
}

export function visibleText(el) {
  if (!el) return '';
  const t = cleanText(el.textContent || '');
  return t.length <= 80 ? t : '';
}

/**
 * 推断 Playwright locator。
 * @returns { kind, name?, expr } expr 形如 getByRole('button', { name: '提交' })
 */
export function inferLocator(el, opts = {}) {
  const testidAttrs = (opts.testidAttr || 'data-testid').split(',').map(s => s.trim()).filter(Boolean);

  // 1) testid
  for (const a of testidAttrs) {
    const v = el.getAttribute(a);
    if (v) return { kind: 'testid', name: v, expr: `getByTestId(${jsStr(v)})` };
  }

  // 2) role + name
  const role = inferRole(el);
  const name = accessibleName(el);
  if (role && name) {
    return { kind: 'role', role, name, expr: `getByRole(${jsStr(role)}, { name: ${jsStr(name)} })` };
  }

  // 3) label
  const label = associatedLabel(el);
  if (label) return { kind: 'label', name: label, expr: `getByLabel(${jsStr(label)})` };

  // 4) placeholder
  const ph = el.getAttribute && el.getAttribute('placeholder');
  if (ph) return { kind: 'placeholder', name: ph, expr: `getByPlaceholder(${jsStr(ph)})` };

  // 5) 可见文本（短）
  const txt = visibleText(el);
  if (txt) return { kind: 'text', name: txt, expr: `getByText(${jsStr(txt)})` };

  // 6) 兜底 CSS
  const css = cssPath(el);
  return { kind: 'css', name: css, expr: `locator(${jsStr(css)})` };
}

export function cssPath(el) {
  if (!el || el.nodeType !== 1) return '';
  if (el.id) return `#${cssEscape(el.id)}`;
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML' && parts.length < 6) {
    let part = cur.tagName.toLowerCase();
    if (cur.classList && cur.classList.length) {
      const cls = [...cur.classList].slice(0, 2).map(cssEscape).join('.');
      if (cls) part += '.' + cls;
    }
    const parent = cur.parentElement;
    if (parent) {
      const sibs = [...parent.children].filter(c => c.tagName === cur.tagName);
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
}

export function jsStr(s) {
  return JSON.stringify(String(s == null ? '' : s));
}
