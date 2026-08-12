/* tdc-pwa.js — registers the service worker and shows a floating "Install" pill.
   Loaded on every page (defer). Head tags (manifest link, apple-touch-icon,
   theme-color) are injected statically per page; this file wires the runtime. */
(function () {
  // ---- service worker ----------------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('[pwa] SW registration failed', e);
      });
    });
  }

  // ---- install affordance ------------------------------------------------
  var DISMISS_KEY = 'tdcInstallDismissed';   // epoch ms of last dismissal
  var DISMISS_DAYS = 45;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }
  function isIOS() { return /iP(hone|ad|od)/.test(navigator.userAgent) && !window.MSStream; }
  function isSafari() { return /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent); }
  function recentlyDismissed() {
    try {
      var t = +localStorage.getItem(DISMISS_KEY);
      return t && (Date.now() - t) < DISMISS_DAYS * 864e5;
    } catch (e) { return false; }
  }
  function dismiss() { try { localStorage.setItem(DISMISS_KEY, '' + Date.now()); } catch (e) {} }

  // Stash the beforeinstallprompt (Android / desktop Chromium)
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.tdcInstallPrompt = e;
    maybeShow();
  });
  window.addEventListener('appinstalled', function () {
    window.tdcInstallPrompt = null;
    var el = document.getElementById('tdcInstall'); if (el) el.remove();
    dismiss();
  });

  var built = false;
  function maybeShow() {
    if (built || isStandalone() || recentlyDismissed()) return;
    var iosPromptable = isIOS() && isSafari();        // iOS can only Add-to-Home-Screen manually
    if (!window.tdcInstallPrompt && !iosPromptable) return;
    build(iosPromptable);
  }

  function css() {
    if (document.getElementById('tdcInstallCSS')) return;
    var s = document.createElement('style');
    s.id = 'tdcInstallCSS';
    s.textContent =
      '#tdcInstall{position:fixed;z-index:2147483000;right:16px;bottom:16px;' +
      'bottom:calc(16px + env(safe-area-inset-bottom));' +
      'display:flex;align-items:center;gap:9px;padding:10px 12px 10px 14px;' +
      'background:#E6D5A8;color:#141416;border-radius:26px;' +
      'box-shadow:0 6px 22px rgba(0,0,0,.28);font:700 13.5px/1 Inter,-apple-system,BlinkMacSystemFont,sans-serif;' +
      'cursor:pointer;animation:tdcInPop .3s ease both;-webkit-tap-highlight-color:transparent;}' +
      '#tdcInstall:hover{transform:translateY(-1px);box-shadow:0 10px 26px rgba(0,0,0,.32);}' +
      '#tdcInstall .tdc-ic{width:16px;height:16px;flex:none;}' +
      '#tdcInstall .tdc-x{margin-left:2px;width:20px;height:20px;border-radius:50%;display:flex;' +
      'align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#5c5334;' +
      'background:rgba(20,20,22,.10);}' +
      '#tdcInstall .tdc-x:hover{background:rgba(20,20,22,.20);color:#141416;}' +
      '@keyframes tdcInPop{from{opacity:0;transform:translateY(10px) scale(.96);}to{opacity:1;transform:none;}}' +
      '#tdcIosSheet{position:fixed;z-index:2147483001;left:16px;right:16px;' +
      'bottom:calc(76px + env(safe-area-inset-bottom));max-width:340px;margin-left:auto;' +
      'background:#1D1D20;color:#F1EFEA;border:1px solid #2E2E34;border-radius:16px;padding:16px 16px 15px;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.5);font:500 13.5px/1.5 Inter,-apple-system,sans-serif;' +
      'animation:tdcInPop .28s ease both;}' +
      '#tdcIosSheet b{color:#E6D5A8;}' +
      '#tdcIosSheet .tdc-share{display:inline-flex;vertical-align:-3px;margin:0 2px;}' +
      '#tdcIosSheet .tdc-done{margin-top:12px;text-align:right;}' +
      '#tdcIosSheet .tdc-done button{font:700 12px Inter,sans-serif;color:#141416;background:#E6D5A8;' +
      'border:none;border-radius:18px;padding:7px 16px;cursor:pointer;}';
    document.head.appendChild(s);
  }

  var DOWNLOAD_SVG = '<svg class="tdc-ic" viewBox="0 0 24 24" fill="none" stroke="#141416" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 21h16"/></svg>';
  var SHARE_SVG = '<svg class="tdc-share" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E6D5A8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';

  function build(iosPromptable) {
    if (built) return; built = true;
    css();
    var el = document.createElement('div');
    el.id = 'tdcInstall';
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'Install The Depth Chart app');
    el.innerHTML = DOWNLOAD_SVG + '<span>Install app</span>' +
      '<span class="tdc-x" role="button" aria-label="Dismiss">×</span>';
    el.addEventListener('click', function (ev) {
      if (ev.target.closest('.tdc-x')) { dismiss(); el.remove(); return; }
      if (iosPromptable) { showIosSheet(); return; }
      var p = window.tdcInstallPrompt;
      if (!p) { el.remove(); return; }
      p.prompt();
      p.userChoice.then(function () { window.tdcInstallPrompt = null; el.remove(); dismiss(); });
    });
    document.body.appendChild(el);
  }

  function showIosSheet() {
    if (document.getElementById('tdcIosSheet')) return;
    var d = document.createElement('div');
    d.id = 'tdcIosSheet';
    d.innerHTML = 'To install, tap the Share button ' + SHARE_SVG +
      ' in your browser toolbar, then choose <b>Add to Home Screen</b>.' +
      '<div class="tdc-done"><button type="button">Got it</button></div>';
    d.querySelector('button').addEventListener('click', function () { d.remove(); dismiss(); });
    document.body.appendChild(d);
  }

  // beforeinstallprompt may have fired before we attached; also covers iOS (no event).
  if (document.readyState === 'complete' || document.readyState === 'interactive') maybeShow();
  else window.addEventListener('DOMContentLoaded', maybeShow);
})();
