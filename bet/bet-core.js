/* bet-core.js — TDC Bet's data engine. No DOM: every page renders from what this returns.
 *
 *   TDCBet.load()            → Promise<ctx>  ratings (TDC_RATINGS) + 2026-27 schedule + scrimmages + tempo/efficiency
 *                                            + live book lines + 5-yr ATS history + results so far
 *   TDCBet.loadProps()       → Promise       player prop data (bet_trends_players + the projected 2026-27 lines)
 *   TDCBet.slate(date)       → [row]         every rated game that day, priced (our spread/total/win %, book, edge)
 *   TDCBet.game(id)          → row | null    one game, priced
 *   TDCBet.propCands(rows)   → [cand]        backtested bounce-back / regression props for the slate's players
 *   TDCBet.bets(rows, cands) → {best, fades} the bet slips, ranked by confidence
 *   TDCBet.live(date)        → Promise<{id: {state, hs, as, clock}}>  ESPN scoreboard (in season)
 *   odds helpers             fair / fairTxt / oddsTxt / implied / coverP / overP
 *
 * The math is the main site's, line for line (tdc-cheatsheet.js slate + bets, tdc-betlab.js fair odds,
 * TDC_RATINGS.lineFor spreads, team_pace_eff totals), so a number on TDC Bet matches the number on a team page.
 * Needs (loaded first): team-colors.js, tdc-ratings.js.
 */
