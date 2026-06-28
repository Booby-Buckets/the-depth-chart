/* NIL valuation model (per the article framework) — shared constants + helpers.
   value = max(0, BPM - replacement) * min(MPG/40,1) * market $/point.
   Calibrated by scripts/compute_nil.py (re-run to refresh constants + nil-data.json). */
window.TDC_NIL = {
  MARKET_RATE: 0.407,                                              // $M per net-rating point (median budget/production)
  REPL: -1.0,                                                      // replacement level, per 100
  SLOPE: 0.74,                                                     // projected BPM = SLOPE * (TDC grade - 78)
  TIER_BUDGET: {1:22.5,2:18,3:13.5,4:10,5:7.5,6:5,7:3,8:1.25,9:0.25} // $M midpoints of each NIL tier range
};
(function(){
  var N = window.TDC_NIL;
  N.gradeBpm    = function(g){ return N.SLOPE * (((+g)||78) - 78); };
  N.contribution= function(bpm,mpg){ return Math.max(0,(+bpm)-N.REPL) * Math.min(Math.max(+mpg,0)/40,1); }; // net-rating pts added
  N.value       = function(bpm,mpg){ return N.contribution(bpm,mpg) * N.MARKET_RATE; };  // $M
  // blend proven BPM with grade-projected BPM (for forward projections); pass projBpm=null for actual seasons
  N.blendBpm    = function(provenBpm, grade){ var pj=N.gradeBpm(grade); return (provenBpm==null)?pj:((+provenBpm)+pj)/2; };
  N.tierBudget  = function(t){ return N.TIER_BUDGET[+((''+t).replace(/\D/g,''))] || null; };
  N.fmt         = function(m){ if(m==null||!isFinite(m)) return '—'; return m>=1 ? ('$'+(+m).toFixed(2)+'M') : ('$'+Math.round(m*1000)+'K'); };
})();
