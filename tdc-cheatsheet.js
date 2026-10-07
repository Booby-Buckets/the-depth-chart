/* tdc-cheatsheet.js — the Betting Cheat Sheet's SLATE layer: pick a game day, then
 *   • six eye-catchers (game of the night, upset alert, mismatch, shootout, rock fight, top play)
 *   • Best Bets / Worst Bets tickets
 *   • the full Game Lines sheet (our spread / total / win prob; market + edge once odds_live has the game)
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
    for (var i = 0; i < keys.length; i++) { var g = S.oddsMap[keys[i][0] + '|' + keys[i][1]]; if (g) return { spread: g.spread == null ? null : -g.spread, total: g.total, flip: false }; }
    for (i = 0; i < keys.length; i++) { g = S.oddsMap[keys[i][1] + '|' + keys[i][0]]; if (g) return { spread: g.spread == null ? null : g.spread, total: g.total, flip: true }; }
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

  // ── tickets ────────────────────────────────────────────────────────────────
  function oppTxt(c) { return c.opp ? (c.opp.at + ' ' + esc(short(c.opp.opp))) : ''; }
  function propTicket(c, tone) {
    var pick = (c.side === 'over' ? 'Over ' : 'Under ') + c.line + ' ' + STAT_ABBR[c.s];
    var pct = Math.round((tone === 'bad' ? 1 - c.rate : c.rate) * 100);
    var why = tone === 'bad'
      ? 'Coming off a career year: last season ran <b>' + Math.round((c.ratio - 1) * 100) + '% above</b> his earlier pace per minute. The public will want this over; players like him went over only <b>' + pct + '%</b> of the time.'
      : (c.side === 'over'
        ? 'Last season ran <b>' + Math.round((1 - c.ratio) * 100) + '% below</b> his career pace per minute. Down years like that bounced back over this kind of line <b>' + pct + '%</b> of the time, and our projection agrees.'
        : 'Last season ran <b>' + Math.round((c.ratio - 1) * 100) + '% above</b> his career pace per minute. Spikes like that faded under this kind of line <b>' + pct + '%</b> of the time, and our projection agrees.');
    return ticket({
      tone: tone, kicker: 'Player prop · ' + STAT_NAME[c.s],
      lead: logoImg(c.team, 'cs-tlg'), title: '<a href="player.html?espn=' + c.id + '&tab=betting">' + esc(c.name) + '</a>',
      pick: (tone === 'bad' ? 'Avoid: ' : '') + pick, sub: esc(short(c.team)) + ' ' + oppTxt(c),
      why: why, stat: pct + '%', statLab: tone === 'bad' ? 'over hit' : 'backtest', n: c.n,
      foot: 'Last yr ' + (c.lastAvg != null ? c.lastAvg : '—') + ' · proj ' + (c.proj != null ? (+c.proj).toFixed(1) : '—') + (c.cleared != null ? (tone === 'bad' ? ' · his past games went over only ' + Math.round((1 - c.cleared) * 100) + '%' : ' · cleared ' + Math.round(c.cleared * 100) + '% of his games') : '')
    });
  }
  function gameTicket(r, tone) {
    var side = r.spEdge > 0 ? r.home : r.away, mk = r.mk;
    var bookSide = side === r.home ? mk.spread : -mk.spread;   // margin for our side by the book
    var num = bookSide >= 0 ? '−' + Math.abs(bookSide).toFixed(1) : '+' + Math.abs(bookSide).toFixed(1);
    return ticket({
      tone: tone, kicker: 'Game · spread',
      lead: logoImg(side, 'cs-tlg'), title: '<a href="' + teamHref(side) + '">' + esc(short(side)) + '</a>',
      pick: esc(short(side)) + ' ' + num, sub: esc(short(r.away)) + (r.neutral ? ' vs ' : ' @ ') + esc(short(r.home)),
      why: 'Our line: <b>' + spreadTxt(r.m, r.home, r.away) + '</b>. The book: <b>' + spreadTxt(mk.spread, r.home, r.away) + '</b>. That is a <b>' + Math.abs(r.spEdge).toFixed(1) + '-point</b> gap toward ' + esc(short(side)) + '.',
      stat: (r.spEdge > 0 ? '+' : '+') + Math.abs(r.spEdge).toFixed(1), statLab: 'pt edge', n: null, foot: 'Model vs market · shop the best number'
    });
  }
  function atsTicket(full, h, r) {
    return ticket({
      tone: 'bad', kicker: 'Team trend · against the spread',
      lead: logoImg(full, 'cs-tlg'), title: '<a href="' + teamHref(full) + '">' + esc(short(full)) + '</a>',
      pick: 'Avoid: ' + esc(short(full)) + ' to cover', sub: esc(short(r.away)) + (r.neutral ? ' vs ' : ' @ ') + esc(short(r.home)),
      why: 'Covered only <b>' + Math.round(h.atsPct * 100) + '%</b> of the time over five seasons of real closing lines (' + esc(h.ats) + '). The market has kept overrating them.',
      stat: Math.round(h.atsPct * 100) + '%', statLab: 'covered', n: h.g, foot: 'Team trends drift: treat this as context'
    });
  }
  function ticket(o) {
    return '<div class="cs-ticket ' + o.tone + '">' +
      '<div class="cs-tk-top"><span class="cs-kick">' + o.kicker + '</span></div>' +
      '<div class="cs-tk-main">' + o.lead + '<div class="cs-tk-body"><div class="cs-tk-name">' + o.title + '</div><div class="cs-tk-sub">' + o.sub + '</div></div>' +
      '<div class="cs-tk-stat"><b>' + o.stat + '</b><span>' + o.statLab + (o.n ? ' · ' + o.n : '') + '</span></div></div>' +
      '<div class="cs-tk-pick">' + o.pick + '</div>' +
      '<div class="cs-tk-why">' + o.why + '</div>' +
      '<div class="cs-tk-foot">' + o.foot + '</div></div>';
  }

  // ── eye-catchers ───────────────────────────────────────────────────────────
  function tile(o) {
    return '<a class="cs-tile" href="' + (o.href || '#gameLines') + '"><div class="cs-tile-k">' + o.k + '</div>' +
      '<div class="cs-tile-m">' + o.m + '</div><div class="cs-tile-v">' + o.v + '</div><div class="cs-tile-s">' + o.s + '</div></a>';
  }
  function mu(r) { return logoImg(r.away, 'cs-mlg') + '<span>' + esc(short(r.away)) + '</span><i>' + (r.neutral ? 'vs' : '@') + '</i>' + logoImg(r.home, 'cs-mlg') + '<span>' + esc(short(r.home)) + '</span>'; }
  function renderEyes(rows, props) {
    var host = $('csEyes'); if (!host) return;
    if (!rows.length) { host.innerHTML = '<div class="cs-empty">No rated games on this date.</div>'; return; }
    var by = function (f) { return rows.slice().sort(f)[0]; };
    var gotn = by(function (a, b) { return (a.both - b.both) || (Math.abs(a.m) - Math.abs(b.m)); });
    var upsetPool = rows.filter(function (r) { return (S.byFull[r.fav].rank || 400) <= 60 && Math.abs(r.m) >= 2.5; });
    var upset = upsetPool.length ? upsetPool.sort(function (a, b) { return b.dogP - a.dogP; })[0] : null;
    var misPool = rows.filter(function (r) { return r.both <= 200; });   // buy games vs bottom feeders aren't a story
    var mis = (misPool.length ? misPool : rows).slice().sort(function (a, b) { return Math.abs(b.m) - Math.abs(a.m); })[0];
    var tots = rows.filter(function (r) { return r.tot != null; });
    var hi = tots.length ? tots.slice().sort(function (a, b) { return b.tot - a.tot; })[0] : null;
    var lo = tots.length ? tots.slice().sort(function (a, b) { return a.tot - b.tot; })[0] : null;
    var top = props.filter(function (c) { return c.s !== 'tpm' && (c.proj == null || (c.side === 'over' ? c.proj >= c.line - 0.3 : c.proj <= c.line + 0.3)); }).sort(function (a, b) { return b.score - a.score || b.ppg - a.ppg; })[0];
    var h = [], used = {};
    var tile1 = function (r, o) { if (!r || used[r.g.id]) return; used[r.g.id] = 1; h.push(tile(o)); };   // a small slate shouldn't show one game five times
    h.push(tile({ k: 'Game of the night', m: mu(gotn), v: spreadTxt(gotn.m, gotn.home, gotn.away), s: (gotn.both <= 25 ? 'two top-25 teams' : 'best pairing on the slate') + (gotn.tot ? ' · total ' + Math.round(gotn.tot) : '') }));
    used[gotn.g.id] = 1;
    if (upset) tile1(upset, { k: 'Upset alert', m: mu(upset), v: Math.round(upset.dogP) + '%', s: esc(short(upset.dog)) + ' win chance as a ' + Math.abs(upset.m).toFixed(1) + '-pt dog' });
    tile1(mis, { k: 'Biggest mismatch', m: mu(mis), v: spreadTxt(mis.m, mis.home, mis.away), s: Math.round(mis.favP) + '% for ' + esc(short(mis.fav)) });
    if (hi) tile1(hi, { k: 'Shootout', m: mu(hi), v: Math.round(hi.tot), s: 'highest projected total' });
    if (lo) tile1(lo, { k: 'Rock fight', m: mu(lo), v: Math.round(lo.tot), s: 'lowest projected total' });
    if (top) h.push(tile({ k: 'Top play', href: '#bestBets', m: logoImg(top.team, 'cs-mlg') + '<span>' + esc(top.name) + '</span>', v: (top.side === 'over' ? 'O ' : 'U ') + top.line + ' ' + STAT_ABBR[top.s], s: Math.round(top.rate * 100) + '% in the backtest' }));
    host.innerHTML = h.join('');
  }

  // ── best / worst ───────────────────────────────────────────────────────────
  function renderBets(rows, props) {
    if (rows.length && rows.every(function (r) { return r.exh; })) {   // scrimmages have no betting markets
      var msg = '<div class="cs-empty">Scrimmage day: these games are unofficial and books don\'t post lines or props on them. Our line for every game is in Game lines below, and results get logged as they come in.</div>';
      $('csBest').innerHTML = msg; $('csWorst').innerHTML = msg; return;
    }
    var best = [], used = {};
    // model vs market (in-season): biggest spread gaps
    rows.filter(function (r) { return r.spEdge != null && Math.abs(r.spEdge) >= 3; })
      .sort(function (a, b) { return Math.abs(b.spEdge) - Math.abs(a.spEdge); }).slice(0, 3)
      .forEach(function (r) { best.push(gameTicket(r, 'good')); });
    var perStat = {};   // a mix of markets, not six rebound unders
    // the pattern AND our own projection must point the same way (a down-year bounce we also project)
    var agrees = function (c) { return c.proj == null || (c.side === 'over' ? c.proj >= c.line - 0.3 : c.proj <= c.line + 0.3); };
    props.filter(function (c) { return c.s !== 'tpm' && c.rate >= 0.55 && agrees(c); })
      .sort(function (a, b) { return b.score - a.score || b.ppg - a.ppg; })
      .forEach(function (c) { if (best.length >= 6 || used[c.id] || (perStat[c.s + c.side] || 0) >= 2) return; used[c.id] = 1; perStat[c.s + c.side] = (perStat[c.s + c.side] || 0) + 1; best.push(propTicket(c, 'good')); });
    $('csBest').innerHTML = best.length ? best.join('') : '<div class="cs-empty">No qualifying plays on this slate.</div>';

    var worst = [], usedW = Object.assign({}, used);   // nobody on both lists
    // traps: the overs the public wants — big scorers coming off career years
    props.filter(function (c) { return c.side === 'under' && (c.s === 'pts' || c.s === 'pra') && c.ratio >= 1.35; })
      .sort(function (a, b) { return b.ppg - a.ppg; })
      .forEach(function (c) { if (worst.length >= 4 || usedW[c.id]) return; usedW[c.id] = 1; var t = Object.assign({}, c, { side: 'over' }); worst.push(propTicket(t, 'bad')); });
    // the slate's worst ATS teams (5-yr real lines)
    var ats = [];
    rows.forEach(function (r) { [r.home, r.away].forEach(function (f) { var h = S.ats[f]; if (h && h.g >= 40 && h.atsPct <= 0.43) ats.push({ f: f, h: h, r: r }); }); });
    ats.sort(function (a, b) { return a.h.atsPct - b.h.atsPct; }).slice(0, 2).forEach(function (x) { worst.push(atsTicket(x.f, x.h, x.r)); });
    $('csWorst').innerHTML = worst.length ? worst.join('') : '<div class="cs-empty">Nothing to fade on this slate.</div>';
  }

  // ── game lines sheet ───────────────────────────────────────────────────────
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
    var body = view.slice(0, lim).map(function (r, i) {
      var tag = '';
      if (r.exh) tag = '<a href="scrimmage.html?id=' + encodeURIComponent(r.g.id) + '" class="cs-tag warn" style="text-decoration:none" title="Preseason scrimmage: unofficial, no betting markets · open the game page">Scrimmage →</a>';
      else if (r.spEdge != null && Math.abs(r.spEdge) >= 3) tag = '<span class="cs-tag good">Edge ' + Math.abs(r.spEdge).toFixed(1) + '</span>';
      else if ((S.byFull[r.fav].rank || 400) <= 60 && r.dogP >= 30 && Math.abs(r.m) >= 2.5) tag = '<span class="cs-tag warn">Upset watch</span>';
      else if (r.both <= 40) tag = '<span class="cs-tag">Marquee</span>';
      else if (Math.abs(r.m) <= 1.5) tag = '<span class="cs-tag">Coin flip</span>';
      var bar = '<div class="cs-wp"><span style="width:' + r.probA.toFixed(0) + '%"></span></div>';
      return '<tr><td class="rk">' + (i + 1) + '</td>' +
        '<td class="l nm cs-mu"><a href="' + teamHref(r.away) + '">' + logoImg(r.away, 'cs-xlg') + rk(r.away) + esc(short(r.away)) + '</a> <i>' + (r.neutral ? 'vs' : '@') + '</i> <a href="' + teamHref(r.home) + '">' + logoImg(r.home, 'cs-xlg') + rk(r.home) + esc(short(r.home)) + '</a></td>' +
        '<td class="l"><b>' + spreadTxt(r.m, r.home, r.away) + '</b></td>' +
        '<td>' + (r.tot != null ? Math.round(r.tot) : '—') + '</td>' +
        '<td class="cs-wpc"><span class="dim">' + Math.round(r.probA) + '</span>' + bar + '<span class="dim">' + Math.round(r.probH) + '</span></td>' +
        (hasMk ? '<td class="l dim">' + (r.mk ? spreadTxt(r.mk.spread, r.home, r.away) : '—') + '</td><td class="dim">' + (r.mk && r.mk.total != null ? r.mk.total : '—') + '</td>' +
          '<td class="big">' + (r.spEdge != null ? (r.spEdge > 0 ? '+' : '') + r.spEdge : '—') + '</td>' : '') +
        '<td class="l">' + tag + '</td></tr>';
    }).join('');
    var head = '<tr><th class="rk">#</th><th class="l">Matchup</th><th class="l">Our spread</th><th>Total</th><th title="Away win % · bar · home win %">Win %</th>' +
      (hasMk ? '<th class="l">Book spread</th><th>Book total</th><th title="Our margin minus the book’s, for the home side">Edge</th>' : '') + '<th class="l"></th></tr>';
    $('linesTbl').innerHTML = '<thead>' + head + '</thead><tbody>' + (body || '<tr><td colspan="9" class="empty">No games match.</td></tr>') + '</tbody>';
    $('linesMore').style.display = view.length > 40 ? '' : 'none';
    $('linesMore').textContent = S.showAll ? 'Show fewer' : 'Show all ' + view.length + ' games';
    $('linesHint').textContent = view.length + ' games · ' + (hasMk ? 'model vs the market' : 'book lines appear here once they post');
  }

  // ── slate chooser ──────────────────────────────────────────────────────────
  function renderSlateBar(rows) {
    var i = S.dates.indexOf(S.date);
    var near = S.dates.slice(Math.max(0, i - 2), Math.max(0, i - 2) + 8);
    $('csDates').innerHTML = near.map(function (d) {
      var gs = S.games.filter(function (g) { return g.date === d; }), n = gs.length, xe = gs.every(function (g) { return g.exh; });
      return '<button class="' + (d === S.date ? 'on' : '') + '" data-d="' + d + '"><b>' + fmtDate(d) + '</b><span>' + (xe ? n + ' scrimmage' + (n > 1 ? 's' : '') : n + ' games') + '</span></button>';
    }).join('');
    var top = rows.filter(function (r) { return r.both <= 100; }).length;
    $('csSlateT').textContent = fmtDate(S.date, true);
    var nx = rows.filter(function (r) { return r.exh; }).length;
    $('csSlateS').textContent = (nx === rows.length && nx ? nx + ' preseason scrimmage' + (nx > 1 ? 's' : '') + ' · ' : rows.length + ' rated games · ' + (nx ? nx + ' scrimmages · ' : '')) + top + ' between top-100 teams' + (nx === rows.length && nx ? ' · unofficial, no betting markets' : rows.some(function (r) { return r.mk; }) ? ' · book lines in' : ' · book lines post about a week out');
    $('csPrev').disabled = i <= 0; $('csNext').disabled = i >= S.dates.length - 1;
  }

  function render() {
    var rows = slate(S.date), allExh = rows.length && rows.every(function (r) { return r.exh; });
    var props = allExh ? [] : propCands(S.date, rows.filter(function (r) { return !r.exh; }));   // no props on scrimmages
    renderSlateBar(rows); renderEyes(rows, props); renderBets(rows, props); renderLines(rows);
  }
  function setDate(d) { S.date = d; S.showAll = false; try { history.replaceState(null, '', '?date=' + d); } catch (e) {} render(); }

  function boot() {
    if (!window.TDC_RATINGS) return;
    var L = window.CS_LOAD || {};
    Promise.all([
      TDC_RATINGS.get(),
      fetch('scripts/data/schedule_2027.json?v=4').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/team_pace_eff.json?v=7').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/odds_live.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      L.teams || null, L.players || null, L.proj || null,
      window.TDCScrim ? TDCScrim.load() : null
    ]).then(function (res) {
      var D = res[0], sch = res[1]; S.eff = res[2]; S.odds = res[3];
      var teams = (D && D.teams || []).filter(function (t) { return t.rating != null; }).sort(function (a, b) { return b.rating - a.rating; });
      teams.forEach(function (t, i) { if (t.rank == null) t.rank = i + 1; S.byFull[t.full] = t; });
      var tt = res[4]; if (tt && tt.teams) Object.keys(tt.teams).forEach(function (k) { if (tt.teams[k].history) S.ats[k] = tt.teams[k].history; });
      if (!sch) { $('csEyes').innerHTML = '<div class="cs-empty">Schedule not available.</div>'; return; }
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
    }).catch(function (e) { console.warn('cheatsheet slate', e); $('csEyes').innerHTML = '<div class="cs-empty">Could not load the slate.</div>'; });

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
