/* bet-arb.js — TDC Bet's arbitrage scanner. Pure math over the odds feed (scripts/data/odds_live.json shape, plus the
 * free live DraftKings / Kalshi / Polymarket games bet-edge.js merges in). No DOM, no model: an arb doesn't care
 * what we think will happen.
 *
 *   TDCArb.scan(games, opts) → {arbs, middles, near}
 *     arbs     two sides of the same bet at different places whose prices add up to less than 100%: back both
 *              in the right amounts and you're paid the same whatever happens. ret = guaranteed return on the stake.
 *     middles  the same market at two different numbers (home −3 at one book, away +5 at another): the game can
 *              land between them and BOTH win; otherwise one wins and one loses, a small cost. Priced on a normal
 *              around the market's own line (spread sd 11, total sd 16, integer scores so pushes count).
 *              noLose = even the worst outcome is ≥ 0, i.e. it's also an arb.
 *     near     no arb, but the best prices leave the books under 1% (useful to watch; one move away)
 *   opts: {books: [keys] only these places · maxAgeMin: drop prices older than this · now: ms · sigma · totalSd}
 *
 *   TDCArb.stakes(legs, total, round) → {st: [stake…], pay: [return…], staked, profit, ret}   split a total stake so
 *                                       every outcome returns the same (2-way, or 3-way like soccer home/draw/away)
 *
 * Every sport the feed carries (game.sport = the-odds-api key; missing = college basketball). Middles only where
 * scores are high enough for a normal curve to mean something (basketball, football; MID below) — never hockey,
 * baseball or soccer.
 *
 * Places: every sportsbook and exchange in the feed (exchange prices already have fees taken out). Pinnacle is
 * skipped — it's a reference line Americans can't bet. DFS pick'em apps pay fixed multipliers, so they can't arb.
 */
