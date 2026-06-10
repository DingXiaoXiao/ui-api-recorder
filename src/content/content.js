/**
 * Content script 入口
 *
 * v0.3.0:
 *  - describe() 重写 → computedName / uniquenessHints / semanticPeers / ancestors 智能截断
 *  - 类名白名单 / null 规整 / 容器内 uniqueness
 *
 * v0.3.1:
 *  - hover → click 回溯绑定:延迟 emit + TTL 滑动窗口
 *    - 监听 mouseover 识别 hover 起点
 *    - MutationObserver(portal/popover/tooltip 容器新增)
 *    - 可见性扫描(覆盖纯 CSS :hover)
 *    - click 时反向查询:命中 → 输出 hover + click(triggeredBy);未命中 → 丢弃 hover
 *    - 几何中心距离交叉校验,防止 portal 单例 tooltip 误归因
 *    - 多 hover 命中标 attribution.ambiguous + warnings
 *    - mouseleave 立即清队列
 */

(() => {
  if (window.__actionRecorderInjected) return;
  window.__actionRecorderInjected = true;

  let recording = false;
  let cfg = null;
  let bound = false;

  // ---------- 文本规整 ----------
  const cleanText = s => (s || '').replace(/\s+/g, ' ').trim();
  const nullable = s => {
    const t = cleanText(s);
    return t ? t : null;
  };

  // ---------- role 推断 ----------
  const ROLE_MAP = {
    A: el => el.hasAttribute('href') ? 'link' : null,
    BUTTON: () => 'button',
    INPUT: el => {
      const t = (el.type || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'search') return 'searchbox';
      return 'textbox';
    },
    TEXTAREA: () => 'textbox',
    SELECT: el => el.multiple ? 'listbox' : 'combobox',
    OPTION: () => 'option',
    H1: () => 'heading', H2: () => 'heading', H3: () => 'heading',
    H4: () => 'heading', H5: () => 'heading', H6: () => 'heading',
    NAV: () => 'navigation', MAIN: () => 'main', DIALOG: () => 'dialog',
    FORM: () => 'form', ASIDE: () => 'complementary',
    HEADER: () => 'banner', FOOTER: () => 'contentinfo',
  };
  function inferRole(el) {
    if (!el || el.nodeType !== 1) return null;
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    const fn = ROLE_MAP[el.tagName];
    return fn ? fn(el) : null;
  }

  // ---------- W3C accname 1.2 ----------
  function computeAccessibleName(el) {
    if (!el || el.nodeType !== 1) return null;
    const doc = el.ownerDocument || document;
    const lblIds = el.getAttribute('aria-labelledby');
    if (lblIds) {
      const parts = lblIds.split(/\s+/).map(id => {
        const ref = doc.getElementById(id);
        return ref ? cleanText(ref.textContent) : '';
      }).filter(Boolean);
      const v = nullable(parts.join(' '));
      if (v) return v;
    }
    const aria = el.getAttribute('aria-label');
    if (aria) { const v = nullable(aria); if (v) return v; }
    if (el.labels && el.labels.length) {
      const v = nullable([...el.labels].map(l => l.textContent).join(' '));
      if (v) return v;
    }
    if (el.tagName === 'INPUT') {
      const t = (el.type || '').toLowerCase();
      if (['button', 'submit', 'reset'].includes(t) && el.value) {
        const v = nullable(el.value); if (v) return v;
      }
      if (el.alt) { const v = nullable(el.alt); if (v) return v; }
    }
    if (el.tagName === 'IMG' && el.alt) { const v = nullable(el.alt); if (v) return v; }
    const ph = el.getAttribute('placeholder');
    if (ph) { const v = nullable(ph); if (v) return v; }
    if (el.title) { const v = nullable(el.title); if (v) return v; }
    const text = nullable(el.textContent);
    if (text) return text.length > 120 ? text.slice(0, 120) : text;
    return null;
  }

  function getTestId(el, attrList) {
    for (const a of attrList) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) return { attr: a, value: v };
    }
    return null;
  }
  function cssEscape(s) {
    return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  }

  function shortSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + cssEscape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML' && parts.length < 4) {
      let part = cur.tagName.toLowerCase();
      const cls = stableClasses(cur);
      if (cls.length) part += '.' + cssEscape(cls[0]);
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

  function isStableClass(c) {
    if (!c || typeof c !== 'string') return false;
    if (c.length > 40) return false;
    if (/^_/.test(c)) return false;
    if (/_[a-zA-Z0-9]{2,6}$/.test(c)) return false;
    if (/[-_][a-z0-9]{5,}$/i.test(c) && /\d/.test(c)) return false;
    if (/^[a-z0-9]{8,}$/i.test(c) && /\d/.test(c) && /[a-z]/i.test(c)) return false;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(c)) return false;
    return true;
  }
  function stableClasses(el) {
    if (!el || !el.classList) return [];
    return [...el.classList].filter(isStableClass).slice(0, 4);
  }

  const ANCHOR_TAGS = new Set(['DIALOG','FORM','MAIN','NAV','SECTION','ASIDE','HEADER','FOOTER']);
  const ANCHOR_ROLES = new Set([
    'dialog','alertdialog','form','main','navigation','region',
    'banner','contentinfo','complementary','search','group','list','menu','tablist',
  ]);
  function isAnchor(el) {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getAttribute && el.getAttribute('role');
    if (r && ANCHOR_ROLES.has(r.split(/\s+/)[0])) return true;
    if (ANCHOR_TAGS.has(el.tagName)) {
      if (el.tagName === 'SECTION') {
        return !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'));
      }
      return true;
    }
    return false;
  }

  function semanticAncestor(el, maxDepth = 4) {
    let cur = el; let i = 0;
    while (cur && cur.nodeType === 1 && i < maxDepth) {
      const r = inferRole(cur);
      if (r || (cur.getAttribute && cur.getAttribute('role'))) return cur;
      cur = cur.parentElement; i++;
    }
    return el;
  }
  function nearestContainer(el, maxDepth = 8) {
    let cur = el.parentElement; let i = 0;
    while (cur && cur.nodeType === 1 && i < maxDepth) {
      if (isAnchor(cur)) return cur;
      cur = cur.parentElement; i++;
    }
    return el.ownerDocument?.body || document.body;
  }

  function ancestorSnap(el, isAnchorFlag) {
    if (!el || el.nodeType !== 1) return null;
    const snap = {
      tag: el.tagName.toLowerCase(),
      role: inferRole(el) || null,
      name: computeAccessibleName(el),
    };
    if (el.id) snap.id = el.id;
    const cls = stableClasses(el);
    if (cls.length) snap.classes = cls;
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) snap.ariaLabel = ariaLabel.slice(0, 80);
    const roleAttr = el.getAttribute('role');
    if (roleAttr) snap.roleAttr = roleAttr;
    if (el.getAttribute('data-testid')) snap.testid = el.getAttribute('data-testid').slice(0, 80);
    if (isAnchorFlag) snap.anchor = true;
    return snap;
  }
  function ancestorsOf(el, maxDepth = 5) {
    const out = [];
    let cur = el.parentElement; let i = 0; let stopped = false;
    while (cur && cur.nodeType === 1 && i < maxDepth) {
      const anchor = isAnchor(cur);
      out.push(ancestorSnap(cur, anchor));
      i++;
      if (anchor) { stopped = true; break; }
      cur = cur.parentElement;
    }
    if (!stopped && cur && cur.parentElement && out.length) {
      out[out.length - 1].truncated = true;
    }
    return out;
  }

  function computeUniqueness(target, container, role, name) {
    if (!container || !role || !name) {
      return { uniqueInContainer: null, totalInContainer: 0 };
    }
    let peers;
    try {
      const byRole = container.querySelectorAll(`[role="${cssEscape(role)}"]`);
      const set = new Set(byRole);
      const implicit = container.querySelectorAll('a[href], button, input, select, textarea, h1, h2, h3, h4, h5, h6');
      for (const el of implicit) if (inferRole(el) === role) set.add(el);
      peers = [...set].filter(el => computeAccessibleName(el) === name);
    } catch { peers = []; }
    if (peers.length <= 1) {
      return { uniqueInContainer: true, totalInContainer: peers.length || 1 };
    }
    const idx = peers.indexOf(target);
    const hint = {
      uniqueInContainer: false,
      totalInContainer: peers.length,
      index: idx >= 0 ? idx : null,
    };
    const near = nearbyDisambiguator(target);
    if (near) hint.nearbyText = near;
    return hint;
  }
  function nearbyDisambiguator(el) {
    let sib = el.previousElementSibling; let steps = 0;
    while (sib && steps < 3) {
      const tag = sib.tagName;
      if (/^H[1-6]$/.test(tag) || tag === 'LABEL' || tag === 'LEGEND' || tag === 'CAPTION') {
        const t = nullable(sib.textContent);
        if (t) return t.slice(0, 60);
      }
      sib = sib.previousElementSibling; steps++;
    }
    let parent = el.parentElement; let up = 0;
    while (parent && up < 2) {
      const h = parent.querySelector('h1,h2,h3,h4,h5,h6,legend,caption');
      if (h && !el.contains(h) && h !== el) {
        const t = nullable(h.textContent);
        if (t) return t.slice(0, 60);
      }
      parent = parent.parentElement; up++;
    }
    return null;
  }

  function semanticPeersOf(target, container, role) {
    if (!container || !role) return [];
    let peers;
    try {
      const byRole = container.querySelectorAll(`[role="${cssEscape(role)}"]`);
      const set = new Set(byRole);
      const implicit = container.querySelectorAll('a[href], button, input, select, textarea, h1, h2, h3, h4, h5, h6');
      for (const el of implicit) if (inferRole(el) === role) set.add(el);
      peers = [...set];
    } catch { peers = []; }
    return peers.slice(0, 8).map(el => {
      const o = { role, name: computeAccessibleName(el), selector: shortSelector(el) };
      if (el === target) o.isTarget = true;
      return o;
    });
  }

  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    const sem = semanticAncestor(el);
    const testidAttrs = ((cfg && cfg.pwTestidAttr) || 'data-testid')
      .split(',').map(s => s.trim()).filter(Boolean);
    const tid = getTestId(sem, testidAttrs) || getTestId(el, testidAttrs);

    const role = inferRole(sem);
    const computedName = computeAccessibleName(sem);
    const container = nearestContainer(sem);

    let testidUnique = null;
    if (tid) {
      try {
        const all = container.querySelectorAll(`[${cssEscape(tid.attr)}="${cssEscape(tid.value)}"]`);
        testidUnique = all.length === 1;
      } catch { testidUnique = null; }
    }
    return {
      tag: sem.tagName.toLowerCase(),
      role,
      computedName,
      name: computedName || '',
      testid: tid,
      testidUnique,
      placeholder: (sem.getAttribute && sem.getAttribute('placeholder')) || '',
      label: (sem.labels && sem.labels[0]?.textContent) ? cleanText(sem.labels[0].textContent) : '',
      text: cleanText((sem.textContent || '').slice(0, 120)),
      selector: shortSelector(sem),
      frameUrl: window !== window.top ? location.href : '',
      isTop: window === window.top,
      uniquenessHints: computeUniqueness(sem, container, role, computedName),
      semanticPeers: semanticPeersOf(sem, container, role),
      ancestors: ancestorsOf(sem, 5),
    };
  }

  // ---------- 通信 ----------
  function send(event) {
    const payload = { cmd: 'recorder/fe-event', event };
    try {
      const p = chrome.runtime.sendMessage(payload);
      if (p && typeof p.catch === 'function') {
        p.catch(err => {
          console.warn('[recorder.content] sendMessage failed, retry once', err);
          setTimeout(() => {
            try { chrome.runtime.sendMessage(payload).catch(() => {}); } catch {}
          }, 50);
        });
      }
    } catch (e) {
      console.warn('[recorder.content] sendMessage threw', e);
    }
  }

  // ============================================================
  // v0.3.1: HOVER → CLICK 回溯绑定模块
  // ============================================================
  const HoverModule = (() => {
    let mo = null;
    let scanTimer = null;
    /**
     * activeHovers: 最近 TTL 窗口内未完成绑定的 hover 记录
     *   { id, ts, triggerEl, triggerSnapshot, triggerRect, triggerCenter,
     *     candidates: Map<el, { strategy, revealedAt, rect, center }>,
     *     baselineVisibility: WeakMap<el, bool>,
     *     ttlTimer }
     */
    const activeHovers = [];
    const HOVER_ID_PREFIX = () => `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    // v0.3.3: 最近被 TTL prune 掉的 hover,用于 click 时提示 "hover→click 间隔过长"
    const recentlyPruned = [];   // [{ts, triggerEl, hadCandidate}]
    const PRUNE_LOG_KEEP_MS = 5000;

    function ttl() { return (cfg && cfg.hoverTtlMs) || 3000; }
    function geomThreshold() { return (cfg && cfg.hoverGeomThreshold) || 240; }
    function dbg(...args) { if (cfg && cfg.hoverDebug) console.debug('[recorder.hover]', ...args); }

    function centerOf(rect) {
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    function distance(a, b) {
      if (!a || !b) return Infinity;
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    /** 元素是否"可见"(粗略版,够回溯使用) */
    function isVisible(el) {
      if (!el || el.nodeType !== 1 || !el.isConnected) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const cs = el.ownerDocument.defaultView.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (parseFloat(cs.opacity) === 0) return false;
      if (el.hasAttribute('hidden')) return false;
      const ah = el.getAttribute('aria-hidden');
      if (ah === 'true') return false;
      return true;
    }

    /** 是否"看起来像 popover/menu/tooltip/dropdown"——白名单加速,避免拿大量普通节点 */
    function looksLikeReveal(el) {
      if (!el || el.nodeType !== 1) return false;
      const r = el.getAttribute && el.getAttribute('role');
      if (r && /^(tooltip|menu|menuitem|listbox|dialog|alertdialog|menubar|combobox)$/.test(r)) return true;
      const cls = (el.className && typeof el.className === 'string') ? el.className : '';
      if (/(tooltip|popover|popper|dropdown|menu|tippy|popup|overlay|flyout)/i.test(cls)) return true;
      const tag = el.tagName;
      if (tag === 'DIALOG') return true;
      // 任何插入后立刻可交互的元素也算
      if (tag === 'BUTTON' || tag === 'A') {
        // 仅当其在 trigger 附近(由 distance 校验保证)
        return true;
      }
      return false;
    }

    // 待扫描的候选根:hover trigger 的祖先(2 层) + 兄弟 + body 末尾 portal 容器
    // v0.3.3: portal 容器扩大到末尾 8 个 + 向下递归 2 层;并加全局 popup-like 节点兜底
    function scanRoots(triggerEl) {
      const roots = new Set();
      // ancestors 2 层
      let cur = triggerEl.parentElement; let i = 0;
      while (cur && i < 2) { roots.add(cur); cur = cur.parentElement; i++; }
      // siblings
      const parent = triggerEl.parentElement;
      if (parent) for (const c of parent.children) if (c !== triggerEl) roots.add(c);
      // body 末尾 portal,向下展开 2 层
      const body = document.body;
      if (body) {
        const last = [...body.children].slice(-8);
        for (const c of last) {
          roots.add(c);
          // 1 层
          if (c.children && c.children.length < 40) {
            for (const c1 of c.children) {
              roots.add(c1);
              // 2 层(portal Modal > Inner > Popup 这种深层结构)
              if (c1.children && c1.children.length < 40) {
                for (const c2 of c1.children) roots.add(c2);
              }
            }
          }
        }
      }
      // 全局 popup-like 兜底:任何 [role=tooltip|menu|dialog|menuitem|listbox|combobox] 都纳入候选
      try {
        const popups = document.querySelectorAll(
          '[role=tooltip],[role=menu],[role=menuitem],[role=dialog],[role=alertdialog],[role=listbox],[role=combobox]'
        );
        for (const p of popups) roots.add(p);
      } catch {}
      return [...roots];
    }

    /** 在 trigger 附近找新出现的 reveal 候选 */
    function probeReveals(hoverRec, strategy) {
      const trigger = hoverRec.triggerEl;
      if (!trigger || !trigger.isConnected) return;
      const roots = scanRoots(trigger);
      for (const root of roots) {
        if (!root || !root.isConnected) continue;
        // root 自身
        considerCandidate(hoverRec, root, strategy);
        // 1 层子节点(避免遍历大树)
        if (root.children && root.children.length < 50) {
          for (const c of root.children) considerCandidate(hoverRec, c, strategy);
        }
      }
    }

    function considerCandidate(hoverRec, el, strategy) {
      if (!el || el.nodeType !== 1) return;
      if (el === hoverRec.triggerEl || hoverRec.triggerEl.contains(el)) return;  // 自身不算
      if (hoverRec.candidates.has(el)) return;
      // baseline:hover 启动那一刻 baseline 不可见,现在可见 → 算"显现"
      const baseline = hoverRec.baselineVisibility.get(el);
      const visNow = isVisible(el);
      if (baseline === true) return;  // 之前就可见,不算 reveal
      if (!visNow) return;            // 仍不可见,不入库
      if (!looksLikeReveal(el)) return;
      const rect = el.getBoundingClientRect();
      const cen = centerOf(rect);
      // 几何阈值粗筛:trigger 中心与候选中心距离超阈值直接丢(放宽到 ×4,大屏 dropdown 友好)
      if (distance(cen, hoverRec.triggerCenter) > geomThreshold() * 4) return;
      hoverRec.candidates.set(el, { strategy, revealedAt: Date.now(), rect, center: cen });
      dbg('candidate captured', {
        hoverId: hoverRec.id, strategy,
        role: el.getAttribute && el.getAttribute('role'),
        tag: el.tagName,
        dist: Math.round(distance(cen, hoverRec.triggerCenter)),
      });
      // v0.3.3: 出现 candidate → 自动续期 TTL(再给 2× ttl,覆盖用户阅读+决定时间)
      if (hoverRec.ttlTimer) {
        clearTimeout(hoverRec.ttlTimer);
        hoverRec.ttlTimer = setTimeout(() => {
          const i = activeHovers.indexOf(hoverRec);
          if (i >= 0) {
            recentlyPruned.push({ ts: Date.now(), triggerEl: hoverRec.triggerEl, hadCandidate: hoverRec.candidates.size > 0 });
            activeHovers.splice(i, 1);
            dbg('hover pruned (after renewal)', { hoverId: hoverRec.id, candidates: hoverRec.candidates.size });
          }
        }, ttl() * 2);
      }
    }

    /** 整页 baseline:仅给 trigger 的 scanRoots 建索引,避免遍历整树 */
    function recordBaseline(hoverRec) {
      const roots = scanRoots(hoverRec.triggerEl);
      for (const root of roots) {
        if (!root || !root.isConnected) continue;
        hoverRec.baselineVisibility.set(root, isVisible(root));
        if (root.children && root.children.length < 50) {
          for (const c of root.children) {
            hoverRec.baselineVisibility.set(c, isVisible(c));
          }
        }
      }
    }

    function startMutationObserver() {
      if (mo || !document.documentElement) return;
      mo = new MutationObserver(mutations => {
        if (!activeHovers.length) return;
        for (const m of mutations) {
          if (m.type === 'childList') {
            for (const n of m.addedNodes) {
              if (n.nodeType !== 1) continue;
              for (const h of activeHovers) considerCandidate(h, n, 'mutation');
            }
          } else if (m.type === 'attributes') {
            for (const h of activeHovers) considerCandidate(h, m.target, 'mutation');
          }
        }
      });
      mo.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'aria-hidden', 'hidden'],
        // 不监听 characterData,避免文本输入页爆量
      });
    }

    function ensureScanLoop() {
      if (scanTimer) return;
      scanTimer = setInterval(() => {
        if (!activeHovers.length) {
          clearInterval(scanTimer); scanTimer = null; return;
        }
        for (const h of activeHovers) probeReveals(h, 'visibility');
      }, 120);
    }

    function pruneExpired() {
      const now = Date.now();
      while (activeHovers.length && now - activeHovers[0].ts > ttl()) {
        activeHovers.shift();   // 未绑定 click → 丢弃
      }
    }

    function noteHover(triggerEl) {
      if (!triggerEl || triggerEl.nodeType !== 1) return null;
      // v0.3.3: 同一 nearestContainer 在 TTL 内只允许一条记录,避免子元素冒泡产生 N 条
      const anchor = (() => {
        try { return nearestContainer(triggerEl); } catch { return triggerEl; }
      })();
      if (activeHovers.some(h => h._anchor === anchor && Date.now() - h.ts < ttl())) {
        return null;
      }
      const rect = triggerEl.getBoundingClientRect();
      // 若 trigger 覆盖面积过大(>60% viewport),换用更小的子元素提高几何精度
      // 极端 case:semanticAncestor 上提到 body/main 容器,导致 distance 永远超阈值
      let effectiveTrigger = triggerEl;
      const viewport = window.innerWidth * window.innerHeight;
      if (viewport > 0 && rect.width * rect.height / viewport > 0.6) {
        effectiveTrigger = triggerEl;  // 保留原 trigger,但 center 用 rect 中心
      }
      const rec = {
        id: HOVER_ID_PREFIX(),
        ts: Date.now(),
        triggerEl: effectiveTrigger,
        _anchor: anchor,
        triggerRect: rect,
        triggerCenter: centerOf(rect),
        triggerSnapshot: null,    // 延迟到 emit 时再算 describe(贵)
        candidates: new Map(),
        baselineVisibility: new WeakMap(),
        ttlTimer: null,
      };
      recordBaseline(rec);
      activeHovers.push(rec);
      startMutationObserver();
      ensureScanLoop();
      dbg('noteHover', {
        hoverId: rec.id,
        tag: triggerEl.tagName,
        role: triggerEl.getAttribute && triggerEl.getAttribute('role'),
        rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
      });
      // TTL 到期自动丢(无 candidate 则记 recentlyPruned 以便 click 时提示)
      rec.ttlTimer = setTimeout(() => {
        const i = activeHovers.indexOf(rec);
        if (i >= 0) {
          recentlyPruned.push({ ts: Date.now(), triggerEl: rec.triggerEl, hadCandidate: rec.candidates.size > 0 });
          activeHovers.splice(i, 1);
          dbg('hover pruned (initial TTL)', { hoverId: rec.id, candidates: rec.candidates.size });
        }
      }, ttl() + 50);
      return rec;
    }

    /** mouseout/mouseleave:若 trigger 已离开且其候选全部不可见,立即清掉这条 */
    function noteLeave(triggerEl) {
      const now = Date.now();
      for (let i = activeHovers.length - 1; i >= 0; i--) {
        const h = activeHovers[i];
        if (h.triggerEl !== triggerEl) continue;
        let anyVisible = false;
        for (const [el] of h.candidates) if (isVisible(el)) { anyVisible = true; break; }
        if (!anyVisible) {
          clearTimeout(h.ttlTimer);
          activeHovers.splice(i, 1);
        }
        // 否则保留:用户可能从 trigger 移到 popup 上点击
        if (now - h.ts > ttl()) {
          clearTimeout(h.ttlTimer);
          activeHovers.splice(i, 1);
        }
      }
    }

    /** click 时反向查询匹配的 hover */
    function bindClick(clickedEl) {
      pruneExpired();
      // v0.3.3: 即便 activeHovers 空,也要查 recentlyPruned 给出诊断
      if (!activeHovers.length) {
        const now = Date.now();
        // 清掉 5s 之前的
        while (recentlyPruned.length && now - recentlyPruned[0].ts > PRUNE_LOG_KEEP_MS) {
          recentlyPruned.shift();
        }
        if (recentlyPruned.length) {
          dbg('bindClick: no active hovers but recent prune exists', {
            pruned: recentlyPruned.length,
            hadCandidate: recentlyPruned.some(p => p.hadCandidate),
          });
        }
        return null;
      }
      const clickedRect = clickedEl.getBoundingClientRect();
      const clickedCen = centerOf(clickedRect);
      const clickedRole = inferRole(semanticAncestor(clickedEl));
      const clickedName = computeAccessibleName(semanticAncestor(clickedEl));
      dbg('bindClick', {
        clickedRole, clickedName: (clickedName || '').slice(0, 40),
        activeHovers: activeHovers.length,
      });

      const matches = [];
      for (const h of activeHovers) {
        // 直接命中:click 落在某 candidate 内
        let containmentMatch = false;
        let chosenCand = null;
        let chosenStrategy = null;
        for (const [el, info] of h.candidates) {
          if (el === clickedEl || el.contains(clickedEl)) {
            containmentMatch = true;
            chosenCand = el;
            chosenStrategy = info.strategy;
            break;
          }
        }
        // 几何 + 指纹命中:portal 场景下 click 可能不落在我们抓的 candidate 内,
        // 但落点离 trigger 一定距离内,且 click 元素自身是新出现的(刚 reveal)
        // v0.3.3: 放宽到 ×1.5 (popup 离 trigger 偏远是常见的)
        let fingerprintMatch = false;
        if (!containmentMatch) {
          const dist = distance(clickedCen, h.triggerCenter);
          if (dist <= geomThreshold() * 1.5) {
            // 看 candidates 里有没有 role+name 与 click 元素一致的
            for (const [el, info] of h.candidates) {
              const r = inferRole(semanticAncestor(el));
              const n = computeAccessibleName(semanticAncestor(el));
              if (r && r === clickedRole && n && n === clickedName) {
                fingerprintMatch = true;
                chosenCand = el;
                chosenStrategy = info.strategy;
                break;
              }
            }
            // 没有匹配 candidate 但 click 元素本身就是某 popup 内的可交互元素
            // → 退一步:只要 click 元素是 popup-like 子树的一员就算 low-conf 命中
            if (!fingerprintMatch && h.candidates.size === 0) {
              // 兜底:click 元素的祖先里有 [role=tooltip|menu|dialog|menuitem]
              let p = clickedEl.parentElement;
              for (let i = 0; p && i < 8; i++, p = p.parentElement) {
                const rr = p.getAttribute && p.getAttribute('role');
                if (rr && /^(tooltip|menu|menuitem|dialog|alertdialog|listbox|combobox)$/.test(rr)) {
                  fingerprintMatch = true;
                  chosenCand = p;
                  chosenStrategy = 'ancestor-role';
                  break;
                }
              }
            }
          }
        }
        if (containmentMatch || fingerprintMatch) {
          matches.push({ h, chosenCand, chosenStrategy,
            confidence: containmentMatch ? 'high' : 'low',
            distance: distance(clickedCen, h.triggerCenter) });
        }
      }
      if (!matches.length) {
        dbg('bindClick: no match', { activeHovers: activeHovers.length });
        return null;
      }

      // 多 match → 取最近(距离最小)的;但标记 ambiguous
      matches.sort((a, b) => a.distance - b.distance);
      const best = matches[0];
      const ambiguous = matches.length > 1;
      const triggerSnapshot = describe(best.h.triggerEl);
      const candEl = best.chosenCand;
      const candRole = candEl ? inferRole(semanticAncestor(candEl)) : null;
      const candName = candEl ? computeAccessibleName(semanticAncestor(candEl)) : null;
      const latency = candEl ? (best.h.candidates.get(candEl)?.revealedAt - best.h.ts) : null;
      const warnings = [];
      if (ambiguous) warnings.push('hoverAttributionAmbiguous');
      if (best.confidence === 'low') warnings.push('hoverAttributionByFingerprint');

      // 从队列移除已被消费的
      const idx = activeHovers.indexOf(best.h);
      if (idx >= 0) { clearTimeout(best.h.ttlTimer); activeHovers.splice(idx, 1); }

      return {
        hoverEventId: best.h.id,
        hoverEvent: {
          id: best.h.id,
          type: 'ui',
          action: 'hover',
          ts: best.h.ts,
          target: triggerSnapshot,
          hoverReveal: {
            strategy: best.chosenStrategy,
            revealedRole: candRole,
            revealedName: candName,
            revealedSelector: candEl ? shortSelector(candEl) : null,
            latencyMs: latency,
          },
          attribution: {
            confidence: best.confidence,
            ...(ambiguous ? { ambiguous: true } : {}),
            ...(warnings.length ? { warnings } : {}),
          },
        },
      };
    }

    function stop() {
      if (mo) { try { mo.disconnect(); } catch {} mo = null; }
      if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
      for (const h of activeHovers) clearTimeout(h.ttlTimer);
      activeHovers.length = 0;
    }

    function stats() {
      const now = Date.now();
      // 过期清理
      while (recentlyPruned.length && now - recentlyPruned[0].ts > PRUNE_LOG_KEEP_MS) {
        recentlyPruned.shift();
      }
      return {
        activeCount: activeHovers.length,
        recentlyPrunedCount: recentlyPruned.length,
        recentlyPrunedHadCandidate: recentlyPruned.some(p => p.hadCandidate),
      };
    }

    return { noteHover, noteLeave, bindClick, stop, stats };
  })();

  // ---------- DOM 事件 ----------
  function onMouseOver(e) {
    if (!recording || !cfg || !cfg.captureHover) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    // v0.3.3: 不再 pre-ancestor;HoverModule.noteHover 内部用 nearestContainer 做去重
    // 这样 trigger 的几何中心更精确(就在用户鼠标所在的元素上)
    HoverModule.noteHover(t);
  }
  function onMouseOut(e) {
    if (!recording || !cfg || !cfg.captureHover) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    // related target 仍在 trigger 内,则不算 leave
    if (e.relatedTarget && t.contains(e.relatedTarget)) return;
    HoverModule.noteLeave(t);
  }

  function onClick(e) {
    if (!recording) return;
    const el = e.target;
    if (!el) return;

    let triggeredBy = null;
    let extraWarnings = null;
    if (cfg && cfg.captureHover) {
      const binding = HoverModule.bindClick(el);
      if (binding) {
        send(binding.hoverEvent);   // 先 emit hover
        triggeredBy = binding.hoverEventId;
      } else {
        // v0.3.3: bindClick 失败时,如果最近确实有 hover 被 prune 且有过 candidate,
        // 给 click 挂 hoverAttributionExpired,方便用户在 events.json 里搜出来调大 TTL
        const s = HoverModule.stats();
        if (s.recentlyPrunedHadCandidate) {
          extraWarnings = ['hoverAttributionExpired'];
        }
      }
    }

    const ev = {
      type: 'ui',
      action: 'click',
      ts: Date.now(),
      target: describe(el),
      button: e.button,
      modifiers: collectMods(e),
    };
    if (triggeredBy) ev.triggeredBy = triggeredBy;
    if (extraWarnings) ev.warnings = extraWarnings;
    send(ev);
  }

  function onDblClick(e) {
    if (!recording) return;
    send({
      type: 'ui', action: 'dblclick', ts: Date.now(),
      target: describe(e.target), modifiers: collectMods(e),
    });
  }

  function onChange(e) {
    if (!recording) return;
    const el = e.target;
    if (!el) return;
    if (el.tagName === 'SELECT') {
      const opts = [...el.selectedOptions].map(o => ({ value: o.value, text: o.textContent }));
      send({
        type: 'ui', action: 'select', ts: Date.now(),
        target: describe(el),
        value: el.multiple ? opts : (opts[0] || null),
      });
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      send({
        type: 'ui', action: el.checked ? 'check' : 'uncheck',
        ts: Date.now(), target: describe(el),
      });
    }
  }

  const inputTimers = new WeakMap();
  function onInput(e) {
    if (!recording) return;
    const el = e.target;
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && !el.isContentEditable)) return;
    if (el.type === 'checkbox' || el.type === 'radio') return;
    clearTimeout(inputTimers.get(el));
    const t = setTimeout(() => {
      const v = el.isContentEditable ? el.innerText : el.value;
      send({
        type: 'ui', action: 'fill', ts: Date.now(),
        target: describe(el),
        value: typeof v === 'string' ? v.slice(0, 500) : '',
      });
    }, 350);
    inputTimers.set(el, t);
  }

  function onKeyDown(e) {
    if (!recording) return;
    const isFunc = ['Enter','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Backspace','Delete'].includes(e.key);
    const isCombo = (e.ctrlKey || e.metaKey || e.altKey) && e.key.length === 1;
    if (!isFunc && !isCombo) return;
    send({
      type: 'ui', action: 'press', ts: Date.now(),
      target: describe(e.target), key: e.key, modifiers: collectMods(e),
    });
  }

  function collectMods(e) {
    const m = [];
    if (e.ctrlKey) m.push('Control');
    if (e.metaKey) m.push('Meta');
    if (e.altKey) m.push('Alt');
    if (e.shiftKey) m.push('Shift');
    return m;
  }

  let lastUrl = location.href;
  function onUrlMaybeChanged() {
    if (location.href !== lastUrl) {
      const from = lastUrl;
      lastUrl = location.href;
      if (recording && window === window.top) {
        send({ type: 'nav', action: 'navigate', ts: Date.now(), from, to: location.href });
      }
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    window.addEventListener('popstate', onUrlMaybeChanged);
    window.addEventListener('hashchange', onUrlMaybeChanged);
    if (!history.__recorderPatched) {
      history.__recorderPatched = true;
      const wrap = (orig) => function () {
        const r = orig.apply(this, arguments);
        setTimeout(onUrlMaybeChanged, 0);
        return r;
      };
      history.pushState = wrap(history.pushState);
      history.replaceState = wrap(history.replaceState);
    }
  }
  function unbind() {
    if (!bound) return;
    bound = false;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('dblclick', onDblClick, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    window.removeEventListener('popstate', onUrlMaybeChanged);
    window.removeEventListener('hashchange', onUrlMaybeChanged);
    HoverModule.stop();
  }

  let metaStartSent = false;

  // ============================================================
  // v0.3.2: 页面内录制指示器(诚实化 UI)
  //   3 种状态:
  //     - 绿色 ● REC          → 此 tab 正在被录(recording=true)
  //     - 灰色 ◐ NOT REC      → 有 session 在跑,但此 tab 不是录制目标
  //     - 隐藏                → 无 session
  //   注入条件:仅顶层 frame(iframe 不重复出指示器)
  // ============================================================
  const Indicator = (() => {
    let root = null;
    let shadow = null;
    let label = null;
    let dot = null;

    function ensureMounted() {
      if (root || window !== window.top) return;
      if (!document.body) return;        // document_start 时还没有 body,延后
      root = document.createElement('div');
      root.id = '__ui_api_recorder_indicator__';
      // 关键:用 Shadow DOM 隔离页面样式
      root.style.cssText = `
        all: initial;
        position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
        pointer-events: none;
      `;
      shadow = root.attachShadow({ mode: 'closed' });
      shadow.innerHTML = `
        <style>
          .box {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 5px 10px; border-radius: 14px;
            font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.25);
            user-select: none; pointer-events: auto;
            transition: background .15s;
          }
          .box.rec  { background: #e53935; }
          .box.idle { background: rgba(90,90,90,.85); }
          .dot {
            width: 8px; height: 8px; border-radius: 50%;
            background: #fff; box-shadow: 0 0 6px rgba(255,255,255,.9);
          }
          .box.rec .dot { animation: pulse 1.2s infinite ease-in-out; }
          .box.idle .dot { background: #cfcfcf; box-shadow: none; opacity: .7; }
          @keyframes pulse {
            0%,100% { opacity: 1;   transform: scale(1); }
            50%     { opacity: .35; transform: scale(.75); }
          }
        </style>
        <div class="box idle" part="box">
          <span class="dot"></span>
          <span class="lbl">未在录制此页</span>
        </div>
      `;
      const box = shadow.querySelector('.box');
      dot = shadow.querySelector('.dot');
      label = shadow.querySelector('.lbl');
      box.title = 'UI + API Recorder';
      document.documentElement.appendChild(root);
    }

    function setState(kind) {
      if (window !== window.top) return;
      ensureMounted();
      if (!shadow) {
        // body 还没出现,等 DOMContentLoaded 后再试一次
        document.addEventListener('DOMContentLoaded', () => setState(kind), { once: true });
        return;
      }
      const box = shadow.querySelector('.box');
      if (!box) return;
      if (kind === 'hidden') {
        root.style.display = 'none';
        return;
      }
      root.style.display = '';
      if (kind === 'rec') {
        box.classList.remove('idle'); box.classList.add('rec');
        label.textContent = '正在录制此页';
      } else {
        box.classList.remove('rec'); box.classList.add('idle');
        label.textContent = '录制中(此页不被录,切回原 tab 才会记录)';
      }
    }

    // body 还没有就先等
    if (!document.body && window === window.top) {
      document.addEventListener('DOMContentLoaded', () => {
        // 由 refreshIndicator() 在 applyState 之后驱动;此处只是确保挂载点存在
      }, { once: true });
    }
    return { setState };
  })();

  /** 根据 background 推过来的全局 state 和本 tab 的 recording 决定指示器状态
   *  注意:即便 captureActions=false(此 tab 不会 bind dom 监听),只要 background
   *  在录这个 tab(API/视频仍在),也算"被录"。content 自己没法直接拿 tabId,
   *  我们用一个间接信号:background 发来的 START 消息(走 chrome.runtime.onMessage)
   *  只会发到目标 tab,收到过就标记 isTargetTab=true。
   */
  function refreshIndicator(globalState) {
    if (window !== window.top) return;
    const globalOn = !!(globalState && globalState.recording);
    if (!globalOn) { isTargetTab = false; Indicator.setState('hidden'); return; }
    Indicator.setState((recording || isTargetTab) ? 'rec' : 'idle');
  }

  // 仅当 background 通过 chrome.tabs.sendMessage 把 START 路由到此 tab,才会被置 true
  let isTargetTab = false;

  function applyState(state) {
    if (!state) return;
    cfg = state.config || {};
    const want = !!state.recording && !!cfg.captureActions;
    if (want && !recording) {
      recording = true;
      bind();
      console.log('[recorder.content] recording=ON', { isTop: window === window.top, url: location.href });
      if (window === window.top && !metaStartSent) {
        metaStartSent = true;
        send({
          type: 'meta', action: 'start', ts: Date.now(),
          url: location.href, title: document.title,
          viewport: { w: innerWidth, h: innerHeight },
        });
      }
    } else if (!want && recording) {
      recording = false;
      unbind();
      console.log('[recorder.content] recording=OFF', { url: location.href });
    }
    refreshIndicator(state);
  }

  console.log('[recorder.content] injected', {
    isTop: window === window.top, url: location.href, docState: document.readyState,
  });

  try {
    chrome.storage.local.get('recorderState', v => {
      console.log('[recorder.content] initial state from storage:', v.recorderState);
      applyState(v.recorderState);
    });
  } catch (e) { console.warn('[recorder.content] storage.get failed', e); }
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.recorderState) {
        console.log('[recorder.content] state changed:', changes.recorderState.newValue);
        applyState(changes.recorderState.newValue);
      }
    });
  } catch (e) { console.warn('[recorder.content] storage.onChanged failed', e); }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return false;
    if (msg.cmd === 'recorder/start') {
      isTargetTab = true;
      applyState({ recording: true, config: msg.config || {} });
      sendResponse?.({ ok: true });
    } else if (msg.cmd === 'recorder/stop') {
      isTargetTab = false;
      applyState({ recording: false, config: cfg || {} });
      metaStartSent = false;
      sendResponse?.({ ok: true });
    }
    return false;
  });

  // 测试钩子:仅在录制时暴露,允许自测脚本访问内部函数
  if (typeof window !== 'undefined') {
    window.__recorderTestHooks = {
      describe, computeAccessibleName, HoverModule, inferRole,
      semanticAncestor, isStableClass, ancestorsOf,
    };
  }
})();
