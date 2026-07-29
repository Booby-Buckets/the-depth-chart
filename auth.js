/* ┌──────────────────────────────────────────────────────────────────────┐
   │  PAYWALL MASTER SWITCH                                                  │
   │  false = all premium gates OPEN (everyone gets in) — DEV / pre-launch.  │
   │  true  = paywall enforced (roster/compare/community/forum redirect      │
   │          non-premium users to pricing.html).                            │
   │  To re-enable the paywall before launch: set this to true AND bump the  │
   │  auth.js?v= query on every page (grep auth.js?v=).                       │
   └──────────────────────────────────────────────────────────────────────┘ */
window.TDC_PAYWALL_ENABLED = false;

/* Shared auth bootstrap — keeps users signed in by refreshing the Supabase JWT.
 *
 * The app stores the full Supabase session in localStorage.tdc_session, but the
 * access_token (a JWT) expires (~1h) and nothing renewed it, so users were
 * silently signed out — even with "keep me signed in" checked. This script:
 *   1. honors the ephemeral-session rule (keep unchecked + browser closed → out)
 *   2. refreshes an expired/expiring token ON LOAD (synchronously) so every page
 *      reads a fresh token from tdc_session
 *   3. keeps long-open tabs alive (interval + on refocus)
 * Load it as the FIRST <script> in <head> on every page.
 */
(function () {
  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
  var KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';

  function get() { try { return JSON.parse(localStorage.getItem('tdc_session') || 'null'); } catch (e) { return null; } }
  function save(d) { try { localStorage.setItem('tdc_session', JSON.stringify(d)); } catch (e) {} }
  function clear() { try { localStorage.removeItem('tdc_session'); localStorage.removeItem('tdc_persist'); } catch (e) {} }
  function expiringWithin(s, ms) { var e = s && s.expires_at ? s.expires_at * 1000 : 0; return !e || Date.now() > e - ms; }

  // 1) ephemeral-session cleanup: "keep me signed in" unchecked (tdc_persist==='0')
  //    means clear the session once the browser session ends (no tdc_alive flag).
  try {
    if (localStorage.getItem('tdc_persist') === '0') {
      if (localStorage.getItem('tdc_session') && !sessionStorage.getItem('tdc_alive')) clear();
      else sessionStorage.setItem('tdc_alive', '1');
    }
  } catch (e) {}

  // 2) synchronous refresh on load if the token is gone/expiring — runs before any
  //    page script reads tdc_session, so the UI never flickers to signed-out.
  try {
    var s = get();
    if (s && s.refresh_token && expiringWithin(s, 120000)) {
      var x = new XMLHttpRequest();
      x.open('POST', SB + '/auth/v1/token?grant_type=refresh_token', false); // sync
      x.setRequestHeader('apikey', KEY);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify({ refresh_token: s.refresh_token }));
      if (x.status === 200) {
        var d = JSON.parse(x.responseText);
        if (d && d.access_token) save(d);
      } else if (x.status === 400 || x.status === 401) {
        clear(); // refresh token genuinely invalid → really signed out
      }
    }
  } catch (e) {}

  // 3) keep long-open tabs alive
  function refreshIfNeeded() {
    var s = get();
    if (!s || !s.refresh_token || !expiringWithin(s, 300000)) return;
    fetch(SB + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.access_token) save(d); })
      .catch(function () {});
  }
  try {
    setInterval(refreshIfNeeded, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshIfNeeded(); });
  } catch (e) {}

  window.tdcRefreshIfNeeded = refreshIfNeeded;

  // Owner-only photo gate: real player headshots (hotlinked ESPN images / photo_url)
  // render ONLY when the OWNER is signed in, so they aren't exposed to the public.
  // Everyone else (signed out or other accounts) gets the initial/placeholder.
  // Every page gates its player <img> tags on window.tdcShowPhotos().
  var OWNER = 'blee4824@gmail.com';
  window.tdcShowPhotos = function () {
    try { var s = get(); return !!(s && s.user && ('' + (s.user.email || '')).toLowerCase() === OWNER); }
    catch (e) { return false; }
  };

  // True when the signed-in account is the owner. Every paywall gate honors this so
  // the owner always has full access to every tier, regardless of profiles.plan
  // (and regardless of whether the paywall is later switched on).
  window.tdcIsOwner = function () {
    try { var s = get(); return !!(s && s.user && ('' + (s.user.email || '')).toLowerCase() === OWNER); }
    catch (e) { return false; }
  };

  // Owner's live access token, but ONLY when the signed-in user is the owner — else null.
  // Shared caches (predictive_ratings, team_projections, award_projections) use this so
  // their writes carry the owner's JWT and pass owner-only RLS. Non-owners get null and
  // must not write (they read the owner-published cache). Pairs with the RLS lockdown.
  window.tdcOwnerToken = function () {
    try { var s = get(); return (s && s.user && ('' + (s.user.email || '')).toLowerCase() === OWNER && s.access_token) ? s.access_token : null; }
    catch (e) { return null; }
  };

  // Coach's Tier access check: owner OR profiles.plan in {pro, coach}. Returns a
  // memoized Promise<bool>. This is the SECTION-level gate for a premium widget
  // embedded on an otherwise-public page (e.g. the player-page Lineup Amplifier) —
  // as opposed to the whole-page redirect the Coach's Tier PAGES use. Enforced
  // regardless of TDC_PAYWALL_ENABLED, matching those pages' hard gate.
  var _coachPromise = null;
  window.tdcHasCoachTier = function () {
    if (_coachPromise) return _coachPromise;
    _coachPromise = new Promise(function (resolve) {
      try {
        if (window.tdcIsOwner && window.tdcIsOwner()) return resolve(true);
        var s = get();
        if (!s || !s.access_token || !s.user) return resolve(false);
        fetch(SB + '/rest/v1/profiles?id=eq.' + s.user.id + '&select=plan',
          { headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token } })
          .then(function (r) { return r.ok ? r.json() : []; })
          .then(function (rows) { var p = rows && rows[0]; resolve(!!(p && ['pro', 'coach'].indexOf(p.plan) >= 0)); })
          .catch(function () { resolve(false); });
      } catch (e) { resolve(false); }
    });
    return _coachPromise;
  };
})();
