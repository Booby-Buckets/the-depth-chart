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
 *   TDCArb.stakes(a, b, total, round) → {sa, sb, payA, payB, profit, ret}   split a total stake across two sides
 *
 * Places: every sportsbook and exchange in the feed (exchange prices already have fees taken out). Pinnacle is
 * skipped — it's a reference line Americans can't bet. DFS pick'em apps pay fixed multipliers, so they can't arb.
 */
(function (g) {
  'use strict';
  var SIGMA = 11, TOTAL_SD = 16, NEAR = 0.01;
  var EXCH = { kalshi: 1, polymarket: 1, novig: 1, prophetx: 1, betopenly: 1, sporttrade: 1 };

  function dec(o) { return o == null || !isFinite(o) || o === 0 ? null : o > 0 ? 1 + o / 100 : 1 + 100 / -o; }
  function kind(k, b) { return (b && b.k) || (k === 'pinnacle' ? 'sharp' : EXCH[k] ? 'ex' : 'book'); }
  function phi(z) { var t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
  function sp(v) { return Math.abs(v) < 0.25 ? 'PK' : (v > 0 ? '+' : '−') + Math.abs(v); }

  // split `total` so both sides return the same; round = stake increment ($1, $5 …). Rounding can cost a little,
  // so profit is the worse of the two outcomes after rounding.
  function stakes(a, b, total, round) {
    var ia = 1 / a.dec, ib = 1 / b.dec, s = ia + ib, r = round || 0;
    var sa = total * ia / s, sb = total * ib / s;
    if (r) { sa = Math.max(r, Math.round(sa / r) * r); sb = Math.max(r, Math.round(sb / r) * r); }
    var payA = sa * a.dec, payB = sb * b.dec, staked = sa + sb, profit = Math.min(payA, payB) - staked;
    return { sa: sa, sb: sb, payA: payA, payB: payB, staked: staked, profit: profit, ret: profit / staked };
  }

  function scan(games, opts) {
    opts = opts || {};
    var now = opts.now || Date.now(), maxAge = opts.maxAgeMin ? opts.maxAgeMin * 60000 : null, only = opts.books && opts.books.length ? opts.books : null;
    var sig = opts.sigma || SIGMA, tsd = opts.totalSd || TOTAL_SD;
    var arbs = [], middles = [], near = [];

    (games || []).forEach(function (x) {
      if (x.commence && Date.parse(x.commence) <= now) return;              // tipped: live prices aren't in the feed
      var books = x.books || {}, game = x.away + ' @ ' + x.home, base = Date.parse(x.snapshot || x.ev_snapshot || x.generated || '') || null;
      var ok = function (k) { if (kind(k, books[k]) === 'sharp' || (!books[k] && k === 'pinnacle')) return false; return !only || only.indexOf(k) >= 0; };
      var ageOf = function (k, ev) { var t = (books[k] && books[k].u && Date.parse(books[k].u)) || (ev ? Date.parse(x.ev_snapshot || '') : null) || base; return t ? now - t : null; };
      var fresh = function (age) { return !maxAge || age == null || age <= maxAge; };
      var title = function (k) { return (books[k] && books[k].t) || k; };
      var slots = {};
      // one two-way market at one number: side a / side b, every place's price
      function add(key, meta, k, pa, pb, ev) {
        if (!ok(k)) return;
        var age = ageOf(k, ev); if (!fresh(age)) return;
        var s = slots[key] || (slots[key] = { meta: meta, a: [], b: [] });
        var da = dec(pa), db = dec(pb);
        if (da) s.a.push({ book: k, bookT: title(k), price: pa, dec: da, age: age });
        if (db) s.b.push({ book: k, bookT: title(k), price: pb, dec: db, age: age });
      }
      Object.keys(books).forEach(function (k) {
        var b = books[k];
        if (b.sp && b.sp[0] != null) add('sp|' + b.sp[0], { market: 'spread', pt: b.sp[0] }, k, b.sp[1], b.sp[2]);
        if (b.to && b.to[0] != null) add('to|' + b.to[0], { market: 'total', pt: b.to[0] }, k, b.to[1], b.to[2]);
        if (b.ml) add('ml', { market: 'ml' }, k, b.ml[0], b.ml[1]);
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
        if (m.market === 'tt') { var t = m.team === 'home' ? x.home : x.away; return [t + ' team total O ' + m.pt, t + ' team total U ' + m.pt]; }
        if (m.market === 'h1') return m.sub === 'sp' ? ['1H ' + x.home + ' ' + sp(m.pt), '1H ' + x.away + ' ' + sp(-m.pt)] : ['1H Over ' + m.pt, '1H Under ' + m.pt];
        return [m.player + ' O ' + m.pt + ' ' + m.stat, m.player + ' U ' + m.pt + ' ' + m.stat];
      }
      var best = function (list) { return list.slice().sort(function (p, q) { return q.dec - p.dec; })[0]; };

      // ── arbs: same number, both sides ──
      Object.keys(slots).forEach(function (key) {
        var s = slots[key], a = best(s.a), b = best(s.b); if (!a || !b) return;
        var sum = 1 / a.dec + 1 / b.dec, L = labels(s.meta);
        var o = { game: game, gid: x.id, home: x.home, away: x.away, commence: x.commence, market: s.meta.market, meta: s.meta,
          a: Object.assign({ label: L[0] }, a), b: Object.assign({ label: L[1] }, b), sum: sum, ret: 1 / sum - 1, sameBook: a.book === b.book,
          places: s.a.length + s.b.length, age: Math.max(a.age || 0, b.age || 0) };
        if (sum < 1) arbs.push(o); else if (sum - 1 <= NEAR) near.push(o);
      });

      // ── middles: spreads + totals at two different numbers ──
      var mu = x.spread != null ? -x.spread : null, tm = x.total != null ? x.total : null;
      function pmf(mean, sd) { var out = [], lo = Math.floor(mean - 5 * sd), hi = Math.ceil(mean + 5 * sd); for (var k = lo; k <= hi; k++) out.push([k, phi((k + 0.5 - mean) / sd) - phi((k - 0.5 - mean) / sd)]); return out; }
      function middle(fam, sideA, sideB, ptA, ptB, a, b, dist, winA, winB) {
        // equal-return stakes per $1; walk every final score: win pays stake x (dec − 1), push refunds, loss costs the stake
        var ia = 1 / a.dec, ib = 1 / b.dec, s = ia + ib, sa = ia / s, sb = ib / s, ev = 0, worst = Infinity, pBoth = 0;
        dist.forEach(function (d) {
          var ra = winA(d[0]), rb = winB(d[0]);
          var res = (ra > 0 ? sa * (a.dec - 1) : ra < 0 ? -sa : 0) + (rb > 0 ? sb * (b.dec - 1) : rb < 0 ? -sb : 0);
          ev += d[1] * res; if (d[1] > 1e-4) worst = Math.min(worst, res); if (ra > 0 && rb > 0) pBoth += d[1];
        });
        middles.push({ game: game, gid: x.id, home: x.home, away: x.away, commence: x.commence, market: fam,
          a: Object.assign({ label: sideA }, a), b: Object.assign({ label: sideB }, b), ptA: ptA, ptB: ptB, width: Math.abs(ptA - ptB),
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
