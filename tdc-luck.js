/* tdc-luck.js — the Team Luck model in the browser (owner, Nov 22 2026: luck should cover turnovers and every swingy
   stat that is or isn't going a team's way). Same math as scripts/build_luck.py luck_box():
     for each stat (own/opp 3P%, 2P%, FT%, turnovers, rebounds) luck = m x (1 - R) x (rate - D-I avg) x attempts x points,
     R = tv / (tv + c / attempts) = how much of a rate is real at that sample, m = calibrated share that really goes away.
   Data: scripts/data/luck_model.json (stats {k: tv c m}, leagues {season: D-I rates}, table).
   TDCLuck.ready() -> Promise; TDCLuck.box(o, d, season) -> {off, def} points (+ = lucky) or null before it loads.
   Boxes use the lineup field names: pts fga fgm tpa tpm fta ftm orb drb tov. */
(function () {
  if (window.TDCLuck) return;
  var M = null, P = null;
  function ready() {
    if (M) return Promise.resolve(M);
    if (!P) P = fetch('scripts/data/luck_model.json?v=1').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { M = j; return j; });
    return P;
  }
  function counts(b, other) {
    return { tpm: b.tpm, tpa: b.tpa, twom: b.fgm - b.tpm, twoa: b.fga - b.tpa, ftm: b.ftm, fta: b.fta, tov: b.tov,
      poss: Math.max(1e-9, b.fga - b.orb + b.tov + 0.44 * b.fta), orb: b.orb, orbo: b.orb + other.drb };
  }
  function box(o, d, season) {
    if (!M || !M.leagues || !M.table) return null;
    var lg = M.leagues[String(season)] || M.leagues[Object.keys(M.leagues).sort().pop()];
    if (!o || !d || o.fga == null || d.fga == null || o.orb == null || d.drb == null) return null;
    var co = counts(o, d), cd = counts(d, o), off = 0, def = 0;
    M.table.forEach(function (T) {
      var k = T[0], num = T[2], den = T[3], val = T[4] === 'ppp' ? lg.ppp : T[4], sign = T[5], side = T[6];
      var c = side === 'o' ? co : cd, n = c[den], st = M.stats[k];
      if (!(n > 0) || !st) return;
      var R = st.tv / (st.tv + st.c / n), pts = (st.m == null ? 1 : st.m) * (1 - R) * (c[num] / n - lg[k]) * n * val * sign;
      if (side === 'o') off += pts; else def += pts;
    });
    return { off: off, def: def };
  }
  window.TDCLuck = { ready: ready, box: box };
  ready();
})();
