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

  // Relative-to-cohort grade coupling: a precomputed {id -> coupled grade} map for
  // players whose PROJECTED LINE beats or lags what their grade-cohort projects
  // (e.g. a returner stepping into a featured role rises; a redundant transfer or
  // an overshooting grade trims). Only "movers" are stored; every other player
  // keeps the live-computed grade. Bounded to +-4 by construction (K*R). Fetched
  // like recruit_pedigree below so every surface (which all call gradeRoster/
  // gradeSolo) shows the identical coupled OVR with no per-page wiring.
  var _COUPLED = {};
  function setCoupled(m){ if(m && typeof m === 'object') _COUPLED = m; }
  // Versatility bump (scripts/build_versatility.py → versatility_adj.json, keyed by espn_id):
  // a bounded, positive-only "does-a-lot" lift for players whose all-around NON-scoring
  // impact (playmaking/defense/spacing/rebounding, position-relative) the scoring-weighted
  // grade under-rewards. Folded into the grade anchor (so it flows into the coupled regen too).
  var _VERS = {};
  function setVersatility(m){ if(m && typeof m === 'object') _VERS = m; }
  function _versOf(row){ var e = row && row.espn_id; return (e != null && _VERS['' + e] != null) ? _VERS['' + e] : 0; }
  // ARCHETYPE bonus (scripts/build_arch_bonus.py → arch_bonus.json, keyed by players.id):
  // the calibrated expectation-relative + custom-stat + team-context composite mapped to
  // grade points. REPLACES the old versatility bump — this is what makes the site-wide
  // grade equal the TDC Rating. Matches tdc-rating.js's archBonus exactly.
  var _ARCH = {};
  function setArchBonus(m){ if(m && typeof m === 'object') _ARCH = m; }
  function _archOf(row){ var i = row && row.id; return (i != null && _ARCH['' + i] != null) ? _ARCH['' + i] : 0; }
  // Archetype-bonus TAPER: the +bonus stays full strength for mid grades (where it does its
  // real job — distinguishing role players by how unusual they are for their position), but
  // shrinks as the anchor grade nears the ceiling, so it can NOT turn a very-good season into
  // an all-time 99. Without it the +4 bonus pushed raw-95 seasons (Caleb Wilson, Tyler Tanner)
  // to a clamped 99, logjamming the top. Keyed on the demonstrated/anchor grade; MUST mirror
  // tdc-rating.js archTaper so historical (boxAdjust) and current (here) grades agree.
  function _taperArch(anchor, arch){ return arch > 0 ? arch * Math.max(0.15, Math.min(1, 1 - (anchor - 86) / 14)) : arch; }
  // small-sample (games-played) regression — a NEGATIVE delta for players whose grade
  // rests on too few games (build_gp_regression.py), keyed by players.id.
  var _GPS = {};
  function setGpShrink(m){ if(m && typeof m === 'object') _GPS = m; }
  function _gpsOf(row){ var i = row && row.id; return (i != null && _GPS['' + i] != null) ? _GPS['' + i] : 0; }

  // ── STATISTICAL OVERALL (the live grade, keyed by espn_id) ────────────────
  // Since 2026-08: the site grade IS the first-principles statistical overall
  // (owned SOS-adjusted wins added, per-minute quality × role — see memory
  // grade-statistical-overall). PROJECTED for returners (forward-looking OVR the
  // site ranks on), DEMONSTRATED as fallback. Freshmen / players with no played
  // season aren't in these maps and fall through to the legacy logic (editor OVR).
  var _SO_DEMO = {}, _SO_PROJ = {}, _SO_HIST = {};   // demonstrated(2026), projected(2026-27), historical {season:{espn:ovr}}
  function setStatOverall(demo, proj){ if(demo) _SO_DEMO = demo; if(proj) _SO_PROJ = proj; }
  function setStatHist(h){ if(h) _SO_HIST = h; }
  // Historical grades (~280KB gz) are LAZY — only pages that actually show a past
  // season fetch them. loadHist() is idempotent; historical callers should await it
  // before gradeSolo. A past-season gradeSolo miss also kicks the load in the
  // background so a subsequent render is correct.
  var _histLoaded = false, _histPromise = null;
  function loadHist(){
    if(_histPromise) return _histPromise;
    _histPromise = fetch('scripts/data/stat_overall_history.json?v=4')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(j) setStatHist(j); _histLoaded = true; return true; })
      .catch(function(){ _histLoaded = true; return false; });
    return _histPromise;
  }
  // Season-aware: a row tagged with a PAST season gets that season's grade; a row
  // tagged 2026 gets the demonstrated grade; an untagged/roster/projected row gets
  // the forward-looking projected grade (→ demonstrated fallback).
  function _statOvrOf(row){
    var e = row && row.espn_id; if(e == null) return null;
    var k = '' + e;
    var sy = (row.season_year != null) ? parseInt(row.season_year, 10) : null;
    if(sy && sy <= 2025){ if(!_histLoaded){ loadHist(); return null; } var hy = _SO_HIST['' + sy]; return (hy && hy[k] != null) ? hy[k] : null; }
    if(sy === 2026) return (_SO_DEMO[k] != null) ? _SO_DEMO[k] : null;
    if(_SO_PROJ[k] != null) return _SO_PROJ[k];
    if(_SO_DEMO[k] != null) return _SO_DEMO[k];
    return null;
  }
  var MAXMIN = 34, TOTMIN = 200, ROT_BAND = 16, ROT_POWER = 2.2;
  var ROLE_K = 14, ROLE_UP = 3, FLOOR_GAP = 12, CEIL = 7;
  // minutes ("playing-time quality") knobs — see gradeRoster
  var MIN_LEVEL_CAP = 3, NEWCOMER_PEN = 2.5, PROD_BASE = 11, PROD_K = 0.4;

  function _clsTrans(yr){ var y = (yr || '').toString().toLowerCase();
    if(/fr/.test(y)) return 'so'; if(/so/.test(y)) return 'jr'; if(/jr/.test(y)) return 'sr'; return null; }
  function _qtier(q){ return q < 73 ? 'low' : (q < 84 ? 'mid' : 'high'); }
  function _expMin(g){ return Math.max(6, Math.min(32, 8 + (g - 70) * 0.9)); }
  function _confOf(nm){ if(!nm || !_LV || !_LV.team_conf) return null;
    var s = ('' + nm).toLowerCase().trim(), tc = _LV.team_conf, best = null, bestExtra = 99, tie = 0;
    for(var full in tc){ var f = full.toLowerCase();
      if(f === s) return tc[full];                          // exact match wins outright
      if(f.indexOf(s + ' ') === 0){                          // full = short + nickname; prefer the SHORTEST suffix
        var extra = f.slice(s.length).trim().split(/\s+/).length;   // "Florida Gators"(1) beats "Florida A&M Rattlers"(2)
        if(extra < bestExtra){ bestExtra = extra; best = tc[full]; tie = 1; }
        else if(extra === bestExtra){ tie++; }               // count ties at the shortest suffix
      } else if(s.indexOf(f + ' ') === 0){                   // s is longer (a full name) and starts with a team
        return tc[full];
      }
    }
    // Ambiguous short name (e.g. "Alabama" -> Crimson Tide / A&M / State, all 2-word suffixes):
    // return null so a power flagship gets NO discount rather than a wrong mid-major one.
    return tie === 1 ? best : null;
  }
  function _levelDisc(conf){ if(!_LV || conf == null) return 0;
    var st = _LV.conf_strength[conf]; return (st == null) ? 0 : _LV.k * (_LV.top - st); }
  // The conference a player EARNED his grade in: hometown holds the transfer-origin school
  // for transfers, but a returner's hometown is a city ("City, ST") — only treat a bare,
  // comma-free hometown as a school so a city can't apply a bogus discount.
  function _originConf(row){
    var hc = (row.hometown && ('' + row.hometown).indexOf(',') < 0) ? _confOf(row.hometown) : null;
    return hc || _confOf(row.team);
  }

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

  // DEPTH-CHART-driven minutes: the user's authored depth_order sets the rotation
  // (who starts, who benches); the model only sizes the minutes per slot, nudged by
  // playing-time quality so a stronger starter plays a few more than a weaker one.
  // Slots 1-5 are starter-level (the chart is position-structured — a starter per
  // position), 6+ taper down the bench. mQual (grade + production - capped level,
  // freshman ramp) breaks ties and fills a missing depth_order.
  // Slots 1-5 are starter-level (the chart is position-structured); 6+ taper the bench.
  // Bases sum to ~213 — a game is 200 player-minutes, but a roster's season-average MPG
  // sums HIGHER (~205-225, injuries/DNPs mean a starter and his fill-in both post big
  // per-game averages). Empirically ~214 for a real top-10 rotation, so 200 made every
  // projected MPG ~7% light.
  var DEPTH_SLOT = [0, 34, 32, 31, 30, 29, 19, 14, 10, 7, 4, 2, 1];
  var DEPTH_MAX = 37, TOT_LO = 205, TOT_HI = 226;   // workhorse cap; realistic team-total band
  // Demonstrated-minutes anchor (see projectMinutesByDepth): a player with a real prior
  // role can GROW it, but not leap far above his baseline — and a step UP in league
  // strength shrinks the allowed jump (a Big-South 24-mpg workhorse doesn't walk into ACC
  // starter minutes). Foul-proneness needs no separate term: a foul-prone player's low
  // demonstrated minutes already price it in. Freshmen / low-baseline players are exempt
  // (they legitimately ramp via the depth model). Younger players get a larger allowance —
  // a rising sophomore has more role to gain than a graduate on his last go-round.
  var STEP_K = 0.42, ANCHOR_MIN_MPG = 12, ANCHOR_MIN_GP = 8, MIN_CEIL = 36;
  // Fraction of the gap between demonstrated MPG and the realistic heavy-starter ceiling
  // a player realizes — younger = more breakout room. Additive "+8 to a 29-mpg starter"
  // overshot to 37; this makes the added minutes SHRINK as you approach the ceiling.
  function _headroomFrac(yr){ var y = ('' + (yr || '')).toLowerCase();
    if(/fr/.test(y)) return 0.62; if(/so/.test(y)) return 0.55; if(/jr/.test(y)) return 0.48; return 0.42; }
  function projectMinutesByDepth(roster, mq){
    var n = roster.length;
    var q = mq.map(function(x){ return x == null ? 45 : x; });
    var order = roster.map(function(p, i){ return i; }).sort(function(a, b){
      var da = parseFloat(roster[a].depth_order), db = parseFloat(roster[b].depth_order);
      if(!isFinite(da)) da = 999; if(!isFinite(db)) db = 999;
      return (da - db) || (q[b] - q[a]);
    });
    var m = new Array(n);
    order.forEach(function(idx, s){
      var slot = s + 1;
      var base = slot < DEPTH_SLOT.length ? DEPTH_SLOT[slot] : (slot <= 13 ? 1 : 0);
      if(base > 0) base += Math.max(-6, Math.min(8, (q[idx] - 76) * 0.6));   // wider grade/production spread within the slot
      m[idx] = Math.max(0, base);
    });
    // DON'T force exactly 200 — keep the natural (depth-calibrated) total, only soft-clamped
    // into the realistic ~205-226 band. Then cap workhorses at 37 and redistribute overflow.
    var sum = m.reduce(function(a, x){ return a + x; }, 0) || 1;
    var target = Math.max(TOT_LO, Math.min(TOT_HI, sum));
    for(var i = 0; i < n; i++) m[i] = m[i] * target / sum;
    for(var it = 0; it < 6; it++){
      var over = 0;
      for(var i = 0; i < n; i++){ if(m[i] > DEPTH_MAX){ over += m[i] - DEPTH_MAX; m[i] = DEPTH_MAX; } }
      if(over < 0.1) break;
      var room = 0;
      for(var i = 0; i < n; i++){ if(m[i] > 0 && m[i] < DEPTH_MAX) room += (DEPTH_MAX - m[i]); }
      if(room <= 0) break;
      for(var i = 0; i < n; i++){ if(m[i] > 0 && m[i] < DEPTH_MAX) m[i] += over * (DEPTH_MAX - m[i]) / room; }
    }
    // ── DEMONSTRATED-MINUTES ANCHOR ──────────────────────────────────────────
    // Cap each experienced player at (last-year MPG + role-expansion allowance), where
    // the allowance shrinks for a step UP in competition. Overflow flows to teammates
    // who have a slot to absorb it — so freed minutes land on real backups, not vanish.
    var cap = new Array(n);
    for(var i = 0; i < n; i++){
      cap[i] = Infinity;
      var p = roster[i], demo = parseFloat(p && p.mpg), gp = parseFloat(p && p.gp);
      if(isFinite(demo) && demo >= ANCHOR_MIN_MPG && (!isFinite(gp) || gp >= ANCHOR_MIN_GP)){
        // realize a fraction of the headroom to the ceiling — added minutes shrink as demo
        // rises, so a 29.5-mpg starter nudges to ~33, not 37; a workhorse already at/over the
        // ceiling just holds his minutes.
        var grow = Math.max(0, MIN_CEIL - demo) * _headroomFrac(p.yr || p.class_year);
        var oc = _originConf(p), dc = _confOf(p.team);   // origin (transfer school) vs destination league
        if(_LV && _LV.conf_strength && oc && dc){
          var up = (_LV.conf_strength[dc] || 0) - (_LV.conf_strength[oc] || 0);
          if(up > 0) grow -= STEP_K * up;                 // a step UP in competition costs minutes
        }
        cap[i] = demo + Math.max(-2, grow);               // slight drop allowed for an extreme step-up
      }
    }
    for(var it2 = 0; it2 < 6; it2++){
      var ov = 0;
      for(var i = 0; i < n; i++){ var c = Math.min(cap[i], DEPTH_MAX); if(m[i] > c){ ov += m[i] - c; m[i] = c; } }
      if(ov < 0.1) break;
      var rm = 0;
      for(var i = 0; i < n; i++){ var c = Math.min(cap[i], DEPTH_MAX); if(m[i] > 0 && m[i] < c) rm += (c - m[i]); }
      if(rm <= 0) break;
      for(var i = 0; i < n; i++){ var c = Math.min(cap[i], DEPTH_MAX); if(m[i] > 0 && m[i] < c) m[i] += ov * (c - m[i]) / rm; }
    }
    for(var i = 0; i < n; i++) m[i] = Math.round(m[i] * 10) / 10;
    return m;
  }

  function _gradeV5(qual, yr, pm){
    var trans = _clsTrans(yr);
    var devBpm = (trans && _DEV && _DEV.bpm_delta && _DEV.bpm_delta[trans]) ? (_DEV.bpm_delta[trans][_qtier(qual)] || 0) : 0;
    var em = _expMin(qual), ratio = em ? pm / em : 1;
    // penalize a role LOSS only; development (dev curve) already handles step-ups, and a
    // zero bonus for ratio>=1 makes a starter's grade == gradeSolo (qual+dev) so the national
    // Top-Players strip and the player/team pages agree exactly.
    var role = ratio < 1 ? -ROLE_K * (1 - ratio) : 0;
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
      var g = parseFloat(p.tdc_grade);
      if(!isFinite(g)){
        // No hand grade yet (e.g. a just-added transfer the owner hasn't graded — Jaxon
        // Kohler). Fall back to the STATISTICAL overall (by espn_id) so he still earns a
        // role/minutes off his real history instead of being zeroed out of the rotation.
        // A true freshman with no played season isn't in the stat map → stays null (his
        // editor OVR should already be in tdc_grade before this is called).
        var sv = _statOvrOf(p);
        return (sv != null && isFinite(sv)) ? sv : null;
      }
      return g;   // NO conference discount in the grade — the level is ALREADY priced into the
                  // projected stat LINE this grade is built on (the projection engine discounts a
                  // transfer's production for the jump). Discounting the grade too double-counts.
    });
    // MINUTES use a distinct "playing-time quality" — coaches allocate minutes on
    // demonstrated role, not pure level-adjusted talent. Three differences from the
    // grade quality: (1) the level discount is CAPPED (a coach plays his productive
    // mid-major/Ivy transfer regardless of where he produced), (2) demonstrated
    // per-game production earns minutes, and (3) a freshman with no college role
    // ramps in. Keeps a proven 18/9 vet ahead of an unproven freshman WITHOUT
    // touching the grade (which still fully reflects level).
    var mQuals = roster.map(function(p, i){
      if(quals[i] == null) return null;
      var g = quals[i];   // resolved grade (tdc_grade, or stat-overall fallback for the ungraded)
      var base = g - Math.min(_levelDisc(_originConf(p)), MIN_LEVEL_CAP);
      var mpg = parseFloat(p.mpg) || 0;
      if(mpg >= 6){
        var prod = (parseFloat(p.ppg) || 0) + 0.5 * (parseFloat(p.rpg) || 0);   // scoring + half of rebounds
        base += Math.max(-2.5, Math.min(5, (prod - PROD_BASE) * PROD_K));        // over/under-producers vs a rotation baseline
      } else {
        var yr = (p.yr || p.class_year || '').toString().toLowerCase();
        if(/fr/.test(yr)) base -= NEWCOMER_PEN;                                   // no college role → earns minutes over time
      }
      return base;
    });
    var mins = projectMinutesByDepth(roster, mQuals);
    return roster.map(function(p, i){
      if(quals[i] == null) return { min: 0, grade: null, qual: null };
      var g = _gradeV5(quals[i], p.yr || p.class_year, mins[i]);
      if(p.id != null && _COUPLED[p.id] != null) g = _COUPLED[p.id];   // projected-line coupling (vers-free anchor)
      g = Math.min(99, Math.round(g + _taperArch(g, _archOf(p)) + _gpsOf(p)));        // + tapered archetype bonus, − small-sample shrink; 99 ceiling (site scale)
      return { min: mins[i], qual: Math.round(quals[i] * 10) / 10, grade: g };
    });
  }

  // Roster-free v5 grade for contexts without a full roster (the national Top-Players strip):
  // level-adjusted quality + development, NO role penalty. Equals gradeRoster's grade for
  // starters (whose role penalty is ~0), which is who the strip shows — so it stays consistent
  // with the player/team pages without needing every team's full roster.
  // Scout-grade blend: the statistical overall is production-only and can't see on-ball
  // defense, tools, or upside. When the owner's hand grade (tdc_grade) is ABOVE the
  // statistical grade, pull the OVR partway toward it (bounded) so a defensive stopper or a
  // young high-upside player isn't undervalued. UP-ONLY — a player the stats grade HIGHER
  // than the scout keeps his (higher) stat grade. Current/projected OVR only; historical
  // rows (season_year set) stay pure statistical.
  var SCOUT_W = 0.40, SCOUT_CAP = 5;
  function _scoutBlend(sv, row){
    if(sv == null || !row) return sv;
    if(row.season_year != null) return sv;
    var hg = parseFloat(row.tdc_grade);
    if(!isFinite(hg) || hg <= sv) return sv;
    return Math.min(99, sv + Math.min(SCOUT_CAP, Math.round(SCOUT_W * (hg - sv))));
  }
  // Floor for real roster players too raw to grade — barely-played deep-bench guys
  // (too few games for the stat model) and the ungraded. They used to render blank;
  // a baseline keeps them on the board without inventing a number from noise. They
  // still sort to the very bottom, so rankings/leaderboards are unaffected up top.
  var BASELINE_OVR = 50;
  function gradeSolo(row){
    if(!row) return null;
    var _gp = (row.gp != null && row.gp !== '') ? +row.gp : ((row.g != null && row.g !== '') ? +row.g : null);
    if(_gp != null && _gp > 0 && _gp < 3) return BASELINE_OVR; // played <3 games → baseline (too small a sample to grade)
    var _sv = _statOvrOf(row);                               // LIVE: statistical overall (projected→demonstrated) by espn_id
    if(_sv != null) return _scoutBlend(_sv, row);
    if(row.id != null && _COUPLED[row.id] != null){ var ca = _COUPLED[row.id]; return Math.min(99, Math.round(ca + _taperArch(ca, _archOf(row)) + _gpsOf(row))); }   // legacy fallback (no stat overall — e.g. freshmen): coupled + tapered archetype
    var g = parseFloat(row.tdc_grade); if(!isFinite(g)) return BASELINE_OVR; // on a roster but ungraded → baseline, not blank
    var qual = g;   // no conference discount here — see gradeRoster; the level lives in the projection
    var trans = _clsTrans(row.yr || row.class_year);
    var devBpm = (trans && _DEV && _DEV.bpm_delta && _DEV.bpm_delta[trans]) ? (_DEV.bpm_delta[trans][_qtier(qual)] || 0) : 0;
    var anchor = qual + devBpm * (_BR.b || 1.174);
    return Math.min(99, Math.round(anchor + _taperArch(anchor, _archOf(row)) + _gpsOf(row)));
  }

  // Transparent decomposition of the SAME number gradeSolo returns, so a page can
  // SHOW exactly how the projected OVR is built (demonstrated grade → role/usage or
  // development → versatility) instead of an invented weight chart. Pass the row with
  // the DEMONSTRATED tdc_grade (last actual season), plus id + espn_id.
  function explain(row){
    if(!row) return null;
    // LIVE statistical overall: decompose as demonstrated → projected role/dev.
    var e = row && row.espn_id, k = e != null ? '' + e : null;
    if(k && (_SO_DEMO[k] != null || _SO_PROJ[k] != null)){
      var d = _SO_DEMO[k] != null ? _SO_DEMO[k] : _SO_PROJ[k];
      var f = _SO_PROJ[k] != null ? _SO_PROJ[k] : _SO_DEMO[k];
      return { demonstrated: d, coupled: false, roleDelta: f - d, devDelta: 0,
               archetype: 0, gpShrink: 0, anchor: d, final: f, statistical: true };
    }
    var demo = parseFloat(row.tdc_grade); if(!isFinite(demo)) return null;
    var gps = _gpsOf(row);   // small-sample (games-played) regression, <= 0
    var coupled = (row.id != null && _COUPLED[row.id] != null);
    var anchor, roleDelta = 0, devDelta = 0;
    if(coupled){
      anchor = _COUPLED[row.id];
      roleDelta = anchor - demo;   // net role/usage move from the projected-line coupling
    } else {
      var trans = _clsTrans(row.yr || row.class_year);
      var devBpm = (trans && _DEV && _DEV.bpm_delta && _DEV.bpm_delta[trans]) ? (_DEV.bpm_delta[trans][_qtier(demo)] || 0) : 0;
      devDelta = devBpm * (_BR.b || 1.174);   // class-development curve
      anchor = demo + devDelta;
    }
    var arch = _taperArch(anchor, _archOf(row));   // tapered near the ceiling — see _taperArch
    var r1 = function(x){ return Math.round(x * 10) / 10; };
    return { demonstrated: r1(demo), coupled: coupled, roleDelta: r1(roleDelta),
             devDelta: r1(devDelta), archetype: r1(arch), gpShrink: r1(gps), anchor: r1(anchor),
             final: Math.min(99, Math.round(anchor + arch + gps)) };
  }

  window.TDCProjGrade = { projMin: projMin, grade: grade, ovr: ovr, K: K, setPedigree: setPedigree,
                          gradeRoster: gradeRoster, gradeSolo: gradeSolo, explain: explain, projectMinutes: projectMinutes, setModel: setModel, setCoupled: setCoupled, setVersatility: setVersatility, setArchBonus: setArchBonus, setGpShrink: setGpShrink, setStatOverall: setStatOverall, setStatHist: setStatHist, loadHist: loadHist,
                          statMaps: function(){ return { demo: _SO_DEMO, proj: _SO_PROJ, hist: _SO_HIST }; } };

  // Self-load the derived pedigree coefficients (tiny, local file) so every page
  // picks them up with no per-page wiring. This resolves well before the slower
  // Supabase roster fetch that precedes any grade render, so grades include it.
  try{
    fetch('scripts/data/recruit_pedigree.json')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(j && j.players) setPedigree(j.players); })
      .catch(function(){});
  }catch(e){}

  // Role-aware grade coupling v2 (movers only; resolves before the roster fetch).
  try{
    fetch('scripts/data/player_coupled_grades.json?v=11')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(j && j.grades) setCoupled(j.grades); })
      .catch(function(){});
  }catch(e){}

  // Archetype bonus (calibrated expectation-relative + custom composite → grade points,
  // keyed by players.id). This is what makes the grade equal the TDC Rating.
  try{
    fetch('scripts/data/arch_bonus.json?v=5')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(j && j.bonuses) setArchBonus(j.bonuses); })
      .catch(function(){});
  }catch(e){}

  // Small-sample (games-played) regression (negative, keyed by players.id).
  try{
    fetch('scripts/data/gp_shrink.json?v=3')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(j && j.deltas) setGpShrink(j.deltas); })
      .catch(function(){});
  }catch(e){}

  // Model data inlined (small) so setModel runs SYNCHRONOUSLY at load — no fetch race.
  setModel({"bpm_delta":{"sr":{"low":1.1,"high":-0.6,"mid":0.0},"so":{"mid":0.5,"low":1.6,"high":0.0},"jr":{"mid":0.1,"low":1.3,"high":-0.4}},"rate_mult":{"sr":{"low":1.044,"high":0.998,"mid":1.01},"so":{"mid":1.087,"low":1.119,"high":1.07},"jr":{"mid":1.04,"low":1.075,"high":1.046}},"meta":{"players":22551,"pairs":30911}}, {"a":73.42,"b":1.174,"r2":0.518,"rmse":3.84,"n":48350}, {"conf_strength":{"United Athletic Conference":10.46,"Mountain West Conference":17.68,"Mid-American Conference":8.37,"Southwestern Athletic Conference":2.46,"Southeastern Conference":22.79,"Patriot League":3.88,"Sun Belt Conference":9.08,"Pac-12 Conference":19.61,"Ohio Valley Conference":4.26,"Big 12 Conference":23.52,"America East Conference":4.61,"Atlantic Coast Conference":19.75,"Missouri Valley Conference":12.73,"Ivy League":9.42,"Northeast Conference":1.74,"Big East Conference":20.99,"West Coast Conference":15.58,"Big West Conference":9.85,"Metro Atlantic Athletic Conference":6.34,"Coastal Athletic Association":8.4,"Southern Conference":8.56,"American Conference":15.03,"Horizon League":7.0,"Mid-Eastern Athletic Conference":2.38,"Atlantic 10 Conference":14.66,"Summit League":7.04,"Big Sky Conference":7.58,"Southland Conference":5.82,"Big Ten Conference":22.71,"Atlantic Sun Conference":6.92,"Big South Conference":7.39,"Conference USA":11.94},"team_conf":{"Abilene Christian Wildcats":"United Athletic Conference","Air Force Falcons":"Mountain West Conference","Akron Zips":"Mid-American Conference","Alabama A&M Bulldogs":"Southwestern Athletic Conference","Alabama Crimson Tide":"Southeastern Conference","Alabama State Hornets":"Southwestern Athletic Conference","Alcorn State Braves":"Southwestern Athletic Conference","American University Eagles":"Patriot League","App State Mountaineers":"Sun Belt Conference","Arizona State Sun Devils":"Big 12 Conference","Arizona Wildcats":"Big 12 Conference","Arkansas Razorbacks":"Southeastern Conference","Arkansas State Red Wolves":"Sun Belt Conference","Arkansas-Pine Bluff Golden Lions":"Southwestern Athletic Conference","Army Black Knights":"Patriot League","Auburn Tigers":"Southeastern Conference","Austin Peay Governors":"Atlantic Sun Conference","Ball State Cardinals":"Mid-American Conference","Baylor Bears":"Big 12 Conference","Belmont Bruins":"Missouri Valley Conference","Bethune-Cookman Wildcats":"Southwestern Athletic Conference","Binghamton Bearcats":"America East Conference","Boise State Broncos":"Mountain West Conference","Boston College Eagles":"Atlantic Coast Conference","Boston University Terriers":"Patriot League","Bowling Green Falcons":"Mid-American Conference","Bradley Braves":"Missouri Valley Conference","Brown Bears":"Ivy League","Bryant Bulldogs":"America East Conference","Bucknell Bison":"Patriot League","Buffalo Bulls":"Mid-American Conference","Butler Bulldogs":"Big East Conference","BYU Cougars":"Big 12 Conference","Cal Poly Mustangs":"Big West Conference","Cal State Bakersfield Roadrunners":"Big West Conference","Cal State Fullerton Titans":"Big West Conference","Cal State Northridge Matadors":"Big West Conference","California Baptist Lancers":"United Athletic Conference","California Golden Bears":"Atlantic Coast Conference","Canisius Golden Griffins":"Metro Atlantic Athletic Conference","Central Connecticut Blue Devils":"Northeast Conference","Central Michigan Chippewas":"Mid-American Conference","Charleston Cougars":"Coastal Athletic Association","Chattanooga Mocs":"Southern Conference","Chicago State Cougars":"Northeast Conference","Cincinnati Bearcats":"Big 12 Conference","Clemson Tigers":"Atlantic Coast Conference","Cleveland State Vikings":"Horizon League","Coastal Carolina Chanticleers":"Sun Belt Conference","Colgate Raiders":"Patriot League","Colorado Buffaloes":"Big 12 Conference","Colorado State Rams":"Mountain West Conference","Columbia Lions":"Ivy League","Coppin State Eagles":"Mid-Eastern Athletic Conference","Cornell Big Red":"Ivy League","Creighton Bluejays":"Big East Conference","Dartmouth Big Green":"Ivy League","Davidson Wildcats":"Atlantic 10 Conference","Dayton Flyers":"Atlantic 10 Conference","Delaware Blue Hens":"Conference USA","Delaware State Hornets":"Mid-Eastern Athletic Conference","Denver Pioneers":"Summit League","DePaul Blue Demons":"Big East Conference","Detroit Mercy Titans":"Horizon League","Drake Bulldogs":"Missouri Valley Conference","Drexel Dragons":"Coastal Athletic Association","Duke Blue Devils":"Atlantic Coast Conference","Duquesne Dukes":"Atlantic 10 Conference","East Carolina Pirates":"American Conference","East Tennessee State Buccaneers":"Southern Conference","Eastern Illinois Panthers":"Ohio Valley Conference","Eastern Michigan Eagles":"Mid-American Conference","Eastern Washington Eagles":"Big Sky Conference","Elon Phoenix":"Coastal Athletic Association","Evansville Purple Aces":"Missouri Valley Conference","Fairfield Stags":"Metro Atlantic Athletic Conference","Fairleigh Dickinson Knights":"Northeast Conference","Florida A&M Rattlers":"Southwestern Athletic Conference","Florida Gators":"Southeastern Conference","Florida State Seminoles":"Atlantic Coast Conference","Fordham Rams":"Atlantic 10 Conference","Fresno State Bulldogs":"Mountain West Conference","Furman Paladins":"Southern Conference","George Mason Patriots":"Atlantic 10 Conference","George Washington Revolutionaries":"Atlantic 10 Conference","Georgetown Hoyas":"Big East Conference","Georgia Bulldogs":"Southeastern Conference","Georgia Southern Eagles":"Sun Belt Conference","Georgia State Panthers":"Sun Belt Conference","Georgia Tech Yellow Jackets":"Atlantic Coast Conference","Gonzaga Bulldogs":"West Coast Conference","Grambling Tigers":"Southwestern Athletic Conference","Grand Canyon Lopes":"Mountain West Conference","Green Bay Phoenix":"Horizon League","Hartford Hawks":"Division I Independents","Harvard Crimson":"Ivy League","Hawai'i Rainbow Warriors":"Big West Conference","Hofstra Pride":"Coastal Athletic Association","Holy Cross Crusaders":"Patriot League","Houston Christian Huskies":"Southland Conference","Houston Cougars":"Big 12 Conference","Howard Bison":"Mid-Eastern Athletic Conference","Idaho State Bengals":"Big Sky Conference","Idaho Vandals":"Big Sky Conference","Illinois Fighting Illini":"Big Ten Conference","Illinois State Redbirds":"Missouri Valley Conference","Incarnate Word Cardinals":"Southland Conference","Indiana Hoosiers":"Big Ten Conference","Indiana State Sycamores":"Missouri Valley Conference","Iona Gaels":"Metro Atlantic Athletic Conference","Iowa Hawkeyes":"Big Ten Conference","Iowa State Cyclones":"Big 12 Conference","IU Indianapolis Jaguars":"Horizon League","Jackson State Tigers":"Southwestern Athletic Conference","James Madison Dukes":"Sun Belt Conference","Kansas City Roos":"Summit League","Kansas Jayhawks":"Big 12 Conference","Kansas State Wildcats":"Big 12 Conference","Kent State Golden Flashes":"Mid-American Conference","Kentucky Wildcats":"Southeastern Conference","La Salle Explorers":"Atlantic 10 Conference","Lafayette Leopards":"Patriot League","Lamar Cardinals":"Southland Conference","Lehigh Mountain Hawks":"Patriot League","Little Rock Trojans":"Ohio Valley Conference","Long Beach State Beach":"Big West Conference","Long Island University Sharks":"Northeast Conference","Louisiana Ragin' Cajuns":"Sun Belt Conference","Louisville Cardinals":"Atlantic Coast Conference","Loyola Chicago Ramblers":"Atlantic 10 Conference","Loyola Maryland Greyhounds":"Patriot League","Loyola Marymount Lions":"West Coast Conference","LSU Tigers":"Southeastern Conference","Maine Black Bears":"America East Conference","Manhattan Jaspers":"Metro Atlantic Athletic Conference","Marist Red Foxes":"Metro Atlantic Athletic Conference","Marquette Golden Eagles":"Big East Conference","Maryland Eastern Shore Hawks":"Mid-Eastern Athletic Conference","Maryland Terrapins":"Big Ten Conference","Massachusetts Minutemen":"Mid-American Conference","McNeese Cowboys":"Southland Conference","Memphis Tigers":"American Conference","Mercer Bears":"Southern Conference","Merrimack Warriors":"Metro Atlantic Athletic Conference","Miami (OH) RedHawks":"Mid-American Conference","Miami Hurricanes":"Atlantic Coast Conference","Michigan State Spartans":"Big Ten Conference","Michigan Wolverines":"Big Ten Conference","Milwaukee Panthers":"Horizon League","Minnesota Golden Gophers":"Big Ten Conference","Mississippi State Bulldogs":"Southeastern Conference","Mississippi Valley State Delta Devils":"Southwestern Athletic Conference","Missouri State Bears":"Conference USA","Missouri Tigers":"Southeastern Conference","Monmouth Hawks":"Coastal Athletic Association","Montana Grizzlies":"Big Sky Conference","Montana State Bobcats":"Big Sky Conference","Morehead State Eagles":"Ohio Valley Conference","Morgan State Bears":"Mid-Eastern Athletic Conference","Mount St. Mary's Mountaineers":"Metro Atlantic Athletic Conference","Murray State Racers":"Missouri Valley Conference","Navy Midshipmen":"Patriot League","NC State Wolfpack":"Atlantic Coast Conference","Nebraska Cornhuskers":"Big Ten Conference","Nevada Wolf Pack":"Mountain West Conference","New Hampshire Wildcats":"America East Conference","New Mexico Lobos":"Mountain West Conference","New Mexico State Aggies":"Conference USA","New Orleans Privateers":"Southland Conference","Niagara Purple Eagles":"Metro Atlantic Athletic Conference","Nicholls Colonels":"Southland Conference","NJIT Highlanders":"America East Conference","Norfolk State Spartans":"Mid-Eastern Athletic Conference","North Carolina Central Eagles":"Mid-Eastern Athletic Conference","North Carolina Tar Heels":"Atlantic Coast Conference","North Dakota Fighting Hawks":"Summit League","North Dakota State Bison":"Summit League","Northeastern Huskies":"Coastal Athletic Association","Northern Arizona Lumberjacks":"Big Sky Conference","Northern Colorado Bears":"Big Sky Conference","Northern Illinois Huskies":"Mid-American Conference","Northern Iowa Panthers":"Missouri Valley Conference","Northern Kentucky Norse":"Horizon League","Northwestern State Demons":"Southland Conference","Northwestern Wildcats":"Big Ten Conference","Notre Dame Fighting Irish":"Atlantic Coast Conference","Oakland Golden Grizzlies":"Horizon League","Ohio Bobcats":"Mid-American Conference","Ohio State Buckeyes":"Big Ten Conference","Oklahoma Sooners":"Southeastern Conference","Oklahoma State Cowboys":"Big 12 Conference","Ole Miss Rebels":"Southeastern Conference","Omaha Mavericks":"Summit League","Oral Roberts Golden Eagles":"Summit League","Oregon Ducks":"Big Ten Conference","Oregon State Beavers":"West Coast Conference","Pacific Tigers":"West Coast Conference","Penn State Nittany Lions":"Big Ten Conference","Pennsylvania Quakers":"Ivy League","Pepperdine Waves":"West Coast Conference","Pittsburgh Panthers":"Atlantic Coast Conference","Portland Pilots":"West Coast Conference","Portland State Vikings":"Big Sky Conference","Prairie View A&M Panthers":"Southwestern Athletic Conference","Princeton Tigers":"Ivy League","Providence Friars":"Big East Conference","Purdue Boilermakers":"Big Ten Conference","Purdue Fort Wayne Mastodons":"Horizon League","Quinnipiac Bobcats":"Metro Atlantic Athletic Conference","Rhode Island Rams":"Atlantic 10 Conference","Richmond Spiders":"Atlantic 10 Conference","Rider Broncs":"Metro Atlantic Athletic Conference","Robert Morris Colonials":"Horizon League","Rutgers Scarlet Knights":"Big Ten Conference","Sacramento State Hornets":"Big Sky Conference","Sacred Heart Pioneers":"Metro Atlantic Athletic Conference","Saint Francis Red Wolves":"Northeast Conference","Saint Joseph's Hawks":"Atlantic 10 Conference","Saint Louis Billikens":"Atlantic 10 Conference","Saint Mary's Gaels":"West Coast Conference","Saint Peter's Peacocks":"Metro Atlantic Athletic Conference","Sam Houston Bearkats":"Conference USA","Samford Bulldogs":"Southern Conference","San Diego State Aztecs":"Mountain West Conference","San Diego Toreros":"West Coast Conference","San Francisco Dons":"West Coast Conference","San Jos\u00e9 State Spartans":"Mountain West Conference","Santa Clara Broncos":"West Coast Conference","SE Louisiana Lions":"Southland Conference","Seattle U Redhawks":"West Coast Conference","Seton Hall Pirates":"Big East Conference","Siena Saints":"Metro Atlantic Athletic Conference","SIU Edwardsville Cougars":"Ohio Valley Conference","SMU Mustangs":"Atlantic Coast Conference","South Alabama Jaguars":"Sun Belt Conference","South Carolina Gamecocks":"Southeastern Conference","South Carolina State Bulldogs":"Mid-Eastern Athletic Conference","South Dakota Coyotes":"Summit League","South Dakota State Jackrabbits":"Summit League","South Florida Bulls":"American Conference","Southeast Missouri State Redhawks":"Ohio Valley Conference","Southern Illinois Salukis":"Missouri Valley Conference","Southern Jaguars":"Southwestern Athletic Conference","Southern Utah Thunderbirds":"United Athletic Conference","St. Bonaventure Bonnies":"Atlantic 10 Conference","St. Francis Brooklyn Terriers":"Northeast Conference","St. John's Red Storm":"Big East Conference","St. Thomas-Minnesota Tommies":"Summit League","Stanford Cardinal":"Atlantic Coast Conference","Stephen F. Austin Lumberjacks":"Southland Conference","Stony Brook Seawolves":"Coastal Athletic Association","Syracuse Orange":"Atlantic Coast Conference","Tarleton State Texans":"United Athletic Conference","TCU Horned Frogs":"Big 12 Conference","Temple Owls":"American Conference","Tennessee State Tigers":"Ohio Valley Conference","Tennessee Tech Golden Eagles":"Ohio Valley Conference","Tennessee Volunteers":"Southeastern Conference","Texas A&M Aggies":"Southeastern Conference","Texas A&M-Corpus Christi Islanders":"Southland Conference","Texas Longhorns":"Southeastern Conference","Texas Southern Tigers":"Southwestern Athletic Conference","Texas State Bobcats":"Sun Belt Conference","Texas Tech Red Raiders":"Big 12 Conference","The Citadel Bulldogs":"Southern Conference","Toledo Rockets":"Mid-American Conference","Towson Tigers":"Coastal Athletic Association","Troy Trojans":"Sun Belt Conference","Tulane Green Wave":"American Conference","Tulsa Golden Hurricane":"American Conference","UAlbany Great Danes":"America East Conference","UC Davis Aggies":"Big West Conference","UC Irvine Anteaters":"Big West Conference","UC Riverside Highlanders":"Big West Conference","UC San Diego Tritons":"Big West Conference","UC Santa Barbara Gauchos":"Big West Conference","UCF Knights":"Big 12 Conference","UCLA Bruins":"Big Ten Conference","UConn Huskies":"Big East Conference","UIC Flames":"Missouri Valley Conference","UL Monroe Warhawks":"Sun Belt Conference","UMass Lowell River Hawks":"America East Conference","UMBC Retrievers":"America East Conference","UNC Greensboro Spartans":"Southern Conference","UNC Wilmington Seahawks":"Coastal Athletic Association","UNLV Rebels":"Mountain West Conference","USC Trojans":"Big Ten Conference","UT Arlington Mavericks":"United Athletic Conference","UT Martin Skyhawks":"Ohio Valley Conference","UT Rio Grande Valley Vaqueros":"Southland Conference","Utah State Aggies":"Mountain West Conference","Utah Tech Trailblazers":"United Athletic Conference","Utah Utes":"Big 12 Conference","Utah Valley Wolverines":"United Athletic Conference","Valparaiso Beacons":"Missouri Valley Conference","Vanderbilt Commodores":"Southeastern Conference","VCU Rams":"Atlantic 10 Conference","Vermont Catamounts":"America East Conference","Villanova Wildcats":"Big East Conference","Virginia Cavaliers":"Atlantic Coast Conference","Virginia Tech Hokies":"Atlantic Coast Conference","VMI Keydets":"Southern Conference","Wagner Seahawks":"Northeast Conference","Wake Forest Demon Deacons":"Atlantic Coast Conference","Washington Huskies":"Big Ten Conference","Washington State Cougars":"West Coast Conference","Weber State Wildcats":"Big Sky Conference","West Virginia Mountaineers":"Big 12 Conference","Western Carolina Catamounts":"Southern Conference","Western Illinois Leathernecks":"Ohio Valley Conference","Western Michigan Broncos":"Mid-American Conference","Wichita State Shockers":"American Conference","William & Mary Tribe":"Coastal Athletic Association","Wisconsin Badgers":"Big Ten Conference","Wofford Terriers":"Southern Conference","Wright State Raiders":"Horizon League","Wyoming Cowboys":"Mountain West Conference","Xavier Musketeers":"Big East Conference","Yale Bulldogs":"Ivy League","Youngstown State Penguins":"Horizon League","Bellarmine Knights":"Atlantic Sun Conference","Campbell Fighting Camels":"Coastal Athletic Association","Central Arkansas Bears":"Atlantic Sun Conference","Charleston Southern Buccaneers":"Big South Conference","Charlotte 49ers":"American Conference","East Texas A&M Lions":"Southland Conference","Eastern Kentucky Colonels":"Atlantic Sun Conference","Florida Atlantic Owls":"American Conference","Florida Gulf Coast Eagles":"Atlantic Sun Conference","Florida International Panthers":"Conference USA","Gardner-Webb Runnin' Bulldogs":"Big South Conference","Hampton Pirates":"Coastal Athletic Association","High Point Panthers":"Big South Conference","Jacksonville Dolphins":"Atlantic Sun Conference","Jacksonville State Gamecocks":"Conference USA","Kennesaw State Owls":"Conference USA","Liberty Flames":"Conference USA","Lindenwood Lions":"Ohio Valley Conference","Lipscomb Bisons":"Atlantic Sun Conference","Longwood Lancers":"Big South Conference","Louisiana Tech Bulldogs":"Conference USA","Marshall Thundering Herd":"Sun Belt Conference","Middle Tennessee Blue Raiders":"Conference USA","North Alabama Lions":"Atlantic Sun Conference","North Carolina A&T Aggies":"Coastal Athletic Association","North Florida Ospreys":"Atlantic Sun Conference","North Texas Mean Green":"American Conference","Old Dominion Monarchs":"Sun Belt Conference","Presbyterian Blue Hose":"Big South Conference","Queens University Royals":"Atlantic Sun Conference","Radford Highlanders":"Big South Conference","Rice Owls":"American Conference","South Carolina Upstate Spartans":"Big South Conference","Southern Indiana Screaming Eagles":"Ohio Valley Conference","Southern Miss Golden Eagles":"Sun Belt Conference","Stetson Hatters":"Atlantic Sun Conference","Stonehill Skyhawks":"Northeast Conference","UAB Blazers":"American Conference","UNC Asheville Bulldogs":"Big South Conference","UTEP Miners":"Conference USA","UTSA Roadrunners":"American Conference","Western Kentucky Hilltoppers":"Conference USA","Winthrop Eagles":"Big South Conference","Le Moyne Dolphins":"Northeast Conference","Mercyhurst Lakers":"Northeast Conference","West Georgia Wolves":"Atlantic Sun Conference","New Haven Chargers":"Northeast Conference"},"top":23.52,"k":0.42});
  // Statistical overall is now the PRIMARY grade source, so `ready` must await it
  // (pages that `await TDCProjGrade.ready` before rendering get correct numbers).
  function _loadSO(url){
    return fetch(url).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(!j || !j.players) return null; var m = {}; for(var k in j.players){ var v = j.players[k]; m[k] = (v && v.ovr != null) ? v.ovr : v; } return m; })
      .catch(function(){ return null; });
  }
  // Keep the FULL projected line rows (not just the ovr) so surfaces can display the exact
  // line the grade was computed from — reconciling the shown stats with the OVR.
  var _SO_PROJ_ROW = {};
  function _loadProjRows(url){
    return fetch(url).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(!j || !j.players) return null; _SO_PROJ_ROW = j.players; var m = {};
        for(var k in j.players){ var v = j.players[k]; m[k] = (v && v.ovr != null) ? v.ovr : v; } return m; })
      .catch(function(){ return null; });
  }
  window.TDCProjGrade.projRowOf = function(espn){ return (espn!=null && _SO_PROJ_ROW) ? (_SO_PROJ_ROW['' + espn] || null) : null; };
  window.TDCProjGrade.ready = Promise.all([
    _loadSO('scripts/data/stat_overall.json?v=4').then(function(m){ if(m) setStatOverall(m, null); }),
    _loadProjRows('scripts/data/stat_overall_projected.json?v=15').then(function(m){ if(m) setStatOverall(null, m); })
  ]).then(function(){ return true; }).catch(function(){ return true; });   // history is lazy — see loadHist()
})();
