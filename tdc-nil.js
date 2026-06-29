/* NIL valuation model (article framework) — shared constants + helpers.
   Impact = composite of BPM + WS/40 + PER + TDC grade (grade encodes usage, TS%,
   rates, Wins Added, team success), z-scored over the pool, mapped to the BPM scale.
   Market premium = size(height) * scoring(PPG) * conference — what the NIL market
   over-pays for beyond pure on-court impact.
   value = max(0, impact-replacement) * min(MPG/40,1) * market $/point * premium.
   Calibrated by scripts/compute_nil.py (re-run to refresh constants + nil-data.json). */
window.TDC_NIL = {
  MARKET_RATE: 0.263,                                             // $M per net-rating point — fixed from real salary data (Tennessee anchors)
  REPL: -1.0,
  FLOOR_PTS: 1.6,                                                 // rotation-body floor: a player who plays is worth >= this many net pts (×minutes×premium)
  WALKON_THR: -6.0,                                               // impact below this = walk-on / non-rotation: nominal value
  WALKON_VALUE: 0.01,                                             // $M nominal ($10K) for walk-ons
  BASE_INTERCEPT: {P:1.00, M:0.45, L:0.18},                       // $M roster-spot base a rotation player commands before production (×minutes), by conf level
  TIER_BUDGET: {1:22.5,2:18,3:13.5,4:10,5:7.5,6:5,7:3,8:1.25,9:0.25},
  IMPACT: {
    w:    {bpm:0.40, grade:0.30, ws40:0.20, per:0.10},
    mean: {bpm:-0.6268, ws40:0.0969, per:14.043, grade:76.7932},
    std:  {bpm:4.3192,  ws40:0.0567, per:5.3637, grade:5.3126},
    cz_mean:-0.00419, cz_std:0.9239
  },
  PREMIUM: { size:[75,85,0.40], score:[12,27,0.18], conf:{P:1.12, M:1.00, L:0.90} }
};
(function(){
  var N = window.TDC_NIL, I = N.IMPACT, P = N.PREMIUM;
  function zz(k,v){ if(v==null||v===''||!isFinite(+v)) return null; return ((+v)-I.mean[k])/I.std[k]; }
  N.impact = function(bpm,ws40,per,grade){
    var parts=[], src=[['bpm',bpm],['ws40',ws40],['per',per],['grade',grade]];
    for(var i=0;i<src.length;i++){ var z=zz(src[i][0],src[i][1]); if(z!=null) parts.push([I.w[src[i][0]],z]); }
    if(!parts.length) return null;
    var wsum=0,s=0; parts.forEach(function(p){ wsum+=p[0]; s+=p[0]*p[1]; });
    return I.mean.bpm + I.std.bpm*((s/wsum)-I.cz_mean)/I.cz_std;
  };
  N.gradeImpact = function(grade){ return N.impact(null,null,null,grade); };
  N.blendImpact = function(provenImp, grade){ var pj=N.gradeImpact(grade);
    if(provenImp==null) return pj; if(pj==null) return provenImp; return (provenImp+pj)/2; };
  N.contribution= function(imp,mpg){ var eff=Math.max((+imp)-N.REPL, N.FLOOR_PTS); return eff * Math.min(Math.max(+mpg,0)/40,1); };
  N.isWalkon    = function(imp){ return (+imp) < N.WALKON_THR; };
  N.value       = function(imp,mpg){ return N.isWalkon(imp) ? N.WALKON_VALUE : N.contribution(imp,mpg) * N.MARKET_RATE; };   // analytical $M (no premium)
  // ── market premium: size (height), scoring (PPG), conference ──
  N.htIn = function(h){ if(!h) return null; var m=(''+h).match(/(\d+)\s*[-’']\s*(\d+)/); return m?(+m[1]*12+ +m[2]):null; };
  N.sizeMult  = function(htIn){ if(!htIn) return 1; var a=P.size;  return 1+Math.min(Math.max((htIn-a[0])/(a[1]-a[0]),0),1)*a[2]; };
  N.scoreMult = function(ppg){  if(!ppg)  return 1; var a=P.score; return 1+Math.min(Math.max((ppg-a[0])/(a[1]-a[0]),0),1)*a[2]; };
  N.confClass = function(c){ c=(''+(c||'')).toLowerCase();
    if(/big ten|big 12|southeastern|big east|atlantic coast/.test(c) || ['acc','sec','b10','b12','be','big-east'].indexOf(c)>=0) return 'P';
    if(/american|atlantic 10|mountain west|west coast|conference usa|sun belt|mid-american|missouri valley/.test(c) || ['aac','a10','a-10','mwc','wcc'].indexOf(c)>=0) return 'M';
    return 'L'; };
  N.confMult  = function(cls){ return P.conf[cls] || 1; };
  N.marketPremium = function(htIn,ppg,confCode){ return N.sizeMult(htIn)*N.scoreMult(ppg)*N.confMult(N.confClass(confCode)); };
  N.baseIntercept = function(mpg,confCode){ var ms=Math.min(Math.max(+mpg,0)/40,1); return (N.BASE_INTERCEPT[N.confClass(confCode)]||0) * ms; }; // $M roster-spot base
  N.marketValue   = function(imp,mpg,htIn,ppg,confCode){ return N.isWalkon(imp) ? N.WALKON_VALUE : N.value(imp,mpg)*N.marketPremium(htIn,ppg,confCode) + N.baseIntercept(mpg,confCode); }; // $M
  N.tierBudget  = function(t){ return N.TIER_BUDGET[+((''+t).replace(/\D/g,''))] || null; };
  N.fmt         = function(m){ if(m==null||!isFinite(m)) return '—'; return m>=1 ? ('$'+(+m).toFixed(2)+'M') : ('$'+Math.round(m*1000)+'K'); };
})();
