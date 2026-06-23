// projection-engine.js — per-player 2026-27 projection engine.
// EXTRACTED verbatim from projections.html (canonical source). Shared so the
// Draft board projects off real projected stat lines, not last-year numbers.
// Depends on window._careerHistoryMap (name->player_history rows) at call time.

const PROJ_CONF_TIERS={'B10':1,'SEC':1,'BIG-12':1,'ACC':1,'Big-East':2,'A10':2,'WCC':2,'PAC-12':2,'MWC':3,'AAC':3,'Ivy':3,'MVC':4,'WAC':4,'CUSA':4,'MAC':4,'Big West':4,'Big Sky':5,'CAA':5,'Horizon':5,'Sun Belt':5,'Big South':5,'SBC':5,'SoCon':6,'ASUN':6,'MAAC':6,'OVC':6,'Summit':6,'Patriot':7,'SWAC':7,'NEC':7,'MEAC':7,'AEC':7};

const PROJ_TRANS_MAT={
  1:{1:1.00,2:1.15,3:1.28,4:1.40,5:1.40,6:1.40,7:1.40},
  2:{1:0.90,2:1.00,3:1.15,4:1.20,5:1.20,6:1.20,7:1.20},
  3:{1:0.75,2:0.90,3:1.00,4:1.05,5:1.10,6:1.10,7:1.10},
  4:{1:0.49,2:0.68,3:0.82,4:1.00,5:1.05,6:1.05,7:1.05},
  5:{1:0.43,2:0.49,3:0.69,4:0.82,5:1.00,6:1.00,7:1.00},
  6:{1:0.40,2:0.42,3:0.50,4:0.69,5:0.82,6:1.00,7:1.00},
  7:{1:0.30,2:0.34,3:0.42,4:0.48,5:0.69,6:0.82,7:1.00},
};

const PROJ_ACC_OUT={1:1.00,2:1.10,3:1.25,4:1.40,5:1.40,6:1.40,7:1.40};

const PROJ_SCHOOL_CONF=(function(){
  const m={};
  const data=[
    // ── TIER 1 ──
    [['Alabama','Arkansas','Auburn','Florida','Georgia','Kentucky','LSU','Mississippi State','Missouri','Ole Miss','South Carolina','Tennessee','Texas','Texas A&M','Vanderbilt','Oklahoma'],'SEC'],
    [['Illinois','Indiana','Iowa','Maryland','Michigan','Michigan State','Minnesota','Nebraska','Northwestern','Ohio State','Penn State','Purdue','Rutgers','Wisconsin','UCLA','USC','Oregon','Washington','UCLA'],'B10'],
    [['Arizona','Arizona State','Baylor','BYU','Cincinnati','Colorado','Houston','Iowa State','Kansas','Kansas State','Oklahoma State','TCU','Texas Tech','UCF','Utah','West Virginia'],'BIG-12'],
    [['Boston College','Clemson','Duke','Florida State','Georgia Tech','Louisville','Miami','NC State','North Carolina','Notre Dame','Pittsburgh','Syracuse','Virginia','Virginia Tech','Wake Forest','California','SMU','Stanford'],'ACC'],
    // ── TIER 2 ──
    [['Butler','Connecticut','Creighton','DePaul','Georgetown','Marquette','Providence','Seton Hall',"St. John's",'Villanova','Xavier'],'Big-East'],
    [['Dayton','Davidson','Duquesne','Fordham','George Mason','George Washington','La Salle','Loyola Chicago','Rhode Island','Richmond',"Saint Joseph's",'Saint Louis','St. Bonaventure','VCU','Massachusetts','Saint Louis','Fordham'],'A10'],
    [['Gonzaga','BYU','Pacific','Pepperdine','Portland','Saint Mary\'s','San Diego','San Francisco','Santa Clara','Loyola Marymount'],'WCC'],
    [['Oregon State','Washington State','San Diego State','Colorado State','Boise State','Utah State','Nevada','New Mexico','Fresno State','Air Force','Wyoming','UNLV','San Jose State','Hawaii'],'PAC-12'],
    // ── TIER 3 ──
    [['Charlotte','East Carolina','Florida Atlantic','Memphis','North Texas','Rice','South Florida','Temple','Tulane','Tulsa','UAB','UTSA','Wichita State'],'AAC'],
    [['Colorado State','San Diego State','Boise State','Utah State','Nevada','New Mexico','Fresno State','Air Force','Wyoming','UNLV','San Jose State','Hawaii'],'MWC'],
    [['Harvard','Yale','Princeton','Columbia','Cornell','Dartmouth','Brown','Pennsylvania'],'Ivy'],
    // ── TIER 4 ──
    [['Bradley','Drake','Evansville','Illinois State','Indiana State','Missouri State','Northern Iowa','Southern Illinois','Valparaiso','Belmont','Murray State'],'MVC'],
    [['Grand Canyon','Seattle U','Utah Valley','New Mexico State','Tarleton State','UT Rio Grande Valley','Cal Baptist','Chicago State','UMKC','UTRGV'],'WAC'],
    [['Florida Atlantic','FIU','UTSA','Middle Tennessee','Old Dominion','Marshall','Western Kentucky','Charlotte','Louisiana Tech','UAB','Rice','North Texas'],'CUSA'],
    [['Akron','Ball State','Bowling Green','Buffalo','Central Michigan','Eastern Michigan','Kent State','Miami (OH)','Northern Illinois','Ohio','Toledo','Western Michigan'],'MAC'],
    [['UC Davis','UC Irvine','UC Riverside','UC Santa Barbara','UC San Diego','Cal Poly','Long Beach State','Pacific','Cal State Fullerton','Cal State Northridge','Hawaii'],'Big West'],
    // ── TIER 5 ──
    [['Montana','Montana State','Weber State','Idaho','Idaho State','Eastern Washington','Northern Arizona','Northern Colorado','Southern Utah','Portland State','Sacramento State','North Dakota','South Dakota','North Dakota State','South Dakota State'],'Big Sky'],
    [['Hofstra','Charleston','Delaware','Elon','James Madison','Northeastern','Towson','UNC Wilmington','William & Mary','Drexel','Campbell','Stony Brook'],'CAA'],
    [['Detroit Mercy','Green Bay','Horizon','IUPUI','IU Indianapolis','Milwaukee','Northern Kentucky','Oakland','Purdue Fort Wayne','Robert Morris','Wright State','Youngstown State','Cleveland State'],'Horizon'],
    [['Appalachian State','Arkansas State','Coastal Carolina','Georgia Southern','Georgia State','Louisiana','Louisiana Monroe','Old Dominion','South Alabama','Southern Miss','Texas State','Troy'],'Sun Belt'],
    [['Winthrop','Campbell','Charleston Southern','Gardner-Webb','High Point','Longwood','Presbyterian','Radford','UNC Asheville','USC Upstate'],'Big South'],
    [['Arkansas State','Louisiana','Louisiana Monroe','South Alabama','Georgia State','Georgia Southern','Appalachian State','Coastal Carolina','Texas State','Troy'],'SBC'],
    // ── TIER 6 ──
    [['Samford','Furman','Chattanooga','ETSU','Mercer','VMI','Western Carolina','Wofford','The Citadel'],'SoCon'],
    [['Liberty','Belmont','Lipscomb','FGCU','North Alabama','Jacksonville','Stetson','Austin Peay','Eastern Kentucky','Morehead State','Murray State','Kennesaw State'],'ASUN'],
    [['Iona','Manhattan','Marist','Niagara','Quinnipiac','Rider',"Saint Peter's",'Siena','Canisius','Fairfield','Mount St. Mary\'s'],'MAAC'],
    [['UT Martin','Tennessee State','Tennessee Tech','Eastern Illinois','Lindenwood','SE Missouri State','SIU Edwardsville','Jacksonville State','Central Arkansas','Bellarmine'],'OVC'],
    [['Oral Roberts','North Dakota State','South Dakota State','Western Illinois','Denver','Omaha','Kansas City','St. Thomas'],'Summit'],
    // ── TIER 7 ──
    [['Colgate','Bucknell','Lafayette','Lehigh','Army','Navy','Holy Cross','American','Loyola Maryland','Boston University','Fordham'],'Patriot'],
    [['Grambling','Jackson State','Alabama A&M','Alabama State','Alcorn State','Arkansas Pine Bluff','Bethune-Cookman','Coppin State','Delaware State','Florida A&M','Howard','Maryland Eastern Shore','Mississippi Valley State','Morgan State','Norfolk State','North Carolina A&T','North Carolina Central','Prairie View','Savannah State','South Carolina State','Southern','Texas Southern'],'SWAC'],
    [['Bryant','Central Connecticut','LIU','Merrimack','Sacred Heart','Fairleigh Dickinson','Mount St. Mary\'s','CCSU','Long Island','Saint Francis','Wagner','FDU'],'NEC'],
    [['Maine','New Hampshire','UMass Lowell','Albany','Binghamton','Hartford','UMBC','Vermont','Stony Brook','New Jersey Tech'],'AEC'],
    [['Kennesaw State','USC Upstate','North Florida','Northern Kentucky','Queens','Eastern Kentucky','Lindenwood','SIU Edwardsville','Little Rock'],'MEAC'],
  ];
  data.forEach(([schools,conf])=>schools.forEach(s=>{ m[s.toLowerCase()]=conf; }));
  return m;
})();

