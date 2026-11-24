/* tdc-resume.js — STRENGTH OF SCHEDULE and STRENGTH OF RECORD, one definition for every page
 * (owner, Nov 24 2026: "We need to have a SOS and SOR they both are important").
 *
 *   SOS  how hard the games were: the average current Power Rating of the D-I teams played so far. Ignores the results.
 *   SOR  how good the record is given those games: hand this team's exact schedule (opponents + venues) to an average
 *        top-25 team and work out the odds of every record it could post. SOR = the chance (0-100) it would have FEWER wins
 *        (an equal record counts half), so 50 = what a top-25 team would do. Margin does not matter, only W-L.
 *        extra = wins above what that top-25 team would expect (the same idea in wins).
 * Non-D-I opponents count for SOR (a loss to one hurts, a win is worth almost nothing), not for SOS.
 *
 *   TDC_RESUME.compute(rows, games)   rows [{full, rating, hcaOff}] current ratings; games [{home, away, home_score, away_score, neutral}]
 *     -> { byTeam: {full: {sos, sosRk, sor, sorRk, extra, w, l, n}}, ref }
 *   TDC_RESUME.live()                 published ratings + every known final, the same re-solve the rankings page does
 */
(function (g) {
  if (g.TDC_RESUME) return;
  var NON_D1 = -22;
  function compute(rows, games) {
    var R = g.TDC_RATINGS, SIG = R.SIGMA || 11, by = {}, log = {};
    rows.forEach(function (r) { by[r.full] = r; });
    var srt = rows.slice().sort(function (a, b) { return b.rating - a.rating; }).slice(19, 30);      // ranks 20-30: an average top-25 team's level
    var ref = srt.reduce(function (s, r) { return s + r.rating; }, 0) / (srt.length || 1);
    games.forEach(function (x) {
      if (x.home_score == null || x.away_score == null || x.home_score === x.away_score) return;
      var h = by[x.home], a = by[x.away]; if (!h && !a) return;
      var hr = h ? h.rating : NON_D1, ar = a ? a.rating : NON_D1, hw = x.home_score > x.away_score;
      // the top-25 team's margin in this team's shoes: at home it gets this building's edge, on the road the host's
      if (h) (log[x.home] = log[x.home] || []).push({ o: a ? ar : null, w: hw, m: ref - ar + (x.neutral ? 0 : R.baseHca(ar) + (h.hcaOff || 0)) });
      if (a) (log[x.away] = log[x.away] || []).push({ o: h ? hr : null, w: !hw, m: ref - hr - (x.neutral ? 0 : R.baseHca(ref) + ((h && h.hcaOff) || 0)) });
    });
    var out = {}, L = [];
    Object.keys(log).forEach(function (t) {
      var G = log[t], w = 0, e = 0, dist = [1], so = 0, sn = 0;
      G.forEach(function (x) {
        var p = R.phi((R.tame ? R.tame(x.m) : x.m) / SIG); e += p; if (x.w) w++;
        if (x.o != null) { so += x.o; sn++; }
        var nd = new Array(dist.length + 1).fill(0);
        dist.forEach(function (q, k) { nd[k] += q * (1 - p); nd[k + 1] += q * p; });
        dist = nd;
      });
      var below = 0; for (var k = 0; k < w; k++) below += dist[k];
      out[t] = { w: w, l: G.length - w, n: G.length, extra: w - e, sos: sn ? so / sn : null, sor: 100 * (below + dist[w] / 2) };
      L.push(t);
    });
    L.filter(function (t) { return out[t].sos != null; }).sort(function (a, b) { return out[b].sos - out[a].sos; }).forEach(function (t, i) { out[t].sosRk = i + 1; });
    L.slice().sort(function (a, b) { return out[b].sor - out[a].sor || out[b].extra - out[a].extra; }).forEach(function (t, i) { out[t].sorRk = i + 1; });
    return { byTeam: out, ref: ref, n: L.length };
  }
  function live() {
    if (!g.TDC_RATINGS || !g.TDCSched) return Promise.resolve(null);
    return Promise.all([g.TDC_RATINGS.get(), g.TDCSched.load()]).then(function (x) {
      var D = x[0], RES = g.TDCSched.sim.results() || {};
      if (!D || !D.teams) return null;
      var games = Object.values(RES).filter(function (r) { return r.hs != null && r.as != null; }).map(function (r) { return { home: r.home, away: r.away, home_score: r.hs, away_score: r.as, neutral: r.neutral }; });
      if (!games.length) return null;
      var rows = D.teams.map(function (r) { return { full: r.full, rating: r.preRating != null ? r.preRating : r.rating, hcaOff: r.hcaOff || 0 }; });
      g.TDC_RATINGS.applyForm(rows, games);
      return compute(rows, games);
    }).catch(function () { return null; });
  }
  g.TDC_RESUME = { compute: compute, live: live };
})(window);
