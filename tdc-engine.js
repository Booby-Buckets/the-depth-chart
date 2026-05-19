/**
 * TDC PROJECTION ENGINE v2.0
 * Advanced college basketball projection model
 * Team-context + possession distribution model
 * All computations derived from existing stats only
 *
 * DROP-IN REPLACEMENT for projectPlayer / buildTeamProjections
 * Exports: TDC.projectTeam(players, teamRow) → projected player array
 *          TDC.projectPlayerInContext(player, teamContext) → single player projection
 */
const TDC = (function(){

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const CONF_TIERS = {
  'B10':1,'SEC':1,'BIG-12':1,'ACC':1,
  'Big-East':2,'A10':2,'WCC':2,'PAC-12':2,
  'MWC':3,'AAC':3,
  'MVC':4,'WAC':4,'Big West':4,'CUSA':4,'MAC':4,
  'Big Sky':5,'CAA':5,'Horizon':5,'Sun Belt':5,'Big South':5,'SBC':5,
  'Ivy':6,'Summit':6,'SoCon':6,'ASUN':6,'MAAC':6,'OVC':6,
  'Patriot':7,'SWAC':7,'NEC':7,'AEC':7,'MEAC':7,
};

const CONF_STRENGTH = {
  'B10':1.00,'SEC':1.00,'BIG-12':1.00,'ACC':0.98,
  'Big-East':0.95,'A10':0.90,'WCC':0.88,'PAC-12':0.92,
  'MWC':0.87,'AAC':0.85,'Ivy':0.82,
  'MVC':0.78,'MAC':0.78,'CUSA':0.76,'WAC':0.76,'Big West':0.75,
  'Big Sky':0.70,'CAA':0.72,'Horizon':0.72,'Sun Belt':0.72,'Big South':0.70,'SBC':0.70,
  'SoCon':0.70,'ASUN':0.70,'MAAC':0.70,'OVC':0.70,'Summit':0.68,
  'Patriot':0.64,'SWAC':0.58,'NEC':0.58,'MEAC':0.56,'AEC':0.55,
};

const ACC_OUT = {1:1.00,2:1.10,3:1.25,4:1.40,5:1.40,6:1.40,7:1.40};
const TRANS_MAT = {
  1:{1:1.00,2:1.15,3:1.28,4:1.40,5:1.40,6:1.40,7:1.40},
  2:{1:0.90,2:1.00,3:1.15,4:1.20,5:1.20,6:1.20,7:1.20},
  3:{1:0.75,2:0.90,3:1.00,4:1.05,5:1.10,6:1.10,7:1.10},
  4:{1:0.49,2:0.68,3:0.82,4:1.00,5:1.05,6:1.05,7:1.05},
  5:{1:0.43,2:0.49,3:0.69,4:0.82,5:1.00,6:1.00,7:1.00},
  6:{1:0.40,2:0.42,3:0.50,4:0.69,5:0.82,6:1.00,7:1.00},
  7:{1:0.30,2:0.34,3:0.42,4:0.48,5:0.69,6:0.82,7:1.00},
};

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
  ].forEach(function(pair){ if(pair&&pair[0]&&pair[1]) pair[0].forEach(function(s){ m[s.toLowerCase()]=pair[1]; }); });
  return m;
})();

function getSchoolConf(school){
  if(!school) return null;
  const lo = school.toLowerCase().trim();
  if(SCHOOL_CONF[lo]) return SCHOOL_CONF[lo];
  for(const k of Object.keys(SCHOOL_CONF)){
    if(lo.includes(k)||k.includes(lo)) return SCHOOL_CONF[k];
  }
  return null;
}

function getTransFactor(origin, dest, grade){
  if(!origin||!dest||origin===dest) return 1.0;
  const ot = CONF_TIERS[origin]||4, dt = CONF_TIERS[dest]||4;
  if(ot===dt) return 1.0;
  const base = origin==='ACC' ? ACC_OUT[dt]||1.0 : (TRANS_MAT[ot]||{})[dt]||1.0;
  const g = parseFloat(grade)||70;
  const boost = g>=90?1.22:g>=85?1.14:g>=80?1.07:g>=75?1.02:g>=70?0.97:g>=65?0.91:0.85;
  return Math.max(0.20, Math.min(1.60, base*boost));
}