const FR_BASE = {
  '92+':{
    PG:{ppg:17.5,rpg:3.5,apg:4.5,fg_pct:45.5,tp_pct:37.5,ft_pct:80.5,stl:1.3,blk:0.3,oreb:0.6,dreb:2.9,tovs:2.25},
    SG:{ppg:16.0,rpg:4.0,apg:2.25,fg_pct:43.5,tp_pct:38.5,ft_pct:74.5,stl:1.1,blk:0.4,oreb:0.8,dreb:3.2,tovs:1.5},
    SF:{ppg:18.5,rpg:5.0,apg:1.75,fg_pct:46.5,tp_pct:36.0,ft_pct:76.0,stl:1.0,blk:0.6,oreb:1.3,dreb:3.7,tovs:1.8},
    PF:{ppg:16.0,rpg:6.5,apg:1.8,fg_pct:50.0,tp_pct:31.0,ft_pct:74.0,stl:0.7,blk:1.2,oreb:2.2,dreb:4.3,tovs:1.75},
    C: {ppg:14.0,rpg:9.0,apg:1.05,fg_pct:56.0,tp_pct:22.0,ft_pct:70.5,stl:0.5,blk:1.9,oreb:2.7,dreb:6.3,tovs:1.75},
  },
  '85-91':{
    PG:{ppg:13.0,rpg:2.0,apg:3.1,fg_pct:44.5,tp_pct:34.0,ft_pct:80.5,stl:1.1,blk:0.2,oreb:0.4,dreb:1.6,tovs:2.35},
    SG:{ppg:12.75,rpg:2.6,apg:1.65,fg_pct:42.25,tp_pct:35.5,ft_pct:74.5,stl:0.9,blk:0.3,oreb:0.6,dreb:2.0,tovs:1.65},
    SF:{ppg:13.5,rpg:3.5,apg:1.15,fg_pct:44.5,tp_pct:34.5,ft_pct:76.0,stl:0.8,blk:0.5,oreb:1.0,dreb:2.5,tovs:1.8},
    PF:{ppg:12.5,rpg:5.25,apg:1.15,fg_pct:47.5,tp_pct:29.5,ft_pct:74.0,stl:0.5,blk:0.9,oreb:1.7,dreb:3.5,tovs:1.75},
    C: {ppg:11.0,rpg:6.75,apg:0.7,fg_pct:52.0,tp_pct:19.5,ft_pct:70.5,stl:0.4,blk:1.5,oreb:2.1,dreb:4.6,tovs:1.75},
  },
  '75-84':{
    PG:{ppg:7.5,rpg:1.5,apg:2.05,fg_pct:43.5,tp_pct:34.0,ft_pct:80.5,stl:0.9,blk:0.2,oreb:0.3,dreb:1.2,tovs:1.75},
    SG:{ppg:7.5,rpg:2.2,apg:1.25,fg_pct:42.0,tp_pct:35.5,ft_pct:74.5,stl:0.7,blk:0.2,oreb:0.5,dreb:1.7,tovs:1.25},
    SF:{ppg:7.6,rpg:2.65,apg:0.9,fg_pct:43.5,tp_pct:34.5,ft_pct:76.0,stl:0.6,blk:0.4,oreb:0.8,dreb:1.85,tovs:1.25},
    PF:{ppg:6.65,rpg:3.25,apg:0.75,fg_pct:47.0,tp_pct:29.5,ft_pct:74.0,stl:0.4,blk:0.7,oreb:1.3,dreb:2.35,tovs:1.35},
    C: {ppg:6.6,rpg:4.75,apg:0.55,fg_pct:51.0,tp_pct:19.5,ft_pct:70.5,stl:0.3,blk:1.1,oreb:1.6,dreb:3.1,tovs:1.3},
  },
  'below75':{
    PG:{ppg:4.0,rpg:1.0,apg:1.3,fg_pct:42.0,tp_pct:32.0,ft_pct:78.0,stl:0.6,blk:0.1,oreb:0.2,dreb:0.8,tovs:1.4},
    SG:{ppg:4.0,rpg:1.2,apg:0.8,fg_pct:40.0,tp_pct:33.0,ft_pct:72.0,stl:0.5,blk:0.1,oreb:0.3,dreb:1.0,tovs:1.0},
    SF:{ppg:4.5,rpg:1.8,apg:0.6,fg_pct:41.0,tp_pct:32.0,ft_pct:72.0,stl:0.4,blk:0.2,oreb:0.5,dreb:1.3,tovs:1.0},
    PF:{ppg:3.5,rpg:2.5,apg:0.5,fg_pct:44.0,tp_pct:26.0,ft_pct:68.0,stl:0.3,blk:0.5,oreb:0.9,dreb:1.6,tovs:1.0},
    C: {ppg:3.5,rpg:3.0,apg:0.4,fg_pct:48.0,tp_pct:15.0,ft_pct:64.0,stl:0.2,blk:0.7,oreb:1.0,dreb:2.0,tovs:1.0},
  },
};

function computePlayerMpg(p, teamRoster){
  const roster=(Array.isArray(teamRoster)?teamRoster:[]).filter(r=>r.name&&r.name!=='—')
    .sort((a,b)=>(a.depth_order||99)-(b.depth_order||99));
  if(!roster.length){const d=p.depth_order||8;return d<=1?32:d<=2?30:d<=3?27:d<=4?25:d<=5?23:d===6?20:d===7?17:d===8?14:d===9?11:d===10?8:5;}
  const grades=roster.map(r=>parseFloat(r.tdc_grade)||70);
  const teamGradeAvg=grades.reduce((a,b)=>a+b,0)/grades.length;
  const rosterSize=roster.length;
  let rotDepth=rosterSize;
  for(let i=2;i<roster.length-1;i++){
    const g1=parseFloat(roster[i-1].tdc_grade)||70,g2=parseFloat(roster[i].tdc_grade)||70;
    if((g1-g2)>=9&&g2<=68){rotDepth=i;break;}
    if(g2<63&&i>=6){rotDepth=i;break;}
  }
  rotDepth=Math.max(7,Math.min(12,rotDepth));
  const mpgMap={};
  roster.forEach((r,i)=>{
    const g=parseFloat(r.tdc_grade)||70,slot=i+1;
    let base;
    if(slot<=5){const gn=Math.max(-1,Math.min(1,(g-teamGradeAvg)/15));base=30.5+gn*3.5;}
    else if(slot===6)base=18;else if(slot===7)base=13;else if(slot===8)base=10;
    else if(slot===9)base=8;else if(slot===10)base=5;else base=Math.max(2,4-(slot-10)*1);
    base=base*(1+((g-teamGradeAvg)/20)*0.10);
    if(slot<=5&&rosterSize<=8)base=Math.min(38,base+2);
    if(slot>rotDepth)base=Math.min(5,base);

    // Returners: blend grade formula with actual-MPG evidence of coach trust.
    // The coach played them X minutes at this school — that's real signal.
    // Transfers get pure formula — old school usage means nothing here.
    const rActualMpg=parseFloat(r.mpg||0)||0;
    const rYr=(r.yr||r.class_year||'').toLowerCase();
    const rIsFr=rYr.includes('fr.')||rYr.includes('r-fr');
    const rIsTransfer=!!(r.hometown&&r.hometown.trim());
    if(!rIsTransfer&&!rIsFr&&rActualMpg>=20&&slot<=7){
      // 65% actual MPG, 35% grade formula — heavy weight on proven usage
      base=base*0.35+rActualMpg*0.65;
    }

    mpgMap[r.name]=Math.max(1,Math.min(38,base));
  });
  const posCounts={};
  roster.forEach(r=>{const pos=(r.position||'G').replace(/\d/g,'').trim();const pk=['PG','SG','SF','PF','C'].includes(pos)?pos:pos==='CG'?'SG':pos.includes('G')?'SG':'C';posCounts[pk]=(posCounts[pk]||0)+1;r._pk2=pk;});
  for(let i=0;i<Math.min(roster.length-1,9);i++){
    const r1=roster[i],r2=roster[i+1];
    if(r1._pk2!==r2._pk2)continue;
    const g1=parseFloat(r1.tdc_grade)||70,g2=parseFloat(r2.tdc_grade)||70,diff=g1-g2;
    if(diff<=3){const c=mpgMap[r1.name]+mpgMap[r2.name];mpgMap[r1.name]=c*0.53;mpgMap[r2.name]=c*0.47;}
    else if(diff<=6){const c=mpgMap[r1.name]+mpgMap[r2.name];mpgMap[r1.name]=c*0.65;mpgMap[r2.name]=c*0.35;}
  }
  // Monotonic enforcement — only apply within bench depth (slots 7+).
  // Starters and first bench wave play different POSITIONS, so cross-position
  // comparison is wrong: PF1 at grade 92 should NOT be capped by SF1 at grade 85
  // just because SF comes before PF in the depth order listing.
  // Deep bench players still enforce: bench #3 shouldn't exceed bench #2.
  for(let i=1;i<roster.length;i++){
    if(i <= 6) continue; // slots 1-7: each gets independent grade-based minutes
    const prev=roster[i-1], cur=roster[i];
    const gPrev=parseFloat(prev.tdc_grade)||70, gCur=parseFloat(cur.tdc_grade)||70;
    if(gCur - gPrev >= 6) continue;
    if(mpgMap[cur.name] > mpgMap[prev.name]) mpgMap[cur.name]=mpgMap[prev.name]*0.95;
  }
  // Dynamic minute cap — responsive to roster continuity and coach system.
  // Returners know the system: coach plays them predictable, proven minutes.
  // New rosters (transfers/freshmen) = tighter rotation while building chemistry.
  const totalMpg = roster.reduce((s,r)=>s+(mpgMap[r.name]||0),0);

  // Fraction of projected minutes held by non-freshman returners
  const returneeMin = roster.filter(r=>{
    const yr=(r.yr||r.class_year||'').toLowerCase();
    const isFr=yr.includes('fr.')||yr.includes('r-fr');
    return !isFr && !(r.hometown && r.hometown.trim());
  }).reduce((s,r)=>s+(mpgMap[r.name]||0),0);
  const returneeFrac = totalMpg > 0 ? returneeMin/totalMpg : 0;

  // Mostly returnees → coach knows his rotation → realistic ~218 total (e.g. Florida 213)
  // All new players → figuring out who plays → tighter ~208 total
  const dynamicCap = Math.round(208 + returneeFrac * 17); // 208 (all new) → 225 (all returners)

  if(totalMpg > dynamicCap){
    const sc = dynamicCap/totalMpg;
    roster.forEach(r=>{mpgMap[r.name]=(mpgMap[r.name]||0)*sc;});
  }
  roster.forEach(r=>{mpgMap[r.name]=Math.min(38,mpgMap[r.name]||0);});

  // Post-normalization: returning contributors can't lose more than 12% of their proven minutes.
  // Normalization compresses everyone proportionally — this restores fairness for starters
  // who proved their usage under this coach last year. Transfers excluded.
  roster.forEach((r,i)=>{
    const slot=i+1; if(slot>6) return;
    const rAMpg=parseFloat(r.mpg||0)||0; if(rAMpg<25) return;
    const rYr=(r.yr||r.class_year||'').toLowerCase();
    if(rYr.includes('fr.')||rYr.includes('r-fr')) return;
    if(r.hometown&&r.hometown.trim()) return;
    const gradeFloor=parseFloat(r.tdc_grade)||70;
    const floorPct=gradeFloor>=90?0.95:gradeFloor>=83?0.91:0.88;
    const floor=rAMpg*floorPct;
    if((mpgMap[r.name]||0)<floor) mpgMap[r.name]=floor;
  });
  const result=mpgMap[p.name];
  if(result!=null)return Math.max(1,Math.min(38,result));
  const d=p.depth_order||8;return d<=1?32:d<=2?30:d<=3?27:d<=4?25:d<=5?23:d===6?20:d===7?17:d===8?14:d===9?11:d===10?8:5;
}

