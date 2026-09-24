/* tdc-loading.js — one small "still loading" indicator for data-heavy pages.
   Team and player pages keep fetching for several seconds after first paint (roster, history,
   projections, shot data…) and sections appear one by one, with nothing saying the page is still
   working. This shows a small spinner, just under the nav on the right, for exactly as long as
   the page has network requests in flight — it tracks real work, it does not guess.

   How: wraps window.fetch to count in-flight requests. Load it EARLY in <head> so it sees the
   page's first requests. Anti-flicker: it waits 150ms before appearing, stays up at least 400ms
   once shown, and waits 300ms of quiet before hiding (chained requests re-arm it). A 25s ceiling
   means a hung request can never leave it spinning. Respects prefers-reduced-motion. */
(function () {
  if (window.__tdcLoading) return; window.__tdcLoading = true;

  var inflight = 0, el = null, shown = false, shownAt = 0;
  var showT = null, hideT = null, capT = null;
  var pageDone = document.readyState === 'complete';

  function css() {
    if (document.getElementById('tdc-loading-css') || !document.head) return;
    var s = document.createElement('style'); s.id = 'tdc-loading-css';
    s.textContent =
      '#tdcLoading{position:fixed;right:18px;z-index:9000;display:flex;align-items:center;gap:8px;' +
      'padding:6px 11px 6px 8px;border-radius:999px;background:var(--bg2,#fff);border:1px solid var(--border,#e6e9ef);' +
      'box-shadow:0 4px 14px rgba(0,0,0,.10);font:600 11px/1 Inter,system-ui,sans-serif;letter-spacing:.04em;' +
      'color:var(--text3,#8a867a);opacity:0;transform:translateY(-4px);transition:opacity .18s ease,transform .18s ease;pointer-events:none;}' +
      '#tdcLoading.on{opacity:1;transform:none;}' +
      ':root[data-theme="dark"] #tdcLoading{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.16);color:var(--text2,#aeb4bd);box-shadow:0 4px 14px rgba(0,0,0,.35);}' +
      '#tdcLoading i{width:14px;height:14px;border-radius:50%;border:2px solid var(--border2,#d7dce4);' +
      'border-top-color:var(--accent,#2952e0);animation:tdcLoadSpin .7s linear infinite;flex:0 0 auto;}' +
      '@keyframes tdcLoadSpin{to{transform:rotate(360deg);}}' +
      '@media (prefers-reduced-motion: reduce){#tdcLoading i{animation-duration:1.8s;}}' +
      '@media (max-width:600px){#tdcLoading{right:10px;padding:6px;}#tdcLoading span{display:none;}}';
    document.head.appendChild(s);
  }
  function make() {
    if (el || !document.body) return el;
    css();
    el = document.createElement('div');
    el.id = 'tdcLoading';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<i aria-hidden="true"></i><span>Loading</span>';
    document.body.appendChild(el);
    return el;
  }
  // Sit just below whatever nav the page uses. Heights differ across pages, and some pages carry
  // an inline nav that tdc-nav.js later replaces, so querySelector's first match can be a nav that
  // is hidden or not laid out yet (bottom = 0) — which pinned the pill to the top edge, over the
  // nav. Take the lowest VISIBLE bar that is pinned to the top of the viewport instead, and keep
  // re-measuring while shown, because the nav can mount after the pill does.
  function place() {
    if (!el) return;
    var b = 0, vw = window.innerWidth || 1200;
    function consider(n) {
      var r = n.getBoundingClientRect();
      if (r.height > 0 && r.top <= 4 && r.bottom < 220 && r.bottom > b) b = r.bottom;
    }
    // the named navs the site uses (.tdn-wrap is tdc-nav.js's; .nav-wrap is the older inline one)
    var cands = document.querySelectorAll('.tdn-wrap,.tdn,.nav-wrap,header,nav');
    for (var i = 0; i < cands.length; i++) consider(cands[i]);
    // …and, so a renamed nav never puts the pill back on top of the Subscribe button, any
    // full-width sticky/fixed bar among the body's first children
    var kids = document.body ? document.body.children : [];
    for (var j = 0; j < kids.length && j < 12; j++) {
      var k = kids[j], p = getComputedStyle(k).position;
      if ((p === 'sticky' || p === 'fixed') && k.getBoundingClientRect().width > vw * 0.8 && k.id !== 'tdcLoading') consider(k);
    }
    el.style.top = Math.max(12, Math.round(b + 10)) + 'px';
  }
  var placeT = null;
  function busy() { return inflight > 0 || !pageDone; }

  function show() {
    if (shown || !make()) return;
    place(); shown = true; shownAt = Date.now();
    clearInterval(placeT); placeT = setInterval(place, 400);
    // Force a reflow, then add the class, so the fade-in transition runs. This used to wait on
    // requestAnimationFrame, which browsers PAUSE in background tabs and non-painting frames —
    // open a team page in a new tab and the pill stayed invisible for the whole load.
    void el.offsetWidth;
    el.classList.add('on');
    clearTimeout(capT);
    capT = setTimeout(forceHide, 25000);            // a hung request never spins forever
  }
  function reallyHide() {
    if (!shown) return;
    shown = false; clearTimeout(capT); clearInterval(placeT);
    if (el) el.classList.remove('on');
  }
  function forceHide() { inflight = 0; pageDone = true; reallyHide(); }

  function update() {
    if (busy()) {
      clearTimeout(hideT); hideT = null;
      if (!shown && !showT) showT = setTimeout(function () { showT = null; if (busy()) show(); }, 150);
    } else {
      clearTimeout(showT); showT = null;
      if (shown && !hideT) {
        var wait = Math.max(300, 400 - (Date.now() - shownAt));
        hideT = setTimeout(function () { hideT = null; if (!busy()) reallyHide(); }, wait);
      }
    }
  }

  var nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function () {
      inflight++; update();
      var done = function () { inflight = Math.max(0, inflight - 1); update(); };
      var p;
      try { p = nativeFetch.apply(this, arguments); }
      catch (e) { done(); throw e; }
      return p.then(function (r) { done(); return r; }, function (e) { done(); throw e; });
    };
  }

  if (!pageDone) window.addEventListener('load', function () { pageDone = true; update(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', update);
  update();

  // hold(): keep the indicator up during work that is not a fetch — a heavy client-side build
  // (the Big Board, a projection pass). Returns the release function; releasing twice is harmless.
  function hold() {
    inflight++; update();
    var released = false;
    return function release() { if (released) return; released = true; inflight = Math.max(0, inflight - 1); update(); };
  }

  window.TDCLoading = { busy: busy, count: function () { return inflight; }, hold: hold };
})();
