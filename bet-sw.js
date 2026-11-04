/* bet-sw.js: arb alerts were removed (Nov 2026). This stays as an empty worker because devices that turned alerts on
   still have it registered; it does nothing and caches nothing. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