function projectPlayer(p, teamConf, teamRoster, targetMpg){
  const conf  = (teamConf||'').trim();
  const yr    = (p.yr||p.class_year||'').toLowerCase();
  const isFr  = yr.includes('fr.')||yr.includes('r-fr');
  const isSo  = yr.includes('so.')||yr.includes('r-so.');
  const isJr  = yr.includes('jr.')||yr.includes('r-jr.');
  const isSr  = yr.includes('sr.')||yr.includes('r-sr')||yr.includes('gr.');
  const pos   = (p.position||'G').replace(/\d/g,'').trim();
  const posNorm = ['PG','SG','SF','PF','C'].includes(pos)?pos:pos==='CG'?'SG':'G';
  const grade = parseFloat(p.tdc_grade)||70;
  const s     = k => parseFloat(p[k])||0;
  const hasStats = p.ppg && parseFloat(p.ppg)>0;

  // ── CAREER HISTORY ────────────────────────────────────────
  // window._careerHistoryMap is populated by player pages; on team pages
  // it may not exist — fall back gracefully.
  const history = (window._careerHistoryMap && window._careerHistoryMap[
    (p.name||'').toLowerCase().trim()
  ]) || null;

  // Pull all played seasons (sat_out=false, has real ppg)
  const playedSeasons = history
    ? history.filter(h => !h.sat_out && parseFloat(h.ppg||0)>0)
             .sort((a,b) => b.season_year - a.season_year)   // newest first
    : [];

  // Most recent season with stats — use as primary base
  const latestSeason = playedSeasons[0] || null;

  // ── TRANSFER FACTOR ───────────────────────────────────────
  let transferFactor = 1.0, originConf = null;
  const isTransfer   = p.hometown && p.hometown.trim() !== '';

  if(isTransfer){
    originConf = getProjSchoolConf(p.hometown)||getSchoolConfFallback(p.hometown);
    if(originConf) transferFactor = getProjTransFactor(originConf, conf, grade);
  }

  // ── MPG ───────────────────────────────────────────────────
  let newMpg;
  if(targetMpg != null){
    newMpg = Math.max(0, Math.min(40, targetMpg));
  } else {
    newMpg = computePlayerMpg(p, teamRoster);
  }

  // ─────────────────────────────────────────────────────────
  // CASE 1: No prior college stats → grade-based estimate
  // ─────────────────────────────────────────────────────────
  if(!hasStats && !latestSeason){
    const tier = grade>=92?'92+':grade>=85?'85-91':grade>=75?'75-84':'below75';
    const bases = FR_BASE;
    const frBase = (bases[tier]&&bases[tier][posNorm])?bases[tier][posNorm]
                 : (bases[tier]&&bases[tier]['SG'])?bases[tier]['SG']
                 : bases['75-84']['SG'];
    const BASE_MPG = 32, scale = newMpg/BASE_MPG;
    const fga = r1t(newMpg*0.28);
    return {
      ppg:r1t(frBase.ppg*scale), rpg:r1t(frBase.rpg*scale), apg:r1t(frBase.apg*scale),
      mpg:r1t(newMpg),
      fgm:r1t(fga*(frBase.fg_pct/100)), fga:r1t(fga), fg_pct:r1t(frBase.fg_pct),
      tpm:r1t(fga*0.42*(frBase.tp_pct/100)), tpa:r1t(fga*0.42), tp_pct:r1t(frBase.tp_pct),
      fta:r1t(newMpg*0.09), ftm:r1t(newMpg*0.09*(frBase.ft_pct/100)), ft_pct:r1t(frBase.ft_pct),
      oreb:r1t((frBase.oreb||frBase.rpg*0.28)*scale),
      dreb:r1t((frBase.dreb||frBase.rpg*0.72)*scale),
      stl:r1t(frBase.stl*scale), blk:r1t((frBase.blk||0)*scale), tovs:r1t(frBase.tovs*scale),
      _frosh:true, _origin:originConf, _factor:transferFactor,
    };
  }

  // ─────────────────────────────────────────────────────────
  // CASE 2: Has career history — use it for richer projection
  // ─────────────────────────────────────────────────────────
  // Resolve the base season: prefer latest from history, fall back to players table
  const base = latestSeason || p;
  const baseMpg = Math.max(1, parseFloat(base.mpg||0)||Math.max(1,s('mpg')));

  // Per-minute rates from base season
  const pm = {
    ppg:  parseFloat(base.ppg ||0)/baseMpg,
    rpg:  parseFloat(base.rpg ||0)/baseMpg,
    apg:  parseFloat(base.apg ||0)/baseMpg,
    fgm:  parseFloat(base.fgm ||0)/baseMpg,
    fga:  parseFloat(base.fga ||0)/baseMpg,
    tpm:  parseFloat(base.tpm ||0)/baseMpg,
    tpa:  parseFloat(base.tpa ||0)/baseMpg,
    ftm:  parseFloat(base.ftm ||0)/baseMpg,
    fta:  parseFloat(base.fta ||0)/baseMpg,
    oreb: parseFloat(base.oreb||0)/baseMpg,
    dreb: parseFloat(base.dreb||0)/baseMpg,
    stl:  parseFloat(base.stl ||0)/baseMpg,
    blk:  parseFloat(base.blk ||0)/baseMpg,
    tovs: parseFloat(base.tovs||0)/baseMpg,
  };

  // ── CAREER TREND (multi-year) ─────────────────────────────
  // If we have 2+ played seasons, calculate the scoring trajectory
  // and use it to modulate the projection
  let trendMult = 1.0;
  if(playedSeasons.length >= 2){
    const newest = playedSeasons[0], prev = playedSeasons[1];
    const newPm  = parseFloat(newest.ppg||0)/Math.max(1,parseFloat(newest.mpg||1));
    const prevPm = parseFloat(prev.ppg  ||0)/Math.max(1,parseFloat(prev.mpg  ||1));
    if(prevPm > 0){
      const rawTrend = newPm/prevPm;   // 1.2 = growing 20%, 0.8 = declining
      // Dampen extremes — don't let a one-season fluke drive the projection
      // +20% real trend → ~+7% projection boost; -20% → ~-7% pull
      trendMult = 1.0 + Math.max(-0.12, Math.min(0.12, (rawTrend-1)*0.35));
    }
  }

  // ── YEAR PROGRESSION ─────────────────────────────────────
  // Reflects typical year-to-year improvement curves in college basketball
  const yrMult = isSo?1.06 : isJr?1.03 : isSr?1.01 : 1.04;

  // ── GRADE vs STATS GAP ────────────────────────────────────
  // If a player's grade >> what their stats show, project partial convergence
  const gradeExpPpg = grade>=90?19 : grade>=85?16 : grade>=80?13 : grade>=75?10 : grade>=70?8 : 6;
  const statsPer32  = pm.ppg*32;
  const gapRatio    = gradeExpPpg>0 ? statsPer32/gradeExpPpg : 1;
  const gapMult     = gapRatio<0.50?1.18 : gapRatio<0.65?1.12 : gapRatio<0.80?1.06
                    : gapRatio<0.95?1.02 : gapRatio>1.40?0.97 : gapRatio>1.20?0.99 : 1.0;

  // Combined rate growth
  const rateGrowth = yrMult * gapMult * trendMult;

  // ── EFFICIENCY PROJECTION ─────────────────────────────────
  // Base percentages from the most recent played season
  const fgBase = parseFloat(base.fg_pct||0)||s('fg_pct');
  const tpBase = parseFloat(base.tp_pct||0)||s('tp_pct');
  const ftBase = parseFloat(base.ft_pct||0)||s('ft_pct');

  // Career FT% average (more stable than single season — less variance)
  const careerFtPct = playedSeasons.length >= 2
    ? playedSeasons.reduce((sum,h)=>sum+parseFloat(h.ft_pct||0),0)/playedSeasons.length
    : ftBase;
  const ftSmoothed = ftBase*0.6 + careerFtPct*0.4;  // blend: recent 60%, career avg 40%

  // Volume change penalty (more shots = slight efficiency drop)
  const oldFga    = parseFloat(base.fga||0)||s('fga');
  const newFgaEst = oldFga>0 ? oldFga*(newMpg/baseMpg) : newMpg*0.28;
  const volChange = oldFga>0 ? (newFgaEst/oldFga - 1) : 0;
  const volPenalty = volChange*3.5;

  // Year efficiency boost
  const yearEffBoost = isSo?1.2 : isJr?0.6 : isSr?0.0 : 1.8;

  // Transfer difficulty adjustment (only to efficiency, not per-min rates)
  const transPctAdj = transferFactor<0.75?-3.5 : transferFactor<0.85?-2.5
                    : transferFactor<0.92?-1.5 : transferFactor<0.97?-0.8
                    : transferFactor>1.20?+1.2 : transferFactor>1.10?+0.8
                    : transferFactor>1.04?+0.4 : 0;

  const fgProj = r1t(Math.max(30, Math.min(65, fgBase+yearEffBoost-volPenalty+transPctAdj)));
  const tpProj = r1t(Math.max(18, Math.min(50, tpBase+(isSo?0.8:isJr?0.4:isSr?0:1.5)-(volChange*2.0)+transPctAdj*0.6)));
  const ftProj = r1t(Math.max(45, Math.min(97, ftSmoothed+(isSo?1.0:isJr?0.5:isSr?0:1.5))));

  // ── COUNTING STATS ────────────────────────────────────────
  const newFga = r1t(pm.fga*rateGrowth*newMpg);
  return {
    ppg:  r1t(pm.ppg *rateGrowth*newMpg),
    rpg:  r1t(pm.rpg *rateGrowth*newMpg),
    apg:  r1t(pm.apg *rateGrowth*newMpg),
    mpg:  r1t(newMpg),
    fgm:  r1t(newFga*(fgProj/100)), fga: newFga, fg_pct: fgProj,
    tpm:  r1t(pm.tpa*rateGrowth*newMpg*(tpProj/100)),
    tpa:  r1t(pm.tpa*rateGrowth*newMpg), tp_pct: tpProj,
    ftm:  r1t(pm.fta*rateGrowth*newMpg*(ftProj/100)),
    fta:  r1t(pm.fta*rateGrowth*newMpg), ft_pct: ftProj,
    oreb: r1t(pm.oreb*rateGrowth*newMpg),
    dreb: r1t(pm.dreb*rateGrowth*newMpg),
    stl:  r1t(pm.stl *rateGrowth*newMpg),
    blk:  r1t(pm.blk *rateGrowth*newMpg),
    tovs: r1t(pm.tovs*rateGrowth*newMpg),
    _frosh:false, _origin:originConf, _factor:transferFactor,
    _seasons:playedSeasons.length, _trend:trendMult,
  };
}

