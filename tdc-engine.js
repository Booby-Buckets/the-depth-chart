/**
 * TDC PROJECTION ENGINE
 * Exactly as specified — ecosystem-based roster projections
 */
const TDC = (function(){
'use strict';

// ─────────────────────────────────────────────
// ADVANCED PROJECTION ENGINE V2 CONFIG
// ─────────────────────────────────────────────

const CONF_TIERS = {
  'SEC':1,'B10':1,'BIG-12':1,'ACC':1,'Big-East':1,
  'PAC-12':2,'A10':2,'WCC':2,'AAC':2,
  'MWC':3,
  'MVC':4,'CUSA':4,'MAC':4,'Big West':4,
  'CAA':5,'Big Sky':5,'Sun Belt':5,
  'ASUN':6,'MAAC':6,'OVC':6,
  'NEC':7,'SWAC':7,'MEAC':7
};

const TIER_TRANSLATION = {
  1:{1:1.00,2:1.10,3:1.18,4:1.26,5:1.34,6:1.40,7:1.45},
  2:{1:0.90,2:1.00,3:1.10,4:1.18,5:1.24,6:1.30,7:1.36},
  3:{1:0.78,2:0.90,3:1.00,4:1.08,5:1.14,6:1.20,7:1.26},
  4:{1:0.66,2:0.78,3:0.90,4:1.00,5:1.08,6:1.14,7:1.20},
  5:{1:0.58,2:0.70,3:0.82,4:0.92,5:1.00,6:1.08,7:1.14},
  6:{1:0.50,2:0.62,3:0.74,4:0.84,5:0.92,6:1.00,7:1.08},
  7:{1:0.42,2:0.54,3:0.66,4:0.76,5:0.84,6:0.92,7:1.00}
};

// ─────────────────────────────────────────────
// SCHOOL → CONFERENCE LOOKUP
// (needed for getProjSchoolConf used in projectPlayerAdvanced)
// ─────────────────────────────────────────────
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
  ].forEach(function(pair){ if(pair&&pair[0]&&pair[1]) pair[0].forEach(function(s){ m[s.toLowerCase()]=pair[1]; }); });
  return m;
})();

function getProjSchoolConf(school){
  if(!school) return null;
  const lo=school.toLowerCase().trim();
  if(SCHOOL_CONF[lo]) return SCHOOL_CONF[lo];
  for(const k of Object.keys(SCHOOL_CONF)){
    if(lo.includes(k)||k.includes(lo)) return SCHOOL_CONF[k];
  }
  return null;
}

// ─────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────
function round1(v){ return v!=null ? Math.round(v*10)/10 : null; }

// ─────────────────────────────────────────────
// STEP 2 — BUILD TEAM ECOSYSTEM
// ─────────────────────────────────────────────
function buildTeamEnvironment(roster, conf){

  const rotation = roster
    .filter(p => p.name && p.name !== '—')
    .sort((a,b)=>(a.depth_order||99)-(b.depth_order||99))
    .slice(0,10);

  let spacingScore = 0;
  let creationScore = 0;
  let reboundingScore = 0;
  let defensiveScore = 0;
  let shootingGravity = 0;
  let totalWeight = 0;

  rotation.forEach(p => {

    const mpg = parseFloat(p.mpg)||20;
    const usg = parseFloat(p.usg_pct)||15;
    const tp = parseFloat(p.tp_pct)||30;
    const tpa = parseFloat(p.tpa)||2;
    const apg = parseFloat(p.apg)||1;
    const tov = parseFloat(p.tovs)||1;
    const rpg = parseFloat(p.rpg)||3;
    const stl = parseFloat(p.stl)||0.5;
    const blk = parseFloat(p.blk)||0.3;

    const weight = mpg;

    totalWeight += weight;

    spacingScore += ((tp * tpa) / 100) * weight;

    creationScore += ((apg * 1.6) + (usg * 0.35) - (tov * 0.7)) * weight;

    reboundingScore += rpg * weight;

    defensiveScore += ((stl * 2.0) + (blk * 2.3) + (rpg * 0.5)) * weight;

    shootingGravity += (tp * tpa) * weight;
  });

  spacingScore /= totalWeight;
  creationScore /= totalWeight;
  reboundingScore /= totalWeight;
  defensiveScore /= totalWeight;
  shootingGravity /= totalWeight;

  let pace = 69;

  if(creationScore > 10) pace += 2;
  if(spacingScore > 1.8) pace += 1;
  if(reboundingScore > 5.5) pace -= 1;

  return {
    spacingScore,
    creationScore,
    reboundingScore,
    defensiveScore,
    shootingGravity,
    pace
  };
}

