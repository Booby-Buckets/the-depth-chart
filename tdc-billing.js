/* tdc-billing.js — "Manage subscription" for signed-in members, sitewide.
   TDC_BILLING.manage({return_url})  → opens the Stripe Customer Portal (cancel / switch
     Premium ⇄ Pro / change interval / update card) via the stripe-portal Edge Function.
     Falls back to the no-code portal login link (PORTAL_LOGIN) if the function isn't
     deployed yet, and finally to a mailto if neither is configured.
   TDC_BILLING.panel(profile)        → the plan-management block (HTML) used by the account
     page, the profile Account tab and the pricing page's signed-in panel. */
window.TDC_BILLING = (function () {
  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
  var KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
  // Optional no-code fallback: Stripe → Settings → Billing → Customer portal → "Activate link"
  // gives a https://billing.stripe.com/p/login/… URL (the member enters their email, gets a
  // magic link). Leave empty to rely on the stripe-portal function only.
  var PORTAL_LOGIN = '';
  var SUPPORT = 'mailto:thedepthchartcbb@gmail.com?subject=Subscription%20change';
  var LINKS = { monthly: 'https://buy.stripe.com/bJe7sN1R89vi3Fu2fJ33W04', yearly: 'https://buy.stripe.com/14AdRbeDUgXKcc0g6z33W01',
                pro_monthly: 'https://buy.stripe.com/eVq3cx7bs6j67VK9Ib33W02', pro_yearly: 'https://buy.stripe.com/9B67sN53k36Udg407B33W08' };
  function sess() { try { return JSON.parse(localStorage.getItem('tdc_session') || 'null'); } catch (e) { return null; } }
  // Payment link stamped with this account (client_reference_id "<userId>__<planKey>") so the plan
  // lands on the right account even if the member pays with a different email.
  // purchases paused site-wide (auth.js TDC_SALES_PAUSED; owner exempt) — and paused if auth.js didn't load
  function paused() { return window.tdcSalesPaused ? window.tdcSalesPaused() : true; }
  function link(planKey) {
    if (paused()) return 'pricing.html';
    var base = LINKS[planKey] || LINKS.monthly, s = sess(), u = s && s.user;
    if (!u || !u.id) return 'pricing.html';
    return base + '?prefilled_email=' + encodeURIComponent(u.email || '') + '&client_reference_id=' + encodeURIComponent(u.id + '__' + planKey);
  }
  // ONE CHECKOUT PER MEMBER (owner, Oct 2026: a member bought the same plan 6 times). Every buy button goes
  // through checkout(): a member whose plan is already paid is sent to the billing portal instead of Stripe
  // Checkout, and a checkout started in the last 45 minutes (payment may still be landing — the plan can take a
  // minute to unlock) asks before opening a second one. Stripe's own "limit customers to one subscription"
  // setting is the server-side backstop (see supabase/BILLING_SETUP.md).
  var PENDING_KEY = 'tdc_checkout_pending', PENDING_MIN = 45;
  async function freshPlan(s) {
    try {
      var r = await fetch(SB + '/rest/v1/profiles?id=eq.' + encodeURIComponent(s.user.id) + '&select=plan', { headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token } });
      var d = r.ok ? await r.json() : null; return d && d[0] ? String(d[0].plan || 'free').toLowerCase() : null;
    } catch (e) { return null; }
  }
  async function checkout(planKey) {
    if (paused()) { location.href = 'pricing.html'; return false; }
    var s = sess(); if (!s || !s.user || !s.access_token) { location.href = 'pricing.html'; return false; }
    var plan = await freshPlan(s);
    if (plan === 'premium' || plan === 'pro' || plan === 'coach') {
      alert('You already have ' + (plan === 'coach' ? "Coach's Tier" : plan.charAt(0).toUpperCase() + plan.slice(1)) + ' on this account. To switch plans or billing period, use Manage subscription — no second purchase needed.');
      manage(); return false;
    }
    var pend = null; try { pend = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch (e) {}
    if (pend && pend.uid === s.user.id && Date.now() - pend.at < PENDING_MIN * 60000) {
      var mins = Math.max(1, Math.round((Date.now() - pend.at) / 60000));
      if (!confirm('You opened checkout ' + mins + ' minute' + (mins > 1 ? 's' : '') + ' ago. If you finished paying, your plan can take a minute to unlock — check your email for a Stripe receipt and refresh this page instead of paying again.\n\nOpen checkout anyway?')) return false;
    }
    try { localStorage.setItem(PENDING_KEY, JSON.stringify({ uid: s.user.id, plan: planKey, at: Date.now() })); } catch (e) {}
    location.href = link(planKey); return true;
  }
  function esc(s) { return ('' + (s == null ? '' : s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css() {
    if (document.getElementById('tdc-billing-css')) return;
    var s = document.createElement('style'); s.id = 'tdc-billing-css';
    s.textContent =
      '.tdcb{border:1px solid var(--border,#2e2e34);border-radius:12px;background:var(--bg2,#1d1d20);padding:18px 20px;font-family:Inter,system-ui,sans-serif;}' +
      '.tdcb .h{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3,#807c74);margin-bottom:8px;}' +
      '.tdcb .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px;}' +
      '.tdcb .b{font:inherit;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;border:1px solid var(--border2,#45454d);background:transparent;color:var(--text,#f1efea);border-radius:22px;padding:9px 18px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;transition:all .15s;}' +
      '.tdcb .b:hover{border-color:var(--accent,#e6d5a8);color:var(--accent,#e6d5a8);}' +
      '.tdcb .b.primary{background:var(--accent,#e6d5a8);border-color:var(--accent,#e6d5a8);color:#1a1206;}' +
      '.tdcb .b.primary:hover{opacity:.9;color:#1a1206;}' +
      '.tdcb .b.danger:hover{border-color:var(--red,#e07070);color:var(--red,#e07070);}' +
      '.tdcb .b[disabled]{opacity:.5;cursor:wait;}' +
      '.tdcb .note{font-size:11.5px;color:var(--text3,#807c74);line-height:1.5;margin-top:10px;}' +
      '.tdcb .msg{font-size:12.5px;font-weight:600;margin-top:10px;display:none;} .tdcb .msg.show{display:block;} .tdcb .msg.err{color:var(--red,#e07070);}' +
      '.tdcb .kv{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--text2,#b4b0a8);} .tdcb .kv b{color:var(--text,#f1efea);}';
    document.head.appendChild(s);
  }
  var busy = false;
  async function manage(opts) {
    opts = opts || {};
    var s = sess(); if (!s || !s.access_token) { location.href = 'pricing.html'; return; }
    if (busy) return; busy = true;
    var btns = document.querySelectorAll('.tdcb .b.manage'); btns.forEach(function (b) { b.disabled = true; b.textContent = 'Opening…'; });
    var msg = document.querySelector('.tdcb .msg'); if (msg) { msg.className = 'msg'; msg.textContent = ''; }
    var ret = opts.return_url || (location.origin.indexOf('thedepthchartcbb.com') > -1 ? location.href : 'https://www.thedepthchartcbb.com/account.html');
    try {
      var r = await fetch(SB + '/functions/v1/stripe-portal', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ return_url: ret }) });
      var d = null; try { d = await r.json(); } catch (e) {}
      if (r.ok && d && d.url) { location.href = d.url; return; }
      if (r.status === 404 && d && d.error === 'no_customer') { fail('We couldn’t find a Stripe purchase linked to this account. If you paid with a different email, <a href="' + SUPPORT + '%20(link%20my%20payment)&body=' + encodeURIComponent('Account email: ' + (s.user && s.user.email || '') + '\nEmail I paid with: ') + '" style="color:var(--accent);font-weight:700;">send us that email</a> and we’ll link it the same day.'); return; }
      // function not deployed / not configured → fallbacks
      if (PORTAL_LOGIN) { location.href = PORTAL_LOGIN; return; }
      fail('Plan changes aren’t self-serve yet — email us and we’ll cancel or switch it the same day. <a href="' + SUPPORT + '" style="color:var(--accent);font-weight:700;">Email support →</a>');
    } catch (e) {
      if (PORTAL_LOGIN) { location.href = PORTAL_LOGIN; return; }
      fail('Couldn’t reach billing right now. <a href="' + SUPPORT + '" style="color:var(--accent);font-weight:700;">Email support →</a>');
    }
    function fail(html) { busy = false; btns.forEach(function (b) { b.disabled = false; b.textContent = b.dataset.label || 'Manage subscription'; }); if (msg) { msg.className = 'msg show err'; msg.innerHTML = html; } }
  }
  // Plan-management block. profile = {plan, sub_expires_at}
  function panel(p) {
    css(); p = p || {};
    var plan = (p.plan || 'free').toLowerCase(), paid = plan === 'premium' || plan === 'pro' || plan === 'coach';
    var label = plan === 'coach' ? "Coach's Tier" : plan.charAt(0).toUpperCase() + plan.slice(1);
    var when = p.sub_expires_at ? new Date(p.sub_expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
    var badge = (window.TDC_BADGE ? TDC_BADGE.html(p, { size: '18px', ml: '6px' }) : '');
    if (!paid) {
      return '<div class="tdcb"><div class="h">Subscription</div><div class="kv"><span>Plan <b>Free</b></span></div>' +
        (paused() ? '<div class="note" style="margin-top:12px">Premium and Pro subscriptions are coming soon — sign-ups are paused while we finish checkout. <a href="pricing.html" style="color:inherit">See what’s included</a>.</div></div>' :
        '<div class="row"><a class="b primary" href="pricing.html" onclick="TDC_BILLING.checkout(\'monthly\');return false;">Go Premium · $4.99/mo</a><a class="b" href="pricing.html" onclick="TDC_BILLING.checkout(\'pro_monthly\');return false;">Go Pro · $8.99/mo</a><a class="b" href="pricing.html">Compare plans</a></div>' +
        '<div class="note">Access unlocks on this account automatically, whatever email you pay with.</div></div>');
    }
    return '<div class="tdcb"><div class="h">Subscription</div>' +
      '<div class="kv"><span style="display:inline-flex;align-items:center">Plan <b style="margin-left:5px">' + esc(label) + '</b>' + badge + '</span>' + (when ? '<span>Renews <b>' + esc(when) + '</b></span>' : '') + '</div>' +
      '<div class="row"><button class="b primary manage" data-label="Manage subscription" onclick="TDC_BILLING.manage()">Manage subscription</button>' +
      '<button class="b manage" data-label="Switch plan" onclick="TDC_BILLING.manage()">Switch plan</button>' +
      '<button class="b danger manage" data-label="Cancel" onclick="TDC_BILLING.manage()">Cancel</button>' +
      '<a class="b" href="refund.html#request">Request a refund</a></div>' +
      '<div class="msg"></div>' +
      '<div class="note">Opens Stripe’s secure billing portal: cancel any time (you keep access to the end of the period), switch Premium ⇄ Pro or monthly ⇄ yearly, update your card, and download invoices. First purchases can be refunded within 14 days — <a href="refund.html" style="color:inherit;text-decoration:underline;">refund policy</a>.' + (plan === 'coach' ? ' Coach’s Tier is invoiced directly — email us for changes.' : '') + '</div></div>';
  }
  // RETURN FROM STRIPE: each Payment Link's "After payment" redirect points at
  // https://www.thedepthchartcbb.com/account.html?checkout=success — this banner confirms the payment and waits
  // (up to ~90 s) for the webhook to unlock the plan, so a member never thinks it failed and pays again.
  function returnBanner() {
    var q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
    if (!/^success/i.test(q.get('checkout') || '')) return;   // tolerant of a stray trailing '.' pasted into Stripe
    try { var u = new URL(location.href); u.searchParams.delete('checkout'); history.replaceState(history.state, '', u.toString()); } catch (e) {}
    var b = document.createElement('div');
    b.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;max-width:min(560px,calc(100vw - 24px));background:var(--bg,#fff);color:var(--text,#111);border:1px solid var(--border2,#ccc);border-left:4px solid var(--accent,#A8843C);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:14px 16px;font:600 14px/1.45 Inter,system-ui,sans-serif';
    var set = function (html) { b.innerHTML = html + '<button aria-label="Close" style="position:absolute;top:6px;right:8px;border:0;background:none;font-size:18px;cursor:pointer;color:inherit;opacity:.5" onclick="this.parentNode.remove()">×</button>'; };
    set('<b>Payment received — thank you!</b><br><span style="font-weight:500">Unlocking your plan… this usually takes a few seconds.</span>');
    document.body.appendChild(b);
    var s = sess(); if (!s || !s.user || !s.access_token) { set('<b>Payment received — thank you!</b><br><span style="font-weight:500">Sign in with your account and your plan will be there.</span>'); return; }
    var tries = 0;
    (function poll() {
      freshPlan(s).then(function (plan) {
        if (plan === 'premium' || plan === 'pro' || plan === 'coach') {
          try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
          var nm = plan === 'coach' ? "Coach's Tier" : plan.charAt(0).toUpperCase() + plan.slice(1);
          set('<b>✓ You’re ' + nm + ' — everything is unlocked.</b><br><span style="font-weight:500">Your receipt is in your email. <a href="#" onclick="location.reload();return false" style="color:inherit;text-decoration:underline">Refresh this page</a> to see it.</span>');
          return;
        }
        if (++tries < 30) { setTimeout(poll, 3000); return; }
        set('<b>Payment received.</b><br><span style="font-weight:500">Your plan hasn’t unlocked yet — please don’t pay again. Refresh in a minute; if it still says Free, <a href="' + SUPPORT + '%20(payment%20not%20unlocked)&body=' + encodeURIComponent('Account email: ' + (s.user.email || '') + '\nEmail I paid with: ') + '" style="color:inherit;text-decoration:underline">email us</a> and we’ll fix it the same day.</span>');
      });
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', returnBanner); else returnBanner();
  return { manage: manage, panel: panel, link: link, checkout: checkout, LINKS: LINKS };
})();
