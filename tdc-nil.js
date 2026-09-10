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
  N.confClass = function(c){ c=(''+(c||'')).toLowerCase().replace(/[\s\-_.]/g,'');   // normalize: "BIG-12"→"big12"
    if(/bigten|big12|southeastern|bigeast|atlanticcoast/.test(c) || ['acc','sec','b10','b12','be','bigeast','big12','bigten'].indexOf(c)>=0) return 'P';
    if(/american|atlantic10|mountainwest|westcoast|conferenceusa|sunbelt|midamerican|missourivalley|pac12|pacific/.test(c) || ['aac','a10','mwc','wcc','pac12','pac'].indexOf(c)>=0) return 'M';
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
  // A player's market value = his own worth on a realistic open market. Anchor tuned so the top
  // of the market lands ~$4.0M (grade-90 star ~$4M, solid starter ~$1.3M, league median ~$0.8M) —
  // outlier overpays like Stokes's reported $6M are NOT the star rate, so the scale isn't pushed
  // toward them. Same player is worth the same at a blue-blood or a mid-major — talent/role, not
  // program. (Known real deals still show as-is via neutralValueOf.)
  N.NEUTRAL_MULT = 0.47;   // (legacy — used only by the deprecated deTier rescale path below)
  // ── GRADE-LED open-market value (2026-09 rebuild) ──────────────────────────────────────────
  // The old neutral model let the market premium (scoring/conf) and minutes swing more than the
  // grade, so g86 volume scorers out-earned g93/g94 stars and freshmen recruits were buried on
  // last-year minutes. Now the GRADE leads: a steep grade curve separates the top, the market
  // premium is compressed to a secondary nudge, and the grade-implied minutes floor (estMpg)
  // keeps projected stars from being penalised for no prior stats. Recruiting pedigree is NOT
  // applied here — grade already values the stars (kept for Moneyball's market-hype view only).
  N.NEU_CURVE = 2.6;     // grade steepness (grade leads)
  N.NEU_PREMW = 0.45;    // marketability weight: a 2.0x premium becomes ~1.45x
  N.NEU_TOP   = 6.3;     // ceiling anchor → top star ~$6M (retuned 7.65->6.3 after grades were repointed to the live stat_overall, which shifted the scale)
  N.neuGradeBase = function(g){ if(g==null||!isFinite(+g)) return 0; var x=Math.max(0,Math.min(1,(+g-N.MODEL.grade_floor)/N.MODEL.grade_span)); return Math.pow(x,N.NEU_CURVE); };
  N.premAdj      = function(pr){ pr=(pr==null||!isFinite(+pr))?1:+pr; return 1+N.NEU_PREMW*(pr-1); };
  N.neuMinFactor = function(mp){ mp=+mp||0; return Math.max(0.55, Math.pow(Math.min(Math.max(mp,0),30)/30,0.5)); };
  N.neuYouth     = function(cls){ var c=(''+(cls||'')).toLowerCase(); if(c.indexOf('so')>=0)return 1.10; if(c.indexOf('fr')>=0)return 1.05; if(c.indexOf('jr')>=0)return 1.00; if(c.indexOf('sr')>=0||c.indexOf('gr')>=0)return 0.92; return 1.00; };
  // PRODUCTION REALITY CHECK — owned Wins Added vs what the grade implies. NIL cares about what a
  // player actually DID: an injury / small sample / hollow box-score stats (a high grade off few
  // games or empty volume) is discounted toward reality. Freshmen & no-prior-season players (wa
  // null) are NEUTRAL — priced on grade/projection since they have no production yet. Discount-only
  // (capped at 1.0) so it never inflates the ceiling. EXP_WA = median WA by grade (from the pool).
  N.EXP_WA = {64:0.2,66:0.2,68:0.3,70:0.6,72:1.0,74:1.5,76:2.0,78:2.5,80:2.9,82:3.3,84:3.4,86:3.7,88:4.1,90:4.2,92:4.2,94:5.1};
  N.expWA = function(g){ g=+g; if(!isFinite(g)) return null; if(g<=64) return N.EXP_WA[64]; if(g>=94) return N.EXP_WA[94];
    var lo=Math.floor(g/2)*2, hi=lo+2, a=N.EXP_WA[lo], b=N.EXP_WA[hi]; if(a==null||b==null) return a||b||null; return a+(b-a)*((g-lo)/2); };
  // Production weight: value should track PRODUCTION, not just the grade. This is a TWO-SIDED
  // multiplier on the grade value — a returner who out-produces his grade is rewarded, one who
  // under-produces is docked (the old version was dock-only + capped at 1.0, so a high grade always
  // kept full value however little he actually produced — that's the grade-value over-correlation).
  // Keyed on WA vs expected-for-grade; the 0.29/0.54 center (≈0.83 at expectation) is a compensation
  // constant that holds the returner AVERAGE and the ceiling (~$6M top) while production redistributes.
  // Freshmen have no track record → returns 1 (they stay grade/pedigree-priced; upside via youth/prospect).
  N.waCoherence = function(grade,wa){ if(wa==null||wa===''||!isFinite(+wa)) return 1; var e=N.expWA(grade); if(!e||e<=0) return 1;
    return Math.max(0.33, Math.min(1.29, 0.29+0.54*((+wa)/e))); };
  // corrected market premium: FRESHMEN have no scoring/pillar data, so their baked prem is just
  // size×conference — but some baked it with a MIS-CLASSIFIED conference (Big-12/Pac-12 read as
  // low-major). Recompute cleanly from the row's size + (fixed) confClass. Returners keep their
  // baked prem (it carries pillar-based efficiency the row can't reproduce).
  N.premOf = function(p){ if(!p) return 1;
    if((p.ppg==null||p.ppg==='') && p.conf!=null && p.ht!=null && N.sizeMult) return N.sizeMult(p.ht,p.pos)*N.confMult(N.confClass(p.conf));
    var pr=(p.prem!=null&&isFinite(+p.prem))?+p.prem:1;
    // returners: the baked prem mis-classified BIG-12 & PAC-12 as low-major (conf factor 0.90). Only
    // those two were wrong (B10/SEC/ACC/Big-East/AAC baked right). Correct the conference factor.
    var c=(''+(p.conf||'')).toUpperCase().replace(/[\s\-_.]/g,'');
    if(c==='BIG12'||c==='PAC12') pr=pr*(N.confMult(N.confClass(p.conf))/0.90);
    return pr; };
  N.gradeValueNeutral = function(grade,mpg,prem,cls,pos,wa){ var b=N.neuGradeBase(grade); if(b<=0.002) return N.WALKON_VALUE;
    return b*N.NEU_TOP*N.premAdj(prem)*N.neuMinFactor(N.estMpg(mpg,grade))*N.neuYouth(cls)*N.bigMult(pos,grade)*N.waCoherence(grade,wa); };
  // MARKETABILITY — NIL is a brand market, not just a talent market: a featured SCORER draws the
  // deals, a low-usage role player (however efficient) does not. Signal = scoring VOLUME (last
  // season's ppg), deliberately SIZE-FREE so it lowers low-scoring bigs without re-inflating them
  // the way the size premium did. Freshmen (ppg null) are neutral — recruiting hype carries them.
  N.MKT_PIVOT = 13; N.MKT_SLOPE = 0.026; N.MKT_LO = 0.78; N.MKT_HI = 1.18;
  N.mktMult = function(ppg){ if(ppg==null||ppg===''||!isFinite(+ppg)) return 1;
    return Math.max(N.MKT_LO, Math.min(N.MKT_HI, 1+N.MKT_SLOPE*((+ppg)-N.MKT_PIVOT))); };
  // PRO / DRAFT UPSIDE — college NIL partly prices a player's pro ceiling (a collective bets on a
  // future star; a lottery pick is a bigger brand than an undersized senior). Proxy = height vs a
  // pro-VIABLE size for the position. DISCOUNT-ONLY (cap 1.0) so it never rewards size — it only
  // docks the clearly undersized-for-the-NBA (esp. sub-6'3" guards, who lack the lottery ceiling).
  N.PRO_THR = {PG:76,SG:77.5,SF:78.5,PF:80.5,C:82,G:77,F:80};   // inches: NBA-viable height by position
  N.PRO_SLOPE = 0.05; N.PRO_FLOOR = 0.72;
  N.proMult = function(htIn,pos){ if(htIn==null||!isFinite(+htIn)) return 1;
    var t=N.PRO_THR[(''+(pos||'')).toUpperCase().split('/')[0].trim()]||77.5;
    return Math.max(N.PRO_FLOOR, Math.min(1.0, 1-N.PRO_SLOPE*Math.max(0,t-(+htIn)))); };
  N.deTier = function(value,tier){ if(value==null||!isFinite(+value)||+value<=N.WALKON_VALUE*1.5) return value;  // rescale a precomputed tier-based value to open-market
    var tm=N.MODEL.tier_mult[N.tierNum(tier)]||0.2; return (+value)*N.NEUTRAL_MULT/tm; };
  // ── client-side known deals: real deals that override the model at runtime (no pipeline re-run),
  //    loaded from nil-deals.json. Keyed by exact player name → $M. Populates async; the render
  //    paths await N.dealsReady before pricing so it's always applied. ──
  N.NAME_DEALS = {};
  N.dealOf = function(name){ if(!name) return null; var v=N.NAME_DEALS[(''+name).trim()]; return (v!=null&&isFinite(+v))?+v:null; };
  N.loadDeals = function(){ if(N._dealsP) return N._dealsP;
    N._dealsP = fetch('nil-deals.json',{cache:'no-cache'}).then(function(r){return r.ok?r.json():null;})
      .then(function(j){ if(j&&j.deals) for(var k in j.deals){ var v=+j.deals[k]; if(isFinite(v)) N.NAME_DEALS[(''+k).trim()]=v; } return N.NAME_DEALS; })
      .catch(function(){ return N.NAME_DEALS; });
    return N._dealsP; };
  N.dealsReady = N.loadDeals();
  // ── recruiting PEDIGREE → market value only (never production). A former five-star still commands a
  //    premium that decays each year as production proves out (a top-3 senior barely gets it).
  //    Coefficient (0..1 per espn_id) from recruit_pedigree.json (247 composite; raw ranks stay private).
  //    Loads async; render paths await N.pedigreeReady before pricing. ──
  N.PEDIGREE = {}; N.PED_MAX = 0.70;
  N.pedDecay = function(cls){ var c=(''+(cls||'')).toLowerCase();
    if(c.indexOf('fr')>=0) return 1.00; if(c.indexOf('so')>=0) return 0.60;
    if(c.indexOf('jr')>=0) return 0.30; if(c.indexOf('sr')>=0||c.indexOf('gr')>=0) return 0.10; return 0.50; };
  N.pedigreeCoef = function(espn){ if(espn==null) return 0; var v=N.PEDIGREE[String(espn)]; return (v!=null&&isFinite(+v))?+v:0; };
  N.pedigreeMult = function(espn,cls){ return 1 + N.PED_MAX*N.pedigreeCoef(espn)*N.pedDecay(cls); };
  N.pedOf = function(p){ if(!p) return 1; return N.pedigreeMult(p.espn_id, p.cls||p.class_year||p.yr||p.class); };
  N.loadPedigree = function(){ if(N._pedP) return N._pedP;
    N._pedP = fetch('scripts/data/recruit_pedigree.json',{cache:'no-cache'}).then(function(r){return r.ok?r.json():null;})
      .then(function(j){ if(j&&j.players) N.PEDIGREE=j.players; return N.PEDIGREE; }).catch(function(){ return N.PEDIGREE; });
    return N._pedP; };
  N.pedigreeReady = N.loadPedigree();
  // ── defensive / foul profile (nil-defense.json, built by scripts/build_nil_defense.py from owned
  //    DWA + box-score fouls). The grade rewards efficient scoring; this docks a foul-prone / weak
  //    defender the grade under-weights. defMult is discount-only (0.80–1.00); no data → 1.0 (freshmen
  //    & unproven players aren't penalised). Also exposes flags for the scouting report. ──
  N.DEF = {};
  N.defOf = function(espn){ if(espn==null) return null; var r=N.DEF[String(espn)]; return r||null; };
  N.defMultOf = function(p){ if(!p) return 1; var e=(typeof p==='object')?(p.espn_id!=null?p.espn_id:p.espn):p; var r=N.defOf(e);
    return (r&&isFinite(+r.defMult))?+r.defMult:1; };
  N.defFlagsOf = function(p){ var e=(p&&typeof p==='object')?(p.espn_id!=null?p.espn_id:p.espn):p; var r=N.defOf(e); return (r&&r.flags)?r.flags:[]; };
  N.loadDefense = function(){ if(N._defP) return N._defP;
    N._defP = fetch('nil-defense.json',{cache:'no-cache'}).then(function(r){return r.ok?r.json():null;})
      .then(function(j){ if(j&&j.by) N.DEF=j.by; return N.DEF; }).catch(function(){ return N.DEF; });
    return N._defP; };
  N.defenseReady = N.loadDefense();
  // ── owner NIL adjustments (nil-adjust.json) — market factors the model can't derive: injury/
  //    availability, eligibility runway (grad transfers), program market size. {name:{mult,reason}}.
  //    mult scales the value; reason is surfaced on the player page. Not a salary — a modifier. ──
  N.ADJ = {};
  N.adjOf = function(name){ if(!name) return null; return N.ADJ[(''+name).trim()] || null; };
  N.adjMultOf = function(name){ var a=N.adjOf(name); return (a&&isFinite(+a.mult))?+a.mult:1; };
  N.loadAdjust = function(){ if(N._adjP) return N._adjP;
    N._adjP = fetch('nil-adjust.json',{cache:'no-cache'}).then(function(r){return r.ok?r.json():null;})
      .then(function(j){ var b=j&&j.by_name; if(b) for(var k in b){ if(b[k]) N.ADJ[(''+k).trim()]=b[k]; } return N.ADJ; })
      .catch(function(){ return N.ADJ; });
    return N._adjP; };
  N.adjustReady = N.loadAdjust();
  // ── SYSTEMATIC INJURY dock — reads the owner injury tool's records (profiles.freshman_projections,
  //    keyed tdc_inj:<team>:<name>, {part,timeline,play}). A player who's OUT (season/multi-month or
  //    play=false) can't play or build value, so NIL craters; shorter timelines dock less. Keyed by
  //    name (injuries are rare enough that collisions don't matter). Anon read. ──
  N.INJ = {};
  N.injuryOf = function(name){ if(!name) return null; return N.INJ[(''+name).trim()] || null; };
  N.injuryMultOf = function(p){ var r=N.injuryOf(p&&p.name); if(!r) return 1;
    var out=(r.play===false)||r.timeline==='multi'||r.timeline==='season';
    if(out) return 0.45;                     // out for the season / months: value cratered
    if(r.timeline==='1-3m') return 0.78;     // misses ~1-3 months
    if(r.timeline==='1-3w') return 0.92;
    if(r.timeline==='day-to-day') return 0.97;
    return 1; };
  // ── ELITE-FRESHMAN DRAFT BOOST — a projected lottery-pick freshman commands more NIL than his
  //    college-production value (the collective bets on the draft). No pedigree data for the incoming
  //    class, so we use the freshman GRADE (the owner's recruit assessment) as the prospect signal.
  //    Freshmen only (no prior college line); scales with grade above the onset. ──
  N.DRAFT_MAX = 0.55; N.DRAFT_ONSET = 83;
  N.draftBoost = function(grade,ppg){ if(ppg!=null&&ppg!=='') return 1;
    return 1 + N.DRAFT_MAX*Math.max(0,Math.min(1,((+grade||0)-N.DRAFT_ONSET)/11)); };
  // ── PROGRAM NIL MARKET — programs pay differently (blue-bloods spend up; some spend below market;
  //    market size varies). Owner-set per-program multiplier + a conference-aware floor so a scholarship
  //    high-major player isn't priced near zero. From nil-programs.json. Keyed by team (rows carry team). ──
  N.PROG = {}; N.PROG_FLOOR = {};
  N.progMultOf = function(team){ if(!team) return 1; var e=N.PROG[(''+team).trim()]; return (e&&isFinite(+e.mult))?+e.mult:1; };
  N.progFloorOf = function(conf){ var c=(''+(conf||'')).toUpperCase().trim(); var f=N.PROG_FLOOR[c];
    return (f!=null&&isFinite(+f))?+f:(isFinite(+N.PROG_FLOOR._default)?+N.PROG_FLOOR._default:0); };
  N.programsReady = fetch('nil-programs.json',{cache:'no-cache'}).then(function(r){return r.ok?r.json():null;})
    .then(function(j){ if(j){ if(j.by_team) N.PROG=j.by_team; if(j.floor_by_conf) N.PROG_FLOOR=j.floor_by_conf; } return N.PROG; })
    .catch(function(){ return N.PROG; });
  N.injuryReady = (function(){
    var SB='https://izlqhnxowdhtdofkwrho.supabase.co', K='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
    return fetch(SB+'/rest/v1/profiles?select=freshman_projections',{headers:{apikey:K,Authorization:'Bearer '+K}})
      .then(function(r){return r.ok?r.json():[];})
      .then(function(rows){ for(var i=0;i<rows.length;i++){ var fp=rows[i]&&rows[i].freshman_projections; if(!fp) continue;
          var has=false; for(var k in fp){ if(k.indexOf('tdc_inj:')===0){ has=true; var nm=k.substring(k.lastIndexOf(':')+1); if(fp[k]) N.INJ[nm.trim()]=fp[k]; } }
          if(has) break; }
        return N.INJ; }).catch(function(){ return N.INJ; });
  })();
  // open-market value of a nil-data player row = the MODEL's own estimate for everyone. We never
  // publish a reported real-deal salary: baked "override" rows carry a hardcoded deal figure, so they
  // are recomputed from the model (grade × minutes × premium, tier-neutral) × recruiting pedigree —
  // the same as everyone else. Walk-ons keep their floor; the rest are rescaled off their tier.
  N.neutralValueOf = function(p,tier){ if(!p) return 0;
    var dl=N.dealOf(p.name); if(dl!=null) return dl;      // (mechanism retained; nil-deals.json is empty by policy)
    var v=+(p.value);
    if(p.walkon) return isFinite(v)?v:N.WALKON_VALUE;
    // GRADE-LED: recompute every player live from the model (grade/mpg/premium/class/pos), so the
    // valuation is controlled entirely by tdc-nil.js — no dependency on the baked tier value, and
    // baked real-deal "override" figures are never surfaced. tier is unused (open-market worth).
    var mv=N.gradeValueNeutral(p.grade,p.mpg,N.premOf(p),p.cls,p.pos,p.wa);
    mv=isFinite(+mv)?+mv:(isFinite(v)?v:0);
    mv=mv*N.draftBoost(p.grade,p.ppg)*N.defMultOf(p)*N.mktMult(p.ppg)*N.proMult(p.ht,p.pos)*N.injuryMultOf(p)*N.adjMultOf(p.name)*N.progMultOf(p.team);
    return Math.max(N.progFloorOf(p.conf), mv); };   // × draft × defense × mkt × pro × injury × adjust × program, then conf floor
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
