/* tdc-rating.js — expectation-relative "archetype" player rating (CORE).
   ---------------------------------------------------------------------------
   Rates a player against what a player of his HEIGHT + POSITION is expected to
   produce (per-40), learned from 20 yrs of history and shipped in
   archetype_expectations.json, then blends the site's custom stats:
     • Shot Genome (Look Quality / Shot-Making / self-created) → Efficiency/Scoring/Creation
     • team success (team_dna net × role)                      → Impact
   Categories (user's weights) are built from RELATIVE numbers, so the "archetype
   bonus" (small guard who rebounds, big who shoots) falls out for free.

   Designed to run off the REAL projected line (pass tdc-proj.js's output), which
   is why it's a passed-in-line function, not a self-contained grade.

   API:
     TDCRating.ready                         -> Promise (warms the data)
     TDCRating.categories(player, line)      -> {Scoring, Creation, ... , Impact}
     TDCRating.composite(player, line)       -> weighted category z (pre-calibration)
   Breakout/role layers + 40-99 calibration land in a later pass.                */
window.TDCRating = (function () {
  var EXP = null, W = null, RATE = [], EFF = [], LQ = { mean: 50, std: 5 };
  var SG = {}, TNET = {}, TN = { mean: 0, std: 9.5 };
  var _p = null;

  function _std(a) { if (!a.length) return 1; var m = a.reduce(function (s, x) { return s + x; }, 0) / a.length;
    return Math.sqrt(a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / a.length) || 1; }
  function _num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function _htIn(h) { var m = /(\d+)\D+(\d+)/.exec('' + (h || '')); return m ? (+m[1] * 12 + +m[2]) : 78; }
  function npos(p) { p = ('' + (p || '')).toUpperCase().replace(/[^A-Z]/g, '');
    if (p === 'PG' || p === 'G') return 'PG';
    if (p === 'SG' || p === 'CG') return 'SG';
    if (p === 'SF' || p === 'F' || p === 'GF') return 'SF';
    if (p === 'PF' || p === 'FC') return 'PF';
    if (p === 'C') return 'C';
    return p.charAt(0) === 'C' ? 'C' : p.charAt(0) === 'G' ? 'SG' : 'SF'; }
  function polyval(c, x) { var v = 0; for (var i = 0; i < c.length; i++) v = v * x + c[i]; return v; }

  function load() {
    if (_p) return _p;
    _p = Promise.all([
      fetch('scripts/data/archetype_expectations.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/shot_genome_players.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/team_dna.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var e = res[0] || {}; EXP = e.expectations || {}; W = e.weights || {}; RATE = e.rate_stats || []; EFF = e.eff_stats || [];
      LQ = (e.pop && e.pop.lookq) || LQ;
      if (e.calibration) setCalibration(e.calibration);   // pool-centered, data-driven
      var sg = res[1]; if (sg && sg.players) sg.players.forEach(function (p) { if (p.espn_id != null) SG['' + p.espn_id] = p; });
      var dna = res[2]; var tms = (dna && dna['2026'] && dna['2026'].teams) || {}; var nets = [];
      Object.keys(tms).forEach(function (f) { var v = tms[f]; var n = (v.adjNet != null ? v.adjNet : v.net);
        if (n != null) { TNET[f.toLowerCase()] = n; nets.push(n); } });
      if (nets.length) { TN = { mean: nets.reduce(function (s, x) { return s + x; }, 0) / nets.length, std: _std(nets) }; }
      return true;
    });
    return _p;
  }

  function per40(line, k) { var m = _num(line.mpg); var v = _num(line[k]); if (m == null || m < 1 || v == null) return null; return v * 40 / m; }
  function expected(pos, ht, stat) { var s = EXP[pos] && EXP[pos][stat]; if (!s) return null; return { e: polyval(s.coef, ht), sd: s.sd || 1 }; }
  function rel(pos, ht, stat, actual) { if (actual == null) return 0; var x = expected(pos, ht, stat); if (!x) return 0; return (actual - x.e) / (x.sd || 1); }
  function tsOf(line) { var ppg = _num(line.ppg), fga = _num(line.fga), fta = _num(line.fta) || 0; if (!ppg || fga == null) return null;
    var den = 2 * (fga + 0.44 * fta); return den > 0 ? ppg / den * 100 : null; }
  function teamZ(teamName) { if (!teamName) return 0; var lo = ('' + teamName).toLowerCase(); var n = TNET[lo];
    if (n == null) { var k = Object.keys(TNET).find(function (f) { return f === lo || f.indexOf(lo + ' ') === 0 || (lo.length >= 6 && f.indexOf(lo) === 0); }); if (k) n = TNET[k]; }
    return n == null ? 0 : (n - TN.mean) / (TN.std || 1); }
  function zpct(p) { return p == null ? 0 : (p - 50) / 30; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // categories from a stat LINE (per-40 relative) + custom stats (by espn_id) + team success
  function categories(player, line) {
    var pos = npos(line.position || player.position), ht = _htIn(line.height || player.height);
    var p40 = {}; RATE.forEach(function (k) { p40[k] = per40(line, k); });
    var G = SG['' + (player.espn_id != null ? player.espn_id : line.espn_id)];
    var smz = G && G.smPct != null ? zpct(G.smPct) : 0;
    var selfz = G && G.selfPctl != null ? zpct(G.selfPctl) : 0;
    var lqz = G && G.lq != null ? (G.lq - LQ.mean) / (LQ.std || 1) : 0;
    var tsv = tsOf(line);
    var effBox = rel(pos, ht, 'fg_pct', _num(line.fg_pct)) * (tsv == null ? 1 : 0.5) + (tsv == null ? 0 : ((tsv - 54) / 6) * 0.5);
    var role = clamp((_num(line.mpg) || 0) / 27, 0, 1.15);
    var C = {
      Scoring: 0.6 * rel(pos, ht, 'ppg', p40.ppg) + 0.4 * smz,
      Creation: 0.6 * (0.6 * rel(pos, ht, 'apg', p40.apg) + 0.4 * (-rel(pos, ht, 'tovs', p40.tovs))) + 0.4 * selfz,
      Efficiency: 0.35 * effBox + 0.65 * (0.5 * lqz + 0.5 * smz),
      Defense: 0.5 * rel(pos, ht, 'stl', p40.stl) + 0.5 * rel(pos, ht, 'blk', p40.blk),
      Rebounding: 0.5 * rel(pos, ht, 'oreb', p40.oreb) + 0.5 * rel(pos, ht, 'dreb', p40.dreb),
      Shooting: 0.5 * rel(pos, ht, 'tpa', p40.tpa) + 0.5 * rel(pos, ht, 'tp_pct', _num(line.tp_pct)),
      Impact: clamp(teamZ(line.team || player.team) * role, -2.5, 3.0)
    };
    var above = ['Scoring', 'Creation', 'Defense', 'Rebounding', 'Shooting'].filter(function (k) { return C[k] > 0.75; });
    C.Versatility = (above.length - 1) * 0.7;
    return C;
  }

  function composite(player, line) { var C = categories(player, line); var z = 0;
    Object.keys(W).forEach(function (k) { z += W[k] * (C[k] || 0); }); return z; }

  // Calibration (tunable): the archetype/custom composite is centered on the
  // current-pool average and mapped to a bounded bonus that layers ON the site's
  // trusted projected grade — which already carries role + development. So the TDC
  // Rating = projected grade, reshaped by how unusual/valuable the player is for his
  // archetype and how his custom stats + team context read.
  var CENTER = 0.30, K = 3.0, AMIN = -3, AMAX = 4;   // fallback; overridden by the file's calibration
  function setCalibration(c) { if (!c) return; if (c.center != null) CENTER = c.center; if (c.k != null) K = c.k;
    if (c.archMin != null) AMIN = c.archMin; if (c.archMax != null) AMAX = c.archMax; }

  // baseGrade = the site's projected OVR (role/dev already applied); line = the projected line.
  function rate(player, line, baseGrade) {
    var comp = composite(player, line);
    var arch = clamp(K * (comp - CENTER), AMIN, AMAX);
    var base = _num(baseGrade);
    return { rating: base == null ? null : Math.round((base + arch) * 10) / 10,
             archBonus: Math.round(arch * 10) / 10, composite: Math.round(comp * 1000) / 1000,
             categories: categories(player, line) };
  }

  return { ready: load(), load: load, categories: categories, composite: composite, rate: rate,
           setCalibration: setCalibration, expected: expected, rel: rel,
           _internal: function () { return { EXP: EXP, W: W, CENTER: CENTER, K: K }; } };
})();
