/* tdc-fantasy-march.js — how many March games a team plays, simulated.
 *
 * TDCMarch.simulate(teams, opts) runs the postseason `sims` times from projected power ratings
 * (predictive_ratings: {full, conf, rating}) and returns, per simulated season, how many games each
 * team played in:
 *   conf  its conference tournament (single elimination, byes to the top seeds, seeded by rating)
 *   fw    the NCAA tournament's first weekend (round of 64 + round of 32)
 *   rest  the rest of the NCAA tournament (Sweet 16 through the title game)
 * The field is 64: every conference tournament winner plus the best-rated teams left. Each sim draws a
 * team's true strength around its rating (tau) and every game adds game-to-game noise (gameSD), so a
 * bubble team sometimes gets hot and a 2 seed sometimes goes home on Friday.
 *
 * The fantasy league (league.html) uses the per-sim games to price players on good teams and to play
 * out its own playoff bracket: a fantasy team stacked with players on teams that lose early runs out
 * of games before the stats reset.
 */
(function (g) {
  // the ratings carry a few leagues under their full name; one key per league
  var CONF_NORM = { 'Atlantic Sun Conference': 'ASUN', 'Big West Conference': 'Big West', 'Coastal Athletic Association': 'CAA',
    'Mid-American Conference': 'MAC', 'Mid-Eastern Athletic Conference': 'MEAC', 'Mountain West Conference': 'MWC',
    'Northeast Conference': 'NEC', 'Ohio Valley Conference': 'OVC', 'Patriot League': 'Patriot',
    'Southland Conference': 'Southland', 'Southwestern Athletic Conference': 'SWAC' };
  // NCAA region order of the 16 seeds, so 1 meets 16 and the 1/8/9 pod meets the 4/5/12/13 pod
  var REGION = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

  function rng(seed) {   // mulberry32 — same answer on every page load
    return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function gauss(R) { var u = 1 - R(), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  // bracket slots for n seeds padded to a power of two: [1,8,4,5,2,7,3,6] for 8 (top seeds meet the byes)
  function slots(p) { var s = [1]; while (s.length < p) { var m = s.length * 2 + 1, n = []; s.forEach(function (x) { n.push(x, m - x); }); s = n; } return s; }

  function simulate(teams, opts) {
    opts = opts || {};
    var sims = opts.sims || 2000, tau = opts.tau == null ? 4 : opts.tau, sd = opts.gameSD || 11, fieldN = opts.field || 64;
    var T = teams.filter(function (t) { return t && t.full && isFinite(+t.rating); });
    var n = T.length, idx = {};
    T.forEach(function (t, i) { idx[t.full] = i; });
    var confs = {};
    T.forEach(function (t, i) { var c = CONF_NORM[t.conf] || t.conf || '?'; (confs[c] = confs[c] || []).push(i); });
    var confList = Object.keys(confs).map(function (c) { return confs[c]; });
    var conf = new Uint8Array(sims * n), fw = new Uint8Array(sims * n), rest = new Uint8Array(sims * n);
    var bid = new Uint32Array(n), champ = new Uint32Array(n);
    var R = rng(opts.seed || 20270314), r = new Float64Array(n);
    var beats = function (a, b) { return r[a] - r[b] + sd * gauss(R) > 0; };

    for (var s = 0; s < sims; s++) {
      var off = s * n;
      for (var i = 0; i < n; i++) r[i] = +T[i].rating + tau * gauss(R);
      // conference tournaments
      var autos = [];
      for (var c = 0; c < confList.length; c++) {
        var mem = confList[c].slice().sort(function (a, b) { return r[b] - r[a]; });
        if (mem.length === 1) { autos.push(mem[0]); continue; }
        var p = 1; while (p < mem.length) p *= 2;
        var order = slots(p).map(function (sd_) { return sd_ <= mem.length ? mem[sd_ - 1] : -1; });
        while (order.length > 1) {
          var nx = [];
          for (var k = 0; k < order.length; k += 2) {
            var a = order[k], b = order[k + 1];
            if (a < 0) { nx.push(b); continue; } if (b < 0) { nx.push(a); continue; }
            conf[off + a]++; conf[off + b]++;
            nx.push(beats(a, b) ? a : b);
          }
          order = nx;
        }
        autos.push(order[0]);
      }
      // the field: every auto bid, then the best-rated teams left
      var inField = new Uint8Array(n), field = [];
      autos.forEach(function (a) { if (!inField[a]) { inField[a] = 1; field.push(a); } });
      var rest_ = []; for (i = 0; i < n; i++) if (!inField[i]) rest_.push(i);
      rest_.sort(function (a, b) { return r[b] - r[a]; });
      for (i = 0; field.length < fieldN && i < rest_.length; i++) { inField[rest_[i]] = 1; field.push(rest_[i]); }
      field.sort(function (a, b) { return r[b] - r[a]; });
      field.forEach(function (t) { bid[t]++; });
      // S-curve into four regions, then the standard 1-16 bracket in each
      var regions = [[], [], [], []];
      field.forEach(function (t, k) { var line = Math.floor(k / 4), pos = k % 4; regions[line % 2 ? 3 - pos : pos][line] = t; });
      var finalists = [];
      for (var g4 = 0; g4 < 4; g4++) {
        var br = REGION.map(function (seed) { return regions[g4][seed - 1]; }).filter(function (t) { return t != null; });
        var round = 0;
        while (br.length > 1) {
          var nx2 = [];
          for (k = 0; k < br.length; k += 2) {
            var x = br[k], y = br[k + 1];
            if (y == null) { nx2.push(x); continue; }
            var arr = round < 2 ? fw : rest; arr[off + x]++; arr[off + y]++;
            nx2.push(beats(x, y) ? x : y);
          }
          br = nx2; round++;
        }
        finalists.push(br[0]);
      }
      var semis = [[finalists[0], finalists[3]], [finalists[1], finalists[2]]], title = [];
      semis.forEach(function (m) { rest[off + m[0]]++; rest[off + m[1]]++; title.push(beats(m[0], m[1]) ? m[0] : m[1]); });
      rest[off + title[0]]++; rest[off + title[1]]++;
      champ[beats(title[0], title[1]) ? title[0] : title[1]]++;
    }
    var mean = {};
    T.forEach(function (t, i) {
      var a = 0, b = 0, c2 = 0; for (var s2 = 0; s2 < sims; s2++) { a += conf[s2 * n + i]; b += fw[s2 * n + i]; c2 += rest[s2 * n + i]; }
      mean[t.full] = { conf: a / sims, fw: b / sims, rest: c2 / sims, bid: bid[i] / sims, champ: champ[i] / sims };
    });
    return { sims: sims, n: n, idx: idx, conf: conf, fw: fw, rest: rest, mean: mean,
      games: function (full, s, which) { var i = idx[full]; if (i == null) return 0; var A = which === 'conf' ? conf : which === 'fw' ? fw : rest; return A[s * n + i]; } };
  }

  g.TDCMarch = { simulate: simulate, CONF_NORM: CONF_NORM };
  if (typeof module !== 'undefined') module.exports = g.TDCMarch;
})(typeof window !== 'undefined' ? window : globalThis);
