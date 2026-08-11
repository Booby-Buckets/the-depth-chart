/* NIL valuation model (article framework) — shared constants + helpers.
   Impact = composite of BPM + WS/40 + PER + TDC grade (grade encodes usage, TS%,
   rates, Wins Added, team success), z-scored over the pool, mapped to the BPM scale.
   Market premium = size(height) * scoring(PPG) * conference — what the NIL market
   over-pays for beyond pure on-court impact.
   value = max(0, impact-replacement) * min(MPG/40,1) * market $/point * premium.
   Calibrated by scripts/compute_nil.py (re-run to refresh constants + nil-data.json). */
window.TDC_NIL = {
  // ── grade-centric realistic-market model (mirrors scripts/compute_nil.py) ──
  MODEL: { grade_floor:58, grade_span:42, curve:1.64, top_m:6.62,  // 2026-08: curve flattened 2.127→1.64 + top_m trimmed → mid/role +~27%, stars ~flat (see compute_nil.py)
           tier_mult:{1:1.00,2:0.74,3:0.54,4:0.40,5:0.29,6:0.20,7:0.13,8:0.07,9:0.03},
           pos_mult:{PG:1.00,CG:1.00,SG:1.00,G:1.00,SF:1.00,GF:1.00,F:1.03,PF:1.06,FC:1.07,C:1.08} },  // grades are position-relative, so only a mild big premium
  MARKET_RATE: 0.263,                                             // (legacy) $M per net-rating point
  REPL: -1.0,
  FLOOR_PTS: 1.6,                                                 // rotation-body floor: a player who plays is worth >= this many net pts (×minutes×premium)
  WALKON_THR: -6.0,                                               // impact below this = walk-on / non-rotation: nominal value
  WALKON_VALUE: 0.01,                                             // $M nominal ($10K) for walk-ons
  BASE_BY_TIER: {1:0.90,2:0.80,3:0.55,4:0.40,5:0.27,6:0.18,7:0.10,8:0.04,9:0.015}, // $M roster-spot base (×minutes), by team spending tier
  RATE_BY_TIER: {1:1.0,2:1.0,3:0.92,4:0.84,5:0.74,6:0.64,7:0.55,8:0.42,9:0.32},      // rate multiplier by team spending tier
  TIER_BUDGET: {1:36.0,2:29.7,3:17.5,4:12.8,5:6.9,6:5.0,7:2.5,8:1.2,9:0.4},  // ×1.38 (2026-08) to track the curve-flatten value lift; keeps ~60% deals
  IMPACT: {
    w:    {bpm:0.40, grade:0.30, ws40:0.20, per:0.10},
    mean: {bpm:-0.6268, ws40:0.0969, per:14.043, grade:76.7932},
    std:  {bpm:4.3192,  ws40:0.0567, per:5.3637, grade:5.3126},
    cz_mean:-0.00419, cz_std:0.9239
  },
  PREMIUM: { score:[12,27,0.18], conf:{P:1.345, M:1.00, L:0.90} },  // power-conf +73% vs mid/low +44% (2025 market)
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
  N.minFactor = function(mp){ mp=+mp||0; return Math.max(0.40, Math.pow(Math.min(Math.max(mp,0),30)/30,0.5)); };
  // projected role: a grade-implied minutes FLOOR so a breakout returner isn't valued on last year's bench minutes
  N.estMpg    = function(mpg,grade){ var mp=+mpg||0, g=+grade||72; var ge=g>=90?28:g>=82?25:g>=76?21:g>=70?17:12; return Math.max(mp,ge); };
  N.youthMult = function(cls){ var c=(''+(cls||'')).toLowerCase(); if(c.indexOf('so')>=0)return 1.22; if(c.indexOf('fr')>=0)return 1.05; if(c.indexOf('jr')>=0)return 1.02; if(c.indexOf('sr')>=0||c.indexOf('gr')>=0)return 0.90; return 1.0; };
  // positional pricing: our grades are already position-relative, so real deals show no
  // center premium in grade-space — only a whisper of a big bump (PF 1.06 / C 1.08).
  N.posMult   = function(pos){ return N.MODEL.pos_mult[(''+(pos||'')).toUpperCase().split('/')[0].trim()] || 1.0; };
  N.bigMult   = N.posMult;   // back-compat alias
  N.prospectMult = function(g,cls){ return 1.0; };   // removed: real deals show elite freshmen aren't paid a premium
  // grade -> $M NIL value. prem = N.marketPremium(...); cls = class_year; pos = PG/…/C.
  N.gradeValue = function(grade,mpg,tier,prem,cls,pos){ var b=N.gradeBase(grade); if(b<=0.003) return N.WALKON_VALUE;
    var tm=N.MODEL.tier_mult[N.tierNum(tier)]||0.2;
    return b*N.MODEL.top_m*tm*N.minFactor(N.estMpg(mpg,grade))*(prem||1)*N.youthMult(cls)*N.bigMult(pos,grade)*N.prospectMult(grade,cls); };
  N.marketValue   = function(imp,mpg,htIn,ppg,confCode,tier,pos,pillars){ return N.isWalkon(imp) ? N.WALKON_VALUE : N.value(imp,mpg,tier)*N.marketPremium(htIn,ppg,confCode,pos,pillars) + N.baseIntercept(mpg,tier); }; // $M
  // ── open-market pricing: value a player by his OWN worth, not his program's spending tier ──
  // A player's market value = what a TOP program would pay him (the open market is set by the
  // top bidders), boosted so the very best land at real-deal levels (a generational recruit ~$6M,
  // e.g. Tyran Stokes). NEUTRAL_MULT = top-of-market (tier-1 = 1.0) × ceiling boost (1.254).
  // Same player is worth the same at a blue-blood or a mid-major — talent/role/premium, not program.
  N.NEUTRAL_MULT = 1.254;
  N.gradeValueNeutral = function(grade,mpg,prem,cls,pos){ var b=N.gradeBase(grade); if(b<=0.003) return N.WALKON_VALUE;
    return b*N.MODEL.top_m*N.NEUTRAL_MULT*N.minFactor(N.estMpg(mpg,grade))*(prem||1)*N.youthMult(cls)*N.bigMult(pos,grade)*N.prospectMult(grade,cls); };
  N.deTier = function(value,tier){ if(value==null||!isFinite(+value)||+value<=N.WALKON_VALUE*1.5) return value;  // rescale a precomputed tier-based value to open-market
    var tm=N.MODEL.tier_mult[N.tierNum(tier)]||0.2; return (+value)*N.NEUTRAL_MULT/tm; };
  // open-market value of a nil-data player row: real deals (override) shown as-is; walk-ons untouched;
  // everyone else rescaled off their program's tier. Use this so a known deal isn't distorted by the rescale.
  N.neutralValueOf = function(p,tier){ if(!p) return 0; var v=+(p.value); if(!isFinite(v)) return 0;
    if(p.override||p.walkon) return v; return N.deTier(v,tier); };
  N.tierBudget  = function(t){ return N.TIER_BUDGET[+((''+t).replace(/\D/g,''))] || null; };
  N.fmt         = function(m){ if(m==null||!isFinite(m)) return '—'; return m>=1 ? ('$'+(+m).toFixed(2)+'M') : ('$'+Math.round(m*1000)+'K'); };
})();

