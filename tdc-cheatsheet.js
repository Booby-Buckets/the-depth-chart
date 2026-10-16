/* tdc-cheatsheet.js — the Betting Cheat Sheet's SLATE layer: pick a game day, then
 *   • Tonight's plays / Fades rows (best and worst bets)
 *   • every game as a banded row: win-chance bar, our spread card (badge = gap vs the book), total, book / fair ML
 *   Look = the Social Studio lineup graphic (owner pick, Oct 16 2026): banded rows, logo rings, white value cards.
 * Inputs: schedule_2027.json (every listed game), TDC_RATINGS.get() (projected power ratings + lineFor),
 * team_pace_eff.json (projected tempo/efficiency → totals), odds_live.json (in-season book lines),
 * and the page's own prop data (window.CS_LOAD promises + the bounce/regression backtest).
 *
 * What counts as a bet here — only things with evidence behind them:
 *   props   = the backtested bounce-back (over) / regression (under) pattern, at the last-season pace line
 *   games   = our model vs the MARKET line (needs a book number, so in-season only)
 *   traps   = overs on players coming off career years (backtest: they go over only ~40-46%), and
 *             backing teams whose 5-year ATS record is worst
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var S = { date: null, dates: [], games: [], byFull: {}, eff: null, odds: null, oddsMap: null, ats: {}, filter: 'all', q: '', showAll: false };
  var STAT_NAME = { pts: 'points', reb: 'rebounds', ast: 'assists', pra: 'pts + reb + ast', tpm: 'threes' };
  var STAT_ABBR = { pts: 'PTS', reb: 'REB', ast: 'AST', pra: 'PRA', tpm: '3PM' };
  var MIN_LINE = { pts: 7.5, reb: 3.5, ast: 2.5, tpm: 1.5, pra: 12.5 };

  function short(full) { var t = S.byFull[full]; var s = (t && t.team) || full; try { if (window.tdcShortSchool) return tdcShortSchool(s) || s; } catch (e) {} return s; }
  function logo(full) { var t = S.byFull[full]; var c = window.tdcTeamColor && (tdcTeamColor((t && t.team) || full) || tdcTeamColor(full)); return (c && c.logo) || ''; }
  function logoImg(full, cls) { var l = logo(full); return '<span class="' + (cls || 'cs-lg') + '">' + (l ? '<img src="' + l + '" alt="" loading="' + (cls === 'cs-xlg' ? 'lazy' : 'eager') + '" onerror="this.style.display=\'none\'">' : '') + '</span>'; }
  function teamHref(full) { var t = S.byFull[full]; return 'team.html?team=' + encodeURIComponent((t && t.team) || full); }
  function rk(full) { var t = S.byFull[full]; return t && t.rank ? '<span class="cs-rk">' + t.rank + '</span>' : ''; }
  function fmtDate(d, long) {
    var x = new Date(d + 'T12:00:00');
    return x.toLocaleDateString('en-US', long ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
  }
  // fair American moneyline for a win % (0-100), no vig — same math as the Lab's futures (tdc-betlab.js)
  function mlTxt(p) { if (window.TDC_BL) return TDC_BL.fairTxt(p / 100); return '—'; }
  function bookMl(o) { return o == null ? '—' : (o > 0 ? '+' : '−') + Math.abs(Math.round(o)); }
  function half(x) { return Math.round(x - 0.5) + 0.5; }
  function spreadTxt(m, home, away) { if (m == null) return '—'; var a = Math.abs(m); if (a < 0.25) return 'Pick’em'; return (m >= 0 ? short(home) : short(away)) + ' −' + (Math.round(a * 2) / 2).toFixed(1); }

  // projected total from tempo × efficiency (same model the team Schedule tab prices)
  function effLine(a, b) {
    var E = S.eff; if (!E || !E.teams) return null;
    var A = E.teams[a], B = E.teams[b]; if (!A || !B) return null;
    var pace = A.t + B.t - E.avgT, k = pace / 100, avg = (E.avgO + E.avgD) / 2;
    return { total: (A.o + B.d - avg) * k + (B.o + A.d - avg) * k, pace: pace };
  }

  // odds-feed names → our rows (same normalizer as build_odds_history.py / betting.html)
  var MASCOT = new Set(('blue devils devils wildcats tigers bulldogs cougars gators aggies huskies volunteers cavaliers cyclones boilermakers jayhawks razorbacks fighting illini cardinals hurricanes eagles bears wolverines spartans hawkeyes gaels red raiders seahawks zips rams lopes utes hoosiers buckeyes badgers cornhuskers terrapins nittany lions demon deacons yellow jackets tar heels wolfpack orange hokies seminoles panthers knights bearcats bruins trojans sun devils golden gophers musketeers friars pirates bluejays gamecocks commodores rebels crimson tide mean green golden eagles ragin cajuns owls minutemen catamounts privateers redhawks red storm crimson vandals broncos mustangs lobos aztecs falcons flames phoenix runnin rebels anteaters gauchos toreros dons waves highlanders titans matadors 49ers roadrunners bobcats mountaineers').split(/\s+/));
  function oNorm(n) { n = (n || '').toLowerCase().trim().replace(/&/g, 'and'); n = n.replace(/\bst\.?\b/g, 'state').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(university|univ|the|of)\b/g, ' '); return n.split(/\s+/).filter(function (t) { return t && !MASCOT.has(t); }).join(' ').trim(); }
  function marketFor(home, away) {
    if (!S.odds || !S.odds.games || !S.odds.games.length) return null;
    if (!S.oddsMap) { S.oddsMap = {}; S.odds.games.forEach(function (g) { S.oddsMap[g.home_norm + '|' + g.away_norm] = g; }); }
    var h = S.byFull[home], a = S.byFull[away];
    var keys = [[oNorm(home), oNorm(away)], [oNorm(h && h.team), oNorm(a && a.team)]];
    for (var i = 0; i < keys.length; i++) { var g = S.oddsMap[keys[i][0] + '|' + keys[i][1]]; if (g) return { spread: g.spread == null ? null : -g.spread, total: g.total, mlH: g.ml_home, mlA: g.ml_away, flip: false }; }
    for (i = 0; i < keys.length; i++) { g = S.oddsMap[keys[i][1] + '|' + keys[i][0]]; if (g) return { spread: g.spread == null ? null : g.spread, total: g.total, mlH: g.ml_away, mlA: g.ml_home, flip: true }; }
    return null;
  }

  // every rated game on a date, priced
  function slate(date) {
    return S.games.filter(function (g) { return g.date === date; }).map(function (g) {
      var H = S.byFull[g.home], A = S.byFull[g.away]; if (!H || !A || H.rating == null || A.rating == null) return null;
      var e = effLine(g.home, g.away);
      var L = TDC_RATINGS.lineFor(H, A, g.neutral ? 'neutral' : 'home', e ? e.total : undefined);
      var m = L.margin, tot = e ? e.total : null, mk = marketFor(g.home, g.away);
      var spEdge = mk && mk.spread != null ? +(m - mk.spread).toFixed(1) : null;
      var toEdge = mk && mk.total != null && tot != null ? +(tot - mk.total).toFixed(1) : null;
      var fav = m >= 0 ? g.home : g.away, dog = m >= 0 ? g.away : g.home;
      var favP = Math.max(L.probA, L.probB);
      return { g: g, exh: !!g.exh, home: g.home, away: g.away, neutral: g.neutral, conf: g.conf, m: m, tot: tot, probH: L.probA, probA: L.probB,
               fav: fav, dog: dog, favP: favP, dogP: 100 - favP, mk: mk, spEdge: spEdge, toEdge: toEdge,
               quality: Math.min(H.rank || 400, A.rank || 400), both: Math.max(H.rank || 400, A.rank || 400) };
    }).filter(Boolean);
  }

  // ── props for players whose team plays on this slate ───────────────────────
  function propCands(date, games) {
    // the page's prop data lives in top-level lets (shared global scope, not window props)
    var P = typeof PLAYERS !== 'undefined' ? PLAYERS : null, PR = typeof PROJ !== 'undefined' ? PROJ : null, BTt = typeof BT !== 'undefined' ? BT : null; if (!P || !PR) return [];
    var dip = typeof DIP !== 'undefined' ? DIP : 0.85, spike = typeof SPIKE !== 'undefined' ? SPIKE : 1.25, last = typeof LAST_SEASON !== 'undefined' ? LAST_SEASON : 2026;
    var opp = {}; games.forEach(function (x) { opp[x.home] = { opp: x.away, at: x.neutral ? 'vs' : 'vs' , x: x }; opp[x.away] = { opp: x.home, at: x.neutral ? 'vs' : '@', x: x }; });
    var out = [];
    P.forEach(function (p) {
      var pr = PR[p.id]; if (!pr || !pr.team || !opp[pr.team]) return;
      if (!(pr.mpg >= 22)) return;                                         // books post props on real rotation players
      var tr = S.byFull[pr.team]; if (!tr || (tr.rank || 400) > 150) return;   // …on teams whose games get real prop markets
      if (pr.last_mpg != null && pr.last_mpg < 12 && pr.mpg - pr.last_mpg > 14) return;
      ['pts', 'reb', 'ast', 'pra', 'tpm'].forEach(function (s) {
        var st = p.stats && p.stats[s]; if (!st || st.g < 25 || !st.bounce) return;
        var r = st.bounce.ratio, line = half(st.bounce.last / 40 * pr.mpg); if (line < MIN_LINE[s]) return;
        var bt = (BTt && BTt[s]) || {};
        var side = r <= dip ? 'over' : r >= spike ? 'under' : null; if (!side) return;
        var rate = side === 'over' ? bt.dip_over : bt.spike_under; if (rate == null) return;
        var strength = side === 'over' ? Math.min(1, (dip - r) / 0.35) : Math.min(1, (r - spike) / 1.0);
        var cleared = window.empiricalOver ? empiricalOver(st, line) : null;
        if (cleared != null && side === 'under') cleared = 1 - cleared;
        var lastAvg = st.bySeason && st.bySeason[String(last)] ? st.bySeason[String(last)].avg : null;
        out.push({ kind: 'prop', id: p.id, name: p.name, team: pr.team, conf: pr.conf, s: s, side: side, line: line, ratio: r, rate: rate,
                   n: side === 'over' ? bt.dip_n : bt.spike_n, strength: strength, cleared: cleared, proj: pr[{ pts: 'ppg', reb: 'rpg', ast: 'apg', tpm: 'tpm' }[s]] || ((pr.ppg || 0) + (pr.rpg || 0) + (pr.apg || 0)),
                   ppg: pr.ppg || 0, lastAvg: lastAvg, career: st.bounce.career, last40: st.bounce.last, opp: opp[pr.team],
                   score: rate + 0.06 * strength + 0.0015 * (pr.ppg || 0) });
      });
    });
    return out;
  }

  // ── rows (owner, Oct 16 2026: the Social Studio "lineup" look — banded rows, logos in rings, the value in a
  //    white card with a small badge; black section bars). Plays and fades are rows; the why is the hover title.
  function ring(full) { var l = logo(full); return '<span class="sl-lg">' + (l ? '<img src="' + l + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') + '</span>'; }
  function card(big, lab, badge, tone, href) {
    var inner = '<b>' + big + '</b><s>' + lab + '</s>' + (badge ? '<span class="sl-bdg ' + (tone || '') + '">' + badge + '</span>' : '');
    return href ? '<a class="sl-card" href="' + href + '">' + inner + '</a>' : '<div class="sl-card">' + inner + '</div>';
  }
  function oppTxt(c) { return c.opp ? (c.opp.at + ' ' + esc(short(c.opp.opp))) : ''; }
  // BET SLIPS (owner pick, Oct 16 2026): one slip per best bet — kicker + confidence dots, who, the pick in a big
  // box (edge or hit rate on the right), one line of why, the evidence underneath. Fades are red slips.
  function dots(n) { n = Math.max(1, Math.min(5, n)); return '<span class="bs-dots" title="confidence ' + n + ' of 5">' + '●'.repeat(n) + '<s>' + '●'.repeat(5 - n) + '</s></span>'; }
  function slip(o, i) {
    return '<div class="bs ' + (o.tone === 'bad' ? 'bad' : '') + '"><div class="bs-top"><span class="bs-k">' + (o.tone === 'bad' ? 'Fade' : 'Best bet ' + (i + 1)) + ' · ' + o.kind + '</span>' + dots(o.conf) + '</div>' +
      '<div class="bs-who">' + ring(o.team) + '<div class="bs-w"><b>' + o.title + '</b><small>' + o.sub + '</small></div></div>' +
      '<div class="bs-pick"><b>' + o.pick + '</b><span>' + o.right + '</span></div>' +
      '<div class="bs-why">' + o.why + '</div><div class="bs-ft"><span>' + o.ft1 + '</span><span>' + o.ft2 + '</span></div></div>';
  }
  var KIND = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', tpm: 'Threes', pra: 'Pts + reb + ast' };
  function propPlay(c, tone) {
    var pct = Math.round((tone === 'bad' ? 1 - c.rate : c.rate) * 100), off = Math.round(Math.abs(c.ratio - 1) * 100);
    var why = tone === 'bad'
      ? 'Coming off a career year (' + off + '% above his earlier pace per minute). Players like him went over only ' + pct + '% of the time.'
      : (c.side === 'over' ? 'Last season ran ' + off + '% below his career pace per minute. Down years like that went over ' + pct + '% of the time' + (c.proj != null ? ', and our projection (' + (+c.proj).toFixed(1) + ') agrees.' : '.')
        : 'Last season ran ' + off + '% above his career pace per minute. Spikes like that went under ' + pct + '% of the time' + (c.proj != null ? ', and our projection (' + (+c.proj).toFixed(1) + ') agrees.' : '.'));
    var conf = tone === 'bad' ? (pct <= 42 ? 4 : pct <= 45 ? 3 : 2)
      : (c.rate >= 0.63 ? 4 : c.rate >= 0.60 ? 3 : c.rate >= 0.57 ? 2 : 1) + (c.strength >= 0.6 ? 1 : 0);
    return { tone: tone, team: c.team, kind: KIND[c.s], conf: conf, why: why,
      title: '<a href="player.html?espn=' + c.id + '&tab=betting">' + esc(c.name) + '</a>', sub: esc(short(c.team)) + ' ' + oppTxt(c),
      pick: (tone === 'bad' ? 'Avoid over ' : c.side === 'over' ? 'Over ' : 'Under ') + c.line + ' ' + STAT_ABBR[c.s], right: pct + '%',
      ft1: 'Backtest ' + pct + '%' + (tone === 'bad' ? ' over' : '') + (c.n ? ' · ' + c.n + ' picks' : ''), ft2: tone === 'bad' ? 'Career-year trap' : c.side === 'over' ? 'Bounce-back' : 'Regression' };
  }
  function edgeConf(e) { e = Math.abs(e); return e >= 6 ? 5 : e >= 4.5 ? 4 : e >= 3 ? 3 : 2; }
  function gamePlay(r) {
    var side = r.spEdge > 0 ? r.home : r.away, mk = r.mk;
    var bookSide = side === r.home ? mk.spread : -mk.spread;
    var num = Math.abs(bookSide) < 0.25 ? 'PK' : (bookSide >= 0 ? '−' : '+') + Math.abs(bookSide).toFixed(1);
    return { tone: '', team: side, kind: 'Spread', conf: edgeConf(r.spEdge),
      why: 'Our line: ' + spreadTxt(r.m, r.home, r.away) + '. The book has ' + spreadTxt(mk.spread, r.home, r.away) + ', a ' + Math.abs(r.spEdge).toFixed(1) + '-point gap toward ' + esc(short(side)) + '.',
      title: '<a href="' + teamHref(side) + '">' + esc(short(side)) + '</a>', sub: esc(short(r.away)) + (r.neutral ? ' vs ' : ' @ ') + esc(short(r.home)),
      pick: esc(short(side)) + ' ' + num, right: '+' + Math.abs(r.spEdge).toFixed(1), ft1: 'Edge ' + Math.abs(r.spEdge).toFixed(1) + ' pts', ft2: 'Model vs market' };
  }
  function totalPlay(r) {
    var over = r.toEdge > 0;
    return { tone: '', team: r.home, kind: 'Total', conf: edgeConf(r.toEdge),
      why: 'We project ' + Math.round(r.tot) + ' total points; the book is at ' + r.mk.total + '.',
      title: esc(short(r.away)) + (r.neutral ? ' vs ' : ' @ ') + esc(short(r.home)), sub: r.neutral ? 'neutral site' : 'at ' + esc(short(r.home)),
      pick: (over ? 'Over ' : 'Under ') + r.mk.total, right: '+' + Math.abs(r.toEdge).toFixed(1), ft1: 'Edge ' + Math.abs(r.toEdge).toFixed(1) + ' pts', ft2: 'Model vs market' };
  }
  function atsPlay(full, h, r) {
    return { tone: 'bad', team: full, kind: 'Against the spread', conf: h.atsPct <= 0.38 ? 4 : h.atsPct <= 0.41 ? 3 : 2,
      why: 'Covered only ' + Math.round(h.atsPct * 100) + '% of the time over five seasons of real closing lines (' + esc(h.ats) + '). The market keeps overrating them.',
      title: '<a href="' + teamHref(full) + '">' + esc(short(full)) + '</a>', sub: esc(short(r.away)) + (r.neutral ? ' vs ' : ' @ ') + esc(short(r.home)),
      pick: 'Fade ' + esc(short(full)), right: Math.round(h.atsPct * 100) + '%', ft1: '5-yr ATS ' + esc(h.ats), ft2: 'Team trend' };
  }
  function renderEyes() {}   // the six tiles were retired with the redesign

  // ── plays / fades ──────────────────────────────────────────────────────────
  function renderBets(rows, props) {
    var none = function (t) { return '<div class="sl-empty">' + t + '</div>'; };
    if (rows.length && rows.every(function (r) { return r.exh; })) {   // scrimmages have no betting markets
      $('csBest').innerHTML = none('Scrimmage day: unofficial games, no lines or props. Our number for each game is below.'); $('csWorst').innerHTML = ''; $('csWorstBar').style.display = 'none'; return;
    }
    var best = [], used = {};
    rows.filter(function (r) { return r.spEdge != null && Math.abs(r.spEdge) >= 3; })
      .sort(function (a, b) { return Math.abs(b.spEdge) - Math.abs(a.spEdge); }).slice(0, 3)
      .forEach(function (r) { best.push(gamePlay(r)); });
    rows.filter(function (r) { return r.toEdge != null && Math.abs(r.toEdge) >= 4; })
      .sort(function (a, b) { return Math.abs(b.toEdge) - Math.abs(a.toEdge); }).slice(0, 2)
      .forEach(function (r) { best.push(totalPlay(r)); });
    var perStat = {};
    var agrees = function (c) { return c.proj == null || (c.side === 'over' ? c.proj >= c.line - 0.3 : c.proj <= c.line + 0.3); };
    props.filter(function (c) { return c.s !== 'tpm' && c.rate >= 0.55 && agrees(c); })
      .sort(function (a, b) { return b.score - a.score || b.ppg - a.ppg; })
      .forEach(function (c) { if (best.length >= 6 || used[c.id] || (perStat[c.s + c.side] || 0) >= 2) return; used[c.id] = 1; perStat[c.s + c.side] = (perStat[c.s + c.side] || 0) + 1; best.push(propPlay(c, 'good')); });
    best.sort(function (a, b) { return b.conf - a.conf; });
    $('csBest').innerHTML = best.length ? '<div class="bs-grid">' + best.map(slip).join('') + '</div>' : none('No qualifying plays on this slate.');
    var worst = [], usedW = Object.assign({}, used);
    props.filter(function (c) { return c.side === 'under' && (c.s === 'pts' || c.s === 'pra') && c.ratio >= 1.35; })
      .sort(function (a, b) { return b.ppg - a.ppg; })
      .forEach(function (c) { if (worst.length >= 2 || usedW[c.id]) return; usedW[c.id] = 1; worst.push(propPlay(Object.assign({}, c, { side: 'over' }), 'bad')); });
    var ats = [];
    rows.forEach(function (r) { [r.home, r.away].forEach(function (f) { var h = S.ats[f]; if (h && h.g >= 40 && h.atsPct <= 0.43) ats.push({ f: f, h: h, r: r }); }); });
    ats.sort(function (a, b) { return a.h.atsPct - b.h.atsPct; }).slice(0, 1).forEach(function (x) { worst.push(atsPlay(x.f, x.h, x.r)); });
    $('csWorstBar').style.display = worst.length ? '' : 'none';
    $('csWorst').innerHTML = worst.length ? '<div class="bs-grid">' + worst.map(slip).join('') + '</div>' : '';
  }

  // ── every game: the SPORTSBOOK BOARD (owner pick, Oct 16 2026, after the split-bar rows made it "hard to tell who
  //    is playing who"): each game is a two-line ticket, away over home, with boxed Spread / Total / Moneyline cells.
  //    No book yet → our numbers in the boxes (our favorite's boxes tinted). Book posted → the book's number is the big
  //    one, ours sits under it, and the side our model likes by a real margin gets the green "value" box.
  function sp(v) { return Math.abs(v) < 0.25 ? 'PK' : (v < 0 ? '−' : '+') + (Math.round(Math.abs(v) * 2) / 2).toFixed(1); }   // v = this team's line
  function impl(o) { return o == null ? null : o > 0 ? 100 / (o + 100) : -o / (-o + 100); }
  function teamLine(full) {
    var t = S.byFull[full];
    return '<a class="bk-tm" href="' + teamHref(full) + '">' + ring(full) + (t && t.rank ? '<span class="bk-rk">' + t.rank + '</span>' : '') + '<span class="bk-n">' + esc(short(full)) + '</span></a>';
  }
  function box(main, sub, cls) { return '<div class="bk-c ' + (cls || '') + '"><b>' + main + '</b><i>' + sub + '</i></div>'; }
  function ticket(r) {
    var mk = r.mk, hasSp = mk && mk.spread != null, hasTot = mk && mk.total != null && r.tot != null, hasMl = mk && mk.mlH != null;
    var side1 = function (isHome) {
      var full = isHome ? r.home : r.away, me = isHome ? r.m : -r.m, p = isHome ? r.probH : r.probA, fav = me > 0;
      // spread
      var spC;
      if (hasSp) { var bk = isHome ? mk.spread : -mk.spread, ed = me - bk;   // our margin for this side minus the book's
        spC = box(sp(-bk), 'ours ' + sp(-me), ed >= 1.5 ? 'val' : ''); }
      else spC = box(sp(-me), Math.round(p) + '%', fav ? 'fav' : '');
      // total: away row = over, home row = under
      var totC;
      if (hasTot) { var te = r.tot - mk.total, over = !isHome;
        totC = box((over ? 'O ' : 'U ') + mk.total, 'ours ' + Math.round(r.tot), (over ? te >= 2 : te <= -2) ? 'val' : ''); }
      else totC = box((isHome ? 'U ' : 'O ') + (r.tot != null ? Math.round(r.tot) : '—'), 'total', '');
      // moneyline
      var mlC;
      if (hasMl) { var bo = isHome ? mk.mlH : mk.mlA;
        mlC = box(bookMl(bo), 'fair ' + mlTxt(p), impl(bo) != null && p / 100 - impl(bo) >= 0.03 ? 'val' : ''); }
      else mlC = box(mlTxt(p), 'fair', fav ? 'fav' : '');
      return '<div class="bk-tr">' + teamLine(full) + spC + totC + mlC + '</div>';
    };
    var tag = '';
    if (r.exh) tag = '<a href="scrimmage.html?id=' + encodeURIComponent(r.g.id) + '" class="bk-tag warn">Scrimmage →</a>';
    else if (r.spEdge != null && Math.abs(r.spEdge) >= 3) tag = '<span class="bk-tag good">Edge ' + Math.abs(r.spEdge).toFixed(1) + '</span>';
    else if ((S.byFull[r.fav].rank || 400) <= 60 && r.dogP >= 30 && Math.abs(r.m) >= 2.5) tag = '<span class="bk-tag warn">Upset watch</span>';
    else if (r.both <= 40) tag = '<span class="bk-tag">Marquee</span>';
    return '<div class="bk-g"><div class="bk-hd"><b>' + esc(short(r.away)) + (r.neutral ? ' vs ' : ' @ ') + esc(short(r.home)) + '</b>' +
      '<span>' + tag + (r.neutral ? 'Neutral site' : 'At ' + esc(short(r.home))) + (r.conf ? ' · conference' : '') + '</span></div>' +
      '<div class="bk-cols"><span>' + (mk ? 'Book · ours' : 'Our line') + '</span><span>Spread</span><span>Total</span><span>Moneyline</span></div>' +
      side1(false) + side1(true) + '</div>';
  }
  function renderLines(rows) {
    var q = S.q.toLowerCase();
    var view = rows.filter(function (r) {
      if (q && (short(r.home) + ' ' + short(r.away) + ' ' + r.home + ' ' + r.away).toLowerCase().indexOf(q) < 0) return false;
      if (S.filter === 'top') return r.both <= 100;
      if (S.filter === 'close') return Math.abs(r.m) <= 4;
      if (S.filter === 'conf') return r.conf;
      return true;
    }).sort(function (a, b) { return (a.both + a.quality) - (b.both + b.quality); });
    var hasMk = rows.some(function (r) { return r.mk; });
    var lim = S.showAll ? view.length : Math.min(view.length, 40);
    $('slRows').innerHTML = view.length ? '<div class="bk-grid">' + view.slice(0, lim).map(ticket).join('') + '</div>' : '<div class="sl-empty">No games match.</div>';
    $('linesMore').style.display = view.length > 40 ? '' : 'none';
    $('linesMore').textContent = S.showAll ? 'Show fewer' : 'Show all ' + view.length + ' games';
    $('linesHint').textContent = view.length + ' of ' + rows.length + (hasMk ? ' · green box = our model likes that side' : ' · book lines post about a week out');
  }

  // ── slate chooser ──────────────────────────────────────────────────────────
  function renderSlateBar(rows) {
    var i = S.dates.indexOf(S.date);
    var near = S.dates.slice(Math.max(0, i - 2), Math.max(0, i - 2) + 8);
    $('csDates').innerHTML = near.map(function (d) {
      var gs = S.games.filter(function (g) { return g.date === d; }), n = gs.length, xe = gs.every(function (g) { return g.exh; });
      return '<button class="' + (d === S.date ? 'on' : '') + '" data-d="' + d + '">' + fmtDate(d) + '<span>' + (xe ? n + ' scrimmage' + (n > 1 ? 's' : '') : n + ' games') + '</span></button>';
    }).join('');
    var nx = rows.filter(function (r) { return r.exh; }).length, top = rows.filter(function (r) { return r.both <= 100; }).length;
    $('csSlateT').textContent = fmtDate(S.date, true);
    $('csSlateS').textContent = (nx === rows.length && nx ? nx + ' preseason scrimmage' + (nx > 1 ? 's' : '') + ' · unofficial, no betting markets' : rows.length + ' rated games · ' + top + ' between top-100 teams' + (rows.some(function (r) { return r.mk; }) ? ' · book lines in' : ''));
    $('csPrev').disabled = i <= 0; $('csNext').disabled = i >= S.dates.length - 1;
  }

  function render() {
    var rows = slate(S.date), allExh = rows.length && rows.every(function (r) { return r.exh; });
    var props = allExh ? [] : propCands(S.date, rows.filter(function (r) { return !r.exh; }));   // no props on scrimmages
    renderSlateBar(rows); renderEyes(rows, props); renderBets(rows, props); renderLines(rows);
  }
  function setDate(d) { S.date = d; S.showAll = false; try { var u = new URL(location.href); u.searchParams.set('date', d); history.replaceState(null, '', u); } catch (e) {} render(); }

  function boot() {
    if (!window.TDC_RATINGS) return;
    var L = window.CS_LOAD || {};
    Promise.all([
      TDC_RATINGS.get(),
      fetch('scripts/data/schedule_2027.json?v=5').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/team_pace_eff.json?v=8').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/odds_live.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      L.teams || null, L.players || null, L.proj || null,
      window.TDCScrim ? TDCScrim.load() : null
    ]).then(function (res) {
      var D = res[0], sch = res[1]; S.eff = res[2]; S.odds = res[3];
      var teams = (D && D.teams || []).filter(function (t) { return t.rating != null; }).sort(function (a, b) { return b.rating - a.rating; });
      teams.forEach(function (t, i) { if (t.rank == null) t.rank = i + 1; S.byFull[t.full] = t; });
      var tt = res[4]; if (tt && tt.teams) Object.keys(tt.teams).forEach(function (k) { if (tt.teams[k].history) S.ats[k] = tt.teams[k].history; });
      if (!sch) { $('slRows').innerHTML = '<div class="sl-empty">Schedule not available.</div>'; return; }
      var T = sch.teams;
      S.games = sch.games.map(function (a) { return { id: a[0], date: a[1], home: T[a[2]], away: T[a[3]], neutral: !!a[4], conf: !!a[5] }; });
      var X = res[7]; if (X && X.games) X.games.forEach(function (x) { S.games.push({ id: x.id, date: x.date, home: x.home, away: x.away, neutral: !!x.neutral, conf: false, exh: true }); });
      // game days with real slates (skip the odd one-game exhibition date)
      var cnt = {}, ex = {}; S.games.forEach(function (g) { if (S.byFull[g.home] && S.byFull[g.away]) { cnt[g.date] = (cnt[g.date] || 0) + 1; if (g.exh) ex[g.date] = 1; } });
      S.dates = Object.keys(cnt).filter(function (d) { return cnt[d] >= 3 || ex[d]; }).sort();   // exhibition days count even with one game
      var want = new URLSearchParams(location.search).get('date');
      var today = new Date(); var iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      S.date = (want && cnt[want]) ? want : (S.dates.find(function (d) { return d >= iso; }) || S.dates[S.dates.length - 1]);
      render();
    }).catch(function (e) { console.warn('cheatsheet slate', e); $('slRows').innerHTML = '<div class="sl-empty">Could not load the slate.</div>'; });

    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('#csDates button'); if (b) { setDate(b.dataset.d); return; }
      var f = e.target.closest && e.target.closest('#linesFilter button');
      if (f) { S.filter = f.dataset.f; document.querySelectorAll('#linesFilter button').forEach(function (x) { x.classList.toggle('on', x === f); }); render(); }
    });
    $('csPrev').onclick = function () { var i = S.dates.indexOf(S.date); if (i > 0) setDate(S.dates[i - 1]); };
    $('csNext').onclick = function () { var i = S.dates.indexOf(S.date); if (i < S.dates.length - 1) setDate(S.dates[i + 1]); };
    $('linesSearch').oninput = function (e) { S.q = e.target.value || ''; renderLines(slate(S.date)); };
    $('linesMore').onclick = function () { S.showAll = !S.showAll; renderLines(slate(S.date)); };
  }
  window.TDC_CS = { boot: boot, render: function () { if (S.date) render(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
