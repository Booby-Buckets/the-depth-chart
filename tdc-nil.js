/* NIL valuation model (article framework) — shared constants + helpers.
   Impact is a COMPOSITE of BPM + WS/40 + PER + TDC grade (grade itself encodes usage,
   TS%, rate stats, Wins Added and team success), z-scored over the qualified pool and
   mapped onto the BPM / net-rating-per-100 scale.
   value = max(0, impact - replacement) * min(MPG/40,1) * market $/point.
   Calibrated by scripts/compute_nil.py (re-run to refresh these constants + nil-data.json). */
window.TDC_NIL = {
  MARKET_RATE: 0.3657,                                            // $M per net-rating point (median budget/production)
  REPL: -1.0,                                                     // replacement level, per 100
  TIER_BUDGET: {1:22.5,2:18,3:13.5,4:10,5:7.5,6:5,7:3,8:1.25,9:0.25}, // $M midpoints of each NIL tier
  IMPACT: {
    w:    {bpm:0.40, grade:0.30, ws40:0.20, per:0.10},            // composite weights (renormalized over present inputs)
    mean: {bpm:-0.6383, ws40:0.097, per:14.0533, grade:76.838},
    std:  {bpm:4.336,  ws40:0.0569, per:5.3686,  grade:5.3477},
    cz_mean:-0.00289, cz_std:0.92555
  }
};
(function(){
  var N = window.TDC_NIL, I = N.IMPACT;
  function zz(k,v){ if(v==null||v===''||!isFinite(+v)) return null; return ((+v)-I.mean[k])/I.std[k]; }
  // composite impact (BPM/per-100 scale) from any subset of {bpm, ws40, per, grade}
  N.impact = function(bpm,ws40,per,grade){
    var parts=[], src=[['bpm',bpm],['ws40',ws40],['per',per],['grade',grade]];
    for(var i=0;i<src.length;i++){ var z=zz(src[i][0],src[i][1]); if(z!=null) parts.push([I.w[src[i][0]],z]); }
    if(!parts.length) return null;
    var wsum=0,s=0; parts.forEach(function(p){ wsum+=p[0]; s+=p[0]*p[1]; });
    var cz=s/wsum;
    return I.mean.bpm + I.std.bpm*((cz-I.cz_mean)/I.cz_std);
  };
  N.gradeImpact = function(grade){ return N.impact(null,null,null,grade); };          // grade-only (projection)
  N.blendImpact = function(provenImp, grade){ var pj=N.gradeImpact(grade);            // blend proven + projected
    if(provenImp==null) return pj; if(pj==null) return provenImp; return (provenImp+pj)/2; };
  N.contribution= function(imp,mpg){ return Math.max(0,(+imp)-N.REPL) * Math.min(Math.max(+mpg,0)/40,1); }; // net-rating pts
  N.value       = function(imp,mpg){ return N.contribution(imp,mpg) * N.MARKET_RATE; };  // $M
  N.tierBudget  = function(t){ return N.TIER_BUDGET[+((''+t).replace(/\D/g,''))] || null; };
  N.fmt         = function(m){ if(m==null||!isFinite(m)) return '—'; return m>=1 ? ('$'+(+m).toFixed(2)+'M') : ('$'+Math.round(m*1000)+'K'); };
})();
