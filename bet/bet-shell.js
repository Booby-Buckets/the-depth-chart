/* bet-shell.js — TDC Bet's frame, shared by every page: top bar, mobile tab bar, footer, theme, the bet slip,
 * paywall cards, toasts. Pages add <div id="bxApp"></div>-style content between the shell's header and footer;
 * this file injects the header/footer around <main class="bx-main">.
 *
 *   BX.px(sel, main, sub, cls)   price box HTML; clicking it adds/removes the selection on the slip
 *   BX.gate(el, opts)            Premium wall over el (opts: label, blurb). Returns Promise<bool locked>
 *   BX.has()                     Promise<bool> the viewer has Premium (owner always)
 *   BX.toast(msg)
 *   BX.slip                      { list, toggle, has, clear, open, mine, track }
 *
 * The slip is a per-viewer convenience (localStorage): picks you tap, a parlay price at OUR odds, and
 * "Track" saves them to My Bets, graded automatically from final scores. Nothing is wagered on TDC Bet.
 * Needs bet-core.js first.
 */
(function (g) {
  'use strict';
  var B = g.TDCBet, esc = B.esc;
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  // ── theme (own key: TDC Bet is dark-first) ─────────────────────────────
  var theme = LS.get('tdcbet_theme', 'dark');
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  function setTheme(t) { theme = t; LS.set('tdcbet_theme', t); document.documentElement.setAttribute('data-theme', t); }

  var IC = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    games: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg>',
    props: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    fut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    slip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>'
  };
  var NAV = [['index', 'Tonight'], ['games', 'Games'], ['props', 'Props'], ['pickem', "Pick'em"], ['arb', 'Arbs'], ['futures', 'Futures'], ['markets', 'Markets'], ['trends', 'Trends'], ['record', 'Record'], ['tools', 'Tools']];
  var MORE = [['arb', 'Arbs', 'Sure bets and middles across every book, with exact stakes'], ['pickem', "Pick'em", 'PrizePicks, Underdog, Pick6 and Betr lines vs each entry\'s break-even'], ['markets', 'Markets', 'Every question, priced like a prediction market'], ['trends', 'Trends', 'ATS and over/under history, 5 seasons'], ['record', 'Record', 'How our numbers have done'],
              ['tools', 'Tools', 'Matchup calculator, odds converter, parlay, Kelly'], ['learn', 'Learn', 'How the model works · glossary']];
  // owner-only pages: hidden from everyone else's nav (the page itself also turns non-owners away)
  var OWNER_ONLY = { arb: 1 };
  if (!(g.tdcIsOwner && g.tdcIsOwner())) {
    NAV = NAV.filter(function (n) { return !OWNER_ONLY[n[0]]; });
    MORE = MORE.filter(function (n) { return !OWNER_ONLY[n[0]]; });
  }

  function session() { try { return JSON.parse(localStorage.getItem('tdc_session') || 'null'); } catch (e) { return null; } }

  function header(cur) {
    var s = session(), signed = !!(s && s.user);
    var acct = signed
      ? '<a class="bx-ib main" href="' + B.main('account.html') + '" title="Your account"><span>' + esc(((s.user.email || 'Account').split('@')[0]).slice(0, 14)) + '</span></a>'
      : '<a class="bx-ib cta" href="' + B.main('signin.html?next=' + encodeURIComponent('bet/' + (cur === 'index' ? 'index.html' : cur + '.html'))) + '">Sign in</a>';
    return '<header class="bx-top"><div class="bx-top-in">' +
      '<a class="bx-logo" href="' + B.href('index') + '" aria-label="TDC Bet home"><span class="bx-mark">TDC</span><span class="bx-word">TDC <b>Bet</b></span></a>' +
      '<nav class="bx-nav" aria-label="TDC Bet">' + NAV.map(function (n) { return '<a href="' + B.href(n[0]) + '"' + (n[0] === cur ? ' class="on" aria-current="page"' : '') + '>' + n[1] + '</a>'; }).join('') + '</nav>' +
      '<div class="bx-right">' +
        '<span class="bx-feed" id="bxFeed" title="Sportsbook odds feed"><i></i><span>Odds feed</span></span>' +
        '<button class="bx-ib" id="bxTheme" aria-label="Switch theme">' + (theme === 'light' ? IC.moon : IC.sun) + '</button>' +
        '<button class="bx-ib slip" id="bxSlipBtn" aria-label="Open bet slip">' + IC.slip + '<span>Slip</span><b id="bxSlipN">0</b></button>' +
        acct +
        '<a class="bx-ib main" href="' + B.main('') + '" title="Back to The Depth Chart">' + IC.back + '<span>The Depth Chart</span></a>' +
      '</div></div></header>';
  }
  function tabbar(cur) {
    var t = [['index', 'Tonight', IC.home], ['games', 'Games', IC.games], ['props', 'Props', IC.props], ['futures', 'Futures', IC.fut]];
    var inMore = MORE.some(function (m) { return m[0] === cur; });
    return '<nav class="bx-tabbar" aria-label="TDC Bet">' + t.map(function (x) { return '<a href="' + B.href(x[0]) + '"' + (x[0] === cur ? ' class="on"' : '') + '>' + x[2] + x[1] + '</a>'; }).join('') +
      '<button id="bxMoreBtn"' + (inMore ? ' class="on"' : '') + '>' + IC.more + 'More</button></nav>' +
      '<div class="sp-ov" id="bxMoreOv"></div><div class="bx-more" id="bxMore"><div class="grab"></div>' +
      MORE.map(function (m) { return '<a href="' + B.href(m[0]) + '">' + m[1] + '<span>' + m[2] + '</span></a>'; }).join('') +
      '<a href="' + B.main('') + '">The Depth Chart<span>Back to the main site</span></a></div>';
  }
  function footer() {
    return '<footer class="bx-foot"><div class="bx-foot-in">' +
      '<div><h5>TDC Bet</h5>College basketball lines, props and futures, priced by The Depth Chart\'s model and set against the books. ' +
        'TDC Bet publishes analysis and prices. It does not take bets.' +
        '<div class="rg"><b>21+ only.</b> Bet with money you can afford to lose. Gambling problem? Call <b>1-800-GAMBLER</b> or visit <a href="https://www.ncpgambling.org" target="_blank" rel="noopener" style="display:inline">ncpgambling.org</a>.</div></div>' +
      '<div><h5>Board</h5>' + NAV.slice(0, -2).map(function (n) { return '<a href="' + B.href(n[0]) + '">' + n[1] + '</a>'; }).join('') + '</div>' +
      '<div><h5>More</h5><a href="' + B.href('record') + '">Our record</a><a href="' + B.href('tools') + '">Tools</a><a href="' + B.href('learn') + '">How it works</a>' +
        '<a href="' + B.main('') + '">The Depth Chart</a><a href="' + B.main('pricing.html') + '">Plans</a><a href="' + B.main('terms.html') + '">Terms</a></div>' +
      '</div></footer>';
  }

  // ── slip state ─────────────────────────────────────────────────────────
  var REG = {};                     // key → selection, for every price box drawn this page
  var slip = LS.get('tdcbet_slip', []);
  var mine = LS.get('tdcbet_mine', []);
  function saveSlip() { LS.set('tdcbet_slip', slip); paintCount(); paintPicked(); if (spOpen) paintSlip(); }
  function has(key) { return slip.some(function (x) { return x.key === key; }); }
  function toggle(sel) {
    if (!sel) return;
    if (has(sel.key)) { slip = slip.filter(function (x) { return x.key !== sel.key; }); saveSlip(); return false; }
    // one side of a market at a time
    var base = sel.key.replace(/:[^:]+$/, ':');
    slip = slip.filter(function (x) { return x.key.indexOf(base) !== 0 || x.market === 'prop'; });
    slip.push(sel); saveSlip();
    toast(esc(sel.label) + ' added to your slip');
    return true;
  }
  function paintCount() {
    var n = document.getElementById('bxSlipN'), b = document.getElementById('bxSlipBtn');
    if (n) n.textContent = slip.length;
    if (b) b.classList.toggle('has', slip.length > 0);
  }
  function paintPicked() {
    document.querySelectorAll('[data-k]').forEach(function (el) { el.classList.toggle('picked', has(el.getAttribute('data-k'))); });
  }
  function px(sel, mainTxt, sub, cls) {
    if (!sel) return '<div class="px" disabled><b>' + (mainTxt || '—') + '</b><i>' + (sub || '') + '</i></div>';
    REG[sel.key] = sel;
    return '<button class="px ' + (cls || '') + (has(sel.key) ? ' picked' : '') + '" data-k="' + esc(sel.key) + '" title="Add ' + esc(sel.label) + ' to your slip"><b>' + mainTxt + '</b><i>' + (sub || '') + '</i></button>';
  }
  function reg(sel) { if (sel) REG[sel.key] = sel; return sel ? sel.key : ''; }

  // ── slip drawer ────────────────────────────────────────────────────────
  var spOpen = false, spTab = 'slip';
  function drawer() {
    return '<div class="sp-ov" id="spOv"></div><aside class="sp" id="sp" aria-label="Bet slip" aria-hidden="true">' +
      '<div class="sp-h"><h3>Bet slip</h3><button class="sp-x" id="spX" aria-label="Close">×</button></div>' +
      '<div class="sp-tabs"><button data-t="slip" class="on">Slip</button><button data-t="mine">My bets</button></div>' +
      '<div class="sp-b" id="spB"></div><div class="sp-sum" id="spSum"></div></aside><div class="bx-toast" id="bxToast"></div>';
  }
  function openSlip(tab) { if (tab) spTab = tab; spOpen = true; document.getElementById('sp').classList.add('open'); document.getElementById('spOv').classList.add('open'); document.getElementById('sp').setAttribute('aria-hidden', 'false'); paintSlip(); }
  function closeSlip() { spOpen = false; document.getElementById('sp').classList.remove('open'); document.getElementById('spOv').classList.remove('open'); document.getElementById('sp').setAttribute('aria-hidden', 'true'); }
  function pct(p) { return p == null ? '—' : Math.round(p * 100) + '%'; }
  function paintSlip() {
    document.querySelectorAll('.sp-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === spTab); });
    var body = document.getElementById('spB'), sum = document.getElementById('spSum');
    if (spTab === 'mine') { paintMine(body, sum); return; }
    if (!slip.length) {
      body.innerHTML = '<div class="bx-empty" style="margin-top:6px">Your slip is empty.<br>Tap any price on the board to add it.</div>';
      sum.innerHTML = '<div class="sp-fine">Prices marked <b>fair</b> are our model\'s odds with no vig. Book prices appear once sportsbooks post lines.</div>'; return;
    }
    body.innerHTML = slip.map(function (x) {
      var edge = x.book && x.price != null ? x.p - B.implied(x.price) : null;
      return '<div class="sp-it"><div class="sp-it-t"><b>' + esc(x.label) + '</b><button data-rm="' + esc(x.key) + '" aria-label="Remove">×</button></div><small>' + esc(x.sub) + ' · ' + esc(B.fmtDate(x.date)) + '</small>' +
        '<div class="row"><span>' + (x.book ? 'Book' : 'Fair') + ' <b>' + B.oddsTxt(x.price) + '</b></span><span>Our chance <b>' + pct(x.p) + '</b></span>' +
        (edge != null ? '<span class="' + (edge >= 0 ? 'pos' : 'neg') + '">' + (edge >= 0 ? '+' : '−') + Math.abs(edge * 100).toFixed(1) + ' pts</span>' : '') + '</div></div>';
    }).join('');
    var dec = slip.reduce(function (a, x) { return a * (B.decimal(x.price) || 1); }, 1), p = slip.reduce(function (a, x) { return a * (x.p || 0); }, 1);
    var sameGame = {}, sg = false; slip.forEach(function (x) { if (sameGame[x.gid]) sg = true; sameGame[x.gid] = 1; });
    var stake = LS.get('tdcbet_stake', 10);
    var n = slip.length;
    sum.innerHTML = (n > 1 ? '<div class="row"><span>' + n + '-leg parlay</span><b>' + B.oddsTxt(B.amFromDec(dec)) + '</b></div><div class="row"><span>Our chance all hit</span><b>' + (p * 100 < 1 ? (p * 100).toFixed(1) : Math.round(p * 100)) + '%</b></div>'
                       : '<div class="row"><span>Single</span><b>' + B.oddsTxt(slip[0].price) + '</b></div><div class="row"><span>Our chance</span><b>' + pct(p) + '</b></div>') +
      '<div class="sp-stake"><span>Stake $</span><input id="spStake" type="number" min="1" step="1" value="' + stake + '" inputmode="decimal"></div>' +
      '<div class="row"><span>To win</span><b id="spWin">$' + (stake * (dec - 1)).toFixed(2) + '</b></div>' +
      '<div class="row"><span>Expected value at these odds</span><b id="spEv" class="' + (p * dec - 1 >= 0 ? 'pos' : 'neg') + '">' + (p * dec - 1 >= 0 ? '+' : '−') + '$' + Math.abs(stake * (p * dec - 1)).toFixed(2) + '</b></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px"><button class="bx-btn" id="spClear" style="flex:none">Clear</button><button class="bx-btn pri" id="spTrack">Track ' + (n > 1 ? 'parlay' : 'pick') + '</button></div>' +
      (sg ? '<div class="sp-fine">Two legs from the same game move together, so the real chance differs from the product shown.</div>' : '') +
      '<div class="sp-fine">Tracking saves this to My bets and grades it from the final score. TDC Bet doesn\'t take bets: place real wagers only with a licensed sportsbook where it\'s legal.</div>';
    var si = document.getElementById('spStake');
    si.oninput = function () { var v = Math.max(0, +si.value || 0); LS.set('tdcbet_stake', v); document.getElementById('spWin').textContent = '$' + (v * (dec - 1)).toFixed(2); var ev = v * (p * dec - 1), e = document.getElementById('spEv'); e.textContent = (ev >= 0 ? '+' : '−') + '$' + Math.abs(ev).toFixed(2); e.className = ev >= 0 ? 'pos' : 'neg'; };
    document.getElementById('spClear').onclick = function () { slip = []; saveSlip(); };
    document.getElementById('spTrack').onclick = function () { track(+si.value || 0); };
  }
  function track(stake) {
    if (!slip.length) return;
    var dec = slip.reduce(function (a, x) { return a * (B.decimal(x.price) || 1); }, 1);
    mine.unshift({ id: Date.now(), at: new Date().toISOString(), stake: stake, price: B.amFromDec(dec), legs: slip.slice(), manual: {} });
    mine = mine.slice(0, 300); LS.set('tdcbet_mine', mine);
    slip = []; saveSlip(); toast('Tracked. Find it under My bets.'); spTab = 'mine'; paintSlip();
  }
  function legResult(leg, m) {
    if (m && m[leg.key]) return m[leg.key];
    var S = B.state(); return B.grade(leg, S.res[String(leg.gid)]);
  }
  function betResult(b) {
    var rs = b.legs.map(function (l) { return legResult(l, b.manual); });
    if (rs.some(function (r) { return r === 'l'; })) return 'l';
    if (rs.every(function (r) { return r === 'w' || r === 'p'; })) return rs.every(function (r) { return r === 'p'; }) ? 'p' : 'w';
    return null;
  }
  function paintMine(body, sum) {
    if (!mine.length) { body.innerHTML = '<div class="bx-empty" style="margin-top:6px">No tracked bets yet.<br>Add picks to your slip, then tap Track.</div>'; sum.innerHTML = ''; return; }
    var w = 0, l = 0, p = 0, units = 0, risk = 0;
    mine.forEach(function (b) { var r = betResult(b); if (r === 'w') { w++; units += b.stake * ((B.decimal(b.price) || 1) - 1); risk += b.stake; } else if (r === 'l') { l++; units -= b.stake; risk += b.stake; } else if (r === 'p') p++; });
    body.innerHTML = '<div class="sp-rec"><div><b>' + w + '–' + l + (p ? '–' + p : '') + '</b><span>Record</span></div><div><b class="' + (units >= 0 ? 'pos' : 'neg') + '">' + (units >= 0 ? '+' : '−') + '$' + Math.abs(units).toFixed(0) + '</b><span>Net</span></div><div><b>' + (risk ? (units / risk * 100).toFixed(0) + '%' : '—') + '</b><span>ROI</span></div></div>' +
      mine.map(function (b) {
        var r = betResult(b), cls = r || 'o', lab = { w: 'Won', l: 'Lost', p: 'Push', o: 'Open' }[cls];
        return '<div class="sp-it"><div class="sp-it-t"><b>' + (b.legs.length > 1 ? b.legs.length + '-leg parlay' : esc(b.legs[0].label)) + '</b><span class="sp-res ' + cls + '">' + lab + '</span><button data-del="' + b.id + '" aria-label="Delete">×</button></div>' +
          (b.legs.length > 1 ? b.legs.map(function (x) { var lr = legResult(x, b.manual); return '<small>' + (lr === 'w' ? '✓ ' : lr === 'l' ? '✗ ' : '· ') + esc(x.label) + ' · ' + esc(x.sub) + '</small>'; }).join('') : '<small>' + esc(b.legs[0].sub) + ' · ' + esc(B.fmtDate(b.legs[0].date)) + '</small>') +
          b.legs.filter(function (x) { return x.market === 'prop' && !b.manual[x.key]; }).map(function (x) { return '<div class="row"><span>' + esc(x.label) + ': grade it</span><span><button class="bx-tag g" data-man="' + b.id + '|' + esc(x.key) + '|w">Hit</button> <button class="bx-tag r" data-man="' + b.id + '|' + esc(x.key) + '|l">Miss</button></span></div>'; }).join('') +
          '<div class="row"><span>$' + b.stake + ' at <b>' + B.oddsTxt(b.price) + '</b></span><span>' + new Date(b.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</span></div></div>';
      }).join('');
    sum.innerHTML = '<div class="sp-fine">Game picks grade themselves from final scores. Props need a tap: we don\'t pull every box score into the slip yet. Saved in this browser only.</div>';
  }

  // ── paywall ────────────────────────────────────────────────────────────
  function hasPremium() {
    if (g.tdcIsOwner && g.tdcIsOwner()) return Promise.resolve(true);
    if (!g.TDCGate) return Promise.resolve(true);
    return TDCGate.ready.then(function () { return TDCGate.has('premium'); });
  }
  function gate(el, o) {
    if (!el) return Promise.resolve(false);
    o = o || {};
    return hasPremium().then(function (ok) {
      if (ok) return false;
      if (el.querySelector(':scope > .bx-lock')) return true;
      el.classList.add('bx-lockwrap');
      Array.prototype.forEach.call(el.children, function (c) { c.classList.add('bx-locked'); });
      var s = session(), signed = !!(s && s.user), cur = B.page();
      var lk = document.createElement('div'); lk.className = 'bx-lock';
      lk.innerHTML = '<div class="bx-lock-c"><div class="ic">' + IC.lock + '</div><h4>' + esc(o.label || 'Premium edges') + '</h4><p>' + esc(o.blurb || 'Best bets, prop edges and the full model board come with Premium.') + '</p>' +
        '<a class="bx-btn pri" href="' + B.main('pricing.html') + '">Get Premium</a>' +
        (signed ? '' : '<small>Already a member? <a href="' + B.main('signin.html?next=' + encodeURIComponent('bet/' + (cur === 'index' ? 'index.html' : cur + '.html'))) + '">Sign in</a></small>') + '</div>';
      el.appendChild(lk);
      return true;
    });
  }

  var tt = null;
  function toast(msg) { var t = document.getElementById('bxToast'); if (!t) return; t.innerHTML = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('on'); }, 1800); }

  function feed() {
    fetch('scripts/data/odds_live.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (d) {
      var el = document.getElementById('bxFeed'); if (!el) return;
      var n = (d && d.games && d.games.length) || 0;
      el.classList.toggle('live', n > 0);
      el.querySelector('span').textContent = n ? 'Books live · ' + n + ' games' : 'Books post lines ~a week out';
      el.title = d && d.generated ? 'Odds feed updated ' + new Date(d.generated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Sportsbook odds feed';
    });
  }

  function mount() {
    var cur = B.page();
    document.body.insertAdjacentHTML('afterbegin', header(cur));
    document.body.insertAdjacentHTML('beforeend', footer() + tabbar(cur) + drawer());
    paintCount(); feed();
    document.getElementById('bxTheme').onclick = function () { setTheme(theme === 'light' ? 'dark' : 'light'); this.innerHTML = theme === 'light' ? IC.moon : IC.sun; };
    document.getElementById('bxSlipBtn').onclick = function () { openSlip(); };
    document.getElementById('spX').onclick = closeSlip;
    document.getElementById('spOv').onclick = closeSlip;
    var mb = document.getElementById('bxMoreBtn'), more = document.getElementById('bxMore'), mo = document.getElementById('bxMoreOv');
    if (mb) { mb.onclick = function () { more.classList.add('open'); mo.classList.add('open'); }; mo.onclick = function () { more.classList.remove('open'); mo.classList.remove('open'); }; }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeSlip(); if (more) { more.classList.remove('open'); mo.classList.remove('open'); } } });
    document.addEventListener('click', function (e) {
      var k = e.target.closest && e.target.closest('[data-k]');
      if (k && !k.hasAttribute('disabled')) { e.preventDefault(); toggle(REG[k.getAttribute('data-k')]); return; }
      var t = e.target.closest && e.target.closest('.sp-tabs button'); if (t) { spTab = t.dataset.t; paintSlip(); return; }
      var rm = e.target.closest && e.target.closest('[data-rm]'); if (rm) { slip = slip.filter(function (x) { return x.key !== rm.getAttribute('data-rm'); }); saveSlip(); return; }
      var del = e.target.closest && e.target.closest('[data-del]'); if (del) { mine = mine.filter(function (b) { return String(b.id) !== del.getAttribute('data-del'); }); LS.set('tdcbet_mine', mine); paintSlip(); return; }
      var man = e.target.closest && e.target.closest('[data-man]');
      if (man) { var a = man.getAttribute('data-man').split('|'); mine.forEach(function (b) { if (String(b.id) === a[0]) b.manual[a[1]] = a[2]; }); LS.set('tdcbet_mine', mine); paintSlip(); }
    });
    // grade tracked bets as soon as results are in
    if (mine.length && B.load) B.load().then(function () { if (spOpen) paintSlip(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

  g.BX = { px: px, reg: reg, gate: gate, has: hasPremium, toast: toast, IC: IC, LS: LS,
           slip: { list: function () { return slip.slice(); }, toggle: toggle, has: has, open: openSlip, paint: paintPicked, mine: function () { return mine.slice(); }, result: betResult } };
})(window);
