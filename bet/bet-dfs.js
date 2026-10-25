/* bet-dfs.js — pick'em math for the DFS apps (PrizePicks, Underdog, DraftKings Pick6, Betr). Pure math, no DOM.
 *
 * A pick'em app doesn't post odds. It posts a line per player, you pick More or Less on 2–6 of them, and the
 * ENTRY pays a fixed multiplier: Power (every pick must hit) or Flex (pays a smaller amount with one or two
 * misses). So a pick has no price on its own; what matters is whether your chance beats the per-pick
 * break-even of the entry you put it in.
 *
 *   TDCPickem.APPS                    payout tables per app (power[n] = multiplier, flex[n][hits] = multiplier)
 *   TDCPickem.breakEven(pay)          per-pick chance that makes an entry break even (every pick equally likely)
 *   TDCPickem.entry(probs, pay)       exact result of one entry: {ev, pAll, pCash, pProfit, dist}
 *   TDCPickem.picks(lines, app)       every line at this app, best side, sorted by chance: [{…line, side, p, line}]
 *   TDCPickem.build(picks, app, opts) the best entry for each size + type from the top picks (one per game first)
 *   TDCPickem.label(app)              display name
 *
 * PAYOUTS — the apps' standard tables as of Oct 2026. They change them, some states get different ones, and a
 * line marked goblin / demon / boosted pays less or more, so pickem.html lets the user type their own multipliers.
 * Edit the defaults here.
 */
