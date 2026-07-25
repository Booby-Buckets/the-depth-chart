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
    // Honor an explicit starter flag (floor 28 min) ONLY when depth_order agrees or is
    // absent. A stale starter=true on a player buried at depth_order 10 — common for a
    // transfer who started elsewhere but is deep on his new team — must NOT project him
    // UP to 28 minutes (more than he even played) and fake a role increase.
    if(starter && (!isFinite(d) || d <= 6)) floor = Math.max(floor, 28);
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

  // ═══════════════════════════════════════════════════════════════════════
  //  PROJECTION MODEL v5 — projected line LEADS the ranking.
  //  gradeRoster(roster) derives each player's projected MINUTES from a rotation
  //  model (no manual depth chart) driven by level-adjusted quality, then grades
  //  from that role. Calibrated offline (see scripts/validate_projmodel.py):
  //   - dev_curves.json     : empirical YoY development by class transition x tier
  //   - projgrade_bridge.json: grade = a + b*estBPM (b used to convert dev BPM->grade)
  //   - level_adj.json      : strength-of-competition discount by conference
  // ═══════════════════════════════════════════════════════════════════════
  var _DEV = null, _BR = { b: 1.174 }, _LV = null;
  function setModel(dev, br, lv){ if(dev) _DEV = dev; if(br) _BR = br; if(lv) _LV = lv; }
  var MAXMIN = 34, TOTMIN = 200, ROT_BAND = 16, ROT_POWER = 2.2;
  var ROLE_K = 14, ROLE_UP = 3, FLOOR_GAP = 12, CEIL = 7;

  function _clsTrans(yr){ var y = (yr || '').toString().toLowerCase();
    if(/fr/.test(y)) return 'so'; if(/so/.test(y)) return 'jr'; if(/jr/.test(y)) return 'sr'; return null; }
  function _qtier(q){ return q < 73 ? 'low' : (q < 84 ? 'mid' : 'high'); }
  function _expMin(g){ return Math.max(6, Math.min(32, 8 + (g - 70) * 0.9)); }
  function _confOf(nm){ if(!nm || !_LV || !_LV.team_conf) return null;
    var s = ('' + nm).toLowerCase().trim(), tc = _LV.team_conf;
    for(var full in tc){ var f = full.toLowerCase();
      if(f === s || f.indexOf(s + ' ') === 0 || s.indexOf(f + ' ') === 0) return tc[full]; }
    return null; }
  function _levelDisc(conf){ if(!_LV || conf == null) return 0;
    var st = _LV.conf_strength[conf]; return (st == null) ? 0 : _LV.k * (_LV.top - st); }

  // rotation/minutes model: quality-weighted, cap 34, total 200, 7-12 man rotation
  function projectMinutes(quals){
    var n = quals.length;
    var order = quals.map(function(q, i){ return i; }).sort(function(a, b){ return quals[b] - quals[a]; });
    var sq = order.map(function(i){ return quals[i]; });
    var base = (n >= 5 ? sq[4] : sq[n - 1]) - ROT_BAND;
    var w = sq.map(function(q){ return Math.pow(Math.max(0, q - base), ROT_POWER); });
    for(var i = 12; i < n; i++) w[i] = 0;
    var s = w.reduce(function(a, b){ return a + b; }, 0) || 1;
    var m = w.map(function(x){ return TOTMIN * x / s; });
    for(var it = 0; it < 8; it++){
      var over = m.reduce(function(a, x){ return a + Math.max(0, x - MAXMIN); }, 0);
      if(over < 0.1) break;
      m = m.map(function(x){ return Math.min(x, MAXMIN); });
      var room = m.map(function(x){ return (x > 0 && x < MAXMIN) ? (MAXMIN - x) : 0; });
      var rs = room.reduce(function(a, b){ return a + b; }, 0) || 1;
      m = m.map(function(x, i){ return x + over * room[i] / rs; });
    }
    var out = new Array(n);
    order.forEach(function(idx, i){ out[idx] = Math.round(m[i] * 10) / 10; });
    return out;
  }

  function _gradeV5(qual, yr, pm){
    var trans = _clsTrans(yr);
    var devBpm = (trans && _DEV && _DEV.bpm_delta && _DEV.bpm_delta[trans]) ? (_DEV.bpm_delta[trans][_qtier(qual)] || 0) : 0;
    var em = _expMin(qual), ratio = em ? pm / em : 1;
    var role = ratio < 1 ? -ROLE_K * (1 - ratio) : Math.min(ROLE_UP, ROLE_K * 0.4 * (ratio - 1));
    var v = qual + devBpm * (_BR.b || 1.174) + role;
    return Math.round(Math.max(qual - FLOOR_GAP, Math.min(qual + CEIL, v)));
  }

  // The public entry point: grade a whole team roster at once.
  // roster: [{tdc_grade, yr|class_year, team, hometown, name, espn_id, ...}, ...]
  // returns aligned [{min, grade, qual}] — freshmen with an editor OVR should have that
  // OVR already in tdc_grade before calling; a freshman with no played role is handled by
  // the editor elsewhere. Uses hometown as the transfer-origin school for the level discount.
  function gradeRoster(roster){
    if(!roster || !roster.length) return [];
    var quals = roster.map(function(p){
      var g = parseFloat(p.tdc_grade); if(!isFinite(g)) return null;
      var conf = _confOf(p.hometown) || _confOf(p.team);
      return g - _levelDisc(conf);
    });
    var q2 = quals.map(function(q){ return q == null ? 45 : q; });
    var mins = projectMinutes(q2);
    return roster.map(function(p, i){
      if(quals[i] == null) return { min: 0, grade: null, qual: null };
      return { min: mins[i], qual: Math.round(quals[i] * 10) / 10,
               grade: _gradeV5(quals[i], p.yr || p.class_year, mins[i]) };
    });
  }

  window.TDCProjGrade = { projMin: projMin, grade: grade, ovr: ovr, K: K, setPedigree: setPedigree,
                          gradeRoster: gradeRoster, projectMinutes: projectMinutes, setModel: setModel };

  // Self-load the derived pedigree coefficients (tiny, local file) so every page
  // picks them up with no per-page wiring. This resolves well before the slower
  // Supabase roster fetch that precedes any grade render, so grades include it.
  try{
    fetch('scripts/data/recruit_pedigree.json')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(j && j.players) setPedigree(j.players); })
      .catch(function(){});
  }catch(e){}

  // Projection model v5 data — dev curves, line->grade bridge, competition ladder.
  // A single Promise so callers can await readiness (window.TDCProjGrade.ready).
  window.TDCProjGrade.ready = Promise.all([
    fetch('scripts/data/dev_curves.json').then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; }),
    fetch('scripts/data/projgrade_bridge.json').then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; }),
    fetch('scripts/data/level_adj.json').then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; })
  ]).then(function(a){ setModel(a[0], a[1], a[2]); return true; });
})();
