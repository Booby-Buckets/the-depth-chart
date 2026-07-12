/* NIL valuation model (article framework) — shared constants + helpers.
   Impact = composite of BPM + WS/40 + PER + TDC grade (grade encodes usage, TS%,
   rates, Wins Added, team success), z-scored over the pool, mapped to the BPM scale.
   Market premium = size(height) * scoring(PPG) * conference — what the NIL market
   over-pays for beyond pure on-court impact.
   value = max(0, impact-replacement) * min(MPG/40,1) * market $/point * premium.
   Calibrated by scripts/compute_nil.py (re-run to refresh constants + nil-data.json). */
window.TDC_NIL = {
  // ── grade-centric realistic-market model (mirrors scripts/compute_nil.py) ──
  MODEL: { grade_floor:58, grade_span:40, curve:2.35, top_m:4.35,
           tier_mult:{1:1.00,2:0.74,3:0.54,4:0.40,5:0.29,6:0.20,7:0.13,8:0.07,9:0.03} },
  MARKET_RATE: 0.263,                                             // (legacy) $M per net-rating point
  REPL: -1.0,
  FLOOR_PTS: 1.6,                                                 // rotation-body floor: a player who plays is worth >= this many net pts (×minutes×premium)
  WALKON_THR: -6.0,                                               // impact below this = walk-on / non-rotation: nominal value
  WALKON_VALUE: 0.01,                                             // $M nominal ($10K) for walk-ons
  BASE_BY_TIER: {1:0.90,2:0.80,3:0.55,4:0.40,5:0.27,6:0.18,7:0.10,8:0.04,9:0.015}, // $M roster-spot base (×minutes), by team spending tier
  RATE_BY_TIER: {1:1.0,2:1.0,3:0.92,4:0.84,5:0.74,6:0.64,7:0.55,8:0.42,9:0.32},      // rate multiplier by team spending tier
  TIER_BUDGET: {1:22.5,2:18,3:13.5,4:10,5:7.5,6:5,7:3,8:1.25,9:0.25},
  IMPACT: {
    w:    {bpm:0.40, grade:0.30, ws40:0.20, per:0.10},
    mean: {bpm:-0.6268, ws40:0.0969, per:14.043, grade:76.7932},
    std:  {bpm:4.3192,  ws40:0.0567, per:5.3637, grade:5.3126},
    cz_mean:-0.00419, cz_std:0.9239
  },
  PREMIUM: { score:[12,27,0.18], conf:{P:1.12, M:1.00, L:0.90} },
  // size is judged RELATIVE TO POSITION — a 6'6" PG (rare, hyped) and a 6'6" C
  // (undersized for the 5) are opposite stories; a flat height curve paid them
  // the same. norms are rough position-average heights in inches.
  POS_HT_NORM: {PG:74, CG:75, SG:76, SF:78.5, PF:80.5, C:82.5, G:75, F:79},
  SIZE_FALLBACK: 75, SIZE_UP_SPAN:10, SIZE_UP:0.40, SIZE_DOWN_SPAN:6, SIZE_DOWN:0.40,
  // pillar-driven hype (scripts/grade_v4.py's 7-pillar z-scores, read from
  // bbref_seasons.grade_pillars when present) — Offense replaces raw-PPG
  // scoring hype with the same efficiency-aware pillar the grade engine uses;
  // Usage adds a ball's-in-his-hands premium (upside only); Defense applies a
  // mild discount (downside only) since the real market underpays defense
  // relative to what BPM/WS already credit it. Falls back to scoreMult(ppg)
  // when a player has no grade_pillars (freshmen, no prior D1 season).
  OFF_SPAN:2.5, OFF_UP:0.22, OFF_DOWN_SPAN:2.5, OFF_DOWN:0.15,
  USG_SPAN:2.5, USG_UP:0.15,
  DEF_SPAN:2.5, DEF_DOWN:0.10
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
  N.tierNum     = function(t){ var m=(''+(t==null?'':t)).match(/\d+/); return m?+m[0]:5; };
  N.value       = function(imp,mpg,tier){ var tn=N.tierNum(tier); return N.isWalkon(imp) ? N.WALKON_VALUE : N.contribution(imp,mpg) * N.MARKET_RATE * (N.RATE_BY_TIER[tn]||0.6); };   // production $M (no premium), tier-scaled
  // ── market premium: size (height), scoring (PPG), conference ──
  N.htIn = function(h){ if(!h) return null; var m=(''+h).match(/(\d+)\s*[-’']\s*(\d+)/); return m?(+m[1]*12+ +m[2]):null; };
  N.sizeMult  = function(htIn,pos){ if(!htIn) return 1;
    var norm=N.POS_HT_NORM[(''+(pos||'')).toUpperCase().trim()]||N.SIZE_FALLBACK, d=htIn-norm;
    if(d>=0) return 1+Math.min(d/N.SIZE_UP_SPAN,1)*N.SIZE_UP;                        // tall for the position: premium
    return 1-Math.min((-d)/N.SIZE_DOWN_SPAN,1)*N.SIZE_DOWN; };                        // short for the position: discount
  N.scoreMult = function(ppg){  if(!ppg)  return 1; var a=P.score; return 1+Math.min(Math.max((ppg-a[0])/(a[1]-a[0]),0),1)*a[2]; };
  // ── pillar-driven hype: offense (replaces scoreMult when available), usage, defense ──
  N.offenseMult = function(z){ if(z==null) return null;
    return z>=0 ? 1+Math.min(z/N.OFF_SPAN,1)*N.OFF_UP : 1+Math.max(z/N.OFF_DOWN_SPAN,-1)*N.OFF_DOWN; };
  N.usageMult   = function(z){ if(z==null) return 1; return 1+Math.min(Math.max(z/N.USG_SPAN,0),1)*N.USG_UP; };
  N.defenseMult = function(z){ if(z==null) return 1; return 1-Math.min(Math.max(z/N.DEF_SPAN,0),1)*N.DEF_DOWN; };
  N.confClass = function(c){ c=(''+(c||'')).toLowerCase();
    if(/big ten|big 12|southeastern|big east|atlantic coast/.test(c) || ['acc','sec','b10','b12','be','big-east'].indexOf(c)>=0) return 'P';
    if(/american|atlantic 10|mountain west|west coast|conference usa|sun belt|mid-american|missouri valley/.test(c) || ['aac','a10','a-10','mwc','wcc'].indexOf(c)>=0) return 'M';
    return 'L'; };
  N.confMult  = function(cls){ return P.conf[cls] || 1; };
  // pillars: {offense,usage,defense,...} z-scores from bbref_seasons.grade_pillars, or null/undefined
  N.marketPremium = function(htIn,ppg,confCode,pos,pillars){
    pillars=pillars||{};
    var off=N.offenseMult(pillars.offense), hype=(off!=null?off:N.scoreMult(ppg));
    hype *= N.usageMult(pillars.usage) * N.defenseMult(pillars.defense);
    return N.sizeMult(htIn,pos)*hype*N.confMult(N.confClass(confCode)); };
  N.baseIntercept = function(mpg,tier){ var ms=Math.min(Math.max(+mpg,0)/40,1); return (N.BASE_BY_TIER[N.tierNum(tier)]||0.1) * ms; }; // $M roster-spot base (tier-scaled)
  // ── grade-centric realistic-market value (the live model, matches compute_nil.py) ──
  N.gradeBase = function(g){ if(g==null||!isFinite(+g)) return 0; var x=Math.max(0,Math.min(1,(+g-N.MODEL.grade_floor)/N.MODEL.grade_span)); return Math.pow(x,N.MODEL.curve); };
  N.minFactor = function(mp){ mp=+mp||0; return Math.max(0.30, Math.pow(Math.min(Math.max(mp,0),34)/34,0.55)); };
  N.youthMult = function(cls){ var c=(''+(cls||'')).toLowerCase(); if(c.indexOf('fr')>=0)return 1.10; if(c.indexOf('so')>=0)return 1.05; if(c.indexOf('sr')>=0||c.indexOf('gr')>=0)return 0.97; return 1.0; };
  // grade -> $M NIL value. prem = N.marketPremium(...); cls = class_year string.
  N.gradeValue = function(grade,mpg,tier,prem,cls){ var b=N.gradeBase(grade); if(b<=0.003) return N.WALKON_VALUE;
    var tm=N.MODEL.tier_mult[N.tierNum(tier)]||0.2; return b*N.MODEL.top_m*tm*N.minFactor(mpg)*(prem||1)*N.youthMult(cls); };
  N.marketValue   = function(imp,mpg,htIn,ppg,confCode,tier,pos,pillars){ return N.isWalkon(imp) ? N.WALKON_VALUE : N.value(imp,mpg,tier)*N.marketPremium(htIn,ppg,confCode,pos,pillars) + N.baseIntercept(mpg,tier); }; // $M
  N.tierBudget  = function(t){ return N.TIER_BUDGET[+((''+t).replace(/\D/g,''))] || null; };
  N.fmt         = function(m){ if(m==null||!isFinite(m)) return '—'; return m>=1 ? ('$'+(+m).toFixed(2)+'M') : ('$'+Math.round(m*1000)+'K'); };
})();