function r1t(v){ return v!=null ? Math.round((v+Number.EPSILON)*10)/10 : null; }

function blendStats(actual, projected, pct){
  // pct=0 → pure actual, pct=100 → pure projected
  if(!projected) return actual;
  const t=pct/100;
  const result={...actual};
  const keys=['ppg','rpg','apg','mpg','fgm','fga','fg_pct','tpm','tpa','tp_pct','ftm','fta','ft_pct','oreb','dreb','stl','blk','tovs'];
  keys.forEach(k=>{
    const a=parseFloat(actual[k])||0;
    const b=parseFloat(projected[k])||0;
    if(b>0) result[k]=r1t(a*(1-t)+b*t);
  });
  return result;
}

const PROJ_CONF_MULT={'SEC':1.00,'B10':1.00,'BIG-12':1.00,'ACC':1.00,'Big-East':0.95,'A10':0.90,'MWC':0.88,'WCC':0.87,'PAC-12':0.92,'AAC':0.85,'Ivy':0.82,'MAC':0.80,'CUSA':0.78,'WAC':0.78,'Big West':0.77,'MVC':0.78,'SBC':0.72,'CAA':0.74,'Horizon':0.74,'Sun Belt':0.74,'Big South':0.72,'SoCon':0.72,'ASUN':0.72,'MAAC':0.72,'OVC':0.72,'Summit':0.70,'Patriot':0.66,'Big Sky':0.68,'SWAC':0.60,'NEC':0.60,'MEAC':0.58,'AEC':0.56};

function getSchoolConfFallback(school){ return getProjSchoolConf(school); }

function getProjSchoolConf(school){
  if(!school) return null;
  const lo=school.toLowerCase().trim();
  if(PROJ_SCHOOL_CONF[lo]) return PROJ_SCHOOL_CONF[lo];
  // Fuzzy match
  for(const k of Object.keys(PROJ_SCHOOL_CONF)){
    if(lo.includes(k)||k.includes(lo)) return PROJ_SCHOOL_CONF[k];
  }
  return null;
}

function getProjTransFactor(originConf, destConf, grade){
  if(!originConf||!destConf||originConf===destConf) return 1.0;
  const ot=PROJ_CONF_TIERS[originConf]||4, dt=PROJ_CONF_TIERS[destConf]||4;
  if(ot===dt) return 1.0;
  // ACC special case going down conferences
  const base=originConf==='ACC'?PROJ_ACC_OUT[dt]||1.0:(PROJ_TRANS_MAT[ot]||{})[dt]||1.0;
  const g=parseFloat(grade)||70;
  // Grade boost: elite players translate better going up in conference
  // Grade penalty: lower-grade players struggle MORE going up
  const boost=g>=90?1.22:g>=85?1.14:g>=80?1.07:g>=75?1.02:g>=70?0.97:g>=65?0.91:0.85;
  return Math.max(0.20,Math.min(1.6,base*boost));
}

const PROJ_POS_BASE = {'PG':{ppg:10.5,rpg:3.2,apg:4.1,mpg:26,fg_pct:42,tp_pct:36,ft_pct:75,stl:1.2,blk:0.2,fgm:3.4,fga:8.2,tpm:1.8,tpa:5.0,ftm:1.8,fta:2.4,oreb:0.5,dreb:2.7,tovs:2.1},'SG':{ppg:11.2,rpg:3.8,apg:2.2,mpg:26,fg_pct:42,tp_pct:37,ft_pct:76,stl:1.0,blk:0.3,fgm:3.8,fga:9.0,tpm:1.9,tpa:5.2,ftm:1.6,fta:2.1,oreb:0.7,dreb:3.1,tovs:1.8},'CG':{ppg:10.8,rpg:3.5,apg:3.0,mpg:26,fg_pct:42,tp_pct:36,ft_pct:75,stl:1.1,blk:0.2,fgm:3.6,fga:8.6,tpm:1.8,tpa:5.0,ftm:1.6,fta:2.2,oreb:0.6,dreb:2.9,tovs:1.9},'SF':{ppg:10.8,rpg:5.2,apg:1.8,mpg:26,fg_pct:43,tp_pct:37,ft_pct:72,stl:0.9,blk:0.5,fgm:3.6,fga:8.4,tpm:1.4,tpa:3.8,ftm:1.8,fta:2.5,oreb:1.4,dreb:3.8,tovs:1.8},'PF':{ppg:10.2,rpg:6.8,apg:1.2,mpg:24,fg_pct:45,tp_pct:33,ft_pct:69,stl:0.6,blk:1.1,fgm:3.5,fga:7.8,tpm:0.6,tpa:1.8,ftm:2.0,fta:2.9,oreb:2.4,dreb:4.4,tovs:1.7},'C':{ppg:9.8,rpg:7.4,apg:0.9,mpg:22,fg_pct:49,tp_pct:30,ft_pct:66,stl:0.4,blk:1.6,fgm:3.5,fga:7.2,tpm:0.2,tpa:0.5,ftm:2.1,fta:3.2,oreb:2.8,dreb:4.6,tovs:1.8},'G':{ppg:10.0,rpg:3.5,apg:3.0,mpg:25,fg_pct:42,tp_pct:35,ft_pct:74,stl:1.1,blk:0.2,fgm:3.5,fga:8.4,tpm:1.7,tpa:4.8,ftm:1.7,fta:2.3,oreb:0.6,dreb:2.8,tovs:2.0},'F':{ppg:10.5,rpg:6.0,apg:1.5,mpg:25,fg_pct:44,tp_pct:35,ft_pct:70,stl:0.7,blk:0.8,fgm:3.6,fga:8.1,tpm:1.0,tpa:2.8,ftm:1.9,fta:2.7,oreb:1.9,dreb:4.1,tovs:1.7}};

