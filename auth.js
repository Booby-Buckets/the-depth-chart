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
  function save(d) { try { localStorage.setItem('tdc_session', JSON.stringify(d)); } catch (e) {} mirror(d); }
  function clear() { try { localStorage.removeItem('tdc_session'); localStorage.removeItem('tdc_persist'); } catch (e) {} }
  function expiringWithin(s, ms) { var e = s && s.expires_at ? s.expires_at * 1000 : 0; return !e || Date.now() > e - ms; }

  // ── one sign-in across subdomains (www ⇄ bet.thedepthchartcbb.com, Oct 2026) ──
  // localStorage is per-origin, so the session's refresh token is mirrored into a cookie on the parent domain:
  //   tdc_sso = {rt, iat, p}  the newest session's refresh token (iat = when it was issued, p = tdc_persist)
  //           = {out}         a sign-out tombstone: sessions issued before `out` are dropped everywhere
  // Supabase rotates refresh tokens and revokes the whole session if a used one is replayed, so an origin
  // always adopts the cookie's newer token instead of refreshing with its own stale one.
  // tdc_sso_seen (localStorage) = this origin has mirrored a session, so a missing session here means the
  // user signed out here (→ tombstone), not that they never signed in here (→ adopt the cookie).
  var SSO_DOM = /(^|\.)thedepthchartcbb\.com$/i.test(location.hostname) ? '.thedepthchartcbb.com' : null;
  function issued(s) { return s ? (s.expires_at || 0) - (s.expires_in || 3600) : 0; }
  function ckGet() { try { var m = document.cookie.match(/(?:^|; )tdc_sso=([^;]*)/); return m ? JSON.parse(decodeURIComponent(m[1])) : null; } catch (e) { return null; } }
  function ckPut(o) { if (SSO_DOM) document.cookie = 'tdc_sso=' + encodeURIComponent(JSON.stringify(o)) + '; Max-Age=2592000; Path=/; Domain=' + SSO_DOM + '; Secure; SameSite=Lax'; }
  function mirror(s) {
    if (!SSO_DOM || !s || !s.refresh_token) return;
    try { ckPut({ rt: s.refresh_token, iat: issued(s), p: localStorage.getItem('tdc_persist') || '1' }); localStorage.setItem('tdc_sso_seen', '1'); } catch (e) {}
  }
  // the refresh token to use: the cookie's when another subdomain holds a newer session
  function liveRt(s) { var c = ckGet(); return (c && c.rt && c.rt !== s.refresh_token && c.iat > issued(s)) ? c.rt : s.refresh_token; }
  function refreshSync(rt) {
    var x = new XMLHttpRequest();
    x.open('POST', SB + '/auth/v1/token?grant_type=refresh_token', false); // sync
    x.setRequestHeader('apikey', KEY);
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify({ refresh_token: rt }));
    if (x.status === 200) { var d = JSON.parse(x.responseText); return d && d.access_token ? d : null; }
    return x.status;
  }

  // 1) ephemeral-session cleanup: "keep me signed in" unchecked (tdc_persist==='0')
  //    means clear the session once the browser session ends (no tdc_alive flag).
  try {
    if (localStorage.getItem('tdc_persist') === '0') {
      if (localStorage.getItem('tdc_session') && !sessionStorage.getItem('tdc_alive')) clear();
      else sessionStorage.setItem('tdc_alive', '1');
    }
  } catch (e) {}

  // 1b) sync with the other subdomain (no-op off thedepthchartcbb.com, e.g. localhost / github.io)
  try {
    if (SSO_DOM) {
      var c0 = ckGet(), s0 = get();
      if (s0 && s0.refresh_token) {
        if (c0 && c0.out && c0.out > issued(s0)) { clear(); localStorage.removeItem('tdc_sso_seen'); }   // signed out elsewhere
        else if (c0 && c0.rt && c0.rt !== s0.refresh_token && c0.iat > issued(s0)) {                   // newer session elsewhere
          var d0 = refreshSync(c0.rt);
          if (d0 && d0.access_token) save(d0); else mirror(s0);
        } else if (!c0 || c0.out || c0.rt !== s0.refresh_token) mirror(s0);
      } else if (c0 && c0.rt && !c0.out) {
        if (localStorage.getItem('tdc_sso_seen')) { ckPut({ out: Math.floor(Date.now() / 1000) }); localStorage.removeItem('tdc_sso_seen'); }   // signed out here
        else { var d1 = refreshSync(c0.rt); if (d1 && d1.access_token) { if (c0.p) localStorage.setItem('tdc_persist', c0.p); save(d1); } }
      }
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
      x.send(JSON.stringify({ refresh_token: liveRt(s) }));
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
      body: JSON.stringify({ refresh_token: liveRt(s) })
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

  // ── SALES SWITCH (owner, Oct 18 2026: "subscriptions suspended until checkout works") ──
  // true = nobody can buy a plan: pricing / account / billing buttons say "coming soon" and no Stripe link opens.
  // The owner is exempt so checkout can still be tested. Flip to false to reopen sales everywhere.
  window.TDC_SALES_PAUSED = false;   // reopened Oct 19 2026 (one-checkout-per-member guard + webhook v14 in place)
  window.tdcSalesPaused = function () { return !!window.TDC_SALES_PAUSED && !window.tdcIsOwner(); };

  // ── OWNER-ONLY pages (owner, Oct 18 2026: "lock the dynasty and fantasy modes for everyone but my account") ──
  // The pages themselves redirect non-owners to coming-soon.html; this hides every link to them (nav menus, the
  // Explore page, tiles) for everyone else. Remove a page from the list to open it to the public.
  window.TDC_OWNER_ONLY = ['dynasty.html', 'league.html'];
  try {
    if (!window.tdcIsOwner()) {
      var _oo = document.createElement('style');
      _oo.textContent = window.TDC_OWNER_ONLY.map(function (p) { return 'a[href^="' + p + '"],a[href^="/' + p + '"]'; }).join(',') + '{display:none!important;}';
      (document.head || document.documentElement).appendChild(_oo);
    }
  } catch (e) {}

  // Owner's live access token, but ONLY when the signed-in user is the owner — else null.
  // Shared caches (predictive_ratings, team_projections, award_projections) use this so
  // their writes carry the owner's JWT and pass owner-only RLS. Non-owners get null and
  // must not write (they read the owner-published cache). Pairs with the RLS lockdown.
  window.tdcOwnerToken = function () {
    try { var s = get(); return (s && s.user && ('' + (s.user.email || '')).toLowerCase() === OWNER && s.access_token) ? s.access_token : null; }
    catch (e) { return null; }
  };

  // Read headers that carry the SIGNED-IN USER's JWT when available (else the anon key).
  // Used for reads of plan-gated tables (e.g. `shots`) so Supabase can check the caller's
  // plan via RLS. Safe for public tables too — the authenticated role keeps public read.
  // Call at fetch time (not captured once) so the token is always fresh.
  window.tdcH = function () {
    try { var s = get(); return { apikey: KEY, Authorization: 'Bearer ' + ((s && s.access_token) || KEY) }; }
    catch (e) { return { apikey: KEY, Authorization: 'Bearer ' + KEY }; }
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
  // ── Account deletion (scripts/delete_accounts.sql) ──
  // tdcDeleteMyAccount(): the signed-in user deletes themselves, after typing DELETE.
  // tdcAdminDeleteAccount(id, name): owner only (the server checks the JWT email too),
  // after typing the account's username. Both resolve true only when the delete happened.
  function rpcDelete(fn, body) {
    var s = get();
    if (!s || !s.access_token) { alert('Please sign in first.'); return Promise.resolve(false); }
    return fetch(SB + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) {}
        if (!r.ok) { alert('Could not delete the account' + (j && j.message ? ': ' + j.message : ' (HTTP ' + r.status + ').')); return false; }
        if (j && j.ok === false) { alert(j.msg || 'Could not delete the account.'); return false; }
        return true;
      });
    }).catch(function () { alert('Could not reach the server. Try again.'); return false; });
  }
  window.tdcDeleteMyAccount = function () {
    if (window.tdcIsOwner()) { alert('The owner account cannot be deleted.'); return Promise.resolve(false); }
    var typed = prompt('This permanently deletes your account, profile, posts, comments and follows. It cannot be undone.\n\n' +
      'If you pay for a subscription, cancel it under Manage billing first — deleting the account does not stop Stripe charges.\n\n' +
      'Type DELETE to confirm:');
    if (typed === null) return Promise.resolve(false);
    if (typed.trim().toUpperCase() !== 'DELETE') { alert('Not deleted — you must type DELETE.'); return Promise.resolve(false); }
    return rpcDelete('delete_my_account').then(function (ok) {
      if (ok) { clear(); try { sessionStorage.removeItem('tdc_alive'); } catch (e) {} alert('Your account has been deleted.'); location.href = 'index.html'; }
      return ok;
    });
  };
  window.tdcAdminDeleteAccount = function (userId, name) {
    if (!window.tdcIsOwner()) return Promise.resolve(false);
    var label = (name || '').trim();
    var typed = prompt('OWNER: permanently delete the account "' + (label || userId) + '" and everything it posted?\n' +
      'This cannot be undone. Their Stripe subscription (if any) is NOT cancelled.\n\n' +
      'Type ' + (label ? 'their username' : 'DELETE') + ' to confirm:');
    if (typed === null) return Promise.resolve(false);
    var want = label || 'DELETE';
    if (typed.trim().toLowerCase() !== want.toLowerCase()) { alert('Not deleted — the confirmation did not match.'); return Promise.resolve(false); }
    return rpcDelete('admin_delete_account', { p_user: userId }).then(function (ok) {
      if (ok) alert('Deleted "' + (label || userId) + '".');
      return ok;
    });
  };
})();
