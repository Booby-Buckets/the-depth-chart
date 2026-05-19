/**
 * TDC PROJECTION ENGINE v3.0
 * Advanced College Basketball Ecosystem Projection Model
 * Combines V2 ecosystem approach with V3 portability/scalability/archetype systems
 *
 * Public API:
 *   TDC.projectTeam(players, teamRow)          → projected player array
 *   TDC.projectPlayerInContext(p, roster, row) → single player projection
 *   TDC.buildTeamRatings(roster, conf)         → {ortg, drtg, net, pace}
 *   TDC.getWinProbability(teamA, teamB)        → win% for teamA
 */
const TDC = (function(){
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONFERENCE TIERS & TRANSLATION MATRIX
// ─────────────────────────────────────────────────────────────────────────────
const CONF_TIERS = {
  'SEC':1,'B10':1,'BIG-12':1,'ACC':1,'Big-East':1,
  'PAC-12':2,'A10':2,'WCC':2,'AAC':2,
  'MWC':3,
  'MVC':4,'CUSA':4,'MAC':4,'Big West':4,'WAC':4,
  'CAA':5,'Big Sky':5,'Sun Belt':5,'Big South':5,'SBC':5,'Horizon':5,
  'ASUN':6,'MAAC':6,'OVC':6,'SoCon':6,'Summit':6,'Ivy':6,
  'NEC':7,'SWAC':7,'MEAC':7,'AEC':7,'Patriot':7,
};

// Row = origin tier, Col = destination tier
const TIER_TRANSLATION = {
  1:{1:1.00,2:1.10,3:1.18,4:1.26,5:1.34,6:1.40,7:1.45},
  2:{1:0.90,2:1.00,3:1.10,4:1.18,5:1.24,6:1.30,7:1.36},
  3:{1:0.78,2:0.90,3:1.00,4:1.08,5:1.14,6:1.20,7:1.26},
  4:{1:0.66,2:0.78,3:0.90,4:1.00,5:1.08,6:1.14,7:1.20},
  5:{1:0.58,2:0.70,3:0.82,4:0.92,5:1.00,6:1.08,7:1.14},
  6:{1:0.50,2:0.62,3:0.74,4:0.84,5:0.92,6:1.00,7:1.08},
  7:{1:0.42,2:0.54,3:0.66,4:0.76,5:0.84,6:0.92,7:1.00},
};

// ─────────────────────────────────────────────────────────────────────────────
// SCHOOL → CONFERENCE LOOKUP
// ─────────────────────────────────────────────────────────────────────────────
const SCHOOL_CONF = (function(){
  const m={};
  [
    [['Alabama','Arkansas','Auburn','Florida','Georgia','Kentucky','LSU','Mississippi State','Missouri','Ole Miss','South Carolina','Tennessee','Texas','Texas A&M','Vanderbilt','Oklahoma'],'SEC'],
    [['Illinois','Indiana','Iowa','Maryland','Michigan','Michigan State','Minnesota','Nebraska','Northwestern','Ohio State','Penn State','Purdue','Rutgers','Wisconsin','UCLA','USC','Oregon','Washington'],'B10'],
    [['Arizona','Arizona State','Baylor','BYU','Cincinnati','Colorado','Houston','Iowa State','Kansas','Kansas State','Oklahoma State','TCU','Texas Tech','UCF','Utah','West Virginia'],'BIG-12'],
    [['Butler','Connecticut','Creighton','DePaul','Georgetown','Marquette','Providence','Seton Hall',"St. John's",'Villanova','Xavier'],'Big-East'],
    [['Boston College','Clemson','Duke','Florida State','Georgia Tech','Louisville','Miami','NC State','North Carolina','Notre Dame','Pittsburgh','Syracuse','Virginia','Virginia Tech','Wake Forest','California','SMU','Stanford'],'ACC'],
    [['Gonzaga','San Diego State','Colorado State','Boise State','Utah State','Nevada','New Mexico','Fresno State','Air Force','Wyoming','Oregon State','Washington State'],'PAC-12'],
    [['Dayton','Davidson','Duquesne','Fordham','George Mason','George Washington','La Salle','Loyola Chicago','Rhode Island','Richmond',"Saint Joseph's",'Saint Louis','St. Bonaventure','VCU','Massachusetts'],'A10'],
    [['Charlotte','East Carolina','Florida Atlantic','Memphis','North Texas','Rice','South Florida','Temple','Tulane','Tulsa','UAB','UTSA','Wichita State'],'AAC'],
    [['Winthrop','Campbell','Charleston Southern','Gardner-Webb','High Point','Longwood','Presbyterian','Radford','UNC Asheville'],'Big South'],
    [['Samford','Furman','Chattanooga','ETSU','Mercer','VMI','Western Carolina','Wofford','The Citadel'],'SoCon'],
    [['Liberty','Belmont','Lipscomb','FGCU','North Alabama','Jacksonville','Stetson','Austin Peay','Eastern Kentucky','Morehead State','Murray State'],'ASUN'],
    [['Bradley','Drake','Evansville','Illinois State','Indiana State','Missouri State','Northern Iowa','Southern Illinois','Valparaiso'],'MVC'],
    [['Nevada','New Mexico','Fresno State','Boise State','Colorado State','Utah State','Air Force','Wyoming','San Diego State','UNLV'],'MWC'],
    [['Akron','Ball State','Bowling Green','Buffalo','Central Michigan','Eastern Michigan','Kent State','Miami (OH)','Northern Illinois','Ohio','Toledo','Western Michigan'],'MAC'],
    [['Grand Canyon','Seattle U','Utah Valley','New Mexico State','Tarleton State','UT Rio Grande Valley'],'WAC'],
    [['Montana','Montana State','Weber State','Idaho','Idaho State','Eastern Washington','Northern Arizona','Northern Colorado','Southern Utah','Portland State','Sacramento State'],'Big Sky'],
    [['UC Davis','UC Irvine','UC Riverside','UC Santa Barbara','UC San Diego','Cal Poly','Long Beach State','Pacific','Cal State Fullerton','Cal State Northridge'],'Big West'],
    [['Iona','Manhattan','Marist','Niagara','Quinnipiac','Rider',"Saint Peter's",'Siena','Canisius','Fairfield'],'MAAC'],
    [['Colgate','Bucknell','Lafayette','Lehigh','Army','Navy','Holy Cross','American','Loyola Maryland'],'Patriot'],
    [['Detroit Mercy','Green Bay','IU Indianapolis','Milwaukee','Northern Kentucky','Oakland','Purdue Fort Wayne','Wright State','Youngstown State'],'Horizon'],
    [['UT Martin','Tennessee State','Tennessee Tech','Eastern Illinois','Lindenwood','SE Missouri State','SIU Edwardsville','Jacksonville State','Central Arkansas'],'OVC'],
    [['Harvard','Yale','Princeton','Penn','Columbia','Cornell','Brown','Dartmouth'],'Ivy'],
    [['Belmont','Murray State','Morehead State','Austin Peay','Eastern Kentucky','Jacksonville State','Central Arkansas'],'OVC'],
  ].forEach(function(pair){ if(pair&&pair[0]&&pair[1]) pair[0].forEach(function(s){ m[s.toLowerCase()]=pair[1]; }); });
  return m;
})();

function getSchoolConf(school){
  if(!school) return null;
  const lo=school.toLowerCase().trim();
  if(SCHOOL_CONF[lo]) return SCHOOL_CONF[lo];
  for(const k of Object.keys(SCHOOL_CONF)){
    if(lo.includes(k)||k.includes(lo)) return SCHOOL_CONF[k];
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────
function r1(v){ return v!=null ? Math.round(v*10)/10 : null; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v||0)); }
function g(p,k){ return parseFloat(p[k])||0; }

function normPos(pos){
  const p=(pos||'G').replace(/\d/g,'').trim().toUpperCase();
  if(p==='PG') return 'PG';
  if(p==='SG'||p==='CG') return 'SG';
  if(p==='SF') return 'SF';
  if(p==='PF') return 'PF';
  if(p==='C')  return 'C';
  return p.includes('G')?'SG':p.includes('F')?'SF':'SG';
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — PORTABILITY SCORE
// How well does this player's production travel to a new environment?
// High portability = efficient shooter, ball-secure, doesn't need volume
// Low portability = high-usage inefficient creator, system-dependent
// ─────────────────────────────────────────────────────────────────────────────
function calculatePortabilityScore(player){
  const usg = g(player,'usg_pct')||g(player,'usg')||15;
  const ts  = g(player,'ts_pct')||g(player,'ts')||52;
  const apg = g(player,'apg')||0;
  const tov = g(player,'tovs')||1;
  const tp  = g(player,'tp_pct')||0;
  const tpa = g(player,'tpa')||0;

  let score=50;

  // Scalable shooting — 3P% and volume travel well
  score += (tp-33)*1.2;
  score += tpa*2;

  // Efficiency — high TS% = production that translates
  score += (ts-54)*1.5;

  // Ball security — negative turnovers, positive assists (net creation)
  score += (apg-tov)*4;

  // Heliocentric penalty — high usage players are system-dependent
  if(usg>27) score -= (usg-27)*2.2;

  // Tough-shot creator penalty — high usage + low efficiency = very system dependent
  if(usg>25&&ts<56) score -= 10;

  return clamp(score,10,95);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — SCALABILITY SCORE
// Can this player absorb more minutes/usage and maintain efficiency?
// High scalability = efficient at any load
// Low scalability = dependent on specific role/volume
// ─────────────────────────────────────────────────────────────────────────────
function calculateScalability(player){
  const usg = g(player,'usg_pct')||g(player,'usg')||15;
  const ts  = g(player,'ts_pct')||g(player,'ts')||52;
  const apg = g(player,'apg')||0;
  const tov = g(player,'tovs')||1;

  let score=50;

  score += (ts-54)*2;
  score += apg*2;
  score -= tov*2;

  // Elite usage + elite efficiency = rare scalable star
  if(usg>28&&ts>58) score+=12;

  // High usage + poor efficiency = will decline more with bigger role
  if(usg>28&&ts<54) score-=15;

  return clamp(score,10,95);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — ARCHETYPE DETECTION
// Derived purely from statistical patterns — no manual labels
// ─────────────────────────────────────────────────────────────────────────────
function detectArchetype(player){
  const usg = g(player,'usg_pct')||g(player,'usg')||15;
  const apg = g(player,'apg')||0;
  const tp  = g(player,'tp_pct')||0;
  const tpa = g(player,'tpa')||0;
  const ts  = g(player,'ts_pct')||g(player,'ts')||52;
  const rpg = g(player,'rpg')||0;
  const blk = g(player,'blk')||0;
  const stl = g(player,'stl')||0;
  const mpg = g(player,'mpg')||0;
  const ppg = g(player,'ppg')||0;
  const oreb= g(player,'oreb')||0;
  const pos = normPos(player.position);
  const isBig = pos==='PF'||pos==='C';

  if(usg>27&&apg>4)            return 'Heliocentric Creator';
  if(tp>37&&tpa>5)             return 'Spacer';
  if(isBig&&rpg>7&&ts>58)      return 'Interior Finisher';
  if(isBig&&blk>1.5&&oreb>2)   return 'Interior Anchor';
  if(isBig&&tpa>3&&tp>33)      return 'Stretch Big';
  if(apg>3&&usg<22)            return 'Connector Creator';
  if(ts>60&&usg<18)            return 'Low Usage Efficiency';
  if(stl>1.4&&ppg<10)         return 'Defensive Specialist';
  if(usg>24&&ppg>14)           return 'Volume Scorer';
  if(mpg>0&&ppg/mpg>0.65&&usg<20) return 'Microwave Scorer';
  return 'Balanced Wing';
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — TEAM ECOSYSTEM (Spacing, Creation, Rebounding, Defense, Pace)
// ─────────────────────────────────────────────────────────────────────────────
function buildTeamEnvironment(roster, conf){
  const rotation = roster
    .filter(p=>p.name&&p.name!=='—'&&g(p,'ppg')>0)
    .sort((a,b)=>(a.depth_order||99)-(b.depth_order||99))
    .slice(0,10);

  if(!rotation.length) return {spacingScore:1.5,creationScore:7,reboundingScore:4,defensiveScore:4,shootingGravity:60,pace:69};

  let spacingScore=0,creationScore=0,reboundingScore=0,defensiveScore=0,shootingGravity=0,totalWeight=0;

  rotation.forEach(p=>{
    const mpg=g(p,'mpg')||20,usg=g(p,'usg_pct')||15;
    const tp=g(p,'tp_pct')||30,tpa=g(p,'tpa')||2;
    const apg=g(p,'apg')||1,tov=g(p,'tovs')||1;
    const rpg=g(p,'rpg')||3,stl=g(p,'stl')||0.5,blk=g(p,'blk')||0.3;
    const w=mpg;

    totalWeight+=w;
    spacingScore     += ((tp*tpa)/100)*w;
    creationScore    += ((apg*1.6)+(usg*0.35)-(tov*0.7))*w;
    reboundingScore  += rpg*w;
    defensiveScore   += ((stl*2.0)+(blk*2.3)+(rpg*0.5))*w;
    shootingGravity  += (tp*tpa)*w;
  });

  const tw=Math.max(1,totalWeight);
  spacingScore    /=tw;
  creationScore   /=tw;
  reboundingScore /=tw;
  defensiveScore  /=tw;
  shootingGravity /=tw;

  let pace=69;
  if(creationScore>10) pace+=2;
  if(spacingScore>1.8) pace+=1;
  if(reboundingScore>5.5) pace-=1;

  // Count shooters for spacing quality (0–1)
  const shooters=rotation.filter(p=>g(p,'tpa')>=2.5&&g(p,'tp_pct')>=34).length;
  const spacingQuality=Math.min(1.0,shooters/4);

  return {spacingScore,creationScore,reboundingScore,defensiveScore,shootingGravity,pace,spacingQuality};
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — ADVANCED TRANSFER TRANSLATION
// Combines tier matrix with portability and scalability scores
// ─────────────────────────────────────────────────────────────────────────────
function getAdvancedTransferFactor(originConf, destConf, player){
  if(!originConf||!destConf||originConf===destConf) return 1.0;

  const ot=CONF_TIERS[originConf]||5;
  const dt=CONF_TIERS[destConf]||5;

  let factor=(TIER_TRANSLATION[ot]||{})[dt]||1.0;

  const portability=calculatePortabilityScore(player);
  const scalability=calculateScalability(player);
  const arch=detectArchetype(player);

  // Scalable/portable players translate better
  factor *= (0.82+(portability/100)*0.25);

  // Heliocentric creators penalized — their production is system-dependent
  if(arch==='Heliocentric Creator') factor*=0.88;

  // High scalability bonus — these players hold efficiency under increased load
  if(scalability>75) factor*=1.05;

  // Going UP in conference — low portability players deflated extra
  if(dt<ot&&portability<45) factor*=0.90;

  // Efficient spacers translate well regardless of conference jump
  if(arch==='Spacer'&&g(player,'tp_pct')>37) factor*=1.04;

  return clamp(factor,0.42,1.45);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 — USAGE REDISTRIBUTION
// Usage is a finite team resource — players compete for possessions
// ─────────────────────────────────────────────────────────────────────────────
function redistributeUsage(roster){
  const rotation=roster
    .filter(p=>p.name&&p.name!=='—')
    .sort((a,b)=>(a.depth_order||99)-(b.depth_order||99))
    .slice(0,9);

  let total=0;
  rotation.forEach(p=>{
    let usg=g(p,'usg_pct')||15;
    const sc=calculateScalability(p);
    const po=calculatePortabilityScore(p);
    usg*=(0.9+sc/200);
    if(po<45) usg*=0.88;
    p._projUsg=usg;
    total+=usg;
  });

  rotation.forEach(p=>{ p._projUsg=(p._projUsg/Math.max(1,total))*100; });

  // Heliocentric suppresses teammates' usage
  const helio=rotation.filter(p=>detectArchetype(p)==='Heliocentric Creator');
  if(helio.length>0){
    const others=rotation.filter(p=>detectArchetype(p)!=='Heliocentric Creator');
    others.forEach(p=>{ p._projUsg*=0.92; });
  }

  return rotation;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 7 — MINUTE DISTRIBUTION
// Grade-order base with archetype fit bonuses/penalties
// ─────────────────────────────────────────────────────────────────────────────
function computeMinutes(roster){
  const sorted=[...roster]
    .filter(p=>p.name&&p.name!=='—')
    .sort((a,b)=>(a.depth_order||99)-(b.depth_order||99));

  if(!sorted.length) return {};

  const grades=sorted.map(p=>parseFloat(p.tdc_grade)||70);
  const avgGrade=grades.reduce((a,b)=>a+b,0)/grades.length;
  const rosterSize=sorted.length;

  // Rotation depth cutoff
  let rotDepth=rosterSize;
  for(let i=2;i<sorted.length-1;i++){
    const g1=parseFloat(sorted[i-1].tdc_grade)||70;
    const g2=parseFloat(sorted[i].tdc_grade)||70;
    if((g1-g2)>=9&&g2<=68){rotDepth=i;break;}
    if(g2<63&&i>=6){rotDepth=i;break;}
  }
  rotDepth=Math.max(7,Math.min(12,rotDepth));

  const mpgMap={};
  sorted.forEach((p,i)=>{
    const grade=parseFloat(p.tdc_grade)||70;
    const slot=i+1;
    let base;
    if(slot<=5){const gn=Math.max(-1,Math.min(1,(grade-avgGrade)/15));base=30.5+gn*3.5;}
    else if(slot===6)base=20;else if(slot===7)base=17;else if(slot===8)base=14;
    else if(slot===9)base=11;else if(slot===10)base=8;
    else base=Math.max(2,6-(slot-10)*1.5);

    base*=(1+((grade-avgGrade)/20)*0.10);
    if(slot<=5&&rosterSize<=8)base=Math.min(38,base+2);
    if(slot>rotDepth)base=Math.min(5,base);

    // Archetype redundancy penalty
    const arch=detectArchetype(p);
    const nearby=sorted.slice(Math.max(0,i-2),i+3).filter(r=>r.name!==p.name).map(r=>detectArchetype(r));
    const sameArch=nearby.filter(a=>a===arch).length;
    if(sameArch>=1)base*=0.97;
    if(sameArch>=2)base*=0.94;

    mpgMap[p.name]=Math.max(1,Math.min(38,base));
  });

  // Close-grade same-position splitting
  for(let i=0;i<Math.min(sorted.length-1,9);i++){
    const a=sorted[i],b=sorted[i+1];
    const pa=normPos(a.position),pb=normPos(b.position);
    if(pa!==pb)continue;
    const ga=parseFloat(a.tdc_grade)||70,gb=parseFloat(b.tdc_grade)||70,diff=ga-gb;
    if(diff<=3){const c=mpgMap[a.name]+mpgMap[b.name];mpgMap[a.name]=c*0.53;mpgMap[b.name]=c*0.47;}
    else if(diff<=6){const c=mpgMap[a.name]+mpgMap[b.name];mpgMap[a.name]=c*0.65;mpgMap[b.name]=c*0.35;}
  }

  // Monotonic enforcement
  for(let i=1;i<sorted.length;i++){
    const prev=sorted[i-1].name,cur=sorted[i].name;
    if(mpgMap[cur]>mpgMap[prev])mpgMap[cur]=mpgMap[prev]*0.95;
  }

  // Starter budget cap
  const top5=sorted.slice(0,5);
  const st=top5.reduce((s,p)=>s+(mpgMap[p.name]||0),0);
  if(st>196){const sc=196/st;top5.forEach(p=>{mpgMap[p.name]=(mpgMap[p.name]||0)*sc;});}

  return mpgMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 8 — YEAR PROGRESSION
// ─────────────────────────────────────────────────────────────────────────────
function yearProgMult(yr){
  const y=(yr||'').toLowerCase();
  if(y.includes('so.')||y.includes('r-so.')) return 1.06;
  if(y.includes('jr.')||y.includes('r-jr.')) return 1.03;
  if(y.includes('sr.')||y.includes('r-sr')||y.includes('gr.')) return 1.01;
  return 1.04; // freshman with stats, or unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 9 — GRADE vs STATS GAP
// If your grade is higher than stats suggest, boost (and vice versa)
// ─────────────────────────────────────────────────────────────────────────────
function gradeGapMult(grade, ppgPer32, pos){
  const posScale=pos==='PG'||pos==='SG'?1.05:pos==='SF'?1.00:pos==='PF'?0.97:0.93;
  const expected=(grade>=90?19:grade>=85?16:grade>=80?13:grade>=75?10:grade>=70?8:6)*posScale;
  const ratio=expected>0?ppgPer32/expected:1;
  if(ratio<0.50)return 1.18;if(ratio<0.65)return 1.12;if(ratio<0.80)return 1.06;
  if(ratio<0.95)return 1.02;if(ratio>1.40)return 0.97;if(ratio>1.20)return 0.99;
  return 1.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 10 — PERCENTAGE PROJECTIONS
// Year boost + volume change + spacing + transfer difficulty
// Percentages are stable year-to-year — small adjustments only
// ─────────────────────────────────────────────────────────────────────────────
function projectPercentages(player, newMpg, transferFactor, env, yr){
  const fgBase=g(player,'fg_pct')||42;
  const tpBase=g(player,'tp_pct')||33;
  const ftBase=g(player,'ft_pct')||70;
  const oldFga=g(player,'fga')||0;
  const oldMpg=Math.max(1,g(player,'mpg')||20);

  const y=(yr||'').toLowerCase();
  const isFr=y.includes('fr.')||y.includes('r-fr');
  const isSo=y.includes('so.')||y.includes('r-so.');
  const isJr=y.includes('jr.')||y.includes('r-jr.');

  const yearFg=isFr?2.0:isSo?1.2:isJr?0.6:0;
  const yearTp=isFr?1.5:isSo?0.8:isJr?0.4:0;
  const yearFt=isFr?1.5:isSo?1.0:isJr?0.5:0;

  // Volume change penalty
  const newFgaEst=oldFga>0?oldFga*(newMpg/oldMpg):newMpg*0.28;
  const volPenalty=oldFga>0?Math.max(0,(newFgaEst/oldFga-1)*3.5):0;

  // Spacing effect from team environment
  const spacingFg=(env.spacingScore-1.5)*2.0;
  const spacingTp=(env.spacingScore-1.5)*1.2;

  // Transfer conf difficulty penalty/bonus
  const transFgAdj=transferFactor<0.75?-3.0:transferFactor<0.90?-1.5:transferFactor>1.15?+1.0:transferFactor>1.05?+0.5:0;

  // Usage burden penalty (high-usage players lose efficiency)
  const usg=g(player,'usg_pct')||15;
  const burdenPenalty=usg>26?-2.5:usg>22?-1.0:0;

  return {
    fg_pct: r1(clamp(fgBase+yearFg-volPenalty+spacingFg+transFgAdj+burdenPenalty, 28, 66)),
    tp_pct: r1(clamp(tpBase+yearTp+spacingTp+transFgAdj*0.6, 15, 50)),
    ft_pct: r1(clamp(ftBase+yearFt, 42, 97)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 11 — FRESHMAN BASELINES
// Tiered by grade, scaled by actual projected MPG
// ─────────────────────────────────────────────────────────────────────────────
const FR_BASES = {
  t1:{ // Grade 92+
    PG:{ppg:17.5,rpg:3.5,apg:4.5,fg:45.5,tp:37.5,ft:78,stl:1.4,blk:0.2,tovs:2.8,oreb:0.6,dreb:2.9},
    SG:{ppg:16.0,rpg:4.0,apg:2.25,fg:43.5,tp:38.5,ft:77,stl:1.2,blk:0.3,tovs:2.4,oreb:0.8,dreb:3.2},
    SF:{ppg:18.5,rpg:5.0,apg:1.75,fg:46.5,tp:36.0,ft:76,stl:1.0,blk:0.6,tovs:2.2,oreb:1.5,dreb:3.5},
    PF:{ppg:16.0,rpg:6.5,apg:1.8,fg:50.0,tp:31.0,ft:70,stl:0.7,blk:1.2,tovs:2.0,oreb:2.5,dreb:4.0},
    C: {ppg:14.0,rpg:9.0,apg:1.05,fg:56.0,tp:22.0,ft:65,stl:0.4,blk:1.8,tovs:1.8,oreb:3.2,dreb:5.8},
  },
  t2:{ // Grade 85-91
    PG:{ppg:13.0,rpg:3.0,apg:3.5,fg:43.5,tp:35.5,ft:76,stl:1.1,blk:0.2,tovs:2.4,oreb:0.5,dreb:2.5},
    SG:{ppg:12.0,rpg:3.5,apg:1.8,fg:41.5,tp:36.0,ft:75,stl:1.0,blk:0.25,tovs:2.0,oreb:0.7,dreb:2.8},
    SF:{ppg:14.0,rpg:4.5,apg:1.5,fg:44.0,tp:34.5,ft:73,stl:0.8,blk:0.5,tovs:1.8,oreb:1.3,dreb:3.2},
    PF:{ppg:12.0,rpg:5.8,apg:1.4,fg:47.5,tp:29.0,ft:68,stl:0.6,blk:1.0,tovs:1.7,oreb:2.2,dreb:3.6},
    C: {ppg:10.5,rpg:7.5,apg:0.9,fg:52.5,tp:18.0,ft:62,stl:0.35,blk:1.5,tovs:1.5,oreb:2.8,dreb:4.7},
  },
  t3:{ // Grade 75-84
    PG:{ppg:8.5,rpg:2.2,apg:2.5,fg:41.0,tp:33.0,ft:73,stl:0.8,blk:0.1,tovs:1.8,oreb:0.4,dreb:1.8},
    SG:{ppg:7.5,rpg:2.5,apg:1.2,fg:40.0,tp:33.5,ft:72,stl:0.7,blk:0.2,tovs:1.5,oreb:0.5,dreb:2.0},
    SF:{ppg:9.0,rpg:3.5,apg:1.0,fg:42.5,tp:32.0,ft:70,stl:0.6,blk:0.4,tovs:1.4,oreb:1.0,dreb:2.5},
    PF:{ppg:7.5,rpg:4.5,apg:1.0,fg:45.0,tp:25.0,ft:65,stl:0.4,blk:0.7,tovs:1.3,oreb:1.8,dreb:2.7},
    C: {ppg:6.5,rpg:6.0,apg:0.7,fg:49.0,tp:12.0,ft:58,stl:0.3,blk:1.0,tovs:1.2,oreb:2.2,dreb:3.8},
  },
  t4:{ // Below 75
    PG:{ppg:5.0,rpg:1.5,apg:1.5,fg:39.0,tp:30.0,ft:70,stl:0.5,blk:0.1,tovs:1.2,oreb:0.3,dreb:1.2},
    SG:{ppg:4.5,rpg:1.8,apg:0.8,fg:38.5,tp:30.5,ft:69,stl:0.45,blk:0.15,tovs:1.0,oreb:0.35,dreb:1.4},
    SF:{ppg:5.5,rpg:2.5,apg:0.7,fg:40.5,tp:29.0,ft:68,stl:0.4,blk:0.3,tovs:0.9,oreb:0.7,dreb:1.8},
    PF:{ppg:4.5,rpg:3.2,apg:0.7,fg:43.0,tp:20.0,ft:62,stl:0.3,blk:0.5,tovs:0.8,oreb:1.2,dreb:2.0},
    C: {ppg:4.0,rpg:4.5,apg:0.5,fg:47.0,tp:8.0,ft:55,stl:0.2,blk:0.8,tovs:0.7,oreb:1.7,dreb:2.8},
  },
};

function freshmanBaseline(grade, pos, newMpg){
  const tier=grade>=92?'t1':grade>=85?'t2':grade>=75?'t3':'t4';
  const b=(FR_BASES[tier]||FR_BASES.t3)[pos]||(FR_BASES[tier]||FR_BASES.t3)['SG'];
  const scale=newMpg/32;
  const fga=r1(newMpg*0.27);
  return {
    ppg:r1(b.ppg*scale),rpg:r1(b.rpg*scale),apg:r1(b.apg*scale),mpg:r1(newMpg),
    fgm:r1(fga*(b.fg/100)),fga:r1(fga),fg_pct:r1(b.fg),
    tpa:r1(fga*0.40),tpm:r1(fga*0.40*(b.tp/100)),tp_pct:r1(b.tp),
    fta:r1(newMpg*0.09),ftm:r1(newMpg*0.09*(b.ft/100)),ft_pct:r1(b.ft),
    oreb:r1(b.oreb*scale),dreb:r1(b.dreb*scale),
    stl:r1(b.stl*scale),blk:r1(b.blk*scale),tovs:r1(b.tovs*scale),
    _frosh:true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 12 — TEAM STAT CONSTRAINTS
// Generate team totals first, distribute player shares to fit
// ─────────────────────────────────────────────────────────────────────────────
function applyTeamConstraints(projected, env){
  if(!projected.length) return projected;
  const result=projected.map(p=>({...p}));

  // FGA: top-8 combined shouldn't exceed 62
  const top8=result.slice(0,8);
  const tfga=top8.reduce((t,p)=>t+(parseFloat(p.fga)||0),0);
  if(tfga>62){
    const sc=62/tfga;
    top8.forEach(p=>{
      p.fga=r1((parseFloat(p.fga)||0)*sc);p.fgm=r1((parseFloat(p.fgm)||0)*sc);
      p.tpa=r1((parseFloat(p.tpa)||0)*sc);p.tpm=r1((parseFloat(p.tpm)||0)*sc);
    });
  }

  // Team PPG cap
  const tppg=result.reduce((t,p)=>t+(parseFloat(p.ppg)||0),0);
  if(tppg>88){
    const sc=88/tppg;
    result.forEach(p=>{p.ppg=r1((parseFloat(p.ppg)||0)*sc);p.fgm=r1((parseFloat(p.fgm)||0)*sc);});
  }

  // Sanity clamps
  result.forEach(p=>{
    p.ppg =r1(clamp(parseFloat(p.ppg), 0,36));p.rpg =r1(clamp(parseFloat(p.rpg), 0,16));
    p.apg =r1(clamp(parseFloat(p.apg), 0,12));p.mpg =r1(clamp(parseFloat(p.mpg), 1,38));
    p.stl =r1(clamp(parseFloat(p.stl), 0, 4));p.blk =r1(clamp(parseFloat(p.blk), 0, 5));
    p.tovs=r1(clamp(parseFloat(p.tovs),0, 6));
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — projectPlayer (single player with full context)
// ─────────────────────────────────────────────────────────────────────────────
function projectPlayerAdvanced(player, roster, conf, targetMpg){
  const env=buildTeamEnvironment(roster,conf);
  const yr=player.yr||player.class_year||'';
  const y=yr.toLowerCase();
  const isFr=y.includes('fr.')||y.includes('r-fr');
  const isSr=y.includes('sr.')||y.includes('r-sr')||y.includes('gr.');
  const pos=normPos(player.position);
  const grade=parseFloat(player.tdc_grade)||70;
  const hasStats=g(player,'ppg')>0;
  const oldMpg=Math.max(1,g(player,'mpg')||20);
  const newMpg=Math.max(1,Math.min(38,targetMpg||oldMpg));
  const rateScale=newMpg/oldMpg;

  // Scores
  const portability=calculatePortabilityScore(player);
  const scalability=calculateScalability(player);
  const archetype=detectArchetype(player);

  // Transfer factor
  let transferFactor=1.0,originConf=null;
  if(player.hometown&&player.hometown.trim()!==''){
    originConf=getSchoolConf(player.hometown);
    if(originConf&&hasStats) transferFactor=getAdvancedTransferFactor(originConf,conf,player);
  }

  // Freshman no-stats case
  if(isFr&&!hasStats){
    const fb=freshmanBaseline(grade,pos,newMpg);
    fb._archetype=archetype;fb._portability=portability;fb._scalability=scalability;
    fb._origin=originConf;fb._factor=transferFactor;
    return {...player,...fb};
  }
  if(!hasStats) return null;

  // Year progression
  const yrMult=yearProgMult(yr);

  // Grade gap
  const gapMult=gradeGapMult(grade,g(player,'ppg')/oldMpg*32,pos);

  // Rate growth = year × gap
  const rateGrowth=yrMult*gapMult;

  // Transfer counting factor (deflates going UP in conference)
  const countingTF=transferFactor<1.0?Math.max(transferFactor,0.70):1.0;

  // Portability + scalability on counting stats
  const portMult=0.82+(portability/100)*0.22;
  const scaleMult=0.85+(scalability/100)*0.25;

  // Usage change — does more/less minutes change efficiency?
  const scalabilityAdjust=rateScale>1?(1+(rateScale-1)*(scalability/100-0.5)):1;

  // Final rate multiplier
  const finalMult=rateGrowth*portMult*scaleMult*scalabilityAdjust*countingTF;

  // Spacing effects on scoring
  let spacingBoost=1.0;
  if(env.spacingScore>2.1) spacingBoost=1.04;
  else if(env.spacingScore<1.3) spacingBoost=0.94;

  // Heliocentric penalty in scoring — already captured in portability but add small hit
  let helioPenalty=1.0;
  if(archetype==='Heliocentric Creator'&&g(player,'usg_pct')>28) helioPenalty=0.94;

  // Percentages
  const pcts=projectPercentages(player,newMpg,transferFactor,env,yr);

  // Per-minute base rates
  const pm={
    ppg:g(player,'ppg')/oldMpg, rpg:g(player,'rpg')/oldMpg, apg:g(player,'apg')/oldMpg,
    fga:g(player,'fga')/oldMpg, tpa:g(player,'tpa')/oldMpg,
    fta:g(player,'fta')/oldMpg, oreb:g(player,'oreb')/oldMpg, dreb:g(player,'dreb')/oldMpg,
    stl:g(player,'stl')/oldMpg, blk:g(player,'blk')/oldMpg, tovs:g(player,'tovs')/oldMpg,
  };

  const fga=r1(pm.fga*finalMult*newMpg);
  const fgm=r1(fga*(pcts.fg_pct/100));
  const tpa=r1(pm.tpa*finalMult*newMpg);
  const tpm=r1(tpa*(pcts.tp_pct/100));
  const fta=r1(pm.fta*finalMult*newMpg);
  const ftm=r1(fta*(pcts.ft_pct/100));
  const ppgShots=r1((fgm||0)*2+(tpm||0)+(ftm||0));
  const ppgRate=r1(pm.ppg*finalMult*newMpg*spacingBoost*helioPenalty);
  const ppg=r1(ppgShots*0.65+ppgRate*0.35);

  return {
    ...player,
    ppg,
    rpg:r1(pm.rpg*finalMult*newMpg),
    apg:r1(pm.apg*finalMult*newMpg*(env.spacingQuality>0.5?1.03:1.0)),
    mpg:r1(newMpg),
    fgm,fga,fg_pct:pcts.fg_pct,
    tpm,tpa,tp_pct:pcts.tp_pct,
    ftm,fta,ft_pct:pcts.ft_pct,
    oreb:r1(pm.oreb*finalMult*newMpg),
    dreb:r1(pm.dreb*finalMult*newMpg),
    stl:r1(pm.stl*finalMult*newMpg),
    blk:r1(pm.blk*finalMult*newMpg),
    tovs:r1(pm.tovs*finalMult*newMpg),
    _archetype:archetype,
    _portability:portability,
    _scalability:scalability,
    _frosh:false,
    _origin:originConf,
    _factor:transferFactor,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT — projectTeam
// ─────────────────────────────────────────────────────────────────────────────
function projectTeam(rawPlayers, teamRow){
  const conf=(teamRow&&(teamRow.conf||teamRow.conference))||'';
  const players=rawPlayers
    .filter(p=>p.name&&p.name!=='—')
    .sort((a,b)=>(a.depth_order||99)-(b.depth_order||99));
  if(!players.length) return [];

  // Redistribute usage across roster
  const withUsage=redistributeUsage(players);

  // Compute minutes
  const mpgMap=computeMinutes(withUsage);

  // Build team environment
  const env=buildTeamEnvironment(withUsage,conf);

  // Project each player
  const projected=players.map(p=>{
    const newMpg=mpgMap[p.name]||5;
    return projectPlayerAdvanced(p,players,conf,newMpg);
  }).filter(Boolean);

  // Apply team constraints
  return applyTeamConstraints(projected,env);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAM STRENGTH RATINGS (for analytics page)
// ─────────────────────────────────────────────────────────────────────────────
function buildTeamRatings(roster, conf){
  const env=buildTeamEnvironment(roster,conf);
  let ortg=108,drtg=104;

  ortg+=env.spacingScore*3;
  ortg+=env.creationScore*0.7;
  drtg-=env.defensiveScore*0.35;
  drtg-=env.reboundingScore*0.15;

  // Conference strength adjustment
  const confStr={'SEC':1.00,'B10':1.00,'BIG-12':1.00,'ACC':0.98,'Big-East':0.96,'A10':0.90,'AAC':0.88,'WCC':0.87,'MVC':0.80,'MAC':0.78,'Big Sky':0.72,'CAA':0.73,'Sun Belt':0.73}[conf]||0.78;
  ortg*=confStr; drtg*=confStr;

  return {ortg:r1(ortg),drtg:r1(drtg),net:r1(ortg-drtg),pace:r1(env.pace)};
}

// ─────────────────────────────────────────────────────────────────────────────
// WIN PROBABILITY
// ─────────────────────────────────────────────────────────────────────────────
function getWinProbability(teamA, teamB){
  const diff=(teamA.net||0)-(teamB.net||0);
  return r1(100/(1+Math.exp(-diff/6)));
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE PLAYER IN CONTEXT (for player.html)
// ─────────────────────────────────────────────────────────────────────────────
function projectPlayerInContext(player, allTeamPlayers, teamRow){
  const conf=(teamRow&&(teamRow.conf||teamRow.conference))||'';
  const projected=projectTeam(allTeamPlayers.length?allTeamPlayers:[{...player,depth_order:player.depth_order||5}],teamRow);
  const match=projected.find(p=>p.name===player.name);
  return match||null;
}

return {
  projectTeam,
  projectPlayerInContext,
  buildTeamRatings,
  buildTeamEnvironment,
  getWinProbability,
  detectArchetype,
  calculatePortabilityScore,
  calculateScalability,
};

})();