function getTargetMpg(posSlot, globalSlot, rosterSize, teamGradeAvg, slotGrade, gradeDiff){
  // Position slot 1 = starter at that position, 2 = first backup, etc.
  // Global slot is the overall roster depth rank

  // Starters: 27-34 MPG range
  // First backup: 15-22 MPG
  // Second backup: 8-14 MPG
  // Deep bench: 3-8 MPG

  // Base from position slot
  let base;
  if(posSlot===1){
    // Starters — scale 27-34 by grade relative to team avg
    const gradeNorm=Math.max(-1,Math.min(1,(slotGrade-teamGradeAvg)/15));
    base=30.5+gradeNorm*3.5; // 27-34 range
  } else if(posSlot===2){
    // First backup: 13-22 MPG
    const gradeNorm=Math.max(-1,Math.min(1,(slotGrade-teamGradeAvg)/15));
    base=17.5+gradeNorm*4.5; // 13-22
    // If close to starter in grade, gets more time
    if(gradeDiff<=4) base=Math.min(base+4,22);
    else if(gradeDiff<=8) base=Math.min(base+2,22);
  } else if(posSlot===3){
    base=10+Math.max(0,(slotGrade-65)/5);
    base=Math.max(6,Math.min(14,base));
  } else {
    base=Math.max(2,8-(posSlot-3)*2);
  }

  // Rotation depth: teams with thin rosters play starters more
  // rosterSize ≤8 = short bench, starters need more minutes
  if(posSlot===1){
    if(rosterSize<=7) base=Math.min(38,base+2.5);
    else if(rosterSize<=8) base=Math.min(38,base+1.5);
    else if(rosterSize>=11) base=Math.max(26,base-1.5);
    else if(rosterSize>=13) base=Math.max(24,base-3);
  }

  return Math.max(1,Math.min(38,base));
}

function inferRotationDepth(sorted){
  const n=sorted.length;
  if(n<=7) return n;
  // Find the first significant grade cliff
  let cutoff=n;
  for(let i=2;i<n-1;i++){
    const g1=parseFloat(sorted[i-1].tdc_grade)||70;
    const g2=parseFloat(sorted[i].tdc_grade)||70;
    const g3=parseFloat(sorted[i+1].tdc_grade)||70;
    // Hard cliff: >8 pt drop AND next player is also lower
    if((g1-g2)>=9&&g2<=68){cutoff=i;break;}
    // Soft cliff: grade drops below 63 — end of useful rotation
    if(g2<63&&i>=6){cutoff=i;break;}
  }
  return Math.max(7,Math.min(12,cutoff));
}

function getDeployedPos(p, roster) {
  const pos1 = (p.position  || 'G').replace(/\d/g,'').trim();
  const pos2 = (p.position2 || '').replace(/\d/g,'').trim();
  if (!pos2 || !['PG','SG','SF','PF','C'].includes(pos2)) return pos1;

  const dOrder = p.depth_order || 99;

  // How many players share pos1 AND rank higher in depth order?
  const pos1Ahead = roster.filter(r =>
    r.name && r.name !== '—' && r.name !== p.name &&
    (r.position||'G').replace(/\d/g,'').trim() === pos1 &&
    (r.depth_order||99) < dOrder
  ).length;

  // How many players have pos2 as their PRIMARY and rank higher?
  const pos2Ahead = roster.filter(r =>
    r.name && r.name !== '—' && r.name !== p.name &&
    (r.position||'G').replace(/\d/g,'').trim() === pos2 &&
    (r.depth_order||99) < dOrder
  ).length;

  // Deployed at secondary if primary slot is occupied AND secondary is open ahead of them
  return (pos1Ahead >= 1 && pos2Ahead === 0) ? pos2 : pos1;
}

