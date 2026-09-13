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
  var SUPPORT = 'mailto:blee4824@gmail.com?subject=Subscription%20change';
  var LINKS = { monthly: 'https://buy.stripe.com/8x25kF67o36U0ticUn33W00', yearly: 'https://buy.stripe.com/14AdRbeDUgXKcc0g6z33W01',
                pro_monthly: 'https://buy.stripe.com/eVq3cx7bs6j67VK9Ib33W02', pro_yearly: 'https://buy.stripe.com/3cI00l8fwdLydg48E733W03' };
  function sess() { try { return JSON.parse(localStorage.getItem('tdc_session') || 'null'); } catch (e) { return null; } }
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
      if (r.status === 404 && d && d.error === 'no_customer') { fail('We can’t find a Stripe subscription under ' + esc(s.user && s.user.email || 'this email') + '. If you paid with a different email, tell us and we’ll link it.'); return; }
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
        '<div class="row"><a class="b primary" href="' + LINKS.monthly + '">Go Premium · $4.99/mo</a><a class="b" href="' + LINKS.pro_monthly + '">Go Pro · $8.99/mo</a><a class="b" href="pricing.html">Compare plans</a></div>' +
        '<div class="note">Pay with the email on this account so access unlocks automatically.</div></div>';
    }
    var alt = plan === 'premium' ? '<a class="b" href="' + LINKS.pro_monthly + '">Upgrade to Pro</a>' : '';
    return '<div class="tdcb"><div class="h">Subscription</div>' +
      '<div class="kv"><span style="display:inline-flex;align-items:center">Plan <b style="margin-left:5px">' + esc(label) + '</b>' + badge + '</span>' + (when ? '<span>Renews <b>' + esc(when) + '</b></span>' : '') + '</div>' +
      '<div class="row"><button class="b primary manage" data-label="Manage subscription" onclick="TDC_BILLING.manage()">Manage subscription</button>' +
      '<button class="b manage" data-label="Switch plan" onclick="TDC_BILLING.manage()">Switch plan</button>' + alt +
      '<button class="b danger manage" data-label="Cancel" onclick="TDC_BILLING.manage()">Cancel</button></div>' +
      '<div class="msg"></div>' +
      '<div class="note">Opens Stripe’s secure billing portal: cancel any time (you keep access to the end of the period), switch Premium ⇄ Pro or monthly ⇄ yearly, update your card, and download invoices.' + (plan === 'coach' ? ' Coach’s Tier is invoiced directly — email us for changes.' : '') + '</div></div>';
  }
  return { manage: manage, panel: panel, LINKS: LINKS };
})();
