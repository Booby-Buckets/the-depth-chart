/* tdc-panelize.js — one anatomy for every stat tab.
   Tabs are drawn by ~15 different modules, each with its own layout (floating caps labels,
   cards inside cards, one giant card). This turns them all into the kit's shape after they draw:
   each section title + the content under it (up to the next title) becomes a .ui-panel
   (tdc-ui.css) — header strip with the title, its toggle moved to the right of the strip,
   and the body. A table that is the whole body sits flush.

   Usage: TDCPanelize.watch(rootEl)  — re-runs whenever the root's content changes.
          TDCPanelize.run(rootEl)    — one pass. */
(function () {
  if (window.TDCPanelize) return;

  // section titles the modules emit
  var TITLE = '.skill-section-title, .sec-title, .sg-title, .dd-sec-h, .gl-tier-head, .dv-h, .sec-h, .wyp-h, ' +
    '.pcard-band, .scout-card-title, .tdcd-sec, .arch-sec-h, .rc-sec, .bet-panel > h4';
  // things that end a section without being one (a new tab region, a legend that belongs above)
  var isTitle = function (el) { return el.nodeType === 1 && el.matches(TITLE); };
  var isToggle = function (el) { return el && el.nodeType === 1 && (el.matches('.seg, .ui-seg, .statmode-row, .gl-seasons') || el.querySelector(':scope > .seg')); };

  // A title that sits in a card's own header row (e.g. .sg-head inside .sg-card): the CARD becomes the
  // panel and that row becomes its strip, instead of building a small panel inside the card.
  function cardize(title) {
    var head = title.parentNode, card = head && head.parentNode;
    if (!card || card.classList.contains('ui-panel')) return true;
    title.dataset.pz = '1';
    card.classList.add('ui-panel', 'pz', 'pz-card'); head.classList.add('ui-panel-head');
    var body = document.createElement('div'); body.className = 'ui-panel-body';
    var n = head.nextSibling; while (n) { var nx = n.nextSibling; body.appendChild(n); n = nx; }
    card.appendChild(body);
    return true;
  }
  var inHeadRow = function (t) { var h = t.parentNode; return h && h.nodeType === 1 && /(^|\s|-)head(\s|$)/.test(h.className) && h.firstElementChild === t; };

  // A title that is the first thing inside a card (.scout-card > .scout-card-title, .bet-panel > h4):
  // the card becomes the panel, the title its strip.
  var firstInCard = function (t) { var c = t.parentNode; return c && c.nodeType === 1 && c.firstElementChild === t && /(^|[\s-])(card|panel)(\s|$)/.test(c.className); };
  function cardFromTitle(title) {
    var card = title.parentNode; title.dataset.pz = '1';
    var head = document.createElement('div'); head.className = 'ui-panel-head';
    card.insertBefore(head, title); head.appendChild(title);
    var body = document.createElement('div'); body.className = 'ui-panel-body';
    var n = head.nextSibling; while (n) { var nx = n.nextSibling; body.appendChild(n); n = nx; }
    card.appendChild(body); card.classList.add('ui-panel', 'pz', 'pz-card');
    var real = [].filter.call(body.children, function (x) { return x.offsetWidth !== 0; });
    if (real.length === 1 && real[0].matches('.sheet-wrap')) body.classList.add('flush');
  }

  function panelize(title) {
    if (title.closest('.ui-panel-head') || title.dataset.pz) return;
    if (inHeadRow(title)) { cardize(title); return; }
    if (firstInCard(title)) { cardFromTitle(title); return; }
    var parent = title.parentNode; if (!parent) return;
    title.dataset.pz = '1';
    var panel = document.createElement('section'); panel.className = 'ui-panel pz';
    var head = document.createElement('div'); head.className = 'ui-panel-head';
    var body = document.createElement('div'); body.className = 'ui-panel-body';
    parent.insertBefore(panel, title);
    head.appendChild(title);
    // gather everything up to the next title at the same level
    var n = panel.nextSibling, items = [];
    while (n && !(n.nodeType === 1 && (isTitle(n) || n.classList.contains('pz')))) { items.push(n); n = n.nextSibling; }
    // a toggle right under the title rides in the header strip
    var first = items.find(function (x) { return x.nodeType === 1; });
    if (first && isToggle(first)) {
      var tools = document.createElement('div'); tools.className = 'ui-panel-tools'; tools.appendChild(first); head.appendChild(tools);
      items = items.filter(function (x) { return x !== first; });
    }
    items.forEach(function (x) { body.appendChild(x); });
    panel.appendChild(head);
    var real = [].filter.call(body.childNodes, function (x) { return x.nodeType === 1 || (x.nodeType === 3 && x.textContent.trim()); });
    if (!real.length) { panel.replaceWith(title); delete title.dataset.pz; return; }
    if (real.length === 1 && real[0].nodeType === 1 && real[0].matches('.sheet-wrap')) body.classList.add('flush');
    panel.appendChild(body);
  }

  function run(root) {
    if (!root) return;
    [].slice.call(root.querySelectorAll(TITLE)).forEach(function (t) {
      // only titles that head a run of content (skip ones nested inside a header row of their own)
      if (t.closest('.ui-panel-head, thead, button, .hgm-item')) return;
      // already inside a panel: stays a plain caps sub-label (never a panel inside a panel)
      if (t.closest('.ui-panel-body')) return;
      panelize(t);
    });
  }

  function watch(root) {
    if (!root || root.__pz) return; root.__pz = 1;
    var t = null;
    var mo = new MutationObserver(function () { clearTimeout(t); t = setTimeout(function () { mo.disconnect(); run(root); mo.observe(root, { childList: true, subtree: true }); }, 60); });
    run(root); mo.observe(root, { childList: true, subtree: true });
  }

  // watch tabs by id from the document, so it keeps working when a page redraws its tab containers
  function watchIds(ids) {
    var t = null, busy = false;
    var pass = function () { busy = true; ids.forEach(function (id) { run(document.getElementById(id)); }); busy = false; };
    var mo = new MutationObserver(function () { if (busy) return; clearTimeout(t); t = setTimeout(pass, 80); });
    var start = function () { pass(); mo.observe(document.body, { childList: true, subtree: true }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }

  window.TDCPanelize = { run: run, watch: watch, watchIds: watchIds };
})();