// ── NIL MARKET VALUE (positional curves) ──────────────────────────────────
// Distinct from the production MODEL value above: the owner sets $ anchors per POSITION
// at grades 90/80/70 (nil_market_anchors.json / tuned live), and a player's Market Value is
// their grade interpolated on that position curve — independent of minutes/role. Two
// grade-88 wings carry the same market price even if one plays 30 mpg and the other 12.
(function(){
  var N = window.TDC_NIL; if(!N) return;
  N.POS5 = function(pos){ pos=(''+(pos||'')).toUpperCase().trim();
    if(pos.indexOf('PG')>=0) return 'PG';
    if(pos.indexOf('SG')>=0||pos==='CG') return 'SG';
    if(pos.indexOf('SF')>=0||pos==='GF') return 'SF';
    if(pos.indexOf('PF')>=0) return 'PF';
    if(pos==='C'||pos.indexOf('C')>=0) return 'C';
    if(pos==='G') return 'SG'; if(pos==='F') return 'SF';
    return 'SF'; };
  // Market $ for (position, grade) off the [90,80,70]-anchor curve. curves = {PG:{90,80,70},…}.
  N.curveMarket = function(pos, grade, curves){
    if(grade==null||!isFinite(+grade)) return null;
    curves = curves || N.MARKET || {}; var c = curves[N.POS5(pos)]; if(!c) return null;
    var v90=+c['90'], v80=+c['80'], v70=+c['70'];
    if(!isFinite(v90)||!isFinite(v80)||!isFinite(v70)) return null;
    var g=+grade, v;
    if(g>=90) v = v90 + (v90-v80)/10*(g-90)*0.6;        // dampened extrapolation above 90
    else if(g>=80) v = v80 + (v90-v80)*(g-80)/10;
    else if(g>=70) v = v70 + (v80-v70)*(g-70)/10;
    else v = v70 - (v80-v70)*(70-g)/10;                 // extend below 70
    return Math.max(0.03, Math.round(v*1000)/1000);
  };
  // ── out-of-position market pricing ─────────────────────────────────────────
  // A player physically bigger/smaller than his LISTED slot (a 6-9 "SF" who's really a PF)
  // is priced by the market on his true archetype. naturalPos = nearest position by height;
  // bestMarket prices an OUT-of-position player at the HIGHEST-value position in the range
  // between his listed slot and his height-natural one (never lowers him). In-position → listed.
  N.POS_ORDER = ['PG','SG','SF','PF','C'];
  N.POS_HT = {PG:74, SG:76, SF:78.5, PF:80.5, C:82.5};
  N.naturalPos = function(htIn){ if(!htIn||!isFinite(+htIn)) return null;
    var best=null, bd=1e9; N.POS_ORDER.forEach(function(p){ var d=Math.abs(+htIn-N.POS_HT[p]); if(d<bd){ bd=d; best=p; } }); return best; };
  // Only FORWARDS/CENTERS are size-defined — a tall PG/SG is still a guard, so guards are
  // NEVER reclassified. A forward/center only shifts UP the frontcourt ladder (SF→PF→C) when
  // his height puts him at a bigger slot (a 6-9 "SF" is a PF, a 6-11 "PF" is a C); never down,
  // never into a guard slot.
  N.FRONT = {SF:1, PF:1, C:1};
  N.bestMarket = function(grade, pos, htIn, curves){
    var lp=N.POS5(pos), base=N.curveMarket(lp, grade, curves);
    if(!N.FRONT[lp]) return {val:base, pos:lp, moved:false};                 // guards keep their slot
    var np=N.naturalPos(htIn);
    if(np==null || !N.FRONT[np]) return {val:base, pos:lp, moved:false};     // don't pull a forward into a guard slot
    var i=N.POS_ORDER.indexOf(lp), j=N.POS_ORDER.indexOf(np);
    if(j<=i) return {val:base, pos:lp, moved:false};                         // only bigger, never smaller
    var bp=lp, bv=base;
    for(var k=i;k<=j;k++){ var v=N.curveMarket(N.POS_ORDER[k], grade, curves); if(v!=null && (bv==null||v>bv)){ bv=v; bp=N.POS_ORDER[k]; } }
    return {val:bv, pos:bp, moved:bp!==lp};
  };

  // ── UNDERRATED / OVERRATED vs market (TIER-FAIR) ──────────────────────────
  // "Slept on" should mean TALENT the market underprices — not just "plays at a rich school."
  // Model bakes in team wealth (tier) while Market is tier-blind, so we first STRIP the tier
  // scaling out of Model (→ tier-neutral production) and rescale it to the market's level via
  // TIER_REF, then compare that talent-production to the market price for his grade & slot:
  //   prod >= 1.30× Market → UNDERRATED (produces more than his grade-slot market price)
  //   Market >= 1.30× prod → OVERRATED
  // Only real rotation pieces are judged (grade/mpg + a market floor) so grade-curve-floor
  // bench players don't create false extremes. Returns {tag, ratio, delta, prod}.
  N.MARK_RATIO = 1.30;                          // ±30% divergence to earn a tag (owner-chosen)
  N.MARK_MINGRADE = 74; N.MARK_MINMPG = 10; N.MARK_MINVAL = 0.25;   // qualifier floors
  N.TIER_REF = 0.48;   // rescales tier-neutral production to the market's level (median-matched over the 2026-27 pool)
  N.marketVerdict = function(model, market, opts){
    opts = opts || {};
    var g = +opts.grade, mp = +opts.mpg;
    if(model==null||market==null||!isFinite(+model)||!isFinite(+market)) return {tag:null};
    model=+model; market=+market;
    if((isFinite(g)&&g<N.MARK_MINGRADE) || (isFinite(mp)&&mp<N.MARK_MINMPG) || market<N.MARK_MINVAL)
      return {tag:null};   // not qualified — no badge
    // tier-fair production: divide out team-wealth scaling, rescale to market level
    var prod = model, tn = (opts.tier!=null) ? N.tierNum(opts.tier) : null;
    if(tn!=null){ var tm = N.MODEL.tier_mult[tn] || 0.29; prod = model / tm * N.TIER_REF; }
    if(prod < N.MARK_MINVAL) return {tag:null};
    var r = prod/market, d = prod-market;
    if(r >= N.MARK_RATIO)   return {tag:'underrated', ratio:r,   delta:d, prod:prod};
    if(1/r >= N.MARK_RATIO) return {tag:'overrated',  ratio:1/r, delta:d, prod:prod};
    return {tag:'fair', ratio:r, delta:d, prod:prod};
  };
  N.markLabel = function(tag){ return tag==='underrated'?'UNDERRATED':tag==='overrated'?'OVERRATED':tag==='fair'?'FAIR VALUE':''; };
  // green = value/underrated, amber = overrated (matches the Δ coloring already on the pages)
  N.markColor = function(tag){ return tag==='underrated'?'var(--green)':tag==='overrated'?'var(--amber)':'var(--text3)'; };
})();
