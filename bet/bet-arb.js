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

  // the biggest total stake the shown prices hold for: each exchange leg that reports its size caps the total at
  // size ÷ that leg's share of the stake. null = no leg reports a size (sportsbooks don't; they limit accounts)
  function capOf(legs) {
    var inv = legs.map(function (l) { return 1 / l.dec; }), s = inv.reduce(function (a, b) { return a + b; }, 0), cap = null;
    legs.forEach(function (l, i) { if (l.cap != null && isFinite(l.cap)) { var c = l.cap / (inv[i] / s); cap = cap == null ? c : Math.min(cap, c); } });
    return cap;
  }

  // ── depth: how much an arb really takes once you walk each exchange's order book ──
  // ladders[i] = [[cost per contract incl. fee, contracts], …] cheapest first, or null for a sportsbook leg (its
  // posted price, no size limit we can see). Every outcome pays the same P dollars (P contracts at $1 each);
  // profit(P) = P − Σ cost to buy P on each leg. Returns the best profit, the stake that gets it, and the most you
  // can stake before the arb stops paying.
  function fill(legs, ladders) {
    function costFor(i, P) {
      var lad = ladders[i]; if (!lad) return P / legs[i].dec;
      var left = P, c = 0;
      for (var j = 0; j < lad.length && left > 1e-9; j++) { var q = Math.min(left, lad[j][1]); c += q * lad[j][0]; left -= q; }
      return left > 1e-9 ? Infinity : c;
    }
    // profit only changes slope where some ladder steps, so check every step's cumulative size
    var marks = [0];
    ladders.forEach(function (lad) { var t = 0; (lad || []).forEach(function (r) { t += r[1]; marks.push(t); }); });
    marks = marks.filter(function (v, i, a) { return v > 0 && a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    var best = { P: 0, profit: 0, stake: 0 }, maxStake = 0, prev = 0;
    for (var m = 0; m < marks.length; m++) {
      var P = marks[m], C = legs.reduce(function (t, l, i) { return t + costFor(i, P); }, 0);
      if (!isFinite(C)) break;
      if (P - C > best.profit) best = { P: P, profit: P - C, stake: C };
      if (P - C >= 0) maxStake = C; else { break; }
      prev = P;
    }
    // the last step that still paid may pay part-way into the next one: profit is linear inside a step
    if (prev && m < marks.length) {
      var lo = prev, hi = marks[m];
      for (var it = 0; it < 40; it++) { var mid = (lo + hi) / 2, Cm = legs.reduce(function (t, l, i) { return t + costFor(i, mid); }, 0); if (isFinite(Cm) && mid - Cm >= 0) { lo = mid; maxStake = Cm; } else hi = mid; }
    }
    var noLadder = ladders.every(function (l) { return !l; });
    return { bestProfit: best.profit, bestStake: best.stake, bestRet: best.stake ? best.profit / best.stake : 0, maxStake: noLadder ? null : maxStake, payout: best.P };
  }

  // ── joining feeds: the same game from the paid sportsbook feed, Kalshi and Polymarket ──
  // names differ by place ("Los Angeles Lakers" / "Los Angeles L" / "LA Lakers" / "Lakers"), so a team matches when
  // its words line up from the front (each a prefix of the other's: "ind colts" ~ "indianapolis colts") or, in the
  // pros, when the nickname matches. A game joins only when BOTH teams match and the start is within a day and a half.
  function words(n) { return String(n || '').toLowerCase().replace(/&/g, ' and ').replace(/\bst\.?(?=\s|$)/g, 'state').replace(/\b(fc|afc|cf|sc|the|university|univ|of)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean); }
  function teamMatch(a, b, pro) {
    var A = words(a), B = words(b); if (!A.length || !B.length) return false;
    if (A.join(' ') === B.join(' ')) return true;
    var s = A.length <= B.length ? A : B, l = s === A ? B : A, front = true;
    for (var i = 0; i < s.length; i++) if (l[i].indexOf(s[i]) !== 0 && s[i].indexOf(l[i]) !== 0) { front = false; break; }
    if (front && (s.length > 1 || s[0].length >= 4 || s[0] === l[0])) return true;
    return !!pro && A[A.length - 1] === B[B.length - 1] && A[A.length - 1].length >= 4;
  }
  function anyMatch(list, names, pro) { return (list || []).some(function (a) { return names.some(function (b) { return teamMatch(a, b, pro); }); }); }
  // swap a book's home/away (a place that lists the teams the other way round)
  function flipBook(b) {
    var o = Object.assign({}, b);
    if (b.ml) o.ml = b.ml.length === 3 ? [b.ml[2], b.ml[1], b.ml[0]] : [b.ml[1], b.ml[0]];
    if (b.sp) o.sp = [-b.sp[0], b.sp[2], b.sp[1]];
    ['cap', 'ref'].forEach(function (f) { if (!b[f]) return; o[f] = {}; Object.keys(b[f]).forEach(function (m) { var v = b[f][m]; o[f][m] = !v ? v : m === 'to' ? v : v.length === 3 ? [v[2], v[1], v[0]] : [v[1], v[0]]; }); });
    return o;
  }
  function flipAlt(a) { return { sp: (a.sp || []).map(function (v) { return [-v[0], v[2], v[1], v[4], v[3], v[6], v[5]]; }), to: a.to || [] }; }
  // base = games already on the board for this sport; pm = /api/pm games (one per exchange per game). Each joins a
  // base game (its books replace that exchange's older feed prices) or, failing that, groups with the other exchange's
  // copy of the same game as a prediction-markets-only game. Returns the extra games to add (base games are copied
  // where touched, never mutated).
  function join(base, pm, sport) {
    var pro = !/ncaa/.test(sport || ''), out = base.slice(), extra = [], hours = function (a, b) { return Math.abs(Date.parse(a) - Date.parse(b)) / 3600e3; };
    (pm || []).forEach(function (g) {
      var nh = (g.names && g.names.home) || [g.home], na = (g.names && g.names.away) || [g.away], src = g.src;
      function find(list) {
        for (var i = 0; i < list.length; i++) {
          var x = list[i]; if (x.commence && g.commence && hours(x.commence, g.commence) > 36) continue;
          var xh = x._names ? x._names.home : [x.home], xa = x._names ? x._names.away : [x.away];
          if (anyMatch(xh, nh, pro) && anyMatch(xa, na, pro)) return { list: list, i: i, flip: false };
          if (anyMatch(xh, na, pro) && anyMatch(xa, nh, pro)) return { list: list, i: i, flip: true };
        }
        return null;
      }
      var hit = find(out) || find(extra);
      var book = Object.assign({ u: g.book.u }, g.book), alt = g.alt;
      if (hit) {
        if (hit.flip) { book = flipBook(book); alt = flipAlt(alt); }
        var x = Object.assign({}, hit.list[hit.i]);
        x.books = Object.assign({}, x.books); x.books[src] = book;
        x.alt = Object.assign({}, x.alt); x.alt[src] = alt;
        if (x.tt && x.tt[src]) { x.tt = Object.assign({}, x.tt); delete x.tt[src]; }
        if (x.pmOnly && !g.approx) x.commence = g.commence;   // Polymarket knows the real start; Kalshi's is estimated
        hit.list[hit.i] = x;
      } else {
        var bk = {}, al = {}; bk[src] = book; al[src] = alt;
        extra.push({ id: 'pm:' + g.id, commence: g.commence, home: g.home, away: g.away, _names: { home: nh, away: na }, books: bk, alt: al, sport: sport, pmOnly: true, snapshot: g.book.u });
      }
    });
    return out.concat(extra);
  }

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
      // one market at one number: every outcome (2, or 3 for home/draw/away), every place's price. cap = dollars
      // on offer at that price (exchanges that report size), ref = the exchange contract (for the depth check)
      function add(key, meta, k, px, ev, cap, ref) {
        if (!ok(k)) return;
        var age = ageOf(k, ev); if (!fresh(age)) return;
        var s = slots[key] || (slots[key] = { meta: meta, sides: px.map(function () { return []; }) });
        if (s.sides.length !== px.length) return;
        px.forEach(function (p, i) { var d = dec(p); if (d) s.sides[i].push({ book: k, bookT: title(k), price: p, dec: d, age: age, ex: kind(k, books[k]) === 'ex', cap: cap ? cap[i] : null, ref: ref ? ref[i] : null }); });
        s.a = s.sides[0]; s.b = s.sides[s.sides.length - 1];
      }
      var at = function (o, f) { return o && o[f] ? o[f] : null; };
      Object.keys(books).forEach(function (k) {
        var b = books[k];
        if (b.sp && b.sp[0] != null) add('sp|' + b.sp[0], { market: 'spread', pt: b.sp[0] }, k, [b.sp[1], b.sp[2]], false, at(b.cap, 'sp'), at(b.ref, 'sp'));
        if (b.to && b.to[0] != null) add('to|' + b.to[0], { market: 'total', pt: b.to[0] }, k, [b.to[1], b.to[2]], false, at(b.cap, 'to'), at(b.ref, 'to'));
        if (b.ml && b.ml.length === 3) add('ml3', { market: 'ml3' }, k, b.ml, false, at(b.cap, 'ml'), at(b.ref, 'ml'));   // [home, draw, away]
        else if (b.ml) add('ml', { market: 'ml' }, k, b.ml, false, at(b.cap, 'ml'), at(b.ref, 'ml'));
      });
      // alternate rungs: [pt, price, price] (+ [cap, cap, ref, ref] from the prediction-market feed)
      Object.keys(x.alt || {}).forEach(function (k) {
        (x.alt[k].sp || []).forEach(function (v) { add('sp|' + v[0], { market: 'spread', pt: v[0], alt: true }, k, [v[1], v[2]], true, v.length > 3 ? [v[3], v[4]] : null, v.length > 5 ? [v[5], v[6]] : null); });
        (x.alt[k].to || []).forEach(function (v) { add('to|' + v[0], { market: 'total', pt: v[0], alt: true }, k, [v[1], v[2]], true, v.length > 3 ? [v[3], v[4]] : null, v.length > 5 ? [v[5], v[6]] : null); });
      });
      Object.keys(x.tt || {}).forEach(function (k) {
        ['home', 'away'].forEach(function (side) { var v = x.tt[k][side]; if (v && v[0] != null) add('tt:' + side + '|' + v[0], { market: 'tt', team: side, pt: v[0] }, k, [v[1], v[2]], true); });
      });
      Object.keys(x.h1 || {}).forEach(function (k) {
        var h = x.h1[k];
        if (h.sp && h.sp[0] != null) add('h1sp|' + h.sp[0], { market: 'h1', sub: 'sp', pt: h.sp[0] }, k, [h.sp[1], h.sp[2]], true);
        if (h.to && h.to[0] != null) add('h1to|' + h.to[0], { market: 'h1', sub: 'to', pt: h.to[0] }, k, [h.to[1], h.to[2]], true);
      });
      (x.props || []).forEach(function (pp) {
        var who = pp.p || pp.pid; if (!who) return;
        Object.keys(pp.b || {}).forEach(function (k) { var v = pp.b[k]; if (v && v[0] != null) add('pr|' + who + '|' + pp.m + '|' + v[0], { market: 'prop', player: who, pid: pp.pid, stat: pp.m, pt: v[0] }, k, [v[1], v[2]], true); });
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
          allEx: legs.every(function (l) { return l.ex; }), cap: capOf(legs),
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
          ev: ev, worst: worst, pBoth: pBoth, noLose: worst >= -1e-9, allEx: !!(a.ex && b.ex), cap: capOf([la, lb]), age: Math.max(a.age || 0, b.age || 0) });
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

  g.TDCArb = { scan: scan, stakes: stakes, dec: dec, fill: fill, join: join, teamMatch: teamMatch };
})(typeof window !== 'undefined' ? window : globalThis);
