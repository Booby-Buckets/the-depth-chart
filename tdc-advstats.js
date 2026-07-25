/* tdc-advstats.js — two original TDC metrics, derived from the shot-genome +
   Team DNA data already precomputed on the site (no tracking data required).

   • Shot Value Over Expected (SVOE): points per shot a player/team scores above
     what their shot DIET alone predicts. Expected pts/shot = 2·(Look Quality),
     Actual = 2·(actual eFG%); SVOE is the gap. Baseball-style value-over-average.

   • Defensive Disruption Index (DDI): one 0-100 number for how much a defense
     disrupts offenses, from the signals box+shot data can see — forcing bad shots
     (low opponent Look Quality), denying shot-making (low opp SM+), and forcing
     turnovers (Team DNA forced-TOV%). Percentile-ranked across the team field.
     NOTE: no player-tracking, so contested-3s / drives-stopped / shot-clock
     violations are NOT included — DDI captures shot-quality + turnover pressure. */
(function(global){
  function num(v){ var n=parseFloat(v); return isNaN(n)?null:n; }
  // eFG% → points per field-goal attempt is 2·eFG% (eFG credits the extra 3pt point)
  function svoe(lq, efg){
    lq=num(lq); efg=num(efg); if(lq==null||efg==null) return null;
    var exp=Math.round(2*lq)/100, act=Math.round(2*efg)/100;   // 2·(pct/100)
    return { exp:exp, act:act, svoe:Math.round((act-exp)*100)/100 };
  }
  function pctRank(arr, v, invert){
    var n=arr.map(num).filter(function(x){return x!=null;});
    v=num(v); if(!n.length||v==null) return null;
    var below=n.filter(function(x){return x<v;}).length + n.filter(function(x){return x===v;}).length*0.5;
    var p=below/n.length*100;
    return Math.round(invert?100-p:p);
  }
  // teamGenome: a shot_genome_teams entry {def:{lq,smAdj}} ; dnaRow: {dTOV}
  // allGenomes: array of team genome entries ; allDna: array of DNA rows (season)
  function ddi(teamGenome, dnaRow, allGenomes, allDna){
    if(!teamGenome||!teamGenome.def) return null;
    var oppLQ=(allGenomes||[]).map(function(t){return t&&t.def?t.def.lq:null;});
    var oppSM=(allGenomes||[]).map(function(t){return t&&t.def?t.def.smAdj:null;});
    var tovs =(allDna||[]).map(function(d){return d?d.dTOV:null;});
    var pBad = pctRank(oppLQ, teamGenome.def.lq, true);        // force LOW opp look quality
    var pSupp= pctRank(oppSM, teamGenome.def.smAdj, true);     // hold opp BELOW expected
    var pTov = dnaRow!=null ? pctRank(tovs, dnaRow.dTOV, false) : null;  // force MORE turnovers
    var parts=[ {k:'Forced bad shots', v:pBad, w:0.42},
                {k:'Shot-making denied', v:pSupp, w:0.30},
                {k:'Forced turnovers', v:pTov, w:0.28} ].filter(function(x){return x.v!=null;});
    if(!parts.length) return null;
    var wsum=parts.reduce(function(t,x){return t+x.w;},0);
    var score=Math.round(parts.reduce(function(t,x){return t+x.v*x.w;},0)/wsum);
    return { ddi:score, parts:parts, tier: score>=80?'Elite':score>=62?'Stingy':score>=42?'Average':'Porous' };
  }
  global.TDCAdv={ svoe:svoe, ddi:ddi, pctRank:pctRank };
})(typeof window!=='undefined'?window:this);