// ─────────────────────────────────────────────
// STEP 3 — PLAYER PORTABILITY ENGINE
// ─────────────────────────────────────────────
function calculatePortabilityScore(player){

  const usg = parseFloat(player.usg_pct)||15;
  const ts = parseFloat(player.ts_pct)||52;
  const apg = parseFloat(player.apg)||1;
  const tov = parseFloat(player.tovs)||1;
  const tp = parseFloat(player.tp_pct)||30;
  const tpa = parseFloat(player.tpa)||2;

  let score = 50;

  score += (tp - 33) * 1.2;
  score += tpa * 2;

  score += (ts - 54) * 1.5;

  score += (apg - tov) * 4;

  if(usg > 27) score -= (usg - 27) * 2.2;

  if(usg > 25 && ts < 56) score -= 10;

  return Math.max(10, Math.min(95, score));
}

// ─────────────────────────────────────────────
// STEP 4 — SCALABILITY ENGINE
// ─────────────────────────────────────────────
function calculateScalability(player){

  const usg = parseFloat(player.usg_pct)||15;
  const ts = parseFloat(player.ts_pct)||52;
  const apg = parseFloat(player.apg)||1;
  const tov = parseFloat(player.tovs)||1;

  let score = 50;

  score += (ts - 54) * 2;
  score += apg * 2;
  score -= tov * 2;

  if(usg > 28 && ts > 58){
    score += 12;
  }

  if(usg > 28 && ts < 54){
    score -= 15;
  }

  return Math.max(10, Math.min(95, score));
}

// ─────────────────────────────────────────────
// STEP 5 — ARCHETYPE DETECTION
// ─────────────────────────────────────────────
function detectArchetype(player){

  const usg = parseFloat(player.usg_pct)||15;
  const apg = parseFloat(player.apg)||1;
  const tp = parseFloat(player.tp_pct)||30;
  const tpa = parseFloat(player.tpa)||2;
  const ts = parseFloat(player.ts_pct)||52;
  const rpg = parseFloat(player.rpg)||3;

  if(usg > 27 && apg > 4){
    return 'Heliocentric Creator';
  }

  if(tp > 37 && tpa > 5){
    return 'Spacer';
  }

  if(rpg > 7 && ts > 58){
    return 'Interior Finisher';
  }

  if(apg > 3 && usg < 22){
    return 'Connector Creator';
  }

  if(ts > 60 && usg < 18){
    return 'Low Usage Efficiency';
  }

  return 'Balanced Wing';
}

// ─────────────────────────────────────────────
// STEP 6 — ADVANCED TRANSFER TRANSLATION
// ─────────────────────────────────────────────
function getAdvancedTransferFactor(originConf, newConf, player){

  const oldTier = CONF_TIERS[originConf] || 5;
  const newTier = CONF_TIERS[newConf] || 5;

  let factor = (TIER_TRANSLATION[oldTier]||{})[newTier]||1.0;

  const portability = calculatePortabilityScore(player);
  const scalability = calculateScalability(player);

  factor *= (0.82 + (portability / 100) * 0.25);

  if(detectArchetype(player) === 'Heliocentric Creator'){
    factor *= 0.88;
  }

  if(scalability > 75){
    factor *= 1.05;
  }

  return Math.max(0.55, Math.min(1.20, factor));
}

// ─────────────────────────────────────────────
// STEP 7 — USAGE REDISTRIBUTION ENGINE
// ─────────────────────────────────────────────
function redistributeUsage(roster){

  const rotation = roster
    .filter(p=>p.name&&p.name!=='—')
    .sort((a,b)=>(a.depth_order||99)-(b.depth_order||99))
    .slice(0,9);

  let totalProjectedUsage = 0;

  rotation.forEach(p=>{

    let usg = parseFloat(p.usg_pct)||15;

    const scalability = calculateScalability(p);
    const portability = calculatePortabilityScore(p);

    usg *= (0.9 + scalability / 200);

    if(portability < 45){
      usg *= 0.88;
    }

    p.projected_usg = usg;

    totalProjectedUsage += usg;
  });

  rotation.forEach(p=>{
    p.projected_usg = (p.projected_usg / totalProjectedUsage) * 100;
  });

  return roster;
}

