/* tdc-gate.js — client-side entitlement + section paywall (Phase A of the hybrid model).
 *
 *   TDCGate.ready            -> Promise<plan>   (resolves after the plan is known)
 *   TDCGate.plan()           -> 'free' | 'premium' | 'pro' | 'coach'
 *   TDCGate.has(tier)        -> bool   (CUMULATIVE: pro⊇premium, coach⊇all; owner⊇all)
 *   TDCGate.lock(el, opts)   -> overlays `el` with a paywall if the user lacks opts.tier.
 *                               opts = { tier:'premium'|'pro'|'coach', label, blurb }
 *   TDCGate.card(opts)       -> returns a standalone paywall element (no target to blur)
 *
 * Load AFTER auth.js (which keeps the session token fresh). Reads the plan from
 * profiles.plan (owner + pro/coach honored). Phase A hides content VISUALLY — the data
 * may still be reachable in the DOM; Phase B withholds it server-side via per-plan RLS.
 */
window.TDCGate = (function () {
  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
  var KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
  var OWNER = 'blee4824@gmail.com';
  var RANK = { free: 0, premium: 1, pro: 2, coach: 3 };
  var LABELS = { premium: 'Premium', pro: 'Pro', coach: "Coach's Tier" };
  var PRICE = { premium: '$4.99/mo', pro: '$8.99/mo', coach: 'a custom plan' };
  var _plan = 'free', _signedIn = false, _resolved = false;

  function sess() { try { return JSON.parse(localStorage.getItem('tdc_session') || 'null'); } catch (e) { return null; } }

  var G = {};
  G.ready = new Promise(function (resolve) {
    var s = sess();
    // Signed-out and owner resolve SYNCHRONOUSLY (no fetch) — so callers can read
    // resolved()/has() synchronously right after this script runs.
    if (!s || !s.access_token || !s.user) { _plan = 'free'; _resolved = true; return resolve('free'); }
    _signedIn = true;
    if (('' + (s.user.email || '')).toLowerCase() === OWNER) { _plan = 'coach'; _resolved = true; return resolve('coach'); }
    fetch(SB + '/rest/v1/profiles?id=eq.' + s.user.id + '&select=plan,sub_expires_at',
      { headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var p = rows && rows[0];
        var plan = (p && p.plan) || 'free';
        if (!RANK.hasOwnProperty(plan)) plan = 'free';
        _plan = plan; _resolved = true;
        resolve(plan);
      })
      .catch(function () { _plan = 'free'; _resolved = true; resolve('free'); });
  });

  G.plan = function () { return _plan; };
  G.signedIn = function () { return _signedIn; };
  G.resolved = function () { return _resolved; };
  G.has = function (tier) { return (RANK[_plan] || 0) >= (RANK[tier] || 0); };

  function ensureCss() {
    if (document.getElementById('tdc-gate-css')) return;
    var s = document.createElement('style');
    s.id = 'tdc-gate-css';
    s.textContent =
      '.tdc-gate-wrap{position:relative;}' +
      '.tdc-gate-blur{filter:blur(7px);pointer-events:none;user-select:none;-webkit-user-select:none;}' +
      '.tdc-gate-ov{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;' +
        'padding:20px;text-align:center;background:color-mix(in srgb,var(--bg,#141416) 55%,transparent);' +
        'backdrop-filter:blur(1px);border-radius:inherit;}' +
      '.tdc-gate-card{max-width:340px;background:var(--bg2,#1d1d20);border:1px solid var(--border,#2e2e34);' +
        'border-radius:16px;padding:22px 22px 20px;box-shadow:0 16px 44px rgba(0,0,0,.4);' +
        'font-family:Inter,-apple-system,system-ui,sans-serif;}' +
      '.tdc-gate-lock{font-size:22px;line-height:1;margin-bottom:10px;}' +
      '.tdc-gate-tier{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;' +
        'color:var(--accent,#E6D5A8);margin-bottom:7px;}' +
      '.tdc-gate-h{font-family:"Playfair Display",Georgia,serif;font-weight:800;font-size:19px;' +
        'color:var(--text,#f1efea);margin-bottom:7px;letter-spacing:-.01em;}' +
      '.tdc-gate-b{font-size:13px;line-height:1.55;color:var(--text2,#b4b0a8);margin-bottom:16px;}' +
      '.tdc-gate-btn{display:inline-block;font-weight:700;font-size:13.5px;color:#141416;' +
        'background:var(--accent,#E6D5A8);border:none;border-radius:24px;padding:10px 22px;cursor:pointer;' +
        'text-decoration:none;transition:transform .12s,box-shadow .12s;}' +
      '.tdc-gate-btn:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(0,0,0,.28);}' +
      '.tdc-gate-alt{display:block;margin-top:11px;font-size:12px;color:var(--text3,#807c74);text-decoration:none;}' +
      '.tdc-gate-alt:hover{color:var(--text2,#b4b0a8);}';
    document.head.appendChild(s);
  }

  // Build the paywall card element (used by lock() and card()).
  G.cardEl = function (opts) {
    ensureCss();
    opts = opts || {};
    var tier = opts.tier || 'premium';
    var tierName = LABELS[tier] || 'Premium';
    var head = opts.label ? ('Unlock ' + opts.label) : (tierName + ' feature');
    var blurb = opts.blurb || ('Get ' + tierName + ' for ' + (PRICE[tier] || '') +
      ' to see this and everything it unlocks.');
    var card = document.createElement('div');
    card.className = 'tdc-gate-card';
    var altHtml = _signedIn ? '' :
      '<a class="tdc-gate-alt" href="pricing.html">Already a member? Sign in</a>';
    card.innerHTML =
      '<div class="tdc-gate-lock">🔒</div>' +
      '<div class="tdc-gate-tier">' + tierName + '</div>' +
      '<div class="tdc-gate-h">' + head + '</div>' +
      '<div class="tdc-gate-b">' + blurb + '</div>' +
      '<a class="tdc-gate-btn" href="pricing.html">' +
        (tier === 'coach' ? 'Contact us' : 'Upgrade to ' + tierName) + '</a>' +
      altHtml;
    return card;
  };

  // Overlay `el` with a paywall if the user lacks `opts.tier`. Idempotent.
  // Returns true if it locked (user lacks tier), false if it left the content visible.
  G.lock = function (el, opts) {
    if (!el) return false;
    opts = opts || {};
    var tier = opts.tier || 'premium';
    if (G.has(tier)) return false;                 // entitled → show content
    if (el.querySelector(':scope > .tdc-gate-ov')) return true;  // already locked
    ensureCss();
    el.classList.add('tdc-gate-wrap');
    // blur the direct children (not the overlay we're about to add)
    Array.prototype.forEach.call(el.children, function (c) { c.classList.add('tdc-gate-blur'); });
    var ov = document.createElement('div');
    ov.className = 'tdc-gate-ov';
    ov.appendChild(G.cardEl(opts));
    el.appendChild(ov);
    return true;
  };

  return G;
})();