(function (g) {
  'use strict';
  var NEAR = 0.01;
  // margin / total standard deviations for middles, by sport (football's key numbers make this rougher)
  var MID = { basketball_ncaab: { m: 11, t: 16 }, basketball_nba: { m: 12, t: 18 }, basketball_wnba: { m: 11, t: 15 },
    americanfootball_nfl: { m: 13.5, t: 13.5 }, americanfootball_ncaaf: { m: 15.5, t: 16.5 } };
  var EXCH = { kalshi: 1, polymarket: 1, novig: 1, prophetx: 1, betopenly: 1, sporttrade: 1 };

  function dec(o) { return o == null || !isFinite(o) || o === 0 ? null : o > 0 ? 1 + o / 100 : 1 + 100 / -o; }
  function kind(k, b) { return (b && b.k) || (k === 'pinnacle' ? 'sharp' : EXCH[k] ? 'ex' : 'book'); }
  function phi(z) { var t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
  function sp(v) { return Math.abs(v) < 0.25 ? 'PK' : (v > 0 ? '+' : '−') + Math.abs(v); }

  // split `total` so every outcome returns the same; round = stake increment ($1, $5 …). Rounding can cost a little,
  // so profit is the worst outcome after rounding.
  function stakes(legs, total, round) {
    var inv = legs.map(function (l) { return 1 / l.dec; }), s = inv.reduce(function (a, b) { return a + b; }, 0), r = round || 0;
    var st = inv.map(function (i) { var v = total * i / s; return r ? Math.max(r, Math.round(v / r) * r) : v; });
    var pay = st.map(function (v, i) { return v * legs[i].dec; }), staked = st.reduce(function (a, b) { return a + b; }, 0);
    var profit = Math.min.apply(null, pay) - staked;
    return { st: st, pay: pay, staked: staked, profit: profit, ret: profit / staked };
  }
  function statName(m) { return String(m || '').replace(/^player_/, '').replace(/_alternate$/, '').replace(/_/g, ' '); }

  function scan(games, opts) {
    opts = opts || {};
    var now = opts.now || Date.now(), maxAge = opts.maxAgeMin ? opts.maxAgeMin * 60000 : null, only = opts.books && opts.books.length ? opts.books : null;
    var arbs = [], middles = [], near = [];

    (games || []).forEach(function (x) {
      if (x.commence && Date.parse(x.commence) <= now) return;              // tipped: live prices aren't in the feed
      var sport = x.sport || 'basketball_ncaab', books = x.books || {}, game = x.away + ' @ ' + x.home, base = Date.parse(x.snapshot || x.ev_snapshot || x.generated || '') || null;
      var ok = function (k) { if (kind(k, books[k]) === 'sharp' || (!books[k] && k === 'pinnacle')) return false; return !only || only.indexOf(k) >= 0; };
      var ageOf = function (k, ev) { var t = (books[k] && books[k].u && Date.parse(books[k].u)) || (ev ? Date.parse(x.ev_snapshot || '') : null) || base; return t ? now - t : null; };
      var fresh = function (age) { return !maxAge || age == null || age <= maxAge; };
      var title = function (k) { return (books[k] && books[k].t) || k; };
      var slots = {};
      // one market at one number: every outcome (2, or 3 for home/draw/away), every place's price
      function add(key, meta, k, pa, pb, ev, pc) {
        if (!ok(k)) return;
        var age = ageOf(k, ev); if (!fresh(age)) return;
        var px = pc === undefined ? [pa, pb] : [pa, pc, pb];
        var s = slots[key] || (slots[key] = { meta: meta, sides: px.map(function () { return []; }) });
        if (s.sides.length !== px.length) return;
        px.forEach(function (p, i) { var d = dec(p); if (d) s.sides[i].push({ book: k, bookT: title(k), price: p, dec: d, age: age }); });
        s.a = s.sides[0]; s.b = s.sides[s.sides.length - 1];
      }
      Object.keys(books).forEach(function (k) {
        var b = books[k];
        if (b.sp && b.sp[0] != null) add('sp|' + b.sp[0], { market: 'spread', pt: b.sp[0] }, k, b.sp[1], b.sp[2]);
        if (b.to && b.to[0] != null) add('to|' + b.to[0], { market: 'total', pt: b.to[0] }, k, b.to[1], b.to[2]);
        if (b.ml && b.ml.length === 3) add('ml3', { market: 'ml3' }, k, b.ml[0], b.ml[2], false, b.ml[1]);   // [home, draw, away]
        else if (b.ml) add('ml', { market: 'ml' }, k, b.ml[0], b.ml[1]);
      });
      Object.keys(x.alt || {}).forEach(function (k) {
        (x.alt[k].sp || []).forEach(function (v) { add('sp|' + v[0], { market: 'spread', pt: v[0], alt: true }, k, v[1], v[2], true); });
        (x.alt[k].to || []).forEach(function (v) { add('to|' + v[0], { market: 'total', pt: v[0], alt: true }, k, v[1], v[2], true); });
      });
      Object.keys(x.tt || {}).forEach(function (k) {
        ['home', 'away'].forEach(function (side) { var v = x.tt[k][side]; if (v && v[0] != null) add('tt:' + side + '|' + v[0], { market: 'tt', team: side, pt: v[0] }, k, v[1], v[2], true); });
      });
      Object.keys(x.h1 || {}).forEach(function (k) {
        var h = x.h1[k];
        if (h.sp && h.sp[0] != null) add('h1sp|' + h.sp[0], { market: 'h1', sub: 'sp', pt: h.sp[0] }, k, h.sp[1], h.sp[2], true);
        if (h.to && h.to[0] != null) add('h1to|' + h.to[0], { market: 'h1', sub: 'to', pt: h.to[0] }, k, h.to[1], h.to[2], true);
      });
      (x.props || []).forEach(function (pp) {
        var who = pp.p || pp.pid; if (!who) return;
        Object.keys(pp.b || {}).forEach(function (k) { var v = pp.b[k]; if (v && v[0] != null) add('pr|' + who + '|' + pp.m + '|' + v[0], { market: 'prop', player: who, pid: pp.pid, stat: pp.m, pt: v[0] }, k, v[1], v[2], true); });
      });

      function labels(m) {
        if (m.market === 'spread') return [x.home + ' ' + sp(m.pt), x.away + ' ' + sp(-m.pt)];
        if (m.market === 'total') return ['Over ' + m.pt, 'Under ' + m.pt];
        if (m.market === 'ml') return [x.home + ' ML', x.away + ' ML'];
        if (m.market === 'ml3') return [x.home + ' to win', 'Draw', x.away + ' to win'];
        if (m.market === 'tt') { var t = m.team === 'home' ? x.home : x.away; return [t + ' team total O ' + m.pt, t + ' team total U ' + m.pt]; }
        if (m.market === 'h1') return m.sub === 'sp' ? ['1H ' + x.home + ' ' + sp(m.pt), '1H ' + x.away + ' ' + sp(-m.pt)] : ['1H Over ' + m.pt, '1H Under ' + m.pt];
        return [m.player + ' O ' + m.pt + ' ' + statName(m.stat), m.player + ' U ' + m.pt + ' ' + statName(m.stat)];
      }
      var best = function (list) { return list.slice().sort(function (p, q) { return q.dec - p.dec; })[0]; };

      // ── arbs: same number, every outcome ──
      Object.keys(slots).forEach(function (key) {
        var s = slots[key], L = labels(s.meta), legs = s.sides.map(best);
        if (legs.some(function (l) { return !l; })) return;
        legs = legs.map(function (l, i) { return Object.assign({ label: L[i] }, l); });
        var sum = legs.reduce(function (t, l) { return t + 1 / l.dec; }, 0), bks = {};
        legs.forEach(function (l) { bks[l.book] = 1; });
        var o = { game: game, gid: x.id, sport: sport, sportT: x.sportT || null, home: x.home, away: x.away, commence: x.commence, market: s.meta.market, meta: s.meta,
          legs: legs, a: legs[0], b: legs[legs.length - 1], sum: sum, ret: 1 / sum - 1, sameBook: Object.keys(bks).length < legs.length,
          age: Math.max.apply(null, legs.map(function (l) { return l.age || 0; })) };
        if (sum < 1) arbs.push(o); else if (sum - 1 <= NEAR) near.push(o);
      });

      // ── middles: spreads + totals at two different numbers ──
      var mid = MID[sport], sig = mid && mid.m, tsd = mid && mid.t;
      var mu = mid && x.spread != null ? -x.spread : null, tm = mid && x.total != null ? x.total : null;
      function pmf(mean, sd) { var out = [], lo = Math.floor(mean - 5 * sd), hi = Math.ceil(mean + 5 * sd); for (var k = lo; k <= hi; k++) out.push([k, phi((k + 0.5 - mean) / sd) - phi((k - 0.5 - mean) / sd)]); return out; }
      function middle(fam, sideA, sideB, ptA, ptB, a, b, dist, winA, winB) {
        // equal-return stakes per $1; walk every final score: win pays stake x (dec − 1), push refunds, loss costs the stake
        var ia = 1 / a.dec, ib = 1 / b.dec, s = ia + ib, sa = ia / s, sb = ib / s, ev = 0, worst = Infinity, pBoth = 0;
        dist.forEach(function (d) {
          var ra = winA(d[0]), rb = winB(d[0]);
          var res = (ra > 0 ? sa * (a.dec - 1) : ra < 0 ? -sa : 0) + (rb > 0 ? sb * (b.dec - 1) : rb < 0 ? -sb : 0);
          ev += d[1] * res; if (d[1] > 1e-4) worst = Math.min(worst, res); if (ra > 0 && rb > 0) pBoth += d[1];
        });
        var la = Object.assign({ label: sideA }, a), lb = Object.assign({ label: sideB }, b);
        middles.push({ game: game, gid: x.id, sport: sport, sportT: x.sportT || null, legs: [la, lb], home: x.home, away: x.away, commence: x.commence, market: fam,
          a: la, b: lb, ptA: ptA, ptB: ptB, width: Math.abs(ptA - ptB),
          ev: ev, worst: worst, pBoth: pBoth, noLose: worst >= -1e-9, age: Math.max(a.age || 0, b.age || 0) });
      }
      var spK = Object.keys(slots).filter(function (k) { return k.indexOf('sp|') === 0; }), toK = Object.keys(slots).filter(function (k) { return k.indexOf('to|') === 0; });
      if (mu != null) {
        var dm = pmf(mu, sig);
        spK.forEach(function (ka) { spK.forEach(function (kb) {
          var hA = slots[ka].meta.pt, hB = slots[kb].meta.pt; if (!(hA > hB)) return;      // home at hA + away at hB: both win when −hA < margin < −hB
          var a = best(slots[ka].a), b = best(slots[kb].b); if (!a || !b) return;
          middle('spread', x.home + ' ' + sp(hA), x.away + ' ' + sp(-hB), hA, hB, a, b, dm,
            function (m) { return m + hA; }, function (m) { return -(m + hB); });
        }); });
      }
      if (tm != null) {
        var dt = pmf(tm, tsd);
        toK.forEach(function (ka) { toK.forEach(function (kb) {
          var pA = slots[ka].meta.pt, pB = slots[kb].meta.pt; if (!(pA < pB)) return;      // over pA + under pB: both win when pA < total < pB
          var a = best(slots[ka].a), b = best(slots[kb].b); if (!a || !b) return;
          middle('total', 'Over ' + pA, 'Under ' + pB, pA, pB, a, b, dt,
            function (t) { return t - pA; }, function (t) { return pB - t; });
        }); });
      }
    });

    arbs.sort(function (p, q) { return q.ret - p.ret; });
    near.sort(function (p, q) { return p.sum - q.sum; });
    // a middle is worth showing when it's no-lose, or its expected value is positive
    middles = middles.filter(function (m) { return m.noLose || m.ev > 0; }).sort(function (p, q) { return (q.noLose - p.noLose) || (q.ev - p.ev); });
    return { arbs: arbs, middles: middles, near: near };
  }

  g.TDCArb = { scan: scan, stakes: stakes, dec: dec };
})(typeof window !== 'undefined' ? window : globalThis);
