/* tdc-mobile.js — one type system on phones (≤ 640px), loaded on every page by tdc-nav.js.
 *
 * The site's pages were written one at a time and carry ~17 font sizes, 5 families and 5 weights
 * each. On a phone that reads as messy. Rather than hand-editing ~80 pages, this snaps every piece of
 * text to the same small set as it renders (and as pages redraw, via a MutationObserver):
 *
 *   sizes    11 · 13 · 15 · 18 · 22 · 28 · 36   (nothing under 11px; a page's biggest hero numbers cap at 36)
 *   family   Inter everywhere; Playfair for every page title (H1) and for section headings (H2/H3) that use it
 *   weight   500 · 600 · 700
 *   labels   UPPERCASE text gets one letter-spacing (.05em)
 *   inputs   16px (iOS zooms the page on any smaller form field)
 *
 * Desktop is untouched. Add data-type-keep to any element (and its subtree) to opt out.
 */
(function () {
  'use strict';
  if (window.__tdcMobile) return; window.__tdcMobile = 1;
  const mq = window.matchMedia('(max-width: 640px)');
  const SIZES = [11, 13, 15, 18, 22, 28, 36];
  const snapSize = s => s <= 11.75 ? 11 : s <= 14 ? 13 : s <= 16.5 ? 15 : s <= 20 ? 18 : s <= 25 ? 22 : s <= 32 ? 28 : 36;
  const snapWeight = w => (w <= 550 ? 500 : w <= 650 ? 600 : 700);
  const NUMERIC = /^[\s\d.,%+\-–—:/#()×x·]+$/;
  const SERIF = /playfair|georgia|serif$/i;
  const HEADING = /^H[1-3]$/;
  const done = new WeakSet();

  function hasOwnText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  }
  function fix(el) {
    if (done.has(el)) return;
    done.add(el);
    if (el.closest('svg,[data-type-keep],.tdn-wrap,canvas,code,pre')) return;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      el.style.setProperty('font-size', '16px', 'important');
      el.style.setProperty('font-family', "'Inter', system-ui, sans-serif", 'important');
      return;
    }
    if (el.classList && el.classList.contains('sheet-wrap')) flattenTable(el);
    if (!hasOwnText(el)) return;
    // hidden text (closed tabs, menus) is styled too: it was being marked done unstyled and never revisited
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize) || 15;
    const to = snapSize(size);
    if (Math.abs(to - size) > 0.2) el.style.setProperty('font-size', to + 'px', 'important');
    const w = parseInt(cs.fontWeight, 10) || 400;
    const tw = snapWeight(w);
    if (tw !== w && w >= 450) el.style.setProperty('font-weight', String(tw), 'important');
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    const text = el.textContent.trim();
    const isSerif = SERIF.test(fam) || fam.includes('playfair');
    // serif = headings only: every page title (H1) is Playfair, section headings keep it if they had it,
    // and nothing else is (tile values like "Duke" / "Elite Eight" were serif next to sans neighbours)
    if (tag === 'H1' && !NUMERIC.test(text)) {
      if (!fam.includes('playfair')) el.style.setProperty('font-family', "'Playfair Display', Georgia, serif", 'important');
      return;
    }
    const keepSerif = isSerif && !NUMERIC.test(text) && HEADING.test(tag);
    if (!keepSerif && fam !== 'inter') {
      el.style.setProperty('font-family', "'Inter', system-ui, sans-serif", 'important');
      if (NUMERIC.test(text)) el.style.setProperty('font-variant-numeric', 'tabular-nums', 'important');
    }
    if (cs.textTransform === 'uppercase') el.style.setProperty('letter-spacing', '.05em', 'important');
  }
  // A bordered table box inside a padded, bordered card reads as box-in-a-box on a phone and costs the
  // table ~30px of width: run it edge to edge inside the card instead (top/bottom rules stay).
  function boxed(e) {
    const c = getComputedStyle(e);
    return parseFloat(c.borderLeftWidth) > 0 && parseFloat(c.borderRightWidth) > 0 && parseFloat(c.paddingLeft) >= 8;
  }
  function flattenTable(el) {
    let p = el.parentElement;
    for (let i = 0; p && p !== document.body && i < 6; i++, p = p.parentElement) {
      if (boxed(p)) {
        const cs = getComputedStyle(p), pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
        el.style.setProperty('margin-left', -pl + 'px', 'important');
        el.style.setProperty('margin-right', -pr + 'px', 'important');
        el.style.setProperty('border-left-width', '0', 'important');
        el.style.setProperty('border-right-width', '0', 'important');
        el.style.setProperty('border-radius', '0', 'important');
        return;
      }
    }
  }
  function walk(root) {
    if (root.nodeType !== 1) return;
    fix(root);
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) fix(all[i]);
  }

  // Rows of pill buttons (seasons, "rank by", conference filters, difficulty...) that wrap onto 3+ lines
  // on a phone become ONE swipe row with a right-edge fade, the selected pill scrolled into view.
  // Rows holding dropdown menus are left alone (a scrolling row would clip the menu).
  const pillRows = new WeakSet();
  function pillRow(row) {
    if (!row || pillRows.has(row) || row.closest('.tdn-wrap,[data-type-keep]')) return;
    const cs = getComputedStyle(row);
    if (cs.display !== 'flex' || cs.flexWrap !== 'wrap') return;
    const vis = [...row.children].filter(k => k.getBoundingClientRect().width > 0);
    // a plain text label leading the row ("Rank by", "Group") is fine; everything else must be a pill
    const isLabel = k => /^(SPAN|B|SMALL|STRONG|EM)$/.test(k.tagName) && !k.querySelector('a,button');
    const kids = vis.filter(k => !isLabel(k));
    if (kids.length < 5 || vis.filter(isLabel).length > 1) return;
    if (!kids.every(k => /^(A|BUTTON|LABEL)$/.test(k.tagName) && k.getBoundingClientRect().height <= 56)) return;
    if (row.querySelector('[class*="menu"],select,input[type="text"],input[type="search"]')) return;
    const lines = new Set(kids.map(k => Math.round(k.getBoundingClientRect().top))).size;
    if (lines < 3) return;
    pillRows.add(row);
    const st = (k, v) => row.style.setProperty(k, v, 'important');
    st('flex-wrap', 'nowrap'); st('overflow-x', 'auto'); st('scrollbar-width', 'none'); st('-webkit-overflow-scrolling', 'touch');
    st('-webkit-mask-image', 'linear-gradient(90deg,#000 86%,transparent)'); st('mask-image', 'linear-gradient(90deg,#000 86%,transparent)');
    st('padding-right', '28px');
    kids.forEach(k => k.style.setProperty('flex-shrink', '0', 'important'));
    // a full-width label line ("RANK BY") would push every pill off screen: sit it inline at the start
    vis.filter(isLabel).forEach(l => { l.style.setProperty('flex', '0 0 auto', 'important'); l.style.setProperty('width', 'auto', 'important'); l.style.setProperty('margin-right', '4px', 'important'); });
    const on = row.querySelector('.active,.on,.sel,.selected,[aria-selected="true"],[aria-pressed="true"]');
    if (on) {   // only when the selected pill is actually off the right edge
      const a = on.getBoundingClientRect(), b = row.getBoundingClientRect();
      if (a.right > b.right - 28) row.scrollLeft += a.right - (b.right - 28) + 12;
    }
  }
  function scanRows(root) {
    const seen = new Set();
    (root.querySelectorAll ? root.querySelectorAll('button,a') : []).forEach(b => { const p = b.parentElement; if (p && !seen.has(p)) { seen.add(p); pillRow(p); } });
  }

  // ── Tables fit the phone (Oct 2026, owner: "make every page fit down to mobile") ──
  // Any table wider than its box is first compacted (full width, tighter cells, text columns wrap, frozen
  // columns released — nothing scrolls sideways so nothing needs to stick); if it is STILL too wide, columns are
  // hidden from the right until it fits, never the rank / name columns on the left. A "Show all N columns" chip
  // brings the full sheet back (sideways scroll, frozen columns restored); "Fit to screen" folds it again.
  // Add data-fit-keep to a table (or any ancestor) to leave it alone, or to a <th> to keep that column.
  // iOS Safari "boosts" text in wide blocks of long text (a full-width table label row rendered ~28px on an
  // iPhone while measuring 12px everywhere else): pin the text size to what the CSS says
  const FIT_CSS = 'html{-webkit-text-size-adjust:100%!important;text-size-adjust:100%!important}' +
    '.tdc-m table.tdc-fit{width:100%!important;min-width:0!important}' +
    '.tdc-m table.tdc-fit th,.tdc-m table.tdc-fit td{padding-left:5px!important;padding-right:5px!important;position:static!important;left:auto!important;min-width:0!important;max-width:none!important}' +
    '.tdc-m table.tdc-fit td:nth-child(-n+3),.tdc-m table.tdc-fit th:nth-child(-n+3){width:auto!important}' +
    '.tdc-m table.tdc-fit td.l,.tdc-m table.tdc-fit td.nm,.tdc-m table.tdc-fit th.l,.tdc-m table.tdc-fit td:nth-child(n+2):nth-child(-n+3),.tdc-m table.tdc-fit td a{white-space:normal!important}' +
    '.tdc-m table.tdc-fit td:first-child{white-space:nowrap!important}' +
    '.tdc-m table.tdc-fit.tdc-wrap0 td:first-child,.tdc-m table.tdc-fit.tdc-wrap0 td:first-child *{white-space:normal!important;min-width:0!important}' +
    '.tdc-m table.tdc-fit td:nth-child(-n+3) a{display:inline}' +
    // inner name spans carry their own nowrap (".tm{white-space:nowrap}"), which beat the cell's wrap and let
    // the longest school name set a 280px column: wrap everything inside the leading columns
    '.tdc-m table.tdc-fit td:nth-child(n+2):nth-child(-n+3) *{white-space:normal!important;min-width:0!important}' +
    '.tdc-m table.tdc-fit .tdc-fx{display:none!important}' +
    // "Boozer·Evans·Sarr·Foster·Ngongba" has no spaces, so it was one ~280px unbreakable word: let each name break
    '.tdc-m .lu-five a,.tdc-m .lu-five i{display:inline-block}' +
    '.tdc-fitbar{display:flex;justify-content:flex-end;margin:6px 0}' +
    '.tdc-fitbar button{font:600 12px Inter,system-ui,sans-serif;border:1px solid var(--border2,#c6c0b2);background:var(--bg2,#f1efea);color:var(--text2,#4a463c);border-radius:999px;padding:5px 11px;cursor:pointer}';
  function fitBar(t, hidden, all) {
    const host = t.closest('.sheet-wrap') || t.parentElement; if (!host || !host.parentElement) return;
    let bar = host.previousElementSibling && host.previousElementSibling.classList.contains('tdc-fitbar') ? host.previousElementSibling : null;
    if (!hidden && !all) { if (bar) bar.remove(); return; }
    const label = all ? 'Fit to screen' : 'Show all ' + (hidden + visibleCols(t)) + ' columns';
    if (!bar) { bar = document.createElement('div'); bar.className = 'tdc-fitbar'; bar.innerHTML = '<button type="button"></button>'; host.parentElement.insertBefore(bar, host); }
    const b = bar.firstChild;
    if (b.textContent !== label) b.textContent = label;
    b.onclick = () => {
      if (all) { delete t.dataset.fit; fitTable(t, true); }
      else { t.dataset.fit = 'all'; t.classList.remove('tdc-fit'); t.querySelectorAll('.tdc-fx').forEach(c => c.classList.remove('tdc-fx')); fitBar(t, 0, true); }
    };
  }
  function visibleCols(t) { const h = headRow(t); return h ? [...h.cells].filter(c => !c.classList.contains('tdc-fx')).length : 0; }
  function headRow(t) { return t.tHead && t.tHead.rows.length ? t.tHead.rows[t.tHead.rows.length - 1] : t.rows[0]; }
  function fitTable(t, force) {
    if (!mq.matches || t.closest('[data-fit-keep]')) return;
    if (t.dataset.fit === 'all') { fitBar(t, 0, true); return; }
    if (t.offsetParent === null) return;
    // a grid / flex parent can size its column to the table (a "1fr" track that grows to 567px on a 347px
    // screen): make every such ancestor shrinkable so the table sees the real width
    for (let a = t.parentElement, i = 0; a && a !== document.body && i < 8; a = a.parentElement, i++) {
      const pa = a.parentElement && getComputedStyle(a.parentElement);
      if (pa && /grid|flex/.test(pa.display)) a.style.setProperty('min-width', '0', 'important');
      const cs = getComputedStyle(a);
      if (cs.display === 'grid' && a.scrollWidth > a.clientWidth + 2) a.style.setProperty('grid-template-columns', 'minmax(0,1fr)', 'important');
    }
    const box = t.closest('.sheet-wrap') || t.parentElement, avail = box && box.clientWidth; if (!avail) return;
    const wide = () => t.getBoundingClientRect().width > avail + 2;
    if (!force && !t.classList.contains('tdc-fit') && !wide()) return;
    t.classList.add('tdc-fit');
    t.querySelectorAll('.tdc-fx').forEach(c => c.classList.remove('tdc-fx'));
    // the first column stays on one line when it is short (rank, season, date); a long one (a lineup) wraps
    const firsts = [...t.tBodies].flatMap(b => [...b.rows]).map(r => r.cells[0] && r.cells[0].colSpan === 1 ? r.cells[0].textContent.trim().length : 0);
    t.classList.toggle('tdc-wrap0', firsts.length > 0 && Math.max(...firsts) > 12);
    // flex rows of 3+ items in the name columns (a starting five "A · B · C · D · E") may wrap; a logo + name
    // pair (2 items) stays on one line
    t.querySelectorAll((t.classList.contains('tdc-wrap0') ? 'td:nth-child(1) *, ' : '') + 'td:nth-child(2) *, td:nth-child(3) *').forEach(e => {
      if (e.children.length > 2 && /flex/.test(getComputedStyle(e).display)) e.style.setProperty('flex-wrap', 'wrap', 'important');
    });
    let hidden = 0;
    const head = headRow(t);
    if (wide() && head && ![...head.cells].some(c => c.colSpan > 1)) {
      const n = head.cells.length, rows = [...t.rows].filter(r => r.cells.length === n);
      // group-header rows above the column header (colspans) can't follow single hidden columns: drop them
      const groupRows = t.tHead ? [...t.tHead.rows].filter(r => r !== head) : [];
      // keep the first column (rank / slot) and the NAME column (first text column); drop secondary text
      // columns (team, conf, pos…) before stats, then stats from the right
      const isText = c => c.classList.contains('l') || c.classList.contains('nm');
      let nameIdx = [...head.cells].findIndex((c, i) => i > 0 && isText(c)); if (nameIdx < 0) nameIdx = 1;
      // a season / date table is identified by its first column — Team there is context, hide it before stats
      if (/^(season|year|yr|date|game|wk|week)\b/i.test(head.cells[0].textContent.trim())) nameIdx = -1;
      const keep = i => i === 0 || i === nameIdx || head.cells[i].hasAttribute('data-fit-keep');
      const order = [];
      for (let i = nameIdx + 1; i < n; i++) if (isText(head.cells[i]) && !keep(i)) order.push(i);
      // unshaded columns before the shaded (data-heat) ones — the heat-coloured stats are the page's point
      const heat = i => head.cells[i].hasAttribute('data-heat') && head.cells[i].getAttribute('data-heat') !== '0';
      for (let i = n - 1; i >= 0; i--) if (!keep(i) && !order.includes(i) && !heat(i)) order.push(i);
      for (let i = n - 1; i >= 0; i--) if (!keep(i) && !order.includes(i)) order.push(i);
      for (const i of order) {
        if (!wide() || n - hidden <= 2) break;
        rows.forEach(r => r.cells[i].classList.add('tdc-fx')); hidden++;
      }
      if (hidden) groupRows.forEach(r => r.classList.add('tdc-fx'));
    }
    fitBar(t, hidden, false);
  }
  let fitT = 0;
  function fitAll() { fitT = 0; document.querySelectorAll('table').forEach(t => { try { fitTable(t); } catch (e) {} }); }
  function scheduleFit(ms) { if (!mq.matches) return; clearTimeout(fitT); fitT = setTimeout(fitAll, ms || 150); }

  let pending = [], raf = 0;
  function flush() {
    raf = 0;
    const list = pending; pending = [];
    for (const n of list) if (n.isConnected) { walk(n); scanRows(n.parentElement || n); }
    if (list.some(n => n.isConnected && !(n.classList && n.classList.contains('tdc-fitbar')))) scheduleFit();
  }
  function start() {
    if (!mq.matches) return;
    document.documentElement.classList.add('tdc-m');
    if (!document.getElementById('tdc-fit-css')) { const st = document.createElement('style'); st.id = 'tdc-fit-css'; st.textContent = FIT_CSS; document.head.appendChild(st); }
    scheduleFit(300);
    // tabs / menus reveal tables that were hidden when measured
    document.addEventListener('click', () => scheduleFit(400), true);
    window.addEventListener('resize', () => scheduleFit(200));
    walk(document.body);
    scanRows(document.body);
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList') {
          m.addedNodes.forEach(n => { if (n.nodeType === 1) pending.push(n); });
          // new text inside an element we already styled (innerHTML / textContent rewrites): style it again
          if (m.target && m.target.nodeType === 1 && [...m.addedNodes].some(n => n.nodeType === 3)) { done.delete(m.target); pending.push(m.target); }
        }
        else if (m.target && m.target.parentElement) { done.delete(m.target.parentElement); pending.push(m.target.parentElement); }
      }
      // a short timer, not requestAnimationFrame: rAF is paused in background tabs, which left pages
      // opened in a new tab unstyled until they were looked at
      if (pending.length && !raf) raf = setTimeout(flush, 30);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