(function (g) {
  'use strict';
  var BET_HOST = /^bet\./i.test(location.hostname);
  var MAIN = BET_HOST ? 'https://www.thedepthchartcbb.com/' : '/';
  var PAGES = ['index', 'games', 'game', 'props', 'pickem', 'futures', 'markets', 'trends', 'record', 'tools', 'learn'];
  // a TDC Bet page: clean paths on the bet host (/games), files under /bet/ on the main domain
  function href(page, qs) {
    page = page || 'index';
    var q = qs ? (qs.charAt(0) === '?' ? qs : '?' + qs) : '';
    if (BET_HOST) return (page === 'index' ? '/tonight' : '/' + page) + q;
    return '/bet/' + (page === 'index' ? '' : page + '.html') + q;
  }
  function pageName() {
    var p = location.pathname.replace(/\/+$/, '');
    var last = p.split('/').pop().replace(/\.html$/, '');
    if (!last || last === 'bet' || last === 'tonight') return 'index';
    return PAGES.indexOf(last) >= 0 ? last : 'index';
  }
  function main(path) { return MAIN + (path || ''); }

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function isoDay(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmtDate(d, style) {
    var x = new Date(d + 'T12:00:00');
    if (style === 'long') return x.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (style === 'dow') return x.toLocaleDateString('en-US', { weekday: 'short' });
    if (style === 'md') return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return x.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function dayLabel(d) {
    var t = isoDay(), y = isoDay(new Date(Date.now() - 864e5)), n = isoDay(new Date(Date.now() + 864e5));
    return d === t ? 'Today' : d === n ? 'Tomorrow' : d === y ? 'Yesterday' : fmtDate(d, 'dow');
  }

  // ── odds math (same as tdc-betlab.js) ──────────────────────────────────
  function fair(p) {
    if (p == null || !isFinite(p) || p <= 0.0005 || p >= 0.9995) return null;
    var o = p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
    o = Math.abs(o) >= 1000 ? Math.round(o / 50) * 50 : Math.abs(o) >= 300 ? Math.round(o / 10) * 10 : Math.round(o / 5) * 5;
    return Math.max(-50000, Math.min(50000, o));
  }
  function oddsTxt(o) { return o == null ? '—' : (o > 0 ? '+' : '−') + Math.abs(Math.round(o)).toLocaleString('en-US'); }
  function fairTxt(p) { var o = fair(p); return o == null ? (p != null && p >= 0.9995 ? 'lock' : '—') : oddsTxt(o); }
  function implied(o) { return o == null ? null : o > 0 ? 100 / (o + 100) : -o / (-o + 100); }
  function decimal(o) { return o == null ? null : o > 0 ? 1 + o / 100 : 1 + 100 / -o; }
  function amFromDec(d) { return d == null || d <= 1 ? null : d >= 2 ? (d - 1) * 100 : -100 / (d - 1); }
  function phi(x) { return g.TDC_RATINGS ? TDC_RATINGS.phi(x) : 0.5 * (1 + erf(x / Math.SQRT2)); }
  function erf(x) { var s = x < 0 ? -1 : 1; x = Math.abs(x); var t = 1 / (1 + 0.3275911 * x); var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
  var SIGMA = 11, TOTAL_SD = 16;            // game-margin sd (tdc-ratings SIGMA); total-points sd (CBB residual ≈ 15–17)
  // chance a team with expected margin m covers `line` (its own spread: −4.5 = laying 4.5)
  function coverP(m, line) { return phi((m + line) / ((g.TDC_RATINGS && TDC_RATINGS.SIGMA) || SIGMA)); }
  function overP(tot, line) { return phi((tot - line) / TOTAL_SD); }
  function spTxt(v) { return Math.abs(v) < 0.25 ? 'PK' : (v < 0 ? '−' : '+') + (Math.round(Math.abs(v) * 2) / 2).toFixed(1); }
  function half(x) { return Math.round(x - 0.5) + 0.5; }

  // ── state ────────────────────────────────────────────────────────────────
  var S = { byFull: {}, teams: [], games: [], byId: {}, dates: [], eff: null, odds: null, oddsMap: null, ats: {}, trends: null, res: {}, ready: null,
            P: null, PR: null, BT: null, DIP: 0.85, SPIKE: 1.25, LAST: 2026, PMETA: null, propsReady: null };
  function getJ(u, o) { return fetch(u, o).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }

  function short(full) { var t = S.byFull[full]; var s = (t && t.team) || full; try { if (g.tdcShortSchool) return tdcShortSchool(s) || s; } catch (e) {} return s; }
  function logo(full) { var t = S.byFull[full]; var c = g.tdcTeamColor && (tdcTeamColor((t && t.team) || full) || tdcTeamColor(full)); return (c && c.logo) || ''; }
  // team colour for bars/charts: primary, or the secondary when the primary is too dark to read on the dark board
  function lum(h) { h = String(h || '').replace('#', ''); if (h.length !== 6) return 0.5; var c = [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function color(full) {
    var t = S.byFull[full]; var c = g.tdcTeamColor && (tdcTeamColor((t && t.team) || full) || tdcTeamColor(full)); if (!c) return null;
    var a = c.c1 || c.primary, b = c.c2;
    if (a && lum(a) < 0.12 && b && lum(b) > lum(a) && lum(b) < 0.92) return b;
    return a || b || null;
  }
  function lg(full, size) { var l = logo(full); return '<span class="lg ' + (size || '') + '">' + (l ? '<img src="' + l + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') + '</span>'; }
  function teamHref(full) { var t = S.byFull[full]; return main('team.html?team=' + encodeURIComponent((t && t.team) || full)); }
  function playerHref(id, tab) { return main('player.html?espn=' + encodeURIComponent(id) + (tab ? '&tab=' + tab : '')); }
  function rank(full) { var t = S.byFull[full]; return t && t.rank ? t.rank : null; }

  // odds-feed names → our rows (same normalizer as build_odds_history.py)
  var MASCOT = new Set(('blue devils devils wildcats tigers bulldogs cougars gators aggies huskies volunteers cavaliers cyclones boilermakers jayhawks razorbacks fighting illini cardinals hurricanes eagles bears wolverines spartans hawkeyes gaels red raiders seahawks zips rams lopes utes hoosiers buckeyes badgers cornhuskers terrapins nittany lions demon deacons yellow jackets tar heels wolfpack orange hokies seminoles panthers knights bearcats bruins trojans sun devils golden gophers musketeers friars pirates bluejays gamecocks commodores rebels crimson tide mean green golden eagles ragin cajuns owls minutemen catamounts privateers redhawks red storm crimson vandals broncos mustangs lobos aztecs falcons flames phoenix runnin rebels anteaters gauchos toreros dons waves highlanders titans matadors 49ers roadrunners bobcats mountaineers').split(/\s+/));
  function oNorm(n) { n = (n || '').toLowerCase().trim().replace(/&/g, 'and'); n = n.replace(/\bst\.?\b/g, 'state').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(university|univ|the|of)\b/g, ' '); return n.split(/\s+/).filter(function (t) { return t && !MASCOT.has(t); }).join(' ').trim(); }
  function marketFor(home, away) {
    if (!S.odds || !S.odds.games || !S.odds.games.length) return null;
    if (!S.oddsMap) { S.oddsMap = {}; S.odds.games.forEach(function (x) { S.oddsMap[x.home_norm + '|' + x.away_norm] = x; }); }
    var h = S.byFull[home], a = S.byFull[away];
    var keys = [[oNorm(home), oNorm(away)], [oNorm(h && h.team), oNorm(a && a.team)]], x, i;
    for (i = 0; i < keys.length; i++) { x = S.oddsMap[keys[i][0] + '|' + keys[i][1]]; if (x) return { spread: x.spread == null ? null : -x.spread, total: x.total, mlH: x.ml_home, mlA: x.ml_away, stamp: S.odds.generated }; }
    for (i = 0; i < keys.length; i++) { x = S.oddsMap[keys[i][1] + '|' + keys[i][0]]; if (x) return { spread: x.spread == null ? null : x.spread, total: x.total, mlH: x.ml_away, mlA: x.ml_home, stamp: S.odds.generated }; }
    return null;
  }
  function effLine(a, b) {
    var E = S.eff; if (!E || !E.teams) return null;
    var A = E.teams[a], B = E.teams[b]; if (!A || !B) return null;
    var pace = A.t + B.t - E.avgT, k = pace / 100, avg = (E.avgO + E.avgD) / 2;
    return { total: (A.o + B.d - avg) * k + (B.o + A.d - avg) * k, pace: pace, ptsH: (A.o + B.d - avg) * k, ptsA: (B.o + A.d - avg) * k };
  }

  function load() {
    if (S.ready) return S.ready;
    return (S.ready = Promise.all([
      TDC_RATINGS.get(),
      getJ('scripts/data/schedule_2027.json?v=5'),
      getJ('scripts/data/team_pace_eff.json?v=8'),
      getJ('scripts/data/odds_live.json', { cache: 'no-cache' }),
      getJ('scripts/data/bet_trends_teams.json?v=4'),
      getJ('scripts/data/scrimmages_2027.json?v=' + new Date().toISOString().slice(0, 10)),
      getJ('scripts/data/results_2027.json?h=' + new Date().toISOString().slice(0, 13), { cache: 'no-cache' }),
      getJ('scripts/data/scrimmage_results_2027.json?v=10', { cache: 'no-cache' })
    ]).then(function (r) {
      var D = r[0], sch = r[1]; S.eff = r[2]; S.odds = r[3]; S.trends = r[4];
      S.teams = (D && D.teams || []).filter(function (t) { return t.rating != null; }).sort(function (a, b) { return b.rating - a.rating; });
      S.teams.forEach(function (t, i) { if (t.rank == null) t.rank = i + 1; S.byFull[t.full] = t; });
      var tt = r[4]; if (tt && tt.teams) Object.keys(tt.teams).forEach(function (k) { if (tt.teams[k].history) S.ats[k] = tt.teams[k].history; });
      if (sch) {
        var T = sch.teams;
        S.games = sch.games.map(function (a) { return { id: a[0], date: a[1], home: T[a[2]], away: T[a[3]], neutral: !!a[4], conf: !!a[5] }; });
      }
      var X = r[5]; if (X && X.games) X.games.forEach(function (x) { S.games.push({ id: x.id, date: x.date, home: x.home, away: x.away, neutral: !!x.neutral, conf: false, exh: true }); });
      S.games.forEach(function (x) { S.byId[String(x.id)] = x; });
      var R = r[6]; if (R && R.games) R.games.forEach(function (a) { S.res[String(a[0])] = { hs: a[4], as: a[5], final: true }; });
      var XR = r[7] && r[7].results; if (XR) Object.keys(XR).forEach(function (id) { var x = XR[id]; if (x && x.hs != null && x.as != null) S.res[id] = { hs: +x.hs, as: +x.as, final: true, exh: true }; });
      var cnt = {}, ex = {};
      S.games.forEach(function (x) { if (S.byFull[x.home] && S.byFull[x.away]) { cnt[x.date] = (cnt[x.date] || 0) + 1; if (x.exh) ex[x.date] = 1; } });
      S.dates = Object.keys(cnt).filter(function (d) { return cnt[d] >= 3 || ex[d]; }).sort();
      S.count = cnt;
      return S;
    }));
  }
  // the default slate: ?date=, else the first game day on/after today
  function defaultDate() {
    var want = new URLSearchParams(location.search).get('date');
    if (want && S.count && S.count[want]) return want;
    var iso = isoDay();
    return S.dates.find(function (d) { return d >= iso; }) || S.dates[S.dates.length - 1];
  }

  function price(x) {
    var H = S.byFull[x.home], A = S.byFull[x.away]; if (!H || !A || H.rating == null || A.rating == null) return null;
    var e = effLine(x.home, x.away);
    var L = TDC_RATINGS.lineFor(H, A, x.neutral ? 'neutral' : 'home', e ? e.total : undefined);
    var m = L.margin, tot = e ? e.total : null, mk = marketFor(x.home, x.away);
    var spEdge = mk && mk.spread != null ? +(m - mk.spread).toFixed(1) : null;
    var toEdge = mk && mk.total != null && tot != null ? +(tot - mk.total).toFixed(1) : null;
    var fav = m >= 0 ? x.home : x.away, favP = Math.max(L.probA, L.probB);
    var res = S.res[String(x.id)] || null;
    return { g: x, id: x.id, date: x.date, exh: !!x.exh, home: x.home, away: x.away, neutral: x.neutral, conf: x.conf, m: m, tot: tot, pace: e ? e.pace : null,
             scoreH: L.scoreA, scoreA: L.scoreB, probH: L.probA, probA: L.probB, fav: fav, dog: m >= 0 ? x.away : x.home, favP: favP, dogP: 100 - favP,
             mk: mk, spEdge: spEdge, toEdge: toEdge, res: res,
             quality: Math.min(H.rank || 400, A.rank || 400), both: Math.max(H.rank || 400, A.rank || 400) };
  }
  function slate(date) {
    return S.games.filter(function (x) { return x.date === date; }).map(price).filter(Boolean)
      .sort(function (a, b) { return (a.both + a.quality) - (b.both + b.quality); });
  }
  function game(id) { var x = S.byId[String(id)]; return x ? price(x) : null; }
  // headline tag for a game (one per ticket)
  function tagOf(r) {
    if (r.exh) return { t: 'Scrimmage', c: 'y' };
    if (r.spEdge != null && Math.abs(r.spEdge) >= 3) return { t: 'Edge ' + Math.abs(r.spEdge).toFixed(1), c: 'g' };
    if (r.toEdge != null && Math.abs(r.toEdge) >= 4) return { t: (r.toEdge > 0 ? 'Over ' : 'Under ') + 'edge', c: 'g' };
    if ((rank(r.fav) || 400) <= 60 && r.dogP >= 30 && Math.abs(r.m) >= 2.5) return { t: 'Upset watch', c: 'y' };
    if (r.both <= 40) return { t: 'Marquee', c: 'b' };
    if (Math.abs(r.m) <= 1.5) return { t: 'Coin flip', c: '' };
    return null;
  }

  // ── props ────────────────────────────────────────────────────────────────
  function loadProps() {
    if (S.propsReady) return S.propsReady;
    return (S.propsReady = Promise.all([
      getJ('scripts/data/stat_overall_projected.json?v=96'),
      getJ('scripts/data/bet_trends_players.json?v=bounce2')
    ]).then(function (r) {
      var pj = r[0], d = r[1];
      S.PR = (pj && pj.players) || {};
      if (d && d.meta) { S.PMETA = d.meta; S.BT = d.meta.backtest || null; if (d.meta.dip) S.DIP = d.meta.dip; if (d.meta.spike) S.SPIKE = d.meta.spike; if (d.meta.seasons) S.LAST = Math.max.apply(null, d.meta.seasons); }
      S.P = d && d.players ? Object.keys(d.players).map(function (id) { var p = d.players[id]; return { id: id, name: p.name, team: p.team, stats: p.stats }; }) : [];
      return S;
    }));
  }
  // distribution-free hit rate across the quantile points (lo/p25/med/p75/hi)
  function empiricalOver(st, line) {
    var pts = [[st.lo, 1.0], [st.p25, 0.75], [st.med, 0.5], [st.p75, 0.25], [st.hi, 0.0]].filter(function (p) { return p[0] != null; }).sort(function (a, b) { return a[0] - b[0]; });
    if (!pts.length) return null;
    if (line <= pts[0][0]) return 0.97;
    if (line >= pts[pts.length - 1][0]) return 0.03;
    for (var i = 1; i < pts.length; i++) { if (line <= pts[i][0]) { var x0 = pts[i - 1][0], p0 = pts[i - 1][1], x1 = pts[i][0], p1 = pts[i][1]; var t = (line - x0) / ((x1 - x0) || 1); return Math.max(0.02, Math.min(0.98, p0 + (p1 - p0) * t)); } }
    return 0.03;
  }
  var STAT_ABBR = { pts: 'PTS', reb: 'REB', ast: 'AST', pra: 'PRA', tpm: '3PM' };
  var STAT_NAME = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', tpm: 'Threes', pra: 'Pts + Reb + Ast' };
  var MIN_LINE = { pts: 7.5, reb: 3.5, ast: 2.5, tpm: 1.5, pra: 12.5 };
  function projStat(id, s) {
    var pr = S.PR && S.PR[id]; if (!pr) return null;
    var v = { pts: pr.ppg, reb: pr.rpg, ast: pr.apg, tpm: pr.tpm, pra: (pr.ppg || 0) + (pr.rpg || 0) + (pr.apg || 0) }[s];
    return v == null || !isFinite(v) ? null : v;
  }
  function propCands(rows) {
    if (!S.P || !S.PR) return [];
    var opp = {};
    rows.forEach(function (x) { if (x.exh) return; opp[x.home] = { opp: x.away, at: 'vs', row: x }; opp[x.away] = { opp: x.home, at: x.neutral ? 'vs' : '@', row: x }; });
    var out = [];
    S.P.forEach(function (p) {
      var pr = S.PR[p.id]; if (!pr || !pr.team || !opp[pr.team]) return;
      if (!(pr.mpg >= 22)) return;
      var tr = S.byFull[pr.team]; if (!tr || (tr.rank || 400) > 150) return;
      if (pr.last_mpg != null && pr.last_mpg < 12 && pr.mpg - pr.last_mpg > 14) return;
      ['pts', 'reb', 'ast', 'pra', 'tpm'].forEach(function (s) {
        var st = p.stats && p.stats[s]; if (!st || st.g < 25 || !st.bounce) return;
        var r = st.bounce.ratio, line = half(st.bounce.last / 40 * pr.mpg); if (line < MIN_LINE[s]) return;
        var bt = (S.BT && S.BT[s]) || {};
        var side = r <= S.DIP ? 'over' : r >= S.SPIKE ? 'under' : null; if (!side) return;
        var rate = side === 'over' ? bt.dip_over : bt.spike_under; if (rate == null) return;
        var strength = side === 'over' ? Math.min(1, (S.DIP - r) / 0.35) : Math.min(1, (r - S.SPIKE) / 1.0);
        var cleared = empiricalOver(st, line); if (cleared != null && side === 'under') cleared = 1 - cleared;
        out.push({ kind: 'prop', id: p.id, name: p.name, team: pr.team, s: s, side: side, line: line, ratio: r, rate: rate,
                   n: side === 'over' ? bt.dip_n : bt.spike_n, strength: strength, cleared: cleared, proj: projStat(p.id, s),
                   ppg: pr.ppg || 0, career: st.bounce.career, last40: st.bounce.last, opp: opp[pr.team],
                   score: rate + 0.06 * strength + 0.0015 * (pr.ppg || 0) });
      });
    });
    return out;
  }

  // ── slip selections ─────────────────────────────────────────────────────
  // {key, gid, date, market, side, label, sub, line, price, p, book}
  function selSpread(r, isHome) {
    var me = isHome ? r.m : -r.m, mk = r.mk, has = mk && mk.spread != null;
    var line = has ? (isHome ? -mk.spread : mk.spread) : -(Math.round(me * 2) / 2);
    var full = isHome ? r.home : r.away;
    return { key: r.id + ':sp:' + (isHome ? 'h' : 'a'), gid: r.id, date: r.date, market: 'spread', side: isHome ? 'home' : 'away', team: full,
             label: short(full) + ' ' + spTxt(line), sub: short(r.away) + (r.neutral ? ' vs ' : ' @ ') + short(r.home), line: line,
             price: has ? -110 : fair(coverP(me, line)), p: coverP(me, line), book: !!has };
  }
  function selTotal(r, over) {
    var mk = r.mk, has = mk && mk.total != null, line = has ? mk.total : (r.tot != null ? half(r.tot) : null); if (line == null) return null;
    var p = r.tot != null ? (over ? overP(r.tot, line) : 1 - overP(r.tot, line)) : 0.5;
    return { key: r.id + ':to:' + (over ? 'o' : 'u'), gid: r.id, date: r.date, market: 'total', side: over ? 'over' : 'under', team: r.home,
             label: (over ? 'Over ' : 'Under ') + line, sub: short(r.away) + (r.neutral ? ' vs ' : ' @ ') + short(r.home), line: line,
             price: has ? -110 : fair(p), p: p, book: !!has };
  }
  function selMl(r, isHome) {
    var mk = r.mk, bo = mk && (isHome ? mk.mlH : mk.mlA), p = (isHome ? r.probH : r.probA) / 100, full = isHome ? r.home : r.away;
    return { key: r.id + ':ml:' + (isHome ? 'h' : 'a'), gid: r.id, date: r.date, market: 'ml', side: isHome ? 'home' : 'away', team: full,
             label: short(full) + ' ML', sub: short(r.away) + (r.neutral ? ' vs ' : ' @ ') + short(r.home), line: null,
             price: bo != null ? bo : fair(p), p: p, book: bo != null };
  }
  function selProp(c) {
    return { key: c.opp.row.id + ':pr:' + c.id + ':' + c.s + ':' + c.side, gid: c.opp.row.id, date: c.opp.row.date, market: 'prop', side: c.side, team: c.team, pid: c.id, stat: c.s,
             label: c.name + ' ' + (c.side === 'over' ? 'O ' : 'U ') + c.line + ' ' + STAT_ABBR[c.s], sub: short(c.team) + ' ' + c.opp.at + ' ' + short(c.opp.opp), line: c.line,
             price: -110, p: c.rate, book: false };
  }
  // grade one selection against a final score: 'w' | 'l' | 'p' | null (not final / not gradable here)
  function grade(sel, res) {
    if (!res || !res.final || res.hs == null) return null;
    var hm = res.hs - res.as;
    if (sel.market === 'spread') { var v = (sel.side === 'home' ? hm : -hm) + sel.line; return v > 0 ? 'w' : v < 0 ? 'l' : 'p'; }
    if (sel.market === 'total') { var t = res.hs + res.as - sel.line; if (t === 0) return 'p'; return (sel.side === 'over') === (t > 0) ? 'w' : 'l'; }
    if (sel.market === 'ml') return (sel.side === 'home') === (hm > 0) ? 'w' : 'l';
    return null;
  }

  // ── the bet slips ───────────────────────────────────────────────────────
  function edgeConf(e) { e = Math.abs(e); return e >= 6 ? 5 : e >= 4.5 ? 4 : e >= 3 ? 3 : 2; }
  function propBet(c, tone) {
    var pct = Math.round((tone === 'bad' ? 1 - c.rate : c.rate) * 100), off = Math.round(Math.abs(c.ratio - 1) * 100);
    var why = tone === 'bad'
      ? 'Coming off a career year (' + off + '% above his earlier pace per minute). Players like him went over only ' + pct + '% of the time.'
      : (c.side === 'over' ? 'Last season ran ' + off + '% below his career pace per minute. Down years like that went over ' + pct + '% of the time' : 'Last season ran ' + off + '% above his career pace per minute. Spikes like that went under ' + pct + '% of the time') +
        (c.proj != null ? ', and our projection (' + (+c.proj).toFixed(1) + ') agrees.' : '.');
    var conf = tone === 'bad' ? (pct <= 42 ? 4 : pct <= 45 ? 3 : 2) : (c.rate >= 0.63 ? 4 : c.rate >= 0.60 ? 3 : c.rate >= 0.57 ? 2 : 1) + (c.strength >= 0.6 ? 1 : 0);
    return { tone: tone, team: c.team, kind: STAT_NAME[c.s], conf: conf, why: why, title: c.name, titleHref: playerHref(c.id, 'betting'),
             sub: short(c.team) + ' ' + c.opp.at + ' ' + short(c.opp.opp), gid: c.opp.row.id,
             pick: (tone === 'bad' ? 'Avoid over ' : c.side === 'over' ? 'Over ' : 'Under ') + c.line + ' ' + STAT_ABBR[c.s], right: pct + '%',
             ft1: 'Backtest ' + pct + '%' + (tone === 'bad' ? ' over' : '') + (c.n ? ' · ' + c.n + ' picks' : ''), ft2: tone === 'bad' ? 'Career-year trap' : c.side === 'over' ? 'Bounce-back' : 'Regression',
             sel: tone === 'bad' ? null : selProp(c) };
  }
  function spreadBet(r) {
    var isHome = r.spEdge > 0, side = isHome ? r.home : r.away, s = selSpread(r, isHome);
    return { tone: 'good', team: side, kind: 'Spread', conf: edgeConf(r.spEdge), gid: r.id,
             why: 'We make it ' + short(r.m >= 0 ? r.home : r.away) + ' ' + spTxt(-Math.abs(r.m)) + '. The book has ' + short(r.mk.spread >= 0 ? r.home : r.away) + ' ' + spTxt(-Math.abs(r.mk.spread)) + ', a ' + Math.abs(r.spEdge).toFixed(1) + '-point gap toward ' + short(side) + '.',
             title: short(side), titleHref: teamHref(side), sub: short(r.away) + (r.neutral ? ' vs ' : ' @ ') + short(r.home),
             pick: s.label, right: Math.round(s.p * 100) + '%', ft1: 'Edge ' + Math.abs(r.spEdge).toFixed(1) + ' pts', ft2: 'Model vs market', sel: s };
  }
  function totalBet(r) {
    var over = r.toEdge > 0, s = selTotal(r, over);
    return { tone: 'good', team: r.home, kind: 'Total', conf: edgeConf(r.toEdge), gid: r.id,
             why: 'We project ' + Math.round(r.tot) + ' total points; the book is at ' + r.mk.total + '.',
             title: short(r.away) + (r.neutral ? ' vs ' : ' @ ') + short(r.home), titleHref: href('game', 'id=' + r.id), sub: r.neutral ? 'Neutral site' : 'At ' + short(r.home),
             pick: s.label, right: Math.round(s.p * 100) + '%', ft1: 'Edge ' + Math.abs(r.toEdge).toFixed(1) + ' pts', ft2: 'Model vs market', sel: s };
  }
  function atsBet(full, h, r) {
    return { tone: 'bad', team: full, kind: 'Against the spread', conf: h.atsPct <= 0.38 ? 4 : h.atsPct <= 0.41 ? 3 : 2, gid: r.id,
             why: 'Covered only ' + Math.round(h.atsPct * 100) + '% of the time over five seasons of real closing lines (' + h.ats + '). The market keeps overrating them.',
             title: short(full), titleHref: teamHref(full), sub: short(r.away) + (r.neutral ? ' vs ' : ' @ ') + short(r.home),
             pick: 'Fade ' + short(full), right: Math.round(h.atsPct * 100) + '%', ft1: '5-yr ATS ' + h.ats, ft2: 'Team trend', sel: null };
  }
  function bets(rows, props) {
    rows = rows.filter(function (r) { return !r.exh; });
    var best = [], used = {};
    rows.filter(function (r) { return r.spEdge != null && Math.abs(r.spEdge) >= 3; }).sort(function (a, b) { return Math.abs(b.spEdge) - Math.abs(a.spEdge); }).slice(0, 3)
      .forEach(function (r) { best.push(spreadBet(r)); });
    rows.filter(function (r) { return r.toEdge != null && Math.abs(r.toEdge) >= 4; }).sort(function (a, b) { return Math.abs(b.toEdge) - Math.abs(a.toEdge); }).slice(0, 2)
      .forEach(function (r) { best.push(totalBet(r)); });
    var perStat = {};
    var agrees = function (c) { return c.proj == null || (c.side === 'over' ? c.proj >= c.line - 0.3 : c.proj <= c.line + 0.3); };
    (props || []).filter(function (c) { return c.s !== 'tpm' && c.rate >= 0.55 && agrees(c); })
      .sort(function (a, b) { return b.score - a.score || b.ppg - a.ppg; })
      .forEach(function (c) { if (best.length >= 6 || used[c.id] || (perStat[c.s + c.side] || 0) >= 2) return; used[c.id] = 1; perStat[c.s + c.side] = (perStat[c.s + c.side] || 0) + 1; best.push(propBet(c, 'good')); });
    best.sort(function (a, b) { return b.conf - a.conf; });
    var fades = [], usedW = Object.assign({}, used);
    (props || []).filter(function (c) { return c.side === 'under' && (c.s === 'pts' || c.s === 'pra') && c.ratio >= 1.35; })
      .sort(function (a, b) { return b.ppg - a.ppg; })
      .forEach(function (c) { if (fades.length >= 2 || usedW[c.id]) return; usedW[c.id] = 1; fades.push(propBet(Object.assign({}, c, { side: 'over' }), 'bad')); });
    var ats = [];
    rows.forEach(function (r) { [r.home, r.away].forEach(function (f) { var h = S.ats[f]; if (h && h.g >= 40 && h.atsPct <= 0.43) ats.push({ f: f, h: h, r: r }); }); });
    ats.sort(function (a, b) { return a.h.atsPct - b.h.atsPct; }).slice(0, 1).forEach(function (x) { fades.push(atsBet(x.f, x.h, x.r)); });
    return { best: best, fades: fades };
  }

  // ── live scores (ESPN scoreboard; schedule ids are ESPN event ids) ─────
  var LIVE = {};
  function live(date) {
    var m = new Date().getMonth(); if (!(m >= 10 || m <= 3)) return Promise.resolve({});
    var t = isoDay(), y = isoDay(new Date(Date.now() - 864e5)); if (date !== t && date !== y) return Promise.resolve({});
    if (LIVE[date] && Date.now() - LIVE[date].t < 60000) return Promise.resolve(LIVE[date].v);
    return getJ('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50&limit=400&dates=' + date.replace(/-/g, ''))
      .then(function (j) {
        var out = {};
        ((j && j.events) || []).forEach(function (ev) {
          var c = ev.competitions && ev.competitions[0], st = ev.status && ev.status.type; if (!c || !st) return;
          var side = {}; (c.competitors || []).forEach(function (x) { side[x.homeAway] = x; });
          if (!side.home || !side.away) return;
          out[String(ev.id)] = { state: st.state, final: st.state === 'post', hs: +side.home.score, as: +side.away.score, clock: st.shortDetail || st.detail || '' };
        });
        LIVE[date] = { t: Date.now(), v: out };
        Object.keys(out).forEach(function (id) { if (out[id].final && !S.res[id]) S.res[id] = { hs: out[id].hs, as: out[id].as, final: true }; });
        return out;
      });
  }

  g.TDCBet = {
    BET_HOST: BET_HOST, MAIN: MAIN, PAGES: PAGES, href: href, main: main, page: pageName, esc: esc,
    isoDay: isoDay, fmtDate: fmtDate, dayLabel: dayLabel,
    fair: fair, fairTxt: fairTxt, oddsTxt: oddsTxt, implied: implied, decimal: decimal, amFromDec: amFromDec, coverP: coverP, overP: overP, spTxt: spTxt, half: half, phi: phi, TOTAL_SD: TOTAL_SD,
    load: load, loadProps: loadProps, defaultDate: defaultDate, slate: slate, game: game, tagOf: tagOf, propCands: propCands, bets: bets, live: live,
    empiricalOver: empiricalOver, projStat: projStat, STAT_ABBR: STAT_ABBR, STAT_NAME: STAT_NAME, MIN_LINE: MIN_LINE,
    selSpread: selSpread, selTotal: selTotal, selMl: selMl, selProp: selProp, grade: grade,
    short: short, logo: logo, color: color, lg: lg, teamHref: teamHref, playerHref: playerHref, rank: rank, effLine: effLine,
    state: function () { return S; }
  };
})(window);