function buildTeamProjections(players, conf){
  const roster = players
    .filter(p => p.name && p.name !== '—')
    .sort((a,b) => (a.depth_order||99)-(b.depth_order||99));

  // Injured players: zero stats, excluded from minute distribution
  const injuredDnp = roster
    .filter(p => p.is_injured)
    .map(p => ({...p, ppg:0, rpg:0, apg:0, mpg:0, fgm:0, fga:0, tpm:0, tpa:0,
      ftm:0, fta:0, oreb:0, dreb:0, stl:0, blk:0, tovs:0, _dnp:true, _injured:true}));

  if(!roster.length) return [];

  const r1 = v => v!=null ? Math.round((v+Number.EPSILON)*10)/10 : null;
  const clamp = (v,lo,hi) => Math.max(lo, Math.min(hi, v));

  const projected = roster.map(p => {
    const yr     = (p.yr||p.class_year||'').toLowerCase();
    const isFr   = yr.includes('fr.')||yr.includes('r-fr');
    const isSo   = yr.includes('so.')||yr.includes('r-so.');
    const isJr   = yr.includes('jr.')||yr.includes('r-jr.');
    const isSr   = yr.includes('sr.')||yr.includes('r-sr')||yr.includes('gr.');
    const grade  = parseFloat(p.tdc_grade)||70;
    const pos    = (p.position||'G').replace(/\d/g,'').trim();
    const posNorm= ['PG','SG','SF','PF','C'].includes(pos)?pos:pos==='CG'?'SG':'G';
    const isBig  = pos==='C'||pos==='PF';
    const isGuard= pos==='PG'||pos==='SG'||pos==='CG';

    const deployedPos = getDeployedPos(p, roster);
    const isOutOfPos  = !!(p.position2 && deployedPos !== pos);
    const posFitMult  = p.position2 ? (isOutOfPos ? 0.97 : 1.02) : 1.0;

    const key    = (p.name||'').toLowerCase().trim();
    const history= (window._careerHistoryMap&&window._careerHistoryMap[key])||[];

    const played = history
      .filter(h => !h.sat_out && parseFloat(h.ppg||0)>0 && parseFloat(h.mpg||0)>=6)
      .sort((a,b) => b.season_year - a.season_year);

    const meaningful = played.filter(h => parseFloat(h.mpg||0)>=12);
    const latestH    = played[0]||null;

    // Minutes driven by grade + depth order + dynamic team normalization.
    // No anchoring to actual previous MPG — a transfer C who played 22 MPG due to
    // foul trouble can project for more; a PG at 35 MPG can project for less
    // if the team added competition. Let the roster context decide.
    const newMpg    = computePlayerMpg(p, roster);
    const actualMpg = parseFloat(p.mpg||0)||0;

    const hasCareerStats  = latestH && parseFloat(latestH.ppg||0)>0;
    const hasCurrentStats = parseFloat(p.ppg||0)>0;

    // A negligible sample (e.g. <6 MPG with no meaningful prior season) can't be trusted —
    // its noisy per-minute rates explode when projected into a real role (a 4-minute player
    // reading 8 OREB/G). Regress these to a grade/position baseline instead.
    const tinySample = !hasCareerStats && hasCurrentStats && (parseFloat(p.mpg||0)||0) < 6;
    if((!hasCareerStats && !hasCurrentStats) || tinySample){
      const fb   = getFrBase(grade, posNorm);
      const effMpg = newMpg < 12 ? Math.min(13, newMpg*1.35)
                   : newMpg < 20 ? Math.min(22, newMpg*(grade>=87?1.15:1.08))
                   : newMpg;
      const scale  = effMpg/FR_BASE_MPG;
      // FGA rate: more bullish for elite recruits — they earn real looks from day 1
      const fgaRate = grade>=92 ? 0.42 : grade>=87 ? 0.37 : grade>=78 ? 0.31 : 0.27;
      const fga     = r1(newMpg*fgaRate);
      const fgm_fr  = r1(fga*(fb.fg_pct/100));
      const tpm_fr  = r1(fga*0.42*(fb.tp_pct/100));
      const fta_fr  = r1(newMpg*0.10);
      const ftm_fr  = r1(fta_fr*(fb.ft_pct/100));
      // PPG derived from components — consistent with rest of model
      const ppg_fr  = r1(fgm_fr*2 + tpm_fr + ftm_fr);
      return {...p,
        ppg: ppg_fr, rpg: r1((fb.oreb+fb.dreb)*scale), apg: r1(fb.apg*scale),
        mpg: r1(newMpg),
        fgm: fgm_fr, fga, fg_pct: fb.fg_pct,
        tpm: tpm_fr, tpa: r1(fga*0.42), tp_pct: fb.tp_pct,
        fta: fta_fr, ftm: ftm_fr, ft_pct: fb.ft_pct,
        oreb: r1(fb.oreb*scale), dreb: r1(fb.dreb*scale),
        stl: r1(fb.stl*scale), blk: r1(fb.blk*scale), tovs: r1(fb.tovs*scale),
        _frosh:true, _noStatEst:true, _deployedPos:deployedPos, _posFit:posFitMult,
      };
    }

    const base    = hasCareerStats ? latestH : p;
    const baseMpg = Math.max(1, parseFloat(base.mpg||0)||1);
    const g = k => parseFloat(base[k]||0)||0;

    const orebBase = g('oreb');
    const drebBase = g('dreb');
    const rpgBase  = (orebBase+drebBase) > 0 ? orebBase+drebBase : g('rpg');

    const pm = {
      ppg:  g('ppg')/baseMpg,  rpg:  rpgBase/baseMpg,   apg:  g('apg')/baseMpg,
      fgm:  g('fgm')/baseMpg,  fga:  g('fga')/baseMpg,
      tpm:  g('tpm')/baseMpg,  tpa:  g('tpa')/baseMpg,
      ftm:  g('ftm')/baseMpg,  fta:  g('fta')/baseMpg,
      oreb: orebBase/baseMpg,  dreb: drebBase/baseMpg,
      stl:  g('stl')/baseMpg,  blk:  g('blk')/baseMpg,  tovs: g('tovs')/baseMpg,
    };

    let trendMult = 1.0;
    if(meaningful.length >= 2){
      const n=meaningful[0], p2=meaningful[1];
      const nPm=parseFloat(n.ppg||0)/Math.max(1,parseFloat(n.mpg||1));
      const pPm=parseFloat(p2.ppg||0)/Math.max(1,parseFloat(p2.mpg||1));
      if(pPm>0){
        const rt=nPm/pPm;
        const mpgGrowth=parseFloat(n.mpg||0)/Math.max(1,parseFloat(p2.mpg||0));
        const isBreakout=rt>=1.40&&mpgGrowth>=1.20;
        const cap=isBreakout?0.15:0.10;
        trendMult=1.0+Math.max(-cap,Math.min(cap,(rt-1)*0.35));
      }
    } else if(meaningful.length===1&&played.length>=2){
      const n=meaningful[0],p2=played.find(h=>h!==n);
      if(p2){
        const nPm=parseFloat(n.ppg||0)/Math.max(1,parseFloat(n.mpg||1));
        const pPm=parseFloat(p2.ppg||0)/Math.max(1,parseFloat(p2.mpg||1));
        if(pPm>0&&nPm/pPm>=1.5) trendMult=1.06;
      }
    }
    // Cap trend for upperclassmen — seniors don't suddenly spike, jrs get moderate ceiling
    if(isSr) trendMult = Math.min(1.05, trendMult);
    else if(isJr) trendMult = Math.min(1.08, trendMult);

    const isTransferIn = !!(p.hometown && p.hometown.trim());
    const isReturnee   = !isTransferIn;
    // Year progression is grade-sensitive for seniors:
    // Elite Sr (87+): still developing ceiling, e.g. projected NBA picks → modest bump
    // Good Sr (80-86): minimal progression — mostly established
    // Role Sr (<80): plateaued — project at per-minute rate only
    const srYr       = grade>=87 ? 1.02 : grade>=80 ? 1.01 : 1.0;
    const srReturn   = isReturnee ? (grade>=85 ? 1.01 : 1.0) : 1.0;
    const returnBoost  = isReturnee ? (isSr ? srReturn : isJr?1.02 : isSo?1.04 : 1.02) : 1.0;
    const transferTrim = isTransferIn ? 0.96 : 1.0;
    const yrMult = (isSo?1.06 : isJr?1.03 : isSr?srYr : 1.04) * returnBoost * transferTrim;

    const gradeExpPpg = grade>=90?19:grade>=85?16:grade>=80?13:grade>=75?10:grade>=70?8:6;
    const statsPer32  = pm.ppg*32;
    const gapRatio    = gradeExpPpg>0 ? statsPer32/gradeExpPpg : 1;
    // Raw gap: how far player is from their grade expectation
    const gapMultRaw  = gapRatio<0.50?1.14:gapRatio<0.65?1.09:gapRatio<0.80?1.05
                      : gapRatio<0.95?1.02:gapRatio>1.40?0.96:gapRatio>1.20?0.98:1.0;
    // Upperclassmen have found their level — don't push them toward a grade ceiling they may never hit
    // Fr/So: full gap adjustment (still developing)
    // Jr: 40% of adjustment (mostly established)
    // Sr/Gr: 15% of adjustment (this IS their level)
    const gapMult = isSr ? 1.0+(gapMultRaw-1)*0.15
                  : isJr ? 1.0+(gapMultRaw-1)*0.40
                  : gapMultRaw;

    const rateGrowth = yrMult * gapMult * trendMult;

    let transferFactor = 1.0;
    if(p.hometown && p.hometown.trim()){
      const originConf = getProjSchoolConf(p.hometown)||getSchoolConfFallback(p.hometown);
      if(originConf && conf) transferFactor = getProjTransFactor(originConf, conf, grade);
    }

    // Percentage adjustment from conference difficulty
    const transPctAdj = transferFactor<0.75?-3.5:transferFactor<0.85?-2.5
                      : transferFactor<0.92?-1.5:transferFactor<0.97?-0.8
                      : transferFactor>1.20?+1.2:transferFactor>1.10?+0.8
                      : transferFactor>1.04?+0.4:0;

    // RPG conference adjustment: stronger competition = fewer easy boards
    const rpgConfAdj = isTransferIn ? (
      isBig  ? (transferFactor<0.80?-1.2:transferFactor<0.90?-0.7:transferFactor<0.96?-0.3:transferFactor>1.15?+0.6:0)
             : (transferFactor<0.80?-0.5:transferFactor<0.90?-0.2:transferFactor>1.15?+0.3:0)
    ) : 0;

    // APG conference adjustment: tighter defense = fewer assist opportunities
    const apgConfAdj = isTransferIn ? (
      isGuard ? (transferFactor<0.80?-1.0:transferFactor<0.90?-0.5:transferFactor<0.96?-0.2:transferFactor>1.15?+0.5:0)
              : (transferFactor<0.80?-0.4:transferFactor<0.90?-0.2:transferFactor>1.15?+0.2:0)
    ) : 0;

    // Recency-weighted career avg: latest season 70%, older seasons 30% (split equally).
    // Prevents a weak freshman year from dragging down a breakout sophomore's projection.
    const recencyAvg=(arr,key)=>{
      if(!arr.length) return 0;
      if(arr.length===1) return parseFloat(arr[0][key]||0);
      const latest=parseFloat(arr[0][key]||0);
      const restAvg=arr.slice(1).reduce((s,h)=>s+parseFloat(h[key]||0),0)/arr.slice(1).length;
      return arr.length===2?latest*0.70+restAvg*0.30:latest*0.60+restAvg*0.40;
    };

    // FG%: recency-weighted career smooth, lean heavily on most recent season
    const fgBase      = parseFloat(base.fg_pct||0)||44;
    const careerFgPct = meaningful.length>=2 ? recencyAvg(meaningful,'fg_pct') : fgBase;
    const fgSmoothed  = fgBase*0.65 + careerFgPct*0.35;

    const tpBase = meaningful.length
      ? (meaningful.length>=2 ? recencyAvg(meaningful,'tp_pct') : parseFloat(meaningful[0].tp_pct||0))
      : (parseFloat(base.tp_pct||0)||parseFloat(p.tp_pct||0)||33);

    const ftBase      = parseFloat(base.ft_pct||0)||70;
    const careerFtPct = meaningful.length>=2 ? recencyAvg(meaningful,'ft_pct') : ftBase;
    const ftSmoothed  = ftBase*0.70 + careerFtPct*0.30;

    const oldFga     = parseFloat(base.fga||0)||1;
    const newFgaE    = oldFga*(newMpg/baseMpg);
    const volChange  = (baseMpg>=12) ? (newFgaE/oldFga-1) : 0;
    const volPenalty = volChange*3.5;
    const yearEff    = isSo?1.2:isJr?0.6:isSr?0.0:1.8;

    // Role-reduction efficiency boost: returning players in reduced shot volume
    // take only their best shots → FG% rises. High-assist PGs also benefit
    // from playing within a system (they create easier looks for themselves too).
    // Not for transfers stepping up — they're still adjusting.
    const roleVolDrop = (isReturnee && baseMpg >= 15 && volChange < -0.12);
    const roleEffBoost = roleVolDrop ? Math.min(2.5, Math.abs(volChange) * 12) : 0;
    const pgSystemBoost = (pos==='PG' && parseFloat(p.apg||0)>=4 && isReturnee && !isTransferIn && !isFr)
      ? 1.0 : 0;

    const fgProj = r1(clamp(fgSmoothed + yearEff - volPenalty + transPctAdj + roleEffBoost + pgSystemBoost, 30, 65));

    const careerTpa  = meaningful.length
      ? meaningful.reduce((s,h)=>s+parseFloat(h.tpa||0),0)/meaningful.length
      : parseFloat(base.tpa||0);
    const is3Shooter = careerTpa >= 0.5;
    const tpProj = is3Shooter
      ? r1(clamp(tpBase+(isSo?0.8:isJr?0.4:isSr?0:1.5)-(volChange*2)+transPctAdj*0.6, 20, 50))
      : tpBase;
    const ftProj = r1(clamp(ftSmoothed+(isSo?1.0:isJr?0.5:isSr?0:1.5), 45, 97));

    // Shot volume scales with minutes only — rateGrowth should not inflate attempts/min.
    // Year progression means better efficiency on the same shots, not more shots per minute.
    const newFga = r1(pm.fga*newMpg);
    const newTpa = r1(pm.tpa*newMpg);

    const pf     = posFitMult;
    // Derive all stats from components so PPG is always consistent with FGA.
    // Year progression shows through efficiency (fgProj) not shot-volume inflation.
    const fgm_v  = r1(newFga*(fgProj/100)*pf);
    const tpm_v  = r1(newTpa*(tpProj/100)*pf);
    const fta_v  = r1(pm.fta*newMpg*pf);
    const ftm_v  = r1(fta_v*(ftProj/100));
    // PPG from components: 2×FGM + bonus point per 3PM + FTM
    const ppg_comp = fgm_v*2 + tpm_v + ftm_v;
    // PPG floor: per-minute scoring rate × new minutes × rateGrowth.
    // Catches cases where player_history FTA is incomplete (under-projects free throws).
    const ppgFloorMult = grade>=90?0.95:grade>=83?0.91:0.88;
    const ppg_floor = pm.ppg * rateGrowth * newMpg * pf * ppgFloorMult;

    // Transfer scoring volume penalty for big conference jumps.
    // transPctAdj hits FG% but per-minute scoring also drops in stronger competition.
    // e.g. Winthrop → ACC: grade 84 player who scored 18 PPG won't replicate that rate.
    const scoringTransMult = (isTransferIn && transferFactor < 0.90)
      ? Math.max(0.78, 0.50 + transferFactor * 0.60)
      : 1.0;

    const ppg_v  = r1(Math.max(ppg_comp, ppg_floor) * scoringTransMult);

    const rawRpg = r1(pm.rpg*rateGrowth*newMpg*pf);
    const rawApg = r1(pm.apg*rateGrowth*newMpg*pf);

    return {...p,
      ppg:  ppg_v,
      rpg:  r1(Math.max(0, rawRpg + rpgConfAdj)),
      apg:  r1(Math.max(0, rawApg + apgConfAdj)),
      mpg:  r1(newMpg),
      fgm:  fgm_v, fga: r1(newFga*pf), fg_pct:fgProj,
      tpm:  tpm_v,  tpa: r1(newTpa*pf), tp_pct:tpProj,
      ftm:  ftm_v,  fta: fta_v,         ft_pct:ftProj,
      oreb: r1(pm.oreb*rateGrowth*newMpg*pf),
      dreb: r1(pm.dreb*rateGrowth*newMpg*pf),
      stl:  r1(pm.stl *rateGrowth*newMpg*pf),
      blk:  r1(pm.blk *rateGrowth*newMpg*pf),
      // Turnovers: don't use rateGrowth — experience improves ball security.
      // Expanded roles get a proportional increase; same/reduced roles get a slight cut.
      // baseMpg already defined above from the career/current base season.
      tovs: r1((()=>{
        const roleRatio = baseMpg > 0 ? newMpg/baseMpg : 1;
        // Returning players in same/smaller role: veteran experience = fewer TOs
        const tovBase = pm.tovs * newMpg * pf;
        if(isTransferIn){
          // Transfers adjusting to new system: modest bump
          return tovBase * (roleRatio > 1.15 ? 1.05 : 1.0);
        }
        if(roleRatio > 1.20){
          // Clearly expanded role: more possessions, more responsibility → more TOs
          // But experience still helps — scale is gentler than the role expansion
          const expFactor = 1.0 + (roleRatio - 1.0) * 0.30;
          return tovBase * Math.min(1.25, expFactor);
        }
        // Same or reduced role: veterans protect the ball better each year
        const expCut = isSr ? 0.90 : isJr ? 0.93 : isSo ? 0.96 : 1.0;
        return tovBase * expCut;
      })()),
      _frosh:false, _factor:transferFactor, _trend:trendMult, _seasons:played.length,
      _deployedPos:deployedPos, _posFit:posFitMult,
    };
  }).filter(Boolean);

  // ── SHOT VOLUME CAP (bench-first) ────────────────────────
  // Teams take ~62-76 FGA per game. When over, bench players absorb
  // the cut first — starters keep their projections. Only if starters
  // alone exceed the cap do they get a light proportional trim.
  // FG%/3P%/FT% never touched — only shot volume scales.
  const fgaCap  = 76;
  const bySlt   = [...projected].sort((a,b)=>(a.depth_order||99)-(b.depth_order||99));
  const totalFga= bySlt.reduce((s,p)=>s+(parseFloat(p.fga)||0),0);

  if(totalFga > fgaCap){
    const scale = (p, vol) => {
      p.fgm = r1(p.fgm*vol); p.fga = r1(p.fga*vol);
      p.tpm = r1(p.tpm*vol); p.tpa = r1(p.tpa*vol);
      p.ftm = r1(p.ftm*vol); p.fta = r1(p.fta*vol);
      p.ppg = r1(p.fgm*2 + p.tpm + p.ftm);
    };

    const starters   = bySlt.slice(0,5);
    const bench      = bySlt.slice(5);
    const starterFga = starters.reduce((s,p)=>s+(parseFloat(p.fga)||0),0);
    const benchFga   = bench.reduce((s,p)=>s+(parseFloat(p.fga)||0),0);

    if(starterFga >= fgaCap){
      // Loaded starting 5 alone fills the cap — trim everything proportionally
      const vol = fgaCap/totalFga;
      bySlt.forEach(p => scale(p, vol));
    } else {
      // Bench takes the full cut — starters untouched
      const benchBudget = Math.max(6, fgaCap - starterFga);
      if(benchFga > benchBudget){
        const vol = benchBudget/benchFga;
        bench.forEach(p => scale(p, vol));
      }
    }
  }

  return [...projected, ...injuredDnp];
}