// ─────────────────────────────────────────────
// STEP 8 — MAIN PLAYER PROJECTION
// ─────────────────────────────────────────────
function projectPlayerAdvanced(player, roster, conf, targetMpg){

  const env = buildTeamEnvironment(roster, conf);

  const portability = calculatePortabilityScore(player);
  const scalability = calculateScalability(player);
  const archetype = detectArchetype(player);

  const oldMpg = parseFloat(player.mpg)||20;
  const newMpg = targetMpg;

  const rateScale = newMpg / oldMpg;

  let ppg = parseFloat(player.ppg)||0;
  let rpg = parseFloat(player.rpg)||0;
  let apg = parseFloat(player.apg)||0;

  ppg *= rateScale;
  rpg *= rateScale;
  apg *= rateScale;

  const portabilityMultiplier = 0.82 + (portability / 100) * 0.22;

  ppg *= portabilityMultiplier;

  const scalabilityMultiplier = 0.85 + (scalability / 100) * 0.25;

  ppg *= scalabilityMultiplier;

  if(env.spacingScore > 2.1){
    ppg *= 1.04;
  }

  if(env.spacingScore < 1.3){
    ppg *= 0.94;
  }

  if(archetype === 'Heliocentric Creator'){

    const usg = parseFloat(player.usg_pct)||20;

    if(usg > 28){
      ppg *= 0.92;
    }
  }

  if(player.hometown){

    const oldConf = getProjSchoolConf(player.hometown);

    if(oldConf){

      const transferFactor = getAdvancedTransferFactor(oldConf, conf, player);

      ppg *= transferFactor;
      apg *= transferFactor;

      rpg *= (0.95 + transferFactor * 0.05);
    }
  }

  let fg = parseFloat(player.fg_pct)||42;
  let tp = parseFloat(player.tp_pct)||33;

  fg += (env.spacingScore - 1.5) * 2;
  tp += (env.spacingScore - 1.5) * 1.2;

  if((parseFloat(player.usg_pct)||20) > 26){
    fg -= 2.5;
    tp -= 1.5;
  }

  return {
    ...player,
    mpg: round1(newMpg),
    ppg: round1(ppg),
    rpg: round1(rpg),
    apg: round1(apg),
    fg_pct: round1(Math.max(35, Math.min(65, fg))),
    tp_pct: round1(Math.max(22, Math.min(48, tp))),
    _portability: portability,
    _scalability: scalability,
    _archetype: archetype,
    _frosh: false,
  };
}

// ─────────────────────────────────────────────
// STEP 9 — TEAM STRENGTH ENGINE
// ─────────────────────────────────────────────
function buildTeamRatings(roster, conf){

  const env = buildTeamEnvironment(roster, conf);

  let ortg = 108;
  let drtg = 104;

  ortg += env.spacingScore * 3;
  ortg += env.creationScore * 0.7;

  drtg -= env.defensiveScore * 0.35;
  drtg -= env.reboundingScore * 0.15;

  return {
    ortg: round1(ortg),
    drtg: round1(drtg),
    net: round1(ortg - drtg),
    pace: round1(env.pace)
  };
}

// ─────────────────────────────────────────────
// STEP 10 — WIN PROBABILITY MODEL
// ─────────────────────────────────────────────
function getWinProbability(teamA, teamB){

  const diff = teamA.net - teamB.net;

  const prob = 1 / (1 + Math.exp(-diff / 6));

  return round1(prob * 100);
}

// ─────────────────────────────────────────────
// MINUTE DISTRIBUTION
// (needed to feed targetMpg into projectPlayerAdvanced)
// ─────────────────────────────────────────────
function computeMinutes(roster){
  const sorted=[...roster]
    .filter(p=>p.name&&p.name!=='—')
    .sort((a,b)=>(a.depth_order||99)-(b.depth_order||99));
  if(!sorted.length) return {};

  const grades=sorted.map(p=>parseFloat(p.tdc_grade)||70);
  const avgGrade=grades.reduce((a,b)=>a+b,0)/grades.length;
  const rosterSize=sorted.length;

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
    mpgMap[p.name]=Math.max(1,Math.min(38,base));
  });

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

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────
function projectTeam(rawPlayers, teamRow){
  const conf=(teamRow&&(teamRow.conf||teamRow.conference))||'';
  const players=rawPlayers
    .filter(p=>p.name&&p.name!=='—')
    .sort((a,b)=>(a.depth_order||99)-(b.depth_order||99));
  if(!players.length) return [];

  redistributeUsage(players);
  const mpgMap=computeMinutes(players);

  const projected=players.map(p=>{
    const newMpg=mpgMap[p.name]||5;
    const hasStats=parseFloat(p.ppg||0)>0;
    const yr=(p.yr||p.class_year||'').toLowerCase();
    const isFr=yr.includes('fr.')||yr.includes('r-fr');

    // Freshman with no stats — use simple baseline
    if(isFr&&!hasStats){
      const grade=parseFloat(p.tdc_grade)||70;
      const scale=newMpg/32;
      const gm=grade>=92?0.85:grade>=85?0.72:grade>=75?0.48:grade>=68?0.32:0.18;
      return {...p,
        ppg:round1(12*gm*scale),rpg:round1(4*gm*scale),apg:round1(2*gm*scale),
        mpg:round1(newMpg),fg_pct:round1(43),tp_pct:round1(34),ft_pct:round1(72),
        stl:round1(0.8*gm*scale),blk:round1(0.3*gm*scale),tovs:round1(1.5*gm*scale),
        _frosh:true,_archetype:detectArchetype(p),
        _portability:calculatePortabilityScore(p),_scalability:calculateScalability(p),
      };
    }

    if(!hasStats) return null;

    return projectPlayerAdvanced(p, players, conf, newMpg);
  }).filter(Boolean);

  return projected;
}

function projectPlayerInContext(player, allTeamPlayers, teamRow){
  const roster=allTeamPlayers.length?allTeamPlayers:[{...player,depth_order:player.depth_order||5}];
  const projected=projectTeam(roster,teamRow);
  return projected.find(p=>p.name===player.name)||null;
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
