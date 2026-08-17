/* tdc-teamgrades.js — the ONE source of truth for the projected team hero grades
   (Overall / Power / Offense / Defense), so team.html and program-hq.html read
   identical numbers. Extracted verbatim from team.html's _projGradeTiles.

   Usage:  TDCTeamGrades.compute(row).then(g => { g.overall, g.power, g.offense, g.defense })
   where `row` has {rating, team, full}. Values are 1-99 (or null). Needs TDC_RATINGS
   loaded on the page. Reads team_projections once (cached) for the offense grade.        */
window.TDCTeamGrades = (function () {
  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
  var KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
  var H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  var _projOff;   // cache: {by:{teamKey:offRtg}, arr:[offRtg...]}

  function pctIn(arr, v) { if (v == null || !isFinite(v) || !arr.length) return null; var b = 0; for (var i = 0; i < arr.length; i++) if (arr[i] < v) b++; return b / arr.length; }
  function pctNum(p) { if (p == null || isNaN(p)) return null; return Math.max(1, Math.min(99, Math.round(p * 99))); }

  // projected offensive efficiency (pts/100 poss); poss ≈ (FGA − OREB + TOV)/0.92
  function loadOff() {
    if (_projOff !== undefined) return Promise.resolve(_projOff);
    return fetch(SB + '/rest/v1/team_projections?select=team,ppg,fga,oreb,tov', { headers: H })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var by = {};
        rows.forEach(function (r) {
          var ppg = +r.ppg, poss = ((+r.fga || 0) - (+r.oreb || 0) + (+r.tov || 0)) / 0.92;
          if (isFinite(ppg) && poss > 20) by[(r.team || '').toLowerCase().trim()] = ppg / poss * 100;
        });
        _projOff = { by: by, arr: Object.values(by).filter(isFinite) };
        return _projOff;
      })
      .catch(function () { _projOff = null; return null; });
  }

  // returns Promise<{overall,power,offense,defense}> (each 1-99 or null)
  function compute(rr) {
    if (!rr || !window.TDC_RATINGS) return Promise.resolve(null);
    return TDC_RATINGS.get().then(function (D) {
      if (!D || !D.teams) return null;
      var ratings = D.teams.map(function (x) { return +x.rating; }).filter(isFinite);
      var pPow = pctIn(ratings, +rr.rating);
      return loadOff().then(function (PP) {
        var pOff = null, pDef = null;
        if (PP && PP.arr.length) {
          var nm = (rr.team || '').toLowerCase().trim(), fn = (rr.full || '').toLowerCase().trim();
          var shortK = window.tdcShortSchool ? tdcShortSchool(rr.full || rr.team || '').toLowerCase().trim() : null;
          var myOff = PP.by[nm]; if (myOff == null) myOff = PP.by[fn]; if (myOff == null && shortK) myOff = PP.by[shortK];
          pOff = pctIn(PP.arr, myOff);
          // implied defense = overall MINUS offense, z-standardized, then percentile, then
          // shrunk halfway toward overall (a strong team isn't actually a terrible defense).
          var mean = function (a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; };
          var sd = function (a, m) { return Math.sqrt(a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / a.length) || 1; };
          var mR = mean(ratings), sdR = sd(ratings, mR), mP = mean(PP.arr), sdP = sd(PP.arr, mP);
          var rateBy = {};
          D.teams.forEach(function (x) { if (x.rating != null) { rateBy[(x.team || '').toLowerCase().trim()] = +x.rating; if (x.full) rateBy[(x.full || '').toLowerCase().trim()] = +x.rating; } });
          var defArr = [], myDef = null;
          Object.keys(PP.by).forEach(function (k) { var r = rateBy[k]; if (r == null) return; var d = ((r - mR) / sdR) - ((PP.by[k] - mP) / sdP); defArr.push(d); if (k === nm || k === fn) myDef = d; });
          if (myDef == null && myOff != null && rr.rating != null) myDef = ((+rr.rating - mR) / sdR) - ((myOff - mP) / sdP);
          var pResid = pctIn(defArr, myDef);
          pDef = (pResid != null && pPow != null) ? (0.5 * pPow + 0.5 * pResid) : (pResid != null ? pResid : pPow);
        }
        return { overall: pctNum(pPow), power: pctNum(pPow), offense: pctNum(pOff), defense: pctNum(pDef) };
      });
    });
  }

  return { compute: compute };
})();