const FR_BASE_MPG = 32;

function getFrBase(grade, pos){
  const tier = grade>=92?'92+':grade>=85?'85-91':grade>=75?'75-84':'below75';
  const posKey = ['PG','SG','SF','PF','C'].includes(pos)?pos:'SG';
  return FR_BASE[tier][posKey];
}

function gradeToStatExpectation(grade, pos){
  const posKey = ['PG','SG','SF','PF','C'].includes(pos)?pos:'SG';
  // Interpolate: grade 70 → low, grade 97 → elite
  const t = Math.max(0, Math.min(1, (grade-60)/37)); // 0 at grade 60, 1 at grade 97
  const elite = {PG:{ppg:19,rpg:4,apg:6},SG:{ppg:20,rpg:5,apg:3},SF:{ppg:19,rpg:7,apg:3},PF:{ppg:16,rpg:9,apg:2},C:{ppg:14,rpg:11,apg:1.5}};
  const low   = {PG:{ppg:5,rpg:2,apg:1.5},SG:{ppg:5,rpg:2,apg:1},SF:{ppg:5,rpg:3,apg:1},PF:{ppg:4,rpg:4,apg:0.8},C:{ppg:4,rpg:5,apg:0.7}};
  const e=elite[posKey], l=low[posKey];
  return {ppg:l.ppg+t*(e.ppg-l.ppg), rpg:l.rpg+t*(e.rpg-l.rpg), apg:l.apg+t*(e.apg-l.apg)};
}

function getYearProgMult(yr){
  const y=yr.toLowerCase();
  if(y.includes('fr.')||y.includes('r-fr')) return 1.10; // So. leap is biggest
  if(y.includes('so.')||y.includes('r-so')) return 1.06;
  if(y.includes('jr.')||y.includes('r-jr')) return 1.03;
  return 1.01; // Sr/Gr — minimal statistical change
}

function efficiencyRegress(fgPct, fgaOld, fgaNew){
  if(!fgaOld||fgaOld<=0) return fgPct;
  const volumeIncrease = fgaNew/fgaOld;
  if(volumeIncrease<=1.1) return fgPct;
  // Each 10% increase in volume drops FG% by ~0.4 pts
  const drop = (volumeIncrease-1)*4.0;
  return Math.max(fgPct-drop, fgPct*0.88);
}

