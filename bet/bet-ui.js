/* bet-ui.js — TDC Bet's shared renderers: the game ticket, the bet slip card, the date strip.
 * Sportsbook grammar the owner picked on the main site's Betting Lab (Oct 16 2026): each game is a two-line
 * ticket (away over home) with boxed Spread / Total / Moneyline. Before books post, the boxes hold OUR numbers
 * (our favourite tinted blue); once a book posts, the book number is big, ours sits under it, and the side our
 * model likes by a real margin turns green. Every box is tappable: it goes on the slip.
 * Needs bet-core.js + bet-shell.js.
 */
(function (g) {
  'use strict';
  var B = g.TDCBet, esc = B.esc;

  function teamLine(r, isHome, live) {
    var full = isHome ? r.home : r.away, rk = B.rank(full);
    var sc = '';
    var res = live || r.res;
    if (res && res.hs != null && (res.final || res.state === 'in')) {
      var me = isHome ? res.hs : res.as, op = isHome ? res.as : res.hs;
      sc = '<span class="bd-sc ' + (res.final ? (me > op ? 'w' : 'l') : '') + '">' + me + '</span>';
    }
    return '<a class="bd-tm" href="' + B.href('game', 'id=' + encodeURIComponent(r.id)) + '">' + (rk ? '<span class="bd-rk">' + rk + '</span>' : '<span class="bd-rk"></span>') +
      B.lg(full) + '<span class="bd-nm">' + esc(B.short(full)) + '</span>' + sc + '</a>';
  }
  // ── book-priced boxes (when the odds feed has this game): the BEST price across books, its book, and a green
  //    box when the bet clears the edge board's EV bar ──
  var BK_SHORT = { draftkings: 'DK', fanduel: 'FD', betmgm: 'MGM', caesars: 'CZR', williamhill_us: 'CZR', espnbet: 'ESPN', fanatics: 'FAN', betrivers: 'BR', hardrockbet: 'HR',
    bovada: 'BOV', betonlineag: 'BOL', mybookieag: 'MYB', lowvig: 'LV', betus: 'BETUS', ballybet: 'BALLY', pointsbetus: 'PB', unibet_us: 'UNI', wynnbet: 'WYNN', superbook: 'SB' };
  function bkShort(k, t) { return BK_SHORT[k] || (t || k || '').slice(0, 5).toUpperCase(); }
  var GM = {};
  function edgeGame(r) {
    if (!g.TDCEdge || !TDCEdge.has()) return null;
    if (!(r.id in GM)) GM[r.id] = TDCEdge.game(r);
    return GM[r.id];
  }
  function edgeBox(b, main) {
    if (!b) return BX.px(null, '—', 'no line');
    var v = b.ev >= (TDCEdge.MIN_EV[b.market] || 0.02);
    return BX.px(TDCEdge.sel(b), main, B.oddsTxt(b.price) + ' ' + bkShort(b.book, b.bookT) + (v ? ' · +' + (b.ev * 100).toFixed(1) + '%' : ''), v ? 'val' : '');
  }
  function edgeBoxes(r, isHome, gm) {
    var pick = function (mk, side) { return gm.bets.filter(function (b) { return b.market === mk && b.side === side; })[0]; };
    var sp = pick('spread', isHome ? 'home' : 'away'), to = pick('total', isHome ? 'under' : 'over'), ml = pick('ml', isHome ? 'home' : 'away');
    return edgeBox(sp, sp ? B.spTxt(sp.point) : '—') + edgeBox(to, to ? (isHome ? 'U ' : 'O ') + to.point : '—') + edgeBox(ml, ml ? B.oddsTxt(ml.price) : '—');
  }
  function boxes(r, isHome) {
    var gm = edgeGame(r); if (gm && gm.bets.length) return edgeBoxes(r, isHome, gm);
    var mk = r.mk, me = isHome ? r.m : -r.m, p = isHome ? r.probH : r.probA, fav = me > 0;
    var hasSp = mk && mk.spread != null, hasTot = mk && mk.total != null && r.tot != null, hasMl = mk && (isHome ? mk.mlH : mk.mlA) != null;
    var sS = B.selSpread(r, isHome), sT = B.selTotal(r, !isHome), sM = B.selMl(r, isHome);
    var spC, totC, mlC;
    if (hasSp) { var bk = isHome ? mk.spread : -mk.spread; spC = BX.px(sS, B.spTxt(-bk), 'ours ' + B.spTxt(-me), me - bk >= 1.5 ? 'val' : ''); }
    else spC = BX.px(sS, B.spTxt(-me), Math.round(p) + '% win', fav ? 'fav' : '');
    if (hasTot) { var te = r.tot - mk.total, over = !isHome; totC = BX.px(sT, (over ? 'O ' : 'U ') + mk.total, 'ours ' + Math.round(r.tot), (over ? te >= 2 : te <= -2) ? 'val' : ''); }
    else totC = sT ? BX.px(sT, (isHome ? 'U ' : 'O ') + sT.line, isHome ? 'under' : 'over', '') : BX.px(null, '—', 'total');
    if (hasMl) { var bo = isHome ? mk.mlH : mk.mlA; mlC = BX.px(sM, B.oddsTxt(bo), 'fair ' + B.fairTxt(p / 100), B.implied(bo) != null && p / 100 - B.implied(bo) >= 0.03 ? 'val' : ''); }
    else mlC = BX.px(sM, B.fairTxt(p / 100), 'fair', fav ? 'fav' : '');
    return spC + totC + mlC;
  }
  // result of our number vs the final (shown on finished tickets)
  function verdict(r, res) {
    if (!res || !res.final) return '';
    var hm = res.hs - res.as, ourSide = r.m >= 0 ? 'home' : 'away';
    var suWin = (r.m >= 0) === (hm > 0);
    var line = r.mk && r.mk.spread != null ? r.mk.spread : null, ats = '';
    if (line != null) { var pick = r.m - line >= 0 ? 'home' : 'away', v = (pick === 'home' ? hm - line : -(hm - line)); ats = v > 0 ? ' · our side covered' : v < 0 ? ' · our side missed' : ' · push'; }
    return '<span class="' + (suWin ? 'pos' : 'neg') + '">' + (suWin ? '✓ Picked the winner' : '✗ Upset') + '</span>' + ats;
  }
  function wpBar(r) {
    var ca = B.color(r.away) || '#7a8699', ch = B.color(r.home) || '#c9d1dc';
    return '<div class="bd-wp"><span>' + esc(B.short(r.away)) + ' ' + Math.round(r.probA) + '%</span><div class="bd-wpbar" title="Win chance"><i style="width:' + r.probA + '%;background:' + ca + '"></i><i style="width:' + r.probH + '%;background:' + ch + '"></i></div><span>' + Math.round(r.probH) + '%</span></div>';
  }
  function ticket(r, live) {
    var tag = B.tagOf(r), lv = live && live[String(r.id)], res = lv || r.res;
    var status = lv && lv.state === 'in' ? '<span class="bx-tag live">Live · ' + esc(lv.clock) + '</span>' : (res && res.final ? '<span class="bx-tag">Final</span>' : '');
    return '<article class="bd"><div class="bd-hd"><span class="t">' + (r.neutral ? 'Neutral site' : 'At ' + esc(B.short(r.home))) + (r.conf ? ' · Conference' : '') + (r.exh ? ' · Exhibition' : '') + '</span>' +
      '<span class="sp">' + status + (tag ? '<span class="bx-tag ' + tag.c + '">' + esc(tag.t) + '</span>' : '') + '</span></div>' +
      '<div class="bd-cols"><span>' + (edgeGame(r) ? 'Best price · book' : r.mk ? 'Book · ours' : 'Our line') + '</span><span>Spread</span><span>Total</span><span>Money</span></div>' +
      '<div class="bd-row">' + teamLine(r, false, lv) + boxes(r, false) + '</div>' +
      '<div class="bd-row">' + teamLine(r, true, lv) + boxes(r, true) + '</div>' +
      '<div class="bd-ft">' + (res && res.final ? '<span>' + verdict(r, res) + '</span>' : wpBar(r)) + '<a href="' + B.href('game', 'id=' + encodeURIComponent(r.id)) + '">Matchup →</a></div></article>';
  }

  function conf(n, bad) { var h = ''; for (var i = 1; i <= 5; i++) h += '<i class="' + (i <= n ? 'on' : '') + '"></i>'; return '<span class="bs-conf" title="Confidence ' + n + ' of 5">' + h + '</span>'; }
  function slipCard(o, i) {
    var key = o.sel ? BX.reg(o.sel) : '';
    return '<div class="bs ' + (o.tone === 'bad' ? 'bad' : '') + '"><div class="bs-top"><span class="bs-k">' + (o.tone === 'bad' ? 'Fade' : 'Best bet ' + (i + 1)) + ' · ' + esc(o.kind) + '</span>' + conf(o.conf) + '</div>' +
      '<div class="bs-who">' + B.lg(o.team, 'm') + '<div class="bs-w"><b><a href="' + o.titleHref + '">' + esc(o.title) + '</a></b><small>' + esc(o.sub) + '</small></div></div>' +
      (o.sel ? '<button class="bs-pick' + (BX.slip.has(key) ? ' picked' : '') + '" data-k="' + esc(key) + '" title="Add to slip"><b>' + esc(o.pick) + '</b><span>' + esc(o.right) + '</span></button>'
             : '<div class="bs-pick"><b>' + esc(o.pick) + '</b><span>' + esc(o.right) + '</span></div>') +
      '<div class="bs-why">' + esc(o.why) + '</div><div class="bs-ft"><span>' + esc(o.ft1) + '</span><span>' + esc(o.ft2) + '</span></div></div>';
  }
  // placeholder slips drawn under the paywall blur (no real picks leak into the DOM)
  function ghostSlips(n) {
    var h = ''; for (var i = 0; i < n; i++) h += '<div class="bs"><div class="bs-top"><span class="bs-k">Best bet ' + (i + 2) + '</span>' + conf(3) + '</div><div class="bs-who"><span class="lg m"></span><div class="bs-w"><b>Premium pick</b><small>Matchup hidden</small></div></div><div class="bs-pick"><b>Over 00.5 PTS</b><span>00%</span></div><div class="bs-why">The reasoning for this pick is part of Premium: model edge, backtest rate and our projection.</div><div class="bs-ft"><span>Backtest</span><span>Model</span></div></div>';
    return h;
  }

  function dateStrip(host, cur, onPick) {
    var S = B.state(), i = S.dates.indexOf(cur);
    var near = S.dates.slice(Math.max(0, i - 3), Math.max(0, i - 3) + 10);
    host.innerHTML = '<button class="bx-arrow" data-dd="-1" aria-label="Previous game day"' + (i <= 0 ? ' disabled' : '') + '>‹</button><div class="bx-dates-row">' +
      near.map(function (d) {
        var gs = S.games.filter(function (x) { return x.date === d; }), xe = gs.every(function (x) { return x.exh; });
        return '<button class="bx-day' + (d === cur ? ' on' : '') + '" data-d="' + d + '"><b>' + B.dayLabel(d) + '</b><span>' + B.fmtDate(d, 'md') + ' · ' + (xe ? gs.length + ' exh' : gs.length + ' games') + '</span></button>';
      }).join('') + '</div><button class="bx-arrow" data-dd="1" aria-label="Next game day"' + (i >= S.dates.length - 1 ? ' disabled' : '') + '>›</button>';
    host.onclick = function (e) {
      var b = e.target.closest('[data-d]'); if (b) { onPick(b.dataset.d); return; }
      var a = e.target.closest('[data-dd]'); if (a && !a.disabled) { var j = S.dates.indexOf(cur) + (+a.dataset.dd); if (S.dates[j]) onPick(S.dates[j]); }
    };
    var on = host.querySelector('.bx-day.on'); if (on && on.scrollIntoView) { var row = host.querySelector('.bx-dates-row'); row.scrollLeft = on.offsetLeft - row.clientWidth / 2 + on.clientWidth / 2; }
  }
  function setQuery(k, v) { try { var u = new URL(location.href); if (v == null) u.searchParams.delete(k); else u.searchParams.set(k, v); history.replaceState(null, '', u); } catch (e) {} }

  // ── the edge board row ─────────────────────────────────────────────────
  var MK_LABEL = { spread: 'Spread', total: 'Total', ml: 'Moneyline', tt: 'Team total', h1: '1st half', alt: 'Alt line', prop: 'Player prop' };
  function pc(p) { return p == null ? '—' : Math.round(p * 100) + '%'; }
  function edgeRow(b, i, bankroll) {
    var key = BX.reg(TDCEdge.sel(b)), stake = bankroll ? Math.max(1, Math.round(bankroll * b.kelly)) : null;
    var shop = (b.offers || []).slice().sort(function (a, c) { return c.ev - a.ev; });
    return '<article class="ed" data-ed="' + i + '"><div class="ed-main">' +
      '<span class="ed-rk">' + (i + 1) + '</span>' +
      '<div class="ed-who">' + B.lg(b.team, 'm') + '<div class="ed-w"><span class="bx-tag ' + (b.market === 'prop' ? 'b' : '') + '">' + MK_LABEL[b.market] + '</span>' + (b.offLine ? ' <span class="bx-tag y" title="This book is hanging a different number from the others: the edge is the line itself. Confirm it before betting; off-market lines get moved fast.">Off-market line</span>' : '') + '<b>' + esc(b.label) + '</b>' +
        '<small>' + esc(b.game) + ' · ' + esc(B.dayLabel(b.date)) + '</small></div></div>' +
      '<div class="ed-num"><span>Our chance</span><b>' + pc(b.p) + '</b><i>market ' + pc(b.pMkt) + '</i></div>' +
      '<div class="ed-num"><span>Best price</span><b>' + B.oddsTxt(b.price) + '</b><i>' + esc(b.bookT) + '</i></div>' +
      '<div class="ed-num ev"><span>EV</span><b>+' + (b.ev * 100).toFixed(1) + '%</b><i>per $1</i></div>' +
      '<div class="ed-num"><span>Stake</span><b>' + (stake != null ? '$' + stake : (b.kelly * 100).toFixed(1) + '%') + '</b><i>¼ Kelly</i></div>' +
      '<button class="ed-add' + (BX.slip.has(key) ? ' picked' : '') + '" data-k="' + esc(key) + '" aria-label="Add to slip">+</button>' +
      '</div><div class="ed-more"><div class="ed-why">' + esc(b.why) + ' Blended with the market, our chance is ' + pc(b.p) + ' (ours alone ' + pc(b.pOurs) + (b.pMkt != null ? ', books ' + pc(b.pMkt) : '') + '). Fair price ' + B.fairTxt(b.p) + '.</div>' +
      (shop.length > 1 ? '<div class="ed-shop">' + shop.map(function (o) { return '<span class="' + (o.ev >= 0 ? 'pos' : '') + '"><b>' + esc(o.bookT) + '</b> ' + (o.point != null && b.market !== 'ml' ? (b.market === 'spread' || b.market === 'h1' && /home|away/.test(o.side) ? B.spTxt(o.point) : o.point) + ' ' : '') + B.oddsTxt(o.price) + ' <i>' + (o.ev >= 0 ? '+' : '−') + Math.abs(o.ev * 100).toFixed(1) + '%</i></span>'; }).join('') + '</div>' : '') +
      '<a class="ed-link" href="' + B.href('game', 'id=' + encodeURIComponent(b.gid)) + '">Full matchup →</a></div></article>';
  }
  function ghostEdges(n) {
    var h = ''; for (var i = 0; i < n; i++) h += '<article class="ed"><div class="ed-main"><span class="ed-rk">' + (i + 2) + '</span><div class="ed-who"><span class="lg m"></span><div class="ed-w"><span class="bx-tag">Market</span><b>Premium bet</b><small>Matchup hidden</small></div></div><div class="ed-num"><span>Our chance</span><b>00%</b></div><div class="ed-num"><span>Best price</span><b>−000</b></div><div class="ed-num ev"><span>EV</span><b>+0.0%</b></div><div class="ed-num"><span>Stake</span><b>$00</b></div></div></article>';
    return h;
  }

  g.BXUI = { edgeRow: edgeRow, ghostEdges: ghostEdges, bkShort: bkShort, MK_LABEL: MK_LABEL, resetEdge: function () { GM = {}; }, ticket: ticket, slipCard: slipCard, ghostSlips: ghostSlips, dateStrip: dateStrip, setQuery: setQuery, wpBar: wpBar, verdict: verdict };
})(window);
