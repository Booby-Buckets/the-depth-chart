/* tdc-pwa.js — registers the service worker and stashes the install prompt.
   Loaded on every page (defer). Head tags (manifest link, apple-touch-icon,
   theme-color) are injected statically per page; this file only wires runtime. */
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('[pwa] SW registration failed', e);
      });
    });
  }
  // Stash the install prompt so an in-app "Install" affordance can trigger it later.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.tdcInstallPrompt = e;
    window.dispatchEvent(new Event('tdc-installable'));
  });
})();
