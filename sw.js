/* sw.js — The Depth Chart service worker (PWA scaffold).
   Bump CACHE to force an update (the SW also auto-updates whenever this file's bytes change).

   Strategy:
   - Navigations / .html  -> network-first (always fresh online; respects the no-cache
                             HTML deploy discipline), cache fallback, else offline.html.
   - Same-origin static   -> stale-while-revalidate (versioned ?v= URLs make this safe;
     (js/css/svg/png/json)   .json shows last-loaded data instantly and refreshes next load).
   - Cross-origin GET      -> network-first with runtime-cache fallback (Supabase data,
                             Google Fonts still render the last-seen values offline).
*/
const CACHE = 'tdc-v13';
const CORE = ['index.html', 'offline.html', 'favicon.svg',
              'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isHTML(req, url) {
  return req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;             // never cache writes (Supabase POST/PATCH)
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // HTML / navigations -> network-first
  if (sameOrigin && isHTML(req, url)) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('offline.html')))
    );
    return;
  }

  // Same-origin static -> stale-while-revalidate
  if (sameOrigin) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // Cross-origin GET -> network-first, cache fallback
  e.respondWith(
    fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req))
  );
});
