/* tdc-theme.js — one shared light/dark theme controller for every page.
 *
 * Goals: (1) the saved choice PERSISTS across pages, (2) a toggle is available on
 * EVERY page, (3) NO flash of the wrong theme on load.
 *
 * Load this FIRST in <head> (before the page's content) so the saved theme is applied
 * to <html data-theme> before the body paints. Storage key `tdc_theme` ('dark'|'light')
 * is already used site-wide; first visit defaults to light (owner's choice).
 *
 * It does NOT define any colors — each page's own :root / [data-theme="dark"] CSS still
 * owns the palette. This only sets the attribute + provides a consistent toggle, so it's
 * safe to drop on every page without touching layout.
 */
(function () {
  var KEY = 'tdc_theme';
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function cur() { return saved() === 'dark' ? 'dark' : 'light'; }

  function paintButtons(theme) {
    var dark = theme === 'dark';
    // update any toggle on the page (this script's button + existing per-page ones)
    var btns = document.querySelectorAll('.tdc-theme-btn, .theme-toggle, #themeBtn');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.getAttribute('data-tdc-noicon') !== '1') b.textContent = dark ? '☀️' : '🌙'; // ☀️ / 🌙
      b.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }
  }
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme); // explicit 'light'|'dark' matches existing pages
    paintButtons(theme);
  }
  // (1) apply immediately — runs in <head>, before the body paints → persistence + no flash
  apply(cur());

  function set(theme) {
    theme = theme === 'dark' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    apply(theme);
  }
  function toggle() { set(cur() === 'dark' ? 'light' : 'dark'); }
  // public API (also what existing inline toggleTheme() writes to — same key, no conflict)
  window.tdcSetTheme = set;
  window.tdcToggleTheme = toggle;

  // (2) guarantee exactly ONE toggle on the page. Most pages get theirs from tdc-nav.js
  // (#themeBtn), but it renders at an unpredictable time — so we inject a fallback floating
  // button and then REMOVE it the moment a real toggle appears (race-proof, no double button).
  var injected = null;
  function realToggle() { return document.querySelector('.theme-toggle, #themeBtn'); } // page/nav toggle, not ours
  function ensureToggle() {
    apply(cur()); // keep any per-page button icons in sync
    if (realToggle()) { if (injected) { injected.remove(); injected = null; } return; }
    if (!injected && document.body) {
      injected = document.createElement('button');
      injected.className = 'tdc-theme-btn';
      injected.type = 'button';
      injected.title = 'Toggle light / dark';
      injected.setAttribute('aria-label', 'Toggle light or dark theme');
      injected.onclick = toggle;
      injected.textContent = cur() === 'dark' ? '☀️' : '🌙';
      injected.style.cssText = 'position:fixed;top:14px;right:14px;z-index:9999;width:38px;height:38px;' +
        'border-radius:10px;border:1px solid var(--border,#d8d8d8);background:var(--bg2,#fff);' +
        'color:var(--text,#111);font-size:16px;line-height:1;cursor:pointer;display:flex;' +
        'align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.14);' +
        '-webkit-tap-highlight-color:transparent;';
      document.body.appendChild(injected);
    }
  }
  // run now + at the usual milestones + a couple of late ticks to catch a slow-rendering nav
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureToggle);
  else ensureToggle();
  window.addEventListener('load', ensureToggle);
  setTimeout(ensureToggle, 400);
  setTimeout(ensureToggle, 1200);
})();
