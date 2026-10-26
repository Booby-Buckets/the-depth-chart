/* bet-sw.js — TDC Bet's service worker: arb alerts only (no caching; the pages load as normal).
   Registered by bet/arb.html with scope "/" on bet.thedepthchartcbb.com (the installed TDC Bet app) and "/bet/" on
   www (so it never replaces the main site's sw.js). Pushes come from api/arb-scan.js. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'TDC Bet', {
    body: d.body || '', tag: d.tag || 'tdc-arb', renotify: true,
    icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || null }
  }));
});

// tapping an alert opens (or focuses) the Arbs page
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || (self.location.hostname.indexOf('bet.') === 0 ? '/arb' : '/bet/arb.html');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) if (/\/arb(\.html)?(\?|$)/.test(new URL(cs[i].url).pathname + '?')) return cs[i].focus();
    return self.clients.openWindow(url);
  }));
});