function r1(v){ return v!=null ? Math.round(v*10)/10 : null; }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v||0)); }
function s(p, k){ return parseFloat(p[k])||0; }

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — MULTI-YEAR WEIGHTED STATS
// Weight: current season 60%, -1 season 28%, -2 seasons 12%
// If only one season available, use it at 100%
// ─────────────────────────────────────────────────────────────────────────────
function blendCareerStats(p){
  // Primary season always on p.*
  // Prior seasons stored on p.season_m1 (last year) and p.season_m2 (2 years ago)
  // These are optional — if absent, use only current
  const cur = p;
  const m1  = p.season_m1 || null;
  const m2  = p.season_m2 || null;

  const keys = ['ppg','rpg','apg','mpg','fgm','fga','fg_pct','tpm','tpa','tp_pct',
                'ftm','fta','ft_pct','oreb','dreb','stl','blk','tovs'];

  // Determine weights
  let w0=1.00, w1=0.00, w2=0.00;
  if(m1 && parseFloat(m1.ppg||0)>0){
    w0=0.60; w1=0.40;
    if(m2 && parseFloat(m2.ppg||0)>0){ w0=0.60; w1=0.28; w2=0.12; }
  }

  const blended = {};
  keys.forEach(k=>{
    const v0 = parseFloat(cur[k])||0;
    const v1 = m1 ? parseFloat(m1[k])||0 : 0;
    const v2 = m2 ? parseFloat(m2[k])||0 : 0;
    blended[k] = r1(v0*w0 + v1*w1 + v2*w2);
  });

  // Stability score: variance across seasons (lower = more stable)
  if(m1 && parseFloat(m1.ppg||0)>0){
    const ppgVals = [parseFloat(cur.ppg||0), parseFloat(m1.ppg||0)];
    if(m2) ppgVals.push(parseFloat(m2.ppg||0));
    const mean = ppgVals.reduce((a,b)=>a+b,0)/ppgVals.length;
    const variance = ppgVals.reduce((s,v)=>s+Math.pow(v-mean,2),0)/ppgVals.length;
    blended._stability = Math.max(0, 1 - Math.sqrt(variance)/Math.max(1,mean));
    blended._hasCareer = true;
  } else {
    blended._stability = 0.75; // assume moderate stability if only one season
    blended._hasCareer = false;
  }

  // Trend: is player improving or declining?
  if(m1 && parseFloat(m1.ppg||0)>0){
    const trend = parseFloat(cur.ppg||0) - parseFloat(m1.ppg||0);
    blended._trend = trend; // positive = improving
  } else {
    blended._trend = 0;
  }

  return blended;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — PLAYER ARCHETYPE DETECTION
// Derived purely from statistical patterns
// ─────────────────────────────────────────────────────────────────────────────
function detectArchetype(p, blended){
  const usg  = parseFloat(p.usg_pct||p['usg%']||0);
  const ts   = parseFloat(p.ts_pct||p['ts%']||0);
  const ppg  = s(blended,'ppg');
  const apg  = s(blended,'apg');
  const rpg  = s(blended,'rpg');
  const tpa  = s(blended,'tpa');
  const fga  = s(blended,'fga');
  const blk  = s(blended,'blk');
  const stl  = s(blended,'stl');
  const tovs = s(blended,'tovs');
  const oreb = s(blended,'oreb');
  const fg   = s(blended,'fg_pct');
  const tp   = s(blended,'tp_pct');
  const mpg  = s(blended,'mpg');
  const pos  = (p.position||'G').replace(/\d/g,'').trim();
  const isBig = pos==='PF'||pos==='C';
  const isG   = pos==='PG'||pos==='SG'||pos==='CG'||pos==='G';

  // Derived creation metric: APG + (FGA/MPG)*MPG-based usage proxy
  const creationRate = mpg>0 ? (apg + (fga*0.15))/mpg : 0;
  const tpaRate = fga>0 ? tpa/fga : 0;

  // PRIMARY ARCHETYPES — ordered by priority
  if(usg>=30 && ppg>=18 && apg>=3.5) return 'heliocentric_creator';
  if(usg>=28 && ppg>=18) return 'high_usage_scorer';
  if(usg>=25 && apg>=5 && ppg<14) return 'primary_creator';
  if(tpaRate>=0.55 && tp>=36 && ppg>=8) return 'spacer';
  if(isBig && oreb>=2.5 && blk>=1.2 && tpaRate<0.25) return 'interior_anchor';
  if(isBig && tpaRate>=0.40 && tp>=33) return 'stretch_big';
  if(isBig && oreb>=2.0 && ppg<8) return 'rim_runner';
  if(stl>=1.4 && ppg<10 && (isG)) return 'defensive_specialist';
  if(apg>=3.5 && ppg>=9 && ppg<15) return 'connector';
  if(usg>=18 && ppg>=10 && apg<2.5 && tpaRate<0.35) return 'play_finisher';
  if(ppg<7 && mpg>=14 && (ts>=0.55||fg>=47)) return 'low_usage_efficiency';
  if(ppg>=12 && mpg<20) return 'microwave_scorer';
  if(usg<=14 && ppg<8) return 'role_player';
  return 'connector'; // default
}

// Archetype interaction modifiers — how archetypes affect teammates
const ARCHETYPE_SYNERGIES = {
  // [myArchetype][teammateArchetype] = modifier to MY stats
  'spacer':              { 'primary_creator':+0.06, 'heliocentric_creator':+0.08, 'connector':+0.03 },
  'play_finisher':       { 'primary_creator':+0.10, 'heliocentric_creator':+0.12, 'spacer':+0.04 },
  'rim_runner':          { 'spacer':+0.08, 'primary_creator':+0.06 },
  'connector':           { 'spacer':+0.04, 'interior_anchor':+0.04 },
  'defensive_specialist':{ 'interior_anchor':+0.05 },
  'high_usage_scorer':   { 'high_usage_scorer':-0.10, 'heliocentric_creator':-0.15, 'primary_creator':-0.08 },
  'heliocentric_creator':{ 'high_usage_scorer':-0.12, 'primary_creator':-0.08, 'connector':-0.04 },
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — TEAM POSSESSION ENVIRONMENT
// Derive team pace/possessions from roster composition
// ─────────────────────────────────────────────────────────────────────────────
function buildTeamEnvironment(players, conf){
  const withStats = players.filter(p => s(p,'ppg')>0);
  if(!withStats.length) return null;

  const confStr = CONF_STRENGTH[conf]||0.82;

  // Weighted averages by minutes
  const totalMins = withStats.reduce((t,p)=>t+s(p,'mpg'),0)||1;
  const wAvg = k => withStats.reduce((t,p)=>t+s(p,k)*s(p,'mpg'),0)/totalMins;

  // Raw team estimates (×5 players per possession)
  const teamFga  = wAvg('fga')*5;
  const teamTpa  = wAvg('tpa')*5;
  const teamFta  = wAvg('fta')*5;
  const teamTov  = wAvg('tovs')*5;
  const teamOreb = wAvg('oreb')*5;
  const teamPpg  = wAvg('ppg')*5;
  const teamApg  = wAvg('apg')*5;

  // Possessions estimate
  const poss = Math.max(50, teamFga - teamOreb + teamTov + 0.44*teamFta);

  // Pace classification
  let paceType;
  if(poss>=78)      paceType = 'elite_tempo';
  else if(poss>=72) paceType = 'transition_heavy';
  else if(poss>=66) paceType = 'balanced';
  else              paceType = 'slow_halfcourt';

  // Total available team FGA (realistic cap)
  const teamFgaCap = paceType==='elite_tempo'?62:paceType==='transition_heavy'?58:paceType==='balanced'?55:51;

  // Spacing quality: how many players project as 3-point threats
  const shooters = withStats.filter(p => s(p,'tpa')>=2.5 && s(p,'tp_pct')>=34).length;
  const spacingQuality = Math.min(1.0, shooters/4); // 4 shooters = perfect spacing

  // Playmaking environment: total assist production
  const assistEnv = wAvg('apg') * 5; // team assists per game

  // Rebounding environment: how many rebounds are available vs competition
  const drebRate = wAvg('dreb') / Math.max(1,(wAvg('dreb')+wAvg('oreb')));

  // Usage distribution: how concentrated is offense?
  // Higher = more concentrated (star-dependent)
  const ppgArr = withStats.map(p=>s(p,'ppg')).sort((a,b)=>b-a);
  const topShare = ppgArr.length>1 ? ppgArr[0]/(ppgArr.reduce((t,v)=>t+v,0)||1) : 0.5;

  // Offensive efficiency baseline (conf-adjusted)
  const ortgBase = poss>0 ? (teamPpg/poss)*100*confStr : 90;

  // Archetype distribution of roster
  const archetypes = withStats.map(p => detectArchetype(p, blendCareerStats(p)));

  // Count archetype types
  const archetypeCount = {};
  archetypes.forEach(a=>{ archetypeCount[a]=(archetypeCount[a]||0)+1; });

  // Ball dominance — how many players want to initiate?
  const initiators = (archetypeCount['heliocentric_creator']||0) +
                     (archetypeCount['primary_creator']||0) +
                     (archetypeCount['high_usage_scorer']||0);

  return {
    conf, confStr, poss, paceType, teamFgaCap, spacingQuality,
    assistEnv, drebRate, topShare, ortgBase, archetypeCount,
    initiators, teamPpg, teamApg, teamFga, teamTov,
    wAvgFg: wAvg('fg_pct'), wAvg3P: wAvg('tp_pct'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — USAGE COMPETITION ENGINE
// Redistribute offensive load based on teammates
// ─────────────────────────────────────────────────────────────────────────────
function computeUsageShare(players, env){
  // Assign raw usage weights from grade + archetype + depth
  const withStats = players.filter(p=>s(p,'ppg')>0||p._froshProjected);
  if(!withStats.length) return {};

  // Raw usage weight per player: grade × archetype multiplier × depth multiplier
  const archetypeUsage = {
    'heliocentric_creator':2.8, 'high_usage_scorer':2.2, 'primary_creator':2.0,
    'microwave_scorer':1.6, 'play_finisher':1.5, 'connector':1.3,
    'spacer':1.1, 'stretch_big':1.0, 'rim_runner':1.0,
    'low_usage_efficiency':0.8, 'role_player':0.7,
    'interior_anchor':0.9, 'defensive_specialist':0.6,
  };

  const weights = {};
  withStats.forEach(p=>{
    const grade = parseFloat(p.tdc_grade)||70;
    const depth = p.depth_order||8;
    const arch  = p._archetype||'role_player';
    const depthMult = depth<=2?1.0:depth<=5?0.80:depth<=8?0.60:0.40;
    const gradeMult  = grade>=88?1.15:grade>=80?1.05:grade>=70?1.00:0.90;
    weights[p.name] = (archetypeUsage[arch]||1.0) * depthMult * gradeMult;
  });

  const totalWeight = Object.values(weights).reduce((t,v)=>t+v,0)||1;

  // FGA budget from team environment
  const fgaBudget = env ? env.teamFgaCap : 55;

  // Share = weight / total × fgaBudget
  const shares = {};
  withStats.forEach(p=>{
    shares[p.name] = (weights[p.name]/totalWeight) * fgaBudget;
  });

  // Suppress secondary initiators when dominant high-usage player exists
  if(env && env.initiators >= 2){
    const dominated = withStats.filter(p=>{
      const a = p._archetype;
      return a==='connector'||a==='play_finisher'||a==='spacer';
    });
    dominated.forEach(p=>{
      shares[p.name] = (shares[p.name]||0) * 0.88;
    });
  }

  // High-usage pair penalty — two heliocentrics cannibalize each other
  const helios = withStats.filter(p=>p._archetype==='heliocentric_creator');
  if(helios.length>=2){
    helios.forEach(p=>{ shares[p.name] = (shares[p.name]||0)*0.82; });
  }

  return shares;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — REBOUNDING ECOSYSTEM
// Distribute rebounds from projected missed shots
// ─────────────────────────────────────────────────────────────────────────────
function computeReboundShares(players, env, usageShares){
  if(!env) return {};
  const withStats = players.filter(p=>s(p,'rpg')>0||p._froshProjected);

  // Projected team missed shots = FGA - FGM estimate
  const fgaPct = env.wAvgFg/100 || 0.45;
  const misses = env.teamFga * (1-fgaPct);

  // Raw rebound weight per player
  const weights = {};
  withStats.forEach(p=>{
    const grade = parseFloat(p.tdc_grade)||70;
    const rpgRate = s(p,'rpg')/Math.max(1,s(p,'mpg'));
    const arch  = p._archetype||'role_player';
    const isBigArch = arch==='interior_anchor'||arch==='rim_runner'||arch==='stretch_big';
    const archMult = isBigArch ? 1.25 : arch==='play_finisher'||arch==='connector' ? 0.85 : 1.00;
    weights[p.name] = (rpgRate * s(p,'mpg') + (grade-60)*0.02) * archMult;
  });

  const totalW = Object.values(weights).reduce((t,v)=>t+v,0)||1;

  // Multiple elite rebounders cannibalize each other
  const eliteRebounders = withStats.filter(p=>s(p,'rpg')>=7&&s(p,'mpg')>=18).length;
  const cannibalFactor = eliteRebounders>=2 ? 0.88 : eliteRebounders>=3 ? 0.80 : 1.0;

  const shares = {};
  withStats.forEach(p=>{
    shares[p.name] = (weights[p.name]/totalW) * misses * cannibalFactor;
  });

  return shares;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 — MINUTE DISTRIBUTION
// Grade-order base + fit bonuses/penalties
// ─────────────────────────────────────────────────────────────────────────────
function computeMinutes(players, conf){
  const sorted = [...players]
    .filter(p=>p.name&&p.name!=='—')
    .sort((a,b)=>(a.depth_order||99)-(b.depth_order||99));

  if(!sorted.length) return {};

  const grades = sorted.map(p=>parseFloat(p.tdc_grade)||70);
  const teamAvgGrade = grades.reduce((a,b)=>a+b,0)/grades.length;
  const rosterSize = sorted.length;

  // Rotation depth cutoff
  let rotDepth = rosterSize;
  for(let i=2;i<sorted.length-1;i++){
    const g1=parseFloat(sorted[i-1].tdc_grade)||70;
    const g2=parseFloat(sorted[i].tdc_grade)||70;
    if((g1-g2)>=9&&g2<=68){rotDepth=i;break;}
    if(g2<63&&i>=6){rotDepth=i;break;}
  }
  rotDepth = Math.max(7,Math.min(12,rotDepth));

  const mpgMap = {};
  sorted.forEach((p,i)=>{
    const g = parseFloat(p.tdc_grade)||70;
    const slot = i+1;
    let base;
    if(slot<=5){ const gn=Math.max(-1,Math.min(1,(g-teamAvgGrade)/15)); base=30.5+gn*3.5; }
    else if(slot===6) base=20; else if(slot===7) base=17; else if(slot===8) base=14;
    else if(slot===9) base=11; else if(slot===10) base=8;
    else base=Math.max(2,6-(slot-10)*1.5);

    // Grade modifier
    base = base*(1+((g-teamAvgGrade)/20)*0.10);

    // Small roster boost
    if(slot<=5&&rosterSize<=8) base=Math.min(38,base+2);

    // Deep bench cap
    if(slot>rotDepth) base=Math.min(5,base);

    // Archetype fit bonus: complementary pairs get slight boost
    // Redundancy penalty: same archetype nearby gets slight cut
    const arch = p._archetype||'role_player';
    const nearbyArchetypes = sorted.slice(Math.max(0,i-2),i+3)
      .filter(r=>r.name!==p.name)
      .map(r=>r._archetype||'role_player');

    // Penalty for redundancy
    const sameArch = nearbyArchetypes.filter(a=>a===arch).length;
    if(sameArch>=1) base *= 0.97;
    if(sameArch>=2) base *= 0.94;

    // Bonus for complementary fit
    const hasCreator  = nearbyArchetypes.some(a=>a.includes('creator')||a.includes('initiator'));
    const isFinisher  = arch==='play_finisher'||arch==='rim_runner'||arch==='spacer';
    if(hasCreator && isFinisher && slot<=8) base *= 1.02;

    mpgMap[p.name] = Math.max(1,Math.min(38,base));
  });

  // Close-grade pair splitting (same position)
  const posCounts = {};
  sorted.forEach(p=>{
    const pk = normPos(p.position);
    posCounts[pk] = (posCounts[pk]||0)+1;
    p._pk = pk;
  });

  for(let i=0;i<Math.min(sorted.length-1,9);i++){
    const r1=sorted[i], r2=sorted[i+1];
    if(r1._pk!==r2._pk) continue;
    const g1=parseFloat(r1.tdc_grade)||70, g2=parseFloat(r2.tdc_grade)||70;
    const diff=g1-g2;
    if(diff<=3){ const c=mpgMap[r1.name]+mpgMap[r2.name]; mpgMap[r1.name]=c*0.53; mpgMap[r2.name]=c*0.47; }
    else if(diff<=6){ const c=mpgMap[r1.name]+mpgMap[r2.name]; mpgMap[r1.name]=c*0.65; mpgMap[r2.name]=c*0.35; }
  }

  // Monotonic enforcement
  for(let i=1;i<sorted.length;i++){
    const prev=sorted[i-1].name, cur=sorted[i].name;
    if(mpgMap[cur]>mpgMap[prev]) mpgMap[cur]=mpgMap[prev]*0.95;
  }

  // Starter budget cap
  const top5 = sorted.slice(0,5);
  const st = top5.reduce((sum,p)=>sum+(mpgMap[p.name]||0),0);
  if(st>196){ const sc=196/st; top5.forEach(p=>{mpgMap[p.name]=(mpgMap[p.name]||0)*sc;}); }

  return mpgMap;
}

function normPos(pos){
  const p=(pos||'G').replace(/\d/g,'').trim().toUpperCase();
  if(['PG','SG','CG','G'].includes(p)) return 'G';
  if(['SF','F'].includes(p)) return 'F';
  if(['PF','C'].includes(p)) return 'C';
  return 'G';
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 7 — STATISTICAL STABILITY SCORE
// Generate hidden stability metric from career data
// ─────────────────────────────────────────────────────────────────────────────
function computeStabilityScore(p, blended){
  // If we have career data, use the stability from blendCareerStats
  if(blended._hasCareer) return blended._stability;

  // Otherwise infer from single-season indicators
  const gp = s(p,'gp');
  const mpg = s(p,'mpg');
  const ts  = parseFloat(p.ts_pct||p['ts%']||0);
  const fg  = s(p,'fg_pct');

  // Players with high GP, consistent minutes, good efficiency = more stable
  let score = 0.60;
  if(gp>=28) score+=0.10;
  if(gp>=32) score+=0.05;
  if(mpg>=24) score+=0.05;
  if(fg>=44) score+=0.05;
  if(fg>=48) score+=0.05;
  if(ts>=0.54) score+=0.05;

  return Math.min(0.95, score);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 8 — SCALABILITY CURVES
// Which players maintain efficiency with increased minutes/usage?
// ─────────────────────────────────────────────────────────────────────────────
function computeScalability(p, blended, archetype){
  // Returns a multiplier 0.7–1.1 applied to efficiency when usage increases
  const fg   = s(blended,'fg_pct');
  const ts   = parseFloat(p.ts_pct||p['ts%']||0);
  const tovR = s(p,'mpg')>0 ? s(blended,'tovs')/s(blended,'mpg') : 0;
  const usg  = parseFloat(p.usg_pct||p['usg%']||0);
  const stab = blended._stability||0.7;

  let scalability = 0.85; // default: modest decline with more load

  // Elite efficiency = scales well
  if(fg>=50&&ts>=0.56) scalability+=0.10;
  if(fg>=47&&ts>=0.54) scalability+=0.05;

  // Low turnover rate = handles pressure well
  if(tovR<0.06) scalability+=0.05;
  if(tovR>0.12) scalability-=0.08;

  // Already high usage = less room to scale
  if(usg>=28) scalability-=0.08;
  if(usg>=32) scalability-=0.05;

  // Career stability bonus
  scalability += (stab-0.75)*0.15;

  // Archetype adjustments
  if(archetype==='low_usage_efficiency') scalability-=0.12; // good in small role, not large
  if(archetype==='microwave_scorer') scalability-=0.08;     // situational, not full load
  if(archetype==='interior_anchor') scalability+=0.05;      // rim work is efficient at any level
  if(archetype==='heliocentric_creator') scalability+=0.08; // built for high load

  return Math.max(0.70, Math.min(1.10, scalability));
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 9 — SPACING ENGINE
// Affect FG%, turnovers, assists, rim efficiency
// ─────────────────────────────────────────────────────────────────────────────
function computeSpacingEffect(player, env){
  if(!env) return {fg:0, apg:0, tov:0};
  const sq = env.spacingQuality; // 0–1

  // Good spacing benefits slashers/creators most
  const arch = player._archetype||'role_player';
  const isSlasher = arch==='play_finisher'||arch==='rim_runner'||arch==='connector'||arch==='heliocentric_creator'||arch==='primary_creator';
  const isShooter = arch==='spacer'||arch==='stretch_big';

  let fgBoost=0, apgBoost=0, tovMult=1.0;

  if(isSlasher){
    fgBoost = (sq-0.50)*4.0;   // 4% FG swing from worst to best spacing
    apgBoost = (sq-0.50)*0.6;  // assists easier when defense collapses
    tovMult  = 1-(sq-0.50)*0.08; // fewer turnovers with spacing
  } else if(isShooter){
    fgBoost = (sq-0.50)*1.5;   // slight benefit, already spaced
  } else {
    fgBoost = (sq-0.50)*1.5;   // mild effect for everyone
  }

  // Poor spacing hurts everyone
  if(sq<0.35){ fgBoost-=2.0; tovMult+=0.05; }

  return {fg:fgBoost, apg:apgBoost, tovMult};
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 10 — PLAYMAKING ECOSYSTEM
// Boost assists for players beside efficient shooters
// ─────────────────────────────────────────────────────────────────────────────
function computePlaymakingEffect(player, teammates, env){
  const arch = player._archetype||'role_player';
  const isCreator = arch==='primary_creator'||arch==='heliocentric_creator'||arch==='connector';
  if(!isCreator) return 1.0;

  // Count efficient shooters on team
  const goodShooters = teammates.filter(t=>{
    return t.name!==player.name && s(t,'tp_pct')>=36 && s(t,'tpa')>=2;
  }).length;

  // Count other ball handlers competing for assists
  const otherCreators = teammates.filter(t=>{
    return t.name!==player.name && (
      (t._archetype||'').includes('creator') || (t._archetype||'')==='connector'
    );
  }).length;

  let mult = 1.0;
  mult += goodShooters * 0.04; // +4% per quality shooter
  mult -= otherCreators * 0.06; // -6% per competing creator

  return Math.max(0.75, Math.min(1.25, mult));
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 11 — PLAYER INTERACTION MATRIX
// Every player influences teammates
// ─────────────────────────────────────────────────────────────────────────────
function computeInteractionMult(player, teammates){
  const myArch = player._archetype||'role_player';
  const syns   = ARCHETYPE_SYNERGIES[myArch]||{};

  let totalMult = 1.0;
  let interactions = 0;

  teammates.forEach(t=>{
    if(t.name===player.name) return;
    const ta = t._archetype||'role_player';
    if(syns[ta]!=null){
      totalMult += syns[ta];
      interactions++;
    }
  });

  // Don't over-amplify on large rosters
  if(interactions>3) totalMult = 1.0 + (totalMult-1.0)*(3/interactions);

  return Math.max(0.70, Math.min(1.20, totalMult));
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 12 — CONFERENCE TRANSFER TRANSLATION
// Improved with archetype/scalability context
// ─────────────────────────────────────────────────────────────────────────────
function computeTransferFactor(p, destConf, blended, archetype, scalability){
  const isTransfer = p.hometown && p.hometown.trim()!=='';
  if(!isTransfer || s(blended,'ppg')===0) return 1.0;

  const originConf = getSchoolConf(p.hometown);
  if(!originConf) return 1.0;

  const grade = parseFloat(p.tdc_grade)||70;
  let factor = getTransFactor(originConf, destConf, grade);

  // Scalability adjustment: highly scalable players translate better going up
  if(factor<1.0){
    // Going up in conference
    const scBoost = (scalability-0.85)*0.30; // up to +/- 9%
    factor = Math.max(0.25, factor*(1+scBoost));

    // Inefficient volume scorers deflated extra (they inflate stats in weak conf)
    if(archetype==='high_usage_scorer' && s(blended,'fg_pct')<42){
      factor *= 0.92;
    }
    // Efficient low-usage players translate better
    if(archetype==='low_usage_efficiency' || archetype==='spacer'){
      factor *= 1.05;
    }
  }

  return Math.max(0.22, Math.min(1.65, factor));
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 13 — YEAR PROGRESSION
// ─────────────────────────────────────────────────────────────────────────────
function yearProgMult(yr, trend){
  const y = (yr||'').toLowerCase();
  const isFr  = y.includes('fr.')||y.includes('r-fr');
  const isSo  = y.includes('so.')||y.includes('r-so.');
  const isJr  = y.includes('jr.')||y.includes('r-jr.');
  const isSr  = y.includes('sr.')||y.includes('r-sr')||y.includes('gr.');

  let base = isFr?1.10:isSo?1.06:isJr?1.03:isSr?1.01:1.04;

  // If player has a positive trend (improving year over year), amplify slightly
  if(trend>2) base = Math.min(base+0.02, base*1.03);
  if(trend<-3) base = Math.max(base-0.02, base*0.97); // declining player

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 14 — GRADE vs STATS GAP
// ─────────────────────────────────────────────────────────────────────────────
function gradeGapMult(grade, ppgPer32, posNorm){
  // Expected PPG at 32 min for this grade and position
  const posScale = posNorm==='PG'||posNorm==='SG'||posNorm==='CG' ? 1.05
                 : posNorm==='SF' ? 1.00
                 : posNorm==='PF' ? 0.97
                 : posNorm==='C'  ? 0.93 : 1.00;

  const gradeExpPpg = (grade>=90?19:grade>=85?16:grade>=80?13:grade>=75?10:grade>=70?8:6)*posScale;
  const gapRatio = gradeExpPpg>0 ? ppgPer32/gradeExpPpg : 1;

  if(gapRatio<0.50) return 1.18;
  if(gapRatio<0.65) return 1.12;
  if(gapRatio<0.80) return 1.06;
  if(gapRatio<0.95) return 1.02;
  if(gapRatio>1.40) return 0.97;
  if(gapRatio>1.20) return 0.99;
  return 1.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 15 — PERCENTAGE PROJECTIONS
// Driven by: year boost, volume change, spacing, transfer, stability
// ─────────────────────────────────────────────────────────────────────────────
function projectPercentages(p, blended, newMpg, isTransfer, transferFactor, spacingEffect, yr){
  const fgBase = s(blended,'fg_pct');
  const tpBase = s(blended,'tp_pct');
  const ftBase = s(blended,'ft_pct');
  const oldFga = s(blended,'fga');
  const y = (yr||'').toLowerCase();
  const isFr = y.includes('fr.')||y.includes('r-fr');
  const isSo = y.includes('so.')||y.includes('r-so.');
  const isJr = y.includes('jr.')||y.includes('r-jr.');
  const isSr = y.includes('sr.')||y.includes('r-sr')||y.includes('gr.');

  // Year-based efficiency improvement
  const yearFgBoost = isFr?2.0:isSo?1.2:isJr?0.6:0;
  const yearTpBoost = isFr?1.5:isSo?0.8:isJr?0.4:0;
  const yearFtBoost = isFr?1.5:isSo?1.0:isJr?0.5:0;

  // Volume change penalty
  const oldMpg = Math.max(1, s(p,'mpg'));
  const newFgaEst = oldFga>0 ? oldFga*(newMpg/oldMpg) : newMpg*0.28;
  const volChange = oldFga>0 ? (newFgaEst/oldFga-1) : 0;
  const volPenalty = volChange * 3.5;

  // Transfer difficulty
  const transFgAdj = transferFactor<0.85?-2.5:transferFactor<0.95?-1.2:transferFactor>1.15?+1.0:transferFactor>1.05?+0.5:0;

  // Spacing effect on FG%
  const spacingFgBoost = spacingEffect.fg||0;

  // Stability modifier — stable shooters don't need to be moved much
  const stab = blended._stability||0.7;
  const stabDamp = 0.7 + stab*0.3; // 0.7–1.0 multiplier on changes

  const fgChange = (yearFgBoost - volPenalty + transFgAdj + spacingFgBoost)*stabDamp;
  const tpChange = (yearTpBoost - volChange*2.0 + transFgAdj*0.6)*stabDamp;
  const ftChange = yearFtBoost*stabDamp;

  return {
    fg_pct: r1(clamp(fgBase+fgChange, 28, 66)),
    tp_pct: r1(clamp(tpBase+tpChange, 15, 50)),
    ft_pct: r1(clamp(ftBase+ftChange, 42, 97)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 16 — TEAM STAT CONSTRAINT SYSTEM
// Generate team totals first, then validate player sums fit
// ─────────────────────────────────────────────────────────────────────────────
function applyTeamConstraints(projectedPlayers, env){
  if(!env||!projectedPlayers.length) return projectedPlayers;

  const result = projectedPlayers.map(p=>({...p}));

  // FGA constraint — top-8 players combined shouldn't exceed 62 FGA
  const top8 = result.slice(0,8);
  const totalFga = top8.reduce((t,p)=>t+(parseFloat(p.fga)||0),0);
  if(totalFga>62){
    const scale = 62/totalFga;
    top8.forEach(p=>{
      p.fga  = r1((parseFloat(p.fga)||0)*scale);
      p.fgm  = r1((parseFloat(p.fgm)||0)*scale);
      p.tpa  = r1((parseFloat(p.tpa)||0)*scale);
      p.tpm  = r1((parseFloat(p.tpm)||0)*scale);
      p.ppg  = r1((parseFloat(p.ppg)||0)*scale);
    });
  }

  // Scoring sanity: team total PPG shouldn't exceed 95 (including bench)
  const totalPpg = result.reduce((t,p)=>t+(parseFloat(p.ppg)||0),0);
  if(totalPpg>88){
    const scale = 88/totalPpg;
    result.forEach(p=>{
      p.ppg = r1((parseFloat(p.ppg)||0)*scale);
      p.fgm = r1((parseFloat(p.fgm)||0)*scale);
    });
  }

  // Final sanity clamps on each player
  result.forEach(p=>{
    p.ppg  = r1(clamp(parseFloat(p.ppg),  0, 36));
    p.rpg  = r1(clamp(parseFloat(p.rpg),  0, 16));
    p.apg  = r1(clamp(parseFloat(p.apg),  0, 12));
    p.mpg  = r1(clamp(parseFloat(p.mpg),  1, 38));
    p.stl  = r1(clamp(parseFloat(p.stl),  0, 4));
    p.blk  = r1(clamp(parseFloat(p.blk),  0, 5));
    p.tovs = r1(clamp(parseFloat(p.tovs), 0, 6));
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// FRESHMAN BASELINE PROJECTIONS
// ─────────────────────────────────────────────────────────────────────────────
function freshmanBaseline(grade, posNorm, newMpg){
  // Tiered baselines at 32 MPG — scale by actual MPG
  const tier = grade>=92?'t1':grade>=85?'t2':grade>=75?'t3':'t4';

  const bases = {
    t1:{ PG:{ppg:17.5,rpg:3.5,apg:4.5,fg:45.5,tp:37.5,ft:78,stl:1.4,blk:0.2,tovs:2.8,oreb:0.6,dreb:2.9},
         SG:{ppg:16.0,rpg:4.0,apg:2.25,fg:43.5,tp:38.5,ft:77,stl:1.2,blk:0.3,tovs:2.4,oreb:0.8,dreb:3.2},
         SF:{ppg:18.5,rpg:5.0,apg:1.75,fg:46.5,tp:36.0,ft:76,stl:1.0,blk:0.6,tovs:2.2,oreb:1.5,dreb:3.5},
         PF:{ppg:16.0,rpg:6.5,apg:1.8,fg:50.0,tp:31.0,ft:70,stl:0.7,blk:1.2,tovs:2.0,oreb:2.5,dreb:4.0},
         C: {ppg:14.0,rpg:9.0,apg:1.05,fg:56.0,tp:22.0,ft:65,stl:0.4,blk:1.8,tovs:1.8,oreb:3.2,dreb:5.8} },
    t2:{ PG:{ppg:13.0,rpg:3.0,apg:3.5,fg:43.5,tp:35.5,ft:76,stl:1.1,blk:0.2,tovs:2.4,oreb:0.5,dreb:2.5},
         SG:{ppg:12.0,rpg:3.5,apg:1.8,fg:41.5,tp:36.0,ft:75,stl:1.0,blk:0.25,tovs:2.0,oreb:0.7,dreb:2.8},
         SF:{ppg:14.0,rpg:4.5,apg:1.5,fg:44.0,tp:34.5,ft:73,stl:0.8,blk:0.5,tovs:1.8,oreb:1.3,dreb:3.2},
         PF:{ppg:12.0,rpg:5.8,apg:1.4,fg:47.5,tp:29.0,ft:68,stl:0.6,blk:1.0,tovs:1.7,oreb:2.2,dreb:3.6},
         C: {ppg:10.5,rpg:7.5,apg:0.9,fg:52.5,tp:18.0,ft:62,stl:0.35,blk:1.5,tovs:1.5,oreb:2.8,dreb:4.7} },
    t3:{ PG:{ppg:8.5,rpg:2.2,apg:2.5,fg:41.0,tp:33.0,ft:73,stl:0.8,blk:0.1,tovs:1.8,oreb:0.4,dreb:1.8},
         SG:{ppg:7.5,rpg:2.5,apg:1.2,fg:40.0,tp:33.5,ft:72,stl:0.7,blk:0.2,tovs:1.5,oreb:0.5,dreb:2.0},
         SF:{ppg:9.0,rpg:3.5,apg:1.0,fg:42.5,tp:32.0,ft:70,stl:0.6,blk:0.4,tovs:1.4,oreb:1.0,dreb:2.5},
         PF:{ppg:7.5,rpg:4.5,apg:1.0,fg:45.0,tp:25.0,ft:65,stl:0.4,blk:0.7,tovs:1.3,oreb:1.8,dreb:2.7},
         C: {ppg:6.5,rpg:6.0,apg:0.7,fg:49.0,tp:12.0,ft:58,stl:0.3,blk:1.0,tovs:1.2,oreb:2.2,dreb:3.8} },
    t4:{ PG:{ppg:5.0,rpg:1.5,apg:1.5,fg:39.0,tp:30.0,ft:70,stl:0.5,blk:0.1,tovs:1.2,oreb:0.3,dreb:1.2},
         SG:{ppg:4.5,rpg:1.8,apg:0.8,fg:38.5,tp:30.5,ft:69,stl:0.45,blk:0.15,tovs:1.0,oreb:0.35,dreb:1.4},
         SF:{ppg:5.5,rpg:2.5,apg:0.7,fg:40.5,tp:29.0,ft:68,stl:0.4,blk:0.3,tovs:0.9,oreb:0.7,dreb:1.8},
         PF:{ppg:4.5,rpg:3.2,apg:0.7,fg:43.0,tp:20.0,ft:62,stl:0.3,blk:0.5,tovs:0.8,oreb:1.2,dreb:2.0},
         C: {ppg:4.0,rpg:4.5,apg:0.5,fg:47.0,tp:8.0,ft:55,stl:0.2,blk:0.8,tovs:0.7,oreb:1.7,dreb:2.8} },
  };

  const b = (bases[tier]||bases.t3)[posNorm] || (bases[tier]||bases.t3)['SG'];
  const scale = newMpg/32;

  const fga = r1(newMpg*0.27);
  return {
    ppg:r1(b.ppg*scale), rpg:r1(b.rpg*scale), apg:r1(b.apg*scale), mpg:r1(newMpg),
    fgm:r1(fga*(b.fg/100)), fga:r1(fga), fg_pct:r1(b.fg),
    tpa:r1(fga*0.40), tpm:r1(fga*0.40*(b.tp/100)), tp_pct:r1(b.tp),
    fta:r1(newMpg*0.09), ftm:r1(newMpg*0.09*(b.ft/100)), ft_pct:r1(b.ft),
    oreb:r1(b.oreb*scale), dreb:r1(b.dreb*scale),
    stl:r1(b.stl*scale), blk:r1(b.blk*scale), tovs:r1(b.tovs*scale),
    _frosh:true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT: projectTeam
// Takes array of players + teamRow (with conf, grades, etc.)
// Returns array of projected players in depth order
// ─────────────────────────────────────────────────────────────────────────────
function projectTeam(rawPlayers, teamRow){
  const conf = (teamRow&&(teamRow.conf||teamRow.conference))||'';
  const players = rawPlayers
    .filter(p=>p.name&&p.name!=='—')
    .sort((a,b)=>(a.depth_order||99)-(b.depth_order||99));

  if(!players.length) return [];

  // ── Phase 1: Enrich players with career-blended stats + archetype ──
  const enriched = players.map(p=>{
    const blended = blendCareerStats(p);
    const arch    = detectArchetype(p, blended);
    const stab    = computeStabilityScore(p, blended);
    return {...p, _blended:blended, _archetype:arch, _stability:stab};
  });

  // ── Phase 2: Build team environment ──
  const env = buildTeamEnvironment(enriched, conf);

  // ── Phase 3: Compute minutes for everyone ──
  const mpgMap = computeMinutes(enriched, conf);

  // ── Phase 4: Compute usage shares ──
  const usageShares = computeUsageShare(enriched, env);

  // ── Phase 5: Compute rebound shares ──
  const rebShares = computeReboundShares(enriched, env, usageShares);

  // ── Phase 6: Project each player ──
  const projected = enriched.map(p=>{
    const blended  = p._blended;
    const arch     = p._archetype;
    const grade    = parseFloat(p.tdc_grade)||70;
    const yr       = p.yr||p.class_year||'';
    const isY      = (yr||'').toLowerCase();
    const isFr     = isY.includes('fr.')||isY.includes('r-fr');
    const posNorm  = normPosDetailed(p.position);
    const hasStats = s(blended,'ppg')>0;
    const newMpg   = mpgMap[p.name]||5;

    // Scalability
    const scalability = computeScalability(p, blended, arch);

    // Transfer factor (enhanced with scalability/archetype)
    const transferFactor = computeTransferFactor(p, conf, blended, arch, scalability);

    // Archetype transfer additional counting factor (going up only)
    const countingTransFactor = transferFactor<1.0 ? Math.max(transferFactor, 0.70) : 1.0;

    // Spacing effect from team environment
    const spacingEffect = computeSpacingEffect(p, env);

    // Interaction multiplier from teammates
    const interactionMult = computeInteractionMult(p, enriched);

    // Playmaking environment
    const playmakingMult = computePlaymakingEffect(p, enriched, env);

    // Year progression (with trend)
    const yrMult = yearProgMult(yr, blended._trend||0);

    // Freshman with no stats
    if(isFr && !hasStats){
      const frosh = freshmanBaseline(grade, posNorm, newMpg);
      // Apply team spacing bonus/penalty to freshman percentages
      frosh.fg_pct = r1(clamp((frosh.fg_pct||42)+spacingEffect.fg, 28, 66));
      frosh._archetype = arch;
      frosh._frosh = true;
      frosh._origin = null;
      frosh._factor = transferFactor;
      frosh._env = env?.paceType;
      return {...p, ...frosh};
    }

    if(!hasStats) return null;

    // Per-minute rates from career-blended stats
    const oldMpg = Math.max(1, s(blended,'mpg'));
    const pm = {
      ppg:  s(blended,'ppg')/oldMpg,
      rpg:  s(blended,'rpg')/oldMpg,
      apg:  s(blended,'apg')/oldMpg,
      fgm:  s(blended,'fgm')/oldMpg,
      fga:  s(blended,'fga')/oldMpg,
      tpm:  s(blended,'tpm')/oldMpg,
      tpa:  s(blended,'tpa')/oldMpg,
      ftm:  s(blended,'ftm')/oldMpg,
      fta:  s(blended,'fta')/oldMpg,
      oreb: s(blended,'oreb')/oldMpg,
      dreb: s(blended,'dreb')/oldMpg,
      stl:  s(blended,'stl')/oldMpg,
      blk:  s(blended,'blk')/oldMpg,
      tovs: s(blended,'tovs')/oldMpg,
    };

    // Grade gap multiplier
    const gapMult = gradeGapMult(grade, pm.ppg*32, posNorm);

    // Rate growth (year + gap)
    const rateGrowth = yrMult * gapMult * interactionMult;

    // Scalability adjustment for usage change
    const mpgRatio = newMpg/Math.max(1,oldMpg);
    const usageChange = mpgRatio-1;
    const scaledGrowth = usageChange>0
      ? rateGrowth*(1+usageChange*(scalability-1))
      : rateGrowth;

    // Percentage projections (team-context aware)
    const pcts = projectPercentages(p, blended, newMpg, p.hometown&&p.hometown.trim()!=='', transferFactor, spacingEffect, yr);

    // FGA allocation from usage engine
    const allocatedFga = usageShares[p.name]!=null
      ? usageShares[p.name]
      : pm.fga*scaledGrowth*newMpg;

    const fga = r1(allocatedFga);
    const fgm = r1(fga*(pcts.fg_pct/100));
    const tpa = r1(pm.tpa*scaledGrowth*newMpg*countingTransFactor);
    const tpm = r1(tpa*(pcts.tp_pct/100));
    const fta = r1(pm.fta*scaledGrowth*newMpg*countingTransFactor);
    const ftm = r1(fta*(pcts.ft_pct/100));

    // PPG from shooting outcomes
    const ppgFromShots = r1((fgm||0)*2 + (tpm||0) + (ftm||0));
    // Blend with rate-based PPG (some scoring not from tracked shots)
    const ppgRateBased = r1(pm.ppg*scaledGrowth*newMpg*countingTransFactor);
    const ppg = r1((ppgFromShots*0.65 + ppgRateBased*0.35));

    // Rebounds from ecosystem
    const rebAlloc = rebShares[p.name];
    const rpgRate  = r1(pm.rpg*scaledGrowth*newMpg*countingTransFactor);
    const rpg = rebAlloc!=null ? r1(rebAlloc*0.60+rpgRate*0.40) : rpgRate;

    // Assists — playmaking environment aware
    const apg = r1(pm.apg*scaledGrowth*newMpg*playmakingMult*countingTransFactor
                   +(spacingEffect.apg||0));

    return {
      ...p,
      ppg, rpg, apg, mpg:r1(newMpg),
      fgm, fga, fg_pct:pcts.fg_pct,
      tpm, tpa, tp_pct:pcts.tp_pct,
      ftm, fta, ft_pct:pcts.ft_pct,
      oreb:r1(pm.oreb*scaledGrowth*newMpg*countingTransFactor),
      dreb:r1(pm.dreb*scaledGrowth*newMpg*countingTransFactor),
      stl: r1(pm.stl*scaledGrowth*newMpg),
      blk: r1(pm.blk*scaledGrowth*newMpg),
      tovs:r1(pm.tovs*scaledGrowth*newMpg*(spacingEffect.tovMult||1)),
      _frosh:false,
      _archetype:arch,
      _stability:blended._stability||0.7,
      _trend:blended._trend||0,
      _origin:p.hometown?getSchoolConf(p.hometown):null,
      _factor:transferFactor,
      _scalability:scalability,
      _interactionMult:interactionMult,
      _env:env?.paceType,
    };
  }).filter(Boolean);

  // ── Phase 7: Apply team constraints ──
  return applyTeamConstraints(projected, env);
}

// projectPlayerInContext — single player projection using team context
// Used by player.html when you have the full roster available
function projectPlayerInContext(player, allTeamPlayers, teamRow){
  const conf = (teamRow&&(teamRow.conf||teamRow.conference))||'';
  const projected = projectTeam(allTeamPlayers, teamRow);
  const match = projected.find(p=>p.name===player.name);
  if(match) return match;

  // Fallback: project in isolation with minimal context
  const solo = projectTeam([{...player, depth_order:player.depth_order||5}], {conf});
  return solo[0]||null;
}

// Normalize position to 5 canonical slots
function normPosDetailed(pos){
  const p = (pos||'G').replace(/\d/g,'').trim().toUpperCase();
  if(p==='PG') return 'PG';
  if(p==='SG'||p==='CG') return 'SG';
  if(p==='SF') return 'SF';
  if(p==='PF') return 'PF';
  if(p==='C')  return 'C';
  if(p.includes('G')) return 'SG';
  if(p.includes('F')) return 'SF';
  return 'SG';
}

// Public API
return {
  projectTeam,
  projectPlayerInContext,
  buildTeamEnvironment,
  detectArchetype,
  blendCareerStats,
  computeStabilityScore,
};

})(); // end TDC module