function projectSinglePlayer(p, conf){
  const yr=(p.yr||p.class_year||'').toLowerCase();
  const isFr=yr.includes('fr.')||yr.includes('r-fr');
  const isSo=yr.includes('so.')||yr.includes('r-so');
  const isJr=yr.includes('jr.')||yr.includes('r-jr');
  const isSr=yr.includes('sr.')||yr.includes('r-sr.')||yr.includes('gr.');
  const pos=(p.position||'G').replace(/\d/g,'').trim();
  const posKey=['PG','SG','SF','PF','C','CG'].includes(pos)?pos:'G';
  const posNorm=posKey==='CG'?'SG':posKey;
  const destMult=PROJ_CONF_MULT[conf]||0.85;
  const grade=parseFloat(p.tdc_grade)||70;
  const depth=p.depth_order||8;
  const hasStats=p.ppg&&parseFloat(p.ppg)>0;
  const isTransfer=p.hometown&&p.hometown.trim()!=='';
  const s=k=>parseFloat(p[k])||0;

  // ── Transfer conference factor (uses new canonical system) ──
  let transferFactor=1.0;
  if(isTransfer&&hasStats){
    const originConf=getProjSchoolConf(p.hometown);
    if(originConf) transferFactor=getProjTransFactor(originConf,conf,grade);
  }

  // ── FRESHMAN (no prior stats) ──
  if(isFr&&!hasStats){
    const base=getFrBase(grade,posNorm);
    // _rawMpg assigned by buildTeamProjections based on slot
    // Temporarily set to a grade-appropriate starter estimate; will be scaled by minutes
    const mpgGuess = grade>=90?30:grade>=85?26:grade>=75?18:10;
    const scale=mpgGuess/FR_BASE_MPG;
    return {...p,_proj:true,_isFrosh:true,_transferFactor:1,_posNorm:posNorm,
      _perMin:{ppg:base.ppg/FR_BASE_MPG,rpg:base.rpg/FR_BASE_MPG,apg:base.apg/FR_BASE_MPG,
        stl:base.stl/FR_BASE_MPG,blk:base.blk/FR_BASE_MPG,oreb:base.oreb/FR_BASE_MPG,dreb:base.dreb/FR_BASE_MPG,tovs:base.tovs/FR_BASE_MPG},
      _fgPct:base.fg_pct,_tpPct:base.tp_pct,_ftPct:base.ft_pct,
      _rawMpg:mpgGuess,
    };
  }

  // ── SENIOR — flat projection (only if they have stats) ──
  if(isSr&&hasStats){
    const mpg=s('mpg')||20;
    return {...p,_proj:true,_isSr:true,_transferFactor:1,
      _rawMpg:mpg,
      ppg:r1t(s('ppg')),rpg:r1t(s('rpg')),apg:r1t(s('apg')),mpg:r1t(mpg),
      fgm:r1t(s('fgm')),fga:r1t(s('fga')),fg_pct:r1t(s('fg_pct')),
      tpm:r1t(s('tpm')),tpa:r1t(s('tpa')),tp_pct:r1t(s('tp_pct')),
      ftm:r1t(s('ftm')),fta:r1t(s('fta')),ft_pct:r1t(s('ft_pct')),
      oreb:r1t(s('oreb')),dreb:r1t(s('dreb')),stl:r1t(s('stl')),blk:r1t(s('blk')),tovs:r1t(s('tovs'))};
  }
  // No prior college stats — international, sat-out, no-stat transfer, etc.
  // Use grade-based estimate (same as freshman path)
  if(!hasStats){
    const base=getFrBase(grade,posNorm);
    const mpgGuess = grade>=90?30:grade>=85?26:grade>=75?18:10;
    return {...p,_proj:true,_isFrosh:true,_transferFactor:transferFactor,_posNorm:posNorm,
      _perMin:{ppg:base.ppg/FR_BASE_MPG,rpg:base.rpg/FR_BASE_MPG,apg:base.apg/FR_BASE_MPG,
        stl:base.stl/FR_BASE_MPG,blk:base.blk/FR_BASE_MPG,oreb:base.oreb/FR_BASE_MPG,dreb:base.dreb/FR_BASE_MPG,tovs:base.tovs/FR_BASE_MPG},
      _fgPct:base.fg_pct,_tpPct:base.tp_pct,_ftPct:base.ft_pct,
      _rawMpg:mpgGuess,
    };
  }

  // (hasStats guaranteed here — no-stats case handled above)

  // ── RETURNING PLAYER WITH STATS ──
  const oldMpg=s('mpg')||1;

  // Per-minute rates from last season (the cleanest signal)
  const pm={
    ppg:s('ppg')/oldMpg, rpg:s('rpg')/oldMpg, apg:s('apg')/oldMpg,
    fgm:s('fgm')/oldMpg, fga:s('fga')/oldMpg,
    tpm:s('tpm')/oldMpg, tpa:s('tpa')/oldMpg,
    ftm:s('ftm')/oldMpg, fta:s('fta')/oldMpg,
    oreb:s('oreb')/oldMpg, dreb:s('dreb')/oldMpg,
    stl:s('stl')/oldMpg, blk:s('blk')/oldMpg, tovs:s('tovs')/oldMpg,
  };

  // Year progression — applied to per-minute rates
  const yrMult=getYearProgMult(yr);

  // Grade vs stats gap adjustment
  // If grade >> what their stats suggest, pull stats upward
  const gradeExp=gradeToStatExpectation(grade, posNorm);
  const statsPpgPer32 = pm.ppg*32;
  const gapRatio = gradeExp.ppg>0 ? statsPpgPer32/gradeExp.ppg : 1;
  // If player's stats are below 65% of what grade expects → boost
  // If stats are above 120% of what grade expects → mild cap
  let gapMult=1.0;
  if(gapRatio<0.50)       gapMult=1.18; // way understat'd — likely blocked by minutes
  else if(gapRatio<0.65)  gapMult=1.12;
  else if(gapRatio<0.80)  gapMult=1.06;
  else if(gapRatio<0.95)  gapMult=1.02;
  else if(gapRatio>1.40)  gapMult=0.97; // overstatted relative to grade
  else if(gapRatio>1.20)  gapMult=0.99;

  // Per-minute rate growth: year progression + grade gap only
  // transferFactor does NOT suppress per-minute rates — a player's per-minute
  // talent is what it is. Conference difficulty affects EFFICIENCY (%) not output per minute.
  // Minutes are already being set correctly by the depth chart slot.
  const rateGrowth=yrMult*gapMult;

  // Old FGA for efficiency regression calc
  const oldFga=s('fga');
  const fgBase=s('fg_pct'), tpBase=s('tp_pct'), ftBase=s('ft_pct');

  // Year-based efficiency improvement
  const yearEffBoost=isFr?2.0:isSo?1.2:isJr?0.6:0.0;

  // Volume regression — depth order change drives FGA estimate
  // Will be refined when minutes are assigned, but get a directional estimate here
  const depthFgaAdd=depth<=2?2.0:depth<=5?1.0:depth<=8?0:-(oldFga*0.1);
  const newFgaEst=Math.max(1,oldFga+depthFgaAdd);
  const volPenalty=oldFga>0?(newFgaEst/oldFga-1)*3.5:0;

  // Conference penalty on percentages only
  const transPctAdj=transferFactor<0.85?-2.5:transferFactor<0.95?-1.2:transferFactor>1.15?+1.0:transferFactor>1.05?+0.5:0;

  const fgDelta=yearEffBoost-volPenalty+transPctAdj;
  const fg_pct_proj=r1t(Math.max(30,Math.min(65,fgBase+fgDelta)));
  const tpVolPenalty=oldFga>0?((newFgaEst/oldFga-1)*2.0):0;
  const tpDelta=(isFr?1.5:isSo?0.8:isJr?0.4:0)-tpVolPenalty+transPctAdj*0.6;
  const tp_pct_proj=r1t(Math.max(18,Math.min(50,tpBase+tpDelta)));
  const ftDelta=isFr?1.5:isSo?1.0:isJr?0.5:0;
  const ft_pct_proj=r1t(Math.max(45,Math.min(97,ftBase+ftDelta)));

  // Store per-minute data + rates for minutes scaling in buildTeamProjections
  return {...p,_proj:true,_isFrosh:false,_isSr:false,_transferFactor:transferFactor,
    _rawMpg:oldMpg,
    _pm:pm,
    _rateGrowth:rateGrowth,
    _fg_pct:fg_pct_proj,
    _tp_pct:tp_pct_proj,
    _ft_pct:ft_pct_proj,
    _oldFga:oldFga,
  };
}

function applyPredictionWalls(projected){
  const active = projected.filter(p=>!p._dnp&&!p._injured&&(parseFloat(p.ppg||0)>0||p._noStatEst));
  if(!active.length) return projected;

  const sum = k => active.reduce((s,p)=>s+(parseFloat(p[k]||0)||0),0);
  const r1  = v => Math.round((v+Number.EPSILON)*10)/10;

  // Prediction walls: floor and ceiling (ceiling = last year's best + 1.2 buffer)
  const walls = {
    ppg:  {min:67.4, max:92.4},
    rpg:  {min:29.0, max:46.3},
    oreb: {min:5.7,  max:17.3},
    dreb: {min:19.0, max:31.3},
    apg:  {min:10.0, max:18.0},
    tov:  {min:8.0,  max:17.0},
    stl:  {min:3.5,  max:10.0},
    blk:  {min:2.0,  max:8.0},
  };

  const clamp = (v, w) => Math.max(w.min, Math.min(w.max, v));

  // Compute scale factors from team totals
  const rawPpg  = sum('ppg'),  rawOreb = sum('oreb'), rawDreb = sum('dreb');
  const rawRpg  = rawOreb + rawDreb;
  const rawApg  = sum('apg'),  rawTov = sum('tovs'), rawStl = sum('stl'), rawBlk = sum('blk');

  const tgtPpg  = clamp(rawPpg,  walls.ppg);
  const tgtOreb = clamp(rawOreb, walls.oreb);
  const tgtDreb = clamp(rawDreb, walls.dreb);
  const tgtRpg  = clamp(rawRpg,  walls.rpg);
  const tgtApg  = clamp(rawApg,  walls.apg);
  const tgtTov  = clamp(rawTov,  walls.tov);
  const tgtStl  = clamp(rawStl,  walls.stl);
  const tgtBlk  = clamp(rawBlk,  walls.blk);

  // If RPG wall fires, split adjustment proportionally between oreb/dreb
  const rpgScale  = rawRpg  > 0 ? tgtRpg  / rawRpg  : 1;
  const ppgScale  = rawPpg  > 0 ? tgtPpg  / rawPpg  : 1;
  const orebScale = rawOreb > 0 ? Math.max(rpgScale, tgtOreb/rawOreb) : 1;
  const drebScale = rawDreb > 0 ? Math.max(rpgScale, tgtDreb/rawDreb) : 1;
  const apgScale  = rawApg  > 0 ? tgtApg  / rawApg  : 1;
  const tovScale  = rawTov  > 0 ? tgtTov  / rawTov  : 1;
  const stlScale  = rawStl  > 0 ? tgtStl  / rawStl  : 1;
  const blkScale  = rawBlk  > 0 ? tgtBlk  / rawBlk  : 1;

  // No-op if no scaling needed
  if(ppgScale===1 && rpgScale===1 && orebScale===1 && drebScale===1 &&
     apgScale===1 && tovScale===1 && stlScale===1 && blkScale===1) return projected;

  return projected.map(p=>{
    if(p._dnp||p._injured||(!parseFloat(p.ppg||0)&&!p._noStatEst)) return p;
    const sp={...p};
    if(ppgScale!==1){
      sp.ppg = r1(parseFloat(p.ppg||0)*ppgScale);
      sp.fgm = r1(parseFloat(p.fgm||0)*ppgScale);
      sp.fga = r1(parseFloat(p.fga||0)*ppgScale);
      sp.tpm = r1(parseFloat(p.tpm||0)*ppgScale);
      sp.tpa = r1(parseFloat(p.tpa||0)*ppgScale);
      sp.ftm = r1(parseFloat(p.ftm||0)*ppgScale);
      sp.fta = r1(parseFloat(p.fta||0)*ppgScale);
    }
    if(orebScale!==1) sp.oreb = r1(parseFloat(p.oreb||0)*orebScale);
    if(drebScale!==1) sp.dreb = r1(parseFloat(p.dreb||0)*drebScale);
    sp.rpg = r1((parseFloat(sp.oreb||0))+(parseFloat(sp.dreb||0)));
    if(apgScale!==1)  sp.apg  = r1(parseFloat(p.apg||0)*apgScale);
    if(tovScale!==1)  sp.tovs = r1(parseFloat(p.tovs||0)*tovScale);
    if(stlScale!==1)  sp.stl  = r1(parseFloat(p.stl||0)*stlScale);
    if(blkScale!==1)  sp.blk  = r1(parseFloat(p.blk||0)*blkScale);
    return sp;
  });
}
