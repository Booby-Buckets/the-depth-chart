/* tdc-projgrade.js — Forward-looking PROJECTED grade for returners.
   ---------------------------------------------------------------------------
   tdc_grade is DEMONSTRATED (what a player proved). For the 2026-27 outlook we
   want the OVR to reflect his PROJECTED role: a bench freshman projected to start
   should grade like a starter. Per user (2026-07): "the grade should be what we
   are trying to project so if Koehler is a projected starter his ranking should
   reflect that."

   Design goals:
     • IDENTICAL on every page. Computed purely from the `players` row (demonstrated
       grade + last-season box + depth_order role) — no projection engine, no
       precompute file — so player page, team page and every list agree by
       construction.
     • SOUND. Anchors on the demonstrated grade (inheriting the trained backend
       model's calibration) and moves it only by the projected CHANGE in the grade's
       drivers, dominated by role/minutes (→ Wins Added). No circularity: the
       projection is built FROM the demonstrated grade; this grades its output.
     • BOUNDED & ASYMMETRIC. A projected role increase can lift a grade up to +7
       (rewarding breakouts). A projected role decrease only dings it up to -4 — a
       talented player who is role-blocked on a loaded team is still talented, so we
       don't tank his grade.

   See memory projected-grade-returners. Freshmen (no played season) are handled by
   their editor OVR elsewhere — this returns the demonstrated grade for them. */
(function(){
  'use strict';
  var K = 11;                                  // composite-delta → grade-points scale
  // projected 2026-27 minutes by depth-chart slot (≈200 team minutes over the top 10)
  var SLOT_MIN = [0, 31, 30, 29, 27, 25, 19, 16, 12, 9, 7];   // index = depth_order

  function _num(v){ var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function projMin(row){
    var d = parseInt(row && row.depth_order, 10);
    if(!isFinite(d) || d < 1) d = 11;
    return d < SLOT_MIN.length ? SLOT_MIN[d] : 5;
  }
  // grade-implied per-minute quality — a WA/BPM-like scalar the composite leans on
  function _qual(g){ return Math.max(0, (g - 58) / 16); }     // g76→1.13, g90→2.0, g64→0.38
  function _clamp01(x){ return x < 0 ? 0 : x > 1 ? 1 : x; }
  // weighted driver composite (the real GRADE_W drivers, with grade+minutes proxies
  // for the advanced pieces the row can't carry). Wins Added is the biggest lever.
  function _comp(g, mpg, ppg, rpg, apg, tovs){
    var q = _qual(g);
    var wa = q * (mpg / 32);                    // WA proxy: quality × minute load
    return 1.70 * _clamp01(wa / 2.6)            // Wins Added
         + 0.95 * _clamp01(ppg / 26)            // scoring
         + 0.60 * _clamp01(0.30 + q * 0.35)     // box impact (grade-driven, minutes-flat)
         + 0.32 * _clamp01(rpg / 11)            // rebounding
         + 0.32 * _clamp01(apg / 7.5)           // playmaking
         + 0.22 * _clamp01(mpg / 34)            // workload
         - 0.18 * _clamp01(tovs / 3.4);         // ball security (subtracts)
  }
  // The projected grade. Returns the demonstrated grade unchanged when there is no
  // played season to project from (freshmen) or no role signal.
  function grade(row){
    if(!row) return null;
    var g = parseInt(row.tdc_grade, 10);
    if(!isFinite(g)) return null;
    var lm = _num(row.mpg);
    if(lm <= 0) return g;                       // no played minutes → demonstrated grade
    var pm = projMin(row);
    if(pm <= 0) return g;
    if(Math.abs(pm / lm - 1) < 0.15) return g;  // role essentially unchanged → demonstrated grade stands
    var sc = Math.max(0.5, Math.min(2.2, pm / lm));
    var cA = _comp(g, lm, _num(row.ppg), _num(row.rpg), _num(row.apg), _num(row.tovs));
    // counting stats scale with minutes; damp slightly for usage saturation
    var cP = _comp(g, pm, _num(row.ppg) * sc * 0.94, _num(row.rpg) * sc * 0.96,
                          _num(row.apg) * sc * 0.96, _num(row.tovs) * sc * 0.96);
    var delta = cP - cA;
    if(delta < 0) delta *= 0.4;                 // demonstrated grade is a talent floor:
                                                // a smaller projected role barely moves it
    var pg = g + K * delta;
    pg = Math.max(g - 3, Math.min(g + 7, pg));  // asymmetric: reward breakouts, don't tank role-blocked talent
    return Math.max(40, Math.min(99, Math.round(pg)));
  }
  // Convenience: the value to DISPLAY as the OVR (projected if we can, else demonstrated).
  function ovr(row){ var p = grade(row); return (p != null && !isNaN(p)) ? p : parseInt(row && row.tdc_grade, 10); }

  window.TDCProjGrade = { projMin: projMin, grade: grade, ovr: ovr, K: K };
})();