(function (g) {
  'use strict';
  var APPS = {
    prizepicks: { name: 'PrizePicks',
      power: { 2: 3, 3: 5, 4: 10, 5: 20, 6: 37.5 },
      flex: { 3: { 3: 2.25, 2: 1.25 }, 4: { 4: 5, 3: 1.5 }, 5: { 5: 10, 4: 2, 3: 0.4 }, 6: { 6: 25, 5: 2, 4: 0.4 } } },
    underdog: { name: 'Underdog',
      power: { 2: 3, 3: 6, 4: 10, 5: 20 },
      flex: { 3: { 3: 3, 2: 1 }, 4: { 4: 6, 3: 1.5 }, 5: { 5: 10, 4: 2.5 }, 6: { 6: 25, 5: 2.6, 4: 0.25 } } },
    pick6: { name: 'DraftKings Pick6',
      power: { 2: 3, 3: 5, 4: 10, 5: 20, 6: 40 }, flex: {} },
    betr_us_dfs: { name: 'Betr Picks',
      power: { 2: 3, 3: 5, 4: 10, 5: 20 }, flex: {} }
  };
  var FALLBACK = APPS.prizepicks;
  function app(k) { return APPS[k] || { name: label(k), power: FALLBACK.power, flex: {} }; }
  function label(k) { return (APPS[k] && APPS[k].name) || String(k || '').replace(/_us_dfs$|_dfs$/, '').replace(/(^|_)(\w)/g, function (m, a, c) { return (a ? ' ' : '') + c.toUpperCase(); }); }

  // pay table for one entry: {hits: multiplier}
  function payTable(a, type, n) {
    if (type === 'power') return a.power[n] != null ? (function () { var t = {}; t[n] = a.power[n]; return t; })() : null;
    return a.flex[n] || null;
  }

  // P(exactly k of the picks hit), each pick with its own chance — the Poisson-binomial, by dynamic programming
  function dist(probs) {
    var d = [1];
    probs.forEach(function (p) {
      var nd = new Array(d.length + 1).fill(0);
      for (var k = 0; k < d.length; k++) { nd[k] += d[k] * (1 - p); nd[k + 1] += d[k] * p; }
      d = nd;
    });
    return d;
  }
  function entry(probs, pay) {
    var d = dist(probs), ev = -1, pCash = 0, pProfit = 0;
    Object.keys(pay).forEach(function (h) { var k = +h, m = pay[h], q = d[k] || 0; ev += q * m; if (m > 0) pCash += q; if (m > 1) pProfit += q; });
    return { ev: ev, pAll: d[probs.length] || 0, pCash: pCash, pProfit: pProfit, dist: d };
  }
  // the per-pick chance where an entry of equally likely picks returns exactly the stake
  function breakEven(pay) {
    var n = Math.max.apply(null, Object.keys(pay).map(Number)), lo = 0.3, hi = 0.95;
    for (var i = 0; i < 50; i++) { var mid = (lo + hi) / 2, p = []; for (var j = 0; j < n; j++) p.push(mid); if (entry(p, pay).ev < 0) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  // every line this app posted, on the side we like. check = don't trust it: a line well off the sportsbooks'
  // number is usually a discounted "goblin" / boosted "demon" line that pays a different multiplier, and a chance
  // over 72% is almost always that or a stale line, not an edge. Checked lines never go into a built entry.
  function offLine(line, book) { return book != null && Math.abs(line - book) >= Math.max(2, 0.2 * book); }
  function picks(lines, appKey) {
    var out = [];
    lines.forEach(function (l) {
      var a = l.apps && l.apps[appKey]; if (!a) return;
      var more = a.pOver >= 0.5, p = more ? a.pOver : 1 - a.pOver;
      out.push(Object.assign({}, l, { app: appKey, line: a.line, side: more ? 'more' : 'less', p: p, pOurs: more ? a.pOurs : 1 - a.pOurs,
        check: offLine(a.line, l.bookLine) || p > 0.72 }));
    });
    return out.sort(function (x, y) { return y.p - x.p; });
  }

  // choose n picks: best chances first, one player once, one pick per game while there are enough games (picks
  // from the same game move together, which the payout math assumes they don't), and at least two teams (the
  // apps require it)
  function choose(list, n) {
    var used = {}, games = {}, out = [];
    [true, false].forEach(function (oneGame) {
      list.forEach(function (c) {
        if (out.length >= n || used[c.pid]) return;
        if (oneGame && games[c.gid]) return;
        out.push(c); used[c.pid] = 1; games[c.gid] = 1;
      });
    });
    if (out.length < n) return null;
    var teams = {}; out.forEach(function (c) { teams[c.team] = 1; });
    if (Object.keys(teams).length < 2) return null;
    return out;
  }

  // every size + type this app offers, built from the top picks; sorted by EV. opts.pay overrides the payouts
  // ({power:{n:m}, flex:{n:{hits:m}}}); opts.min drops picks below this chance.
  function build(list, appKey, opts) {
    opts = opts || {};
    var a = app(appKey), pay = opts.pay || a, pool = list.filter(function (c) { return !c.check && c.p >= (opts.min || 0); }), out = [];
    ['power', 'flex'].forEach(function (type) {
      Object.keys(pay[type] || {}).forEach(function (ns) {
        var n = +ns, t = payTable(pay, type, n); if (!t) return;
        var ch = choose(pool, n); if (!ch) return;
        var r = entry(ch.map(function (c) { return c.p; }), t);
        out.push({ app: appKey, type: type, n: n, pay: t, picks: ch, ev: r.ev, pAll: r.pAll, pCash: r.pCash, pProfit: r.pProfit, dist: r.dist, be: breakEven(t) });
      });
    });
    return out.sort(function (x, y) { return y.ev - x.ev; });
  }

  // the friendliest break-even this app offers (the bar a single pick has to clear to be worth playing anywhere)
  function bestBreakEven(appKey, pay) {
    var a = pay || app(appKey), best = null;
    ['power', 'flex'].forEach(function (type) { Object.keys(a[type] || {}).forEach(function (n) { var t = payTable(a, type, +n); if (!t) return; var be = breakEven(t); if (!best || be < best.be) best = { type: type, n: +n, be: be }; }); });
    return best;
  }

  g.TDCPickem = { APPS: APPS, app: app, label: label, payTable: payTable, dist: dist, entry: entry, breakEven: breakEven, bestBreakEven: bestBreakEven, picks: picks, build: build };
})(typeof window !== 'undefined' ? window : globalThis);
