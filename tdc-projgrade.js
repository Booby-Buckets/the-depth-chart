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
    var slot = (isFinite(d) && d >= 1) ? (d < SLOT_MIN.length ? SLOT_MIN[d] : 5) : 0;
    // depth_order is NOISY in the roster data — proven starters are sometimes tagged
    // deep (e.g. a 34-mpg, grade-93 star sitting at depth_order 9), which used to
    // project them down to bench minutes and unfairly ding the grade. A returner's
    // OWN minutes are the reliable prior: never project him below ~90% of what he
    // actually played, and honor an explicit starter flag. depth_order can still
    // push a role UP (a bench freshman projected to start).
    var last = _num(row && row.mpg);
    var starter = row && (row.starter === true || row.starter === 'true' || row.starter === 't');
    var floor = last > 0 ? last * 0.9 : 0;
    if(starter) floor = Math.max(floor, 28);
    var pm = Math.max(slot, floor);
    if(!isFinite(d) && last > 0) pm = last;      // no depth signal at all → hold proven role
    return pm;
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
  // Development runway by class: younger players have more projectable upside left.
  function _runway(row){
    var y = (row && (row.yr || row.class_year) || '').toString().toLowerCase();
    if(/fr/.test(y)) return 1.0;
    if(/so/.test(y)) return 0.85;
    if(/jr/.test(y)) return 0.50;
    if(/sr|gr/.test(y)) return 0.25;
    return 0.6;                                 // unknown class → moderate
  }
  // Recruiting pedigree coefficients (0..1 per espn_id), set once per page from the
  // derived recruit_pedigree.json. NOT 247's rankings — a private model input; the
  // raw ranks are never shipped, only this coefficient influences the grade.
  var PED = {};
  function setPedigree(map){ PED = map || {}; }

  // Young-player UPSIDE (added on top of the role adjustment). Two bounded signals:
  //   (a) SHOOTING POSITIVE REGRESSION — FT% is the best predictor of future 3P%, so
  //       a young high-volume shooter whose 3P% sits below his FT-implied expectation
  //       is a buy (Braylon Mullins: 88.9 FT but 33.5% on 6.5 3PA). Self-zeroing.
  //   (b) RECRUITING PEDIGREE — a highly-touted young recruit whose PRODUCTION grade
  //       undersells his pedigree has projectable upside (tools/role tend to catch
  //       up). Tapers to 0 once his grade already reflects the pedigree, and by class
  //       (a senior former 5★ still low has had his chance). Lifts an Alijah Arenas.
  // Combined upside is bounded so neither signal runs away.
  function _upside(row){
    var youth = _runway(row);
    if(youth <= 0) return 0;
    if(_num(row.mpg) < 10) return 0;            // needs a real role/sample
    var g = parseInt(row.tdc_grade, 10) || 0;
    // (a) shooting positive regression
    var shootUp = 0;
    var ft = _num(row.ft_pct), tp = _num(row.tp_pct), tpa = _num(row.tpa);
    if(ft > 0 && tpa >= 1){
      var expTP  = 0.55 * ft - 10;              // FT-implied 3P%: FT88.9→~38.9
      var room   = _clamp01((expTP - tp) / 8);  // 3P below expectation (0 if at/above)
      var ftGate = _clamp01((ft - 72) / 12);    // must be a genuine FT shooter
      var vol    = _clamp01((tpa - 2) / 4);     // enough 3PA that the % gain moves scoring
      shootUp = youth * (ftGate * room * vol) * 7;
    }
    // (b) recruiting pedigree — a modest benefit-of-the-doubt for a young, highly
    // touted recruit whose production trails his pedigree. Deliberately small: the
    // grade should be driven by projected PRODUCTION/ROLE, not by recruiting rank.
    // (Was up to ~+6, which over-inflated former 5★s who never produced.)
    var ped = PED[row.espn_id]; if(ped == null) ped = _num(row.recruit_ped);
    var pedUp = 0;
    if(ped > 0){
      var target = 80 + ped * 8;                // 5★(1.0)→88, high-4★(.85)→86.8
      var gap = _clamp01((target - g) / 12);    // how far production sits below pedigree
      pedUp = youth * ped * gap * 3.5;          // up to ~+3 for a young elite recruit underproducing
    }
    return Math.min(4, shootUp + pedUp);        // combined upside bounded (was 7)
  }
  // Year-over-year DEVELOPMENT for returners. A FORWARD-LOOKING board should price in
  // the normal growth curve: a productive underclassman who returns projects to take
  // a step, so his OVR shouldn't sit flat at last year's demonstrated grade. Bounded
  // and class-tapered (Fr>So>Jr>Sr — younger = more runway), with less room the higher
  // the grade already is, and scaled by minutes + production so it rewards players who
  // carried a real load rather than deep-bench projection. Incoming freshmen (no played
  // season, mpg≈0) are untouched — their editor OVR handles them.
  var DEV_BASE = { fr:6.5, so:5.0, jr:3.0, sr:0.8 };   // aggressive setting (user pick, 2026-07)
  var DEV_CEIL = 99, DEV_SPAN = 20;
  function _devClass(row){
    var y = (row && (row.yr || row.class_year) || '').toString().toLowerCase();
    if(/fr/.test(y)) return 'fr';
    if(/so/.test(y)) return 'so';
    if(/jr/.test(y)) return 'jr';
    return 'sr';
  }
  function _develop(row, g){
    var mpg = _num(row.mpg);
    if(mpg < 10) return 0;                       // needs a real role/sample last year
    var base = DEV_BASE[_devClass(row)] || 0;
    if(base <= 0) return 0;
    var room = _clamp01((DEV_CEIL - g) / DEV_SPAN);
    var minF = _clamp01(mpg / 22);
    var prod = _clamp01((_num(row.ppg) + 1.5 * _num(row.apg)) / 28);
    return base * room * minF * (0.55 + 0.45 * prod);
  }
  // The projected grade. Anchors on the demonstrated grade, moves it by projected
  // ROLE change, then adds bounded young-player UPSIDE. Freshmen with no played
  // season fall back to the demonstrated grade (handled by editor OVR elsewhere).
  function grade(row){
    if(!row) return null;
    var g = parseInt(row.tdc_grade, 10);
    if(!isFinite(g)) return null;
    var up = _upside(row);                      // young-player upside, role-independent
    var dev = _develop(row, g);                 // year-over-year development for returners
    // clamp helper: upside + development stack on top of the (already role-bounded)
    // grade, with an overall +9 ceiling vs the demonstrated grade so nothing runs away.
    function out(pg){ return Math.max(40, Math.min(99, Math.round(Math.min(g + 9, pg + up + dev)))); }
    var lm = _num(row.mpg);
    if(lm <= 0) return out(g);                  // no played minutes → demonstrated (+upside≈0)
    var pm = projMin(row);
    if(pm <= 0) return out(g);
    if(Math.abs(pm / lm - 1) < 0.15) return out(g);  // role unchanged → demonstrated + upside
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
    return out(pg);
  }
  // Convenience: the value to DISPLAY as the OVR (projected if we can, else demonstrated).
  function ovr(row){ var p = grade(row); return (p != null && !isNaN(p)) ? p : parseInt(row && row.tdc_grade, 10); }

  window.TDCProjGrade = { projMin: projMin, grade: grade, ovr: ovr, K: K, setPedigree: setPedigree };

  // Self-load the derived pedigree coefficients (tiny, local file) so every page
  // picks them up with no per-page wiring. This resolves well before the slower
  // Supabase roster fetch that precedes any grade render, so grades include it.
  try{
    fetch('scripts/data/recruit_pedigree.json')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(j && j.players) setPedigree(j.players); })
      .catch(function(){});
  }catch(e){}
})();
