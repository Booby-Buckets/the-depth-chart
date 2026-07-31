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
  var BOXW = null, CENTERS = {}, BOXCENTER = 0.03;   // box-only weights + per-season centers
  var TSTR = {};                                      // per-season team strength (SRS z) for the weak-team dampener
  var DAMP_K = 0.8, DAMP_REF = 3.0, DAMP_CAP = 2.0;
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
      fetch('scripts/data/archetype_expectations.json?v=2').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/shot_genome_players.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/team_dna.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/team_strength.json?v=1').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var e = res[0] || {}; EXP = e.expectations || {}; W = e.weights || {}; RATE = e.rate_stats || []; EFF = e.eff_stats || [];
      LQ = (e.pop && e.pop.lookq) || LQ;
      BOXW = e.box_weights || null; CENTERS = e.season_centers || {}; if (e.box_center != null) BOXCENTER = e.box_center;
      if (e.calibration) setCalibration(e.calibration);   // pool-centered, data-driven
      var ts = res[3]; TSTR = (ts && ts.z) || {};
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
    if (c.archMin != null) AMIN = c.archMin; if (c.archMax != null) AMAX = c.archMax;
    if (c.damp_k != null) DAMP_K = c.damp_k; if (c.damp_ref != null) DAMP_REF = c.damp_ref; if (c.damp_cap != null) DAMP_CAP = c.damp_cap; }

  // team strength (SRS z within season); prefix-tolerant so short/full names both hit.
  function teamStrengthZ(team, season) {
    if (!team) return 0; var yr = TSTR['' + season]; if (!yr) return 0;
    var lo = ('' + team).toLowerCase().trim(); var z = yr[lo];
    if (z == null) { var k = Object.keys(yr).find(function (f) {
      return f === lo || lo.indexOf(f + ' ') === 0 || f.indexOf(lo + ' ') === 0 || (lo.length >= 5 && f.indexOf(lo) === 0); });
      if (k) z = yr[k]; }
    return z == null ? 0 : z;
  }
  // DAMPEN-ONLY: a weak team pulls a POSITIVE archetype bonus down (empty-calorie stats);
  // strong/average teams and non-positive bonuses do nothing. Never inflates.
  function teamDamp(bonus, team, season) {
    if (bonus <= 0) return 0;
    var tz = teamStrengthZ(team, season); if (tz >= 0) return 0;
    var weak = -tz; if (weak > DAMP_CAP) weak = DAMP_CAP;
    var frac = bonus / DAMP_REF; if (frac > 1) frac = 1;
    return -DAMP_K * weak * frac;
  }

  // baseGrade = the site's projected OVR (role/dev already applied); line = the projected line.
  function rate(player, line, baseGrade) {
    var comp = composite(player, line);
    var arch = clamp(K * (comp - CENTER), AMIN, AMAX);
    var base = _num(baseGrade);
    return { rating: base == null ? null : Math.round((base + arch) * 10) / 10,
             archBonus: Math.round(arch * 10) / 10, composite: Math.round(comp * 1000) / 1000,
             categories: categories(player, line) };
  }

  // ── BOX-ONLY path (every-year consistent) ─────────────────────────────────
  // No Shot Genome / team-success — just expectation-relative box categories, so a
  // 2013 season and a 2026 season are graded the same way. Mirrors the Python
  // rate_player + build_arch_bonus exactly, so precomputed 2026 bonuses and these
  // client-side historical bonuses agree. Re-centered per season (season_centers).
  function boxCategories(player, line) {
    line = line || player;
    var pos = npos(line.position || player.position), ht = _htIn(line.height || player.height);
    function rz(stat, actual) { return rel(pos, ht, stat, actual); }
    var p40 = {}; RATE.forEach(function (k) { p40[k] = per40(line, k); });
    var ts = tsOf(line), fg = _num(line.fg_pct);
    var C = {
      Scoring: rz('ppg', p40.ppg),
      Creation: 0.6 * rz('apg', p40.apg) + 0.4 * (-rz('tovs', p40.tovs)),
      Efficiency: ts == null ? rz('fg_pct', fg) : (rz('fg_pct', fg) * 0.5 + ((ts - 54) / 6) * 0.5),
      Defense: 0.5 * rz('stl', p40.stl) + 0.5 * rz('blk', p40.blk),
      Rebounding: 0.5 * rz('oreb', p40.oreb) + 0.5 * rz('dreb', p40.dreb),
      Shooting: 0.5 * rz('tpa', p40.tpa) + 0.5 * rz('tp_pct', _num(line.tp_pct))
    };
    var above = ['Scoring', 'Creation', 'Defense', 'Rebounding', 'Shooting'].filter(function (k) { return C[k] > 0.75; });
    C.Versatility = (above.length - 1) * 0.7;
    return C;
  }
  function boxComposite(player, line) { var C = boxCategories(player, line), z = 0, w = BOXW || W;
    Object.keys(w).forEach(function (k) { if (C[k] != null) z += w[k] * C[k]; }); return z; }
  function seasonCenter(season) { var c = CENTERS['' + season]; return c == null ? BOXCENTER : c; }
  function boxBonus(player, line, season) {
    var raw = clamp(K * (boxComposite(player, line) - seasonCenter(season)), AMIN, AMAX);
    var team = (line && line.team) || (player && player.team);
    return clamp(raw + teamDamp(raw, team, season), AMIN, AMAX);
  }
  // rawGrade = the season's demonstrated tdc_grade; returns it reshaped by archetype fit.
  function boxAdjust(rawGrade, player, line, season) {
    var base = _num(rawGrade); if (base == null) return null;
    var b = boxBonus(player, line, season);
    return { grade: Math.min(99, Math.round((base + b) * 10) / 10), bonus: Math.round(b * 10) / 10,
             composite: Math.round(boxComposite(player, line) * 1000) / 1000,
             center: seasonCenter(season), categories: boxCategories(player, line) };
  }

  return { ready: load(), load: load, categories: categories, composite: composite, rate: rate,
           boxCategories: boxCategories, boxComposite: boxComposite, boxBonus: boxBonus,
           boxAdjust: boxAdjust, seasonCenter: seasonCenter,
           teamStrengthZ: teamStrengthZ, teamDamp: teamDamp,
           setCalibration: setCalibration, expected: expected, rel: rel,
           _internal: function () { return { EXP: EXP, W: W, BOXW: BOXW, CENTERS: CENTERS, CENTER: CENTER, K: K, AMIN: AMIN, AMAX: AMAX, DAMP_K: DAMP_K, DAMP_REF: DAMP_REF, DAMP_CAP: DAMP_CAP }; } };
})();
