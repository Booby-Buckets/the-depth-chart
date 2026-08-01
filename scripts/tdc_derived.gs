// ═══════════════════════════════════════════════════════════════════════════════
// TDC DERIVED STATS — Google Apps Script module (owned advanced stats)
// ───────────────────────────────────────────────────────────────────────────────
// Drop-in mirror of scripts/derived_stats.py. Computes the PLAYER-ONLY advanced
// stats — the ones derivable from a single player's counting stats — so nothing
// here depends on Sports-Reference. Paste this alongside tdc_roster_fill.gs /
// tdc_scraper.gs (Extensions → Apps Script → new file → paste).
//
// SAME FORMULAS AS THE PYTHON BATCH → same numbers. Keep the two in sync: if you
// retune a weight here, retune TI_W in derived_stats.py (and vice-versa).
//
// What lives here (player-only): TS%, eFG%, FG%/3P%/FT%, per-40 lines, TI (our own
// impact metric — the BPM/PER/WS replacement).
// What does NOT (needs team + opponent totals, so it stays in the Python batch):
// USG%, AST%/REB%/STL%/BLK%/TOV%, TI per-100.
//
// TI is deliberately pf-free (personal fouls aren't in player_history or the ESPN
// per-game feed) so it matches the Python value wherever it's computed.
// ═══════════════════════════════════════════════════════════════════════════════

// Impact weights — MUST match TI_W in derived_stats.py.
var TDC_TI_W = {
  pts: 1.00, oreb: 0.80, dreb: 0.30, ast: 0.70, stl: 1.40, blk: 0.90,
  missFg: -0.50, missFt: -0.35, tov: -1.00
};
var TDC_REG_MP = 100;   // per-40 minute regression (season minutes), matches Python

function _tdcNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

// ── shooting (scale-invariant: per-game or season totals both work) ──────────────
function tdcTrueShooting(pts, fga, fta) {           // TS% = PTS / (2*(FGA + 0.44*FTA))
  var tsa = _tdcNum(fga) + 0.44 * _tdcNum(fta);
  return tsa > 0 ? _tdcNum(pts) / (2 * tsa) : null;
}
function tdcEfg(fgm, tpm, fga) {                     // eFG% = (FGM + 0.5*3PM) / FGA
  fga = _tdcNum(fga);
  return fga > 0 ? (_tdcNum(fgm) + 0.5 * _tdcNum(tpm)) / fga : null;
}
function tdcPct(made, att) { att = _tdcNum(att); return att > 0 ? _tdcNum(made) / att : null; }

// ── per-40 (needs a minutes figure on the SAME scale as the stat) ────────────────
function tdcPer40(stat, minutes) { minutes = _tdcNum(minutes); return minutes > 0 ? _tdcNum(stat) * 40 / minutes : null; }

// ── TI: our own impact metric, per-40 ────────────────────────────────────────────
// Pass SEASON TOTALS. The minute-regression (REG_MP) is defined on season minutes,
// so if you only have per-game numbers, multiply each by games first (see tdcImpact40FromPerGame).
function tdcImpact40(t) {
  var w = TDC_TI_W;
  var ti = w.pts * _tdcNum(t.pts) + w.oreb * _tdcNum(t.oreb) + w.dreb * _tdcNum(t.dreb)
         + w.ast * _tdcNum(t.ast) + w.stl * _tdcNum(t.stl) + w.blk * _tdcNum(t.blk)
         + w.missFg * (_tdcNum(t.fga) - _tdcNum(t.fgm))
         + w.missFt * (_tdcNum(t.fta) - _tdcNum(t.ftm))
         + w.tov * _tdcNum(t.tov);
  var min = _tdcNum(t.min);
  return min > 0 ? Math.round(ti * 40 / (min + TDC_REG_MP) * 100) / 100 : null;
}

// Convenience: per-game line + games → TI40 (reconstructs season totals internally).
// pg = {ppg, oreb, dreb, apg, stl, blk, fga, fgm, fta, ftm, tovs, mpg}, gp = games.
function tdcImpact40FromPerGame(pg, gp) {
  gp = _tdcNum(gp) || 1;
  return tdcImpact40({
    pts: _tdcNum(pg.ppg) * gp, oreb: _tdcNum(pg.oreb) * gp, dreb: _tdcNum(pg.dreb) * gp,
    ast: _tdcNum(pg.apg) * gp, stl: _tdcNum(pg.stl) * gp, blk: _tdcNum(pg.blk) * gp,
    fga: _tdcNum(pg.fga) * gp, fgm: _tdcNum(pg.fgm) * gp,
    fta: _tdcNum(pg.fta) * gp, ftm: _tdcNum(pg.ftm) * gp,
    tov: _tdcNum(pg.tovs) * gp, min: _tdcNum(pg.mpg) * gp
  });
}

// Full owned derived line from a per-game row + games. Returns {ts_pct, efg_pct,
// fg_pct, tp_pct, ft_pct, pts40, reb40, ast40, ti40}. Percentages as 0-1 (×100 for display).
function tdcDerivedFromPerGame(pg, gp) {
  var mpgTot = _tdcNum(pg.mpg) * (_tdcNum(gp) || 1);
  return {
    ts_pct: tdcTrueShooting(pg.ppg, pg.fga, pg.fta),
    efg_pct: tdcEfg(pg.fgm, pg.tpm, pg.fga),
    fg_pct: tdcPct(pg.fgm, pg.fga),
    tp_pct: tdcPct(pg.tpm, pg.tpa),
    ft_pct: tdcPct(pg.ftm, pg.fta),
    pts40: tdcPer40(_tdcNum(pg.ppg) * (_tdcNum(gp) || 1), mpgTot),
    reb40: tdcPer40(_tdcNum(pg.rpg) * (_tdcNum(gp) || 1), mpgTot),
    ast40: tdcPer40(_tdcNum(pg.apg) * (_tdcNum(gp) || 1), mpgTot),
    ti40: tdcImpact40FromPerGame(pg, gp)
  };
}
