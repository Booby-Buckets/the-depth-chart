/* THE projection model — single source of truth, shared by team.html and
   player.html so every surface shows identical numbers. Contains the
   data-derived trends (36k season pairs), minutes cohesion, transfer factors,
   the usage-vacancy model and advanced-stat awareness. Load AFTER tdc-nil.js
   and tdc-pos.js. Pages may prefetch bbref advanced rows into
   window._advByEspn = { espn_id: advancedJson } before calling
   buildTeamProjections() to enable usage/TS-aware volume projection. */
function r1t(v){ return v!=null ? Math.round((v+Number.EPSILON)*10)/10 : null; }
// computePlayerMpg — mirrors buildTeamProjections MPG steps exactly
// Used by player page; team page uses targetMpg directly from buildTeamProjections
// Forward-looking grade that DRIVES the minute allocation — the SAME projected OVR
// shown on the depth chart / player card / stats (role + pedigree adjusted), NOT the
// demonstrated tdc_grade. Ranking by the demonstrated grade buried projected-up
// starters: a former 5★ soph whose grade jumps 80→88 as the projected PG1 sorted ~7th
// by his old 80 and got bench minutes, contradicting his OVR and the depth chart.
// Priority: stamped editor/projected grade → computed projgrade → demonstrated grade.
function _projGradeOf(r){
  if(!r) return 70;
  var v = (r._projGrade!=null && !isNaN(r._projGrade)) ? parseFloat(r._projGrade)
        : (window.TDCProjGrade ? window.TDCProjGrade.ovr(r) : NaN);
  if(!isFinite(v)) v = parseFloat(r.tdc_grade);
  return isFinite(v) ? v : 70;
}
function computePlayerMpg(p, teamRoster){
  const pg = _projGradeOf;
  const base=(Array.isArray(teamRoster)?teamRoster:[]).filter(r=>r.name&&r.name!=='—');
  // Order by the AUTHORED depth chart (depth_order) so projected minutes match the depth
  // chart the user maintains: a backup listed ahead of a higher-graded teammate stays
  // ahead (e.g. a proven Jr. ordered over a higher-rated Fr.). The projected grade still
  // sets HOW MANY minutes each slot gets — depth_order only sets the ORDER.
  // RESCUE: a genuine star mis-slotted deep (a roster-push can park a 94 at slot 9) is
  // pulled toward the front — but only from bench slots (>=6) and only for grades well
  // above the roster, so the authored top-of-rotation order is never reshuffled.
  const _avg = base.length ? base.reduce((s,r)=>s+pg(r),0)/base.length : 75;
  const _thr = _avg + 7;
  const rankKey = r => { const d = r.depth_order||99;
    return d - (d>=6 ? Math.max(0, pg(r)-_thr)*1.3 : 0); };
  const roster=base.sort((a,b)=>(rankKey(a)-rankKey(b))||((pg(b))-(pg(a))));
  if(!roster.length){const d=p.depth_order||8;return d<=1?32:d<=2?30:d<=3?27:d<=4?25:d<=5?23:d===6?20:d===7?17:d===8?14:d===9?11:d===10?8:5;}
  const grades=roster.map(r=>pg(r));
  const teamGradeAvg=grades.reduce((a,b)=>a+b,0)/grades.length;
  const rosterSize=roster.length;
  let rotDepth=rosterSize;
  for(let i=2;i<roster.length-1;i++){
    const g1=pg(roster[i-1]),g2=pg(roster[i]);
    if((g1-g2)>=9&&g2<=68){rotDepth=i;break;}
    if(g2<63&&i>=6){rotDepth=i;break;}
  }
  rotDepth=Math.max(7,Math.min(12,rotDepth));
  const mpgMap={};
  roster.forEach((r,i)=>{
    const g=pg(r),slot=i+1;
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
    const g1=pg(r1),g2=pg(r2),diff=g1-g2;
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
    const gPrev=pg(prev), gCur=pg(cur);
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
    const gradeFloor=pg(r);
    const floorPct=gradeFloor>=90?0.95:gradeFloor>=83?0.91:0.88;
    const floor=rAMpg*floorPct;
    if((mpgMap[r.name]||0)<floor) mpgMap[r.name]=floor;
  });
  const result=mpgMap[p.name];
  if(result!=null)return Math.max(1,Math.min(38,result));
  const d=p.depth_order||8;return d<=1?32:d<=2?30:d<=3?27:d<=4?25:d<=5?23:d===6?20:d===7?17:d===8?14:d===9?11:d===10?8:5;
}


// ── TEAM PROJECTION COHESION ENGINE ──────────────────────
const TEAM_TOTAL_MINUTES = 200; // 5 players × 40 min

// ── CANONICAL CONFERENCE SYSTEM (shared with player.html) ──
// Tier matrix matches your spreadsheet exactly
const PROJ_CONF_MULT={'SEC':1.00,'B10':1.00,'BIG-12':1.00,'ACC':1.00,'Big-East':0.95,'A10':0.90,'MWC':0.88,'WCC':0.87,'PAC-12':0.92,'AAC':0.85,'Ivy':0.82,'MAC':0.80,'CUSA':0.78,'WAC':0.78,'Big West':0.77,'MVC':0.78,'SBC':0.72,'CAA':0.74,'Horizon':0.74,'Sun Belt':0.74,'Big South':0.72,'SoCon':0.72,'ASUN':0.72,'MAAC':0.72,'OVC':0.72,'Summit':0.70,'Patriot':0.66,'Big Sky':0.68,'SWAC':0.60,'NEC':0.60,'MEAC':0.58,'AEC':0.56};

const PROJ_CONF_TIERS={'B10':1,'SEC':1,'BIG-12':1,'ACC':1,'Big-East':2,'A10':2,'WCC':2,'PAC-12':2,'MWC':3,'AAC':3,'Ivy':3,'MVC':4,'WAC':4,'CUSA':4,'MAC':4,'Big West':4,'Big Sky':5,'CAA':5,'Horizon':5,'Sun Belt':5,'Big South':5,'SBC':5,'SoCon':6,'ASUN':6,'MAAC':6,'OVC':6,'Summit':6,'Patriot':7,'SWAC':7,'NEC':7,'MEAC':7,'AEC':7};

// Translation matrix: rows=origin tier, cols=destination tier
// Matches your spreadsheet values exactly
const PROJ_TRANS_MAT={
  1:{1:1.00,2:1.15,3:1.28,4:1.40,5:1.40,6:1.40,7:1.40},
  2:{1:0.90,2:1.00,3:1.15,4:1.20,5:1.20,6:1.20,7:1.20},
  3:{1:0.75,2:0.90,3:1.00,4:1.05,5:1.10,6:1.10,7:1.10},
  4:{1:0.49,2:0.68,3:0.82,4:1.00,5:1.05,6:1.05,7:1.05},
  5:{1:0.43,2:0.49,3:0.69,4:0.82,5:1.00,6:1.00,7:1.00},
  6:{1:0.40,2:0.42,3:0.50,4:0.69,5:0.82,6:1.00,7:1.00},
  7:{1:0.30,2:0.34,3:0.42,4:0.48,5:0.69,6:0.82,7:1.00},
};
// ACC special case — higher variance moving down
const PROJ_ACC_OUT={1:1.00,2:1.10,3:1.25,4:1.40,5:1.40,6:1.40,7:1.40};

// Full D1 school → conference map (all ~360 programs)
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
    [['Gonzaga','Pacific','Pepperdine','Portland','Saint Mary\'s','San Diego','San Francisco','Santa Clara','Loyola Marymount','Washington State','Oregon State'],'WCC'],
    [['San Diego State','Colorado State','Boise State','Utah State','Nevada','New Mexico','Fresno State','Air Force','Wyoming','UNLV','San Jose State','Hawaii'],'PAC-12'],
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

function getSchoolConfFallback(school){ return getProjSchoolConf(school); }

// Abbreviations / divergent names that a substring match gets WRONG. Most critical:
// "Penn" (Univ. of Pennsylvania, Ivy) was matching "Penn State" (B10) → no transfer
// translation, so an Ivy scorer projected like a high-major. Explicit wins.
const PROJ_CONF_ALIAS={
  'penn':'Ivy','pitt':'ACC','uconn':'Big-East','ole miss':'SEC','st johns':'Big-East',
  "st. john's":'Big-East','usc':'B10','ucla':'B10','byu':'BIG-12','tcu':'BIG-12','smu':'ACC',
  'vcu':'A10','umass':'A10','unlv':'MWC','uab':'AAC','app state':'Sun Belt','fau':'AAC',
  'fgcu':'ASUN','etsu':'SoCon','vmi':'SoCon','uic':'MVC','umkc':'Summit','ccsu':'NEC',
  'liu':'NEC','fdu':'NEC','umbc':'AEC','nc state':'ACC','unc':'ACC','uc davis':'Big West',
  'saint marys':'WCC',"saint mary's":'WCC','ucf':'BIG-12','lsu':'SEC','miami (fl)':'ACC',
  'miami (oh)':'MAC'
};
function getProjSchoolConf(school){
  if(!school) return null;
  const lo=school.toLowerCase().trim();
  if(PROJ_CONF_ALIAS[lo]) return PROJ_CONF_ALIAS[lo];      // abbreviations first
  if(PROJ_SCHOOL_CONF[lo]) return PROJ_SCHOOL_CONF[lo];     // exact
  // word-boundary match either direction (so "penn" never grabs "penn state")
  for(const k of Object.keys(PROJ_SCHOOL_CONF)){
    if(k===lo || k.startsWith(lo+' ') || lo.startsWith(k+' ')) return PROJ_SCHOOL_CONF[k];
  }
  // loose substring only when the query is long enough to be unambiguous
  if(lo.length>=6) for(const k of Object.keys(PROJ_SCHOOL_CONF)){
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

// ══════════════════════════════════════════════════════════
// PROJECTION ENGINE v3
// Drivers (in priority order):
//  1. Depth-chart slot → projected MPG (primary driver)
//  2. Per-minute rates from last season scaled to new minutes
//  3. Grade vs stats gap → partial upward pull if grade >> stats
//  4. Year progression (So > Jr progression curves)
//  5. Transfer conference translation
//  6. Team usage compression (can't have 5 players all at 20 FGA)
//  7. Efficiency regression (more shots at higher volume = slight % drop)
// ══════════════════════════════════════════════════════════

// ── MINUTES MODEL v2 ─────────────────────────────────────
// Now position-aware: slot = rank within a position group
// Rotation depth is inferred from team quality and roster size
// Returns target MPG
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

// Determine how many players a team realistically plays (7-12 rotation)
// Based on quality drop-off down the roster
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

// ── FR_BASE — grade-tiered baseline stats per position ──────
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

// ── POSITION FIT ENGINE ──────────────────────────────────────────────────────
// Determines if a player is deployed at their primary or secondary position.
// If a player has position2 and their primary slot is already occupied by someone
// with a lower depth_order, but the secondary slot is open → deployed at secondary.
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

// ── DATA-DERIVED PROJECTION TRENDS ───────────────────────────────────────────
// Mined from 36,070 consecutive-season pairs in bbref_seasons (2007-2026) by
// scripts/projection_trends.py. Three ingredients:
//   growth — median per-40 rate ratio (next/current) by class × position group.
//            Blocks REGRESS for guards/wings; assists grow most for forwards.
//   lag1   — regression to the mean: next = m + b·(current − m). 3P% is the
//            noisiest stat in the sport (b=.22); rebounds the stickiest (b=.88).
//   eff / advDelta — average efficiency + advanced-stat movement by class.
const PROJ_TRENDS={
  growth:{ // per-40 medians, keyed class → posGroup(G/W/B) → stat
    FR:{G:{ppg:1.105,rpg:1.023,apg:1.071,stl:1.013,blk:0.745,tovs:0.973,fga:1.070},
        W:{ppg:1.111,rpg:1.019,apg:1.167,stl:1.003,blk:0.892,tovs:1.022,fga:1.081},
        B:{ppg:1.116,rpg:1.027,apg:1.116,stl:0.989,blk:0.978,tovs:1.007,fga:1.083}},
    SO:{G:{ppg:1.060,rpg:1.008,apg:1.031,stl:1.002,blk:0.785,tovs:0.978,fga:1.043},
        W:{ppg:1.053,rpg:1.005,apg:1.076,stl:0.989,blk:0.878,tovs:0.994,fga:1.044},
        B:{ppg:1.063,rpg:1.018,apg:1.091,stl:0.996,blk:0.942,tovs:1.000,fga:1.054}},
    JR:{G:{ppg:1.028,rpg:0.998,apg:1.025,stl:1.005,blk:0.786,tovs:0.969,fga:1.028},
        W:{ppg:1.040,rpg:0.988,apg:1.070,stl:0.986,blk:0.895,tovs:0.986,fga:1.031},
        B:{ppg:1.036,rpg:1.009,apg:1.074,stl:0.971,blk:0.943,tovs:0.980,fga:1.023}},
    SR:{G:{},W:{},B:{}}, // seniors: flat (multiplier defaults to 1)
  },
  lag1:{ // next = m + b·(cur − m), per-40 scale (pcts in pct points)
    p40:{b:0.758,m:13.30}, r40:{b:0.882,m:6.39}, a40:{b:0.849,m:2.46},
    s40:{b:0.635,m:1.27},  b40:{b:0.838,m:0.71}, t40:{b:0.579,m:2.49},
    fg_pct:{b:0.623,m:44.2}, tp_pct:{b:0.220,m:31.4}, ft_pct:{b:0.498,m:68.5},
    usg:{b:0.755,m:19.1}, bpm:{b:0.785,m:-0.45}, per:{b:0.679,m:14.2},
    ws40:{b:0.622,m:0.098}, ts:{b:0.398,m:52.9},
  },
  eff:{ FR:{fg:+0.96,tp:-0.01,ft:+2.68,ts:+1.45}, SO:{fg:+0.33,tp:-0.44,ft:+1.41,ts:+0.64},
        JR:{fg:-0.02,tp:-0.53,ft:+1.12,ts:+0.37}, SR:{fg:0,tp:0,ft:0,ts:0} },
  advDelta:{ FR:{bpm:1.21,per:1.79,ws40:0.017,usg:1.08}, SO:{bpm:0.72,per:1.02,ws40:0.010,usg:0.68},
             JR:{bpm:0.54,per:0.58,ws40:0.006,usg:0.37}, SR:{bpm:0,per:0,ws40:0,usg:0} },
};
function _projCls(yr){
  const y=(yr||'').toLowerCase();
  if(y.includes('fr')) return 'FR';
  if(y.includes('so')) return 'SO';
  if(y.includes('jr')) return 'JR';
  return 'SR';
}
function _projGroup(pos,height){
  const g=window.tdcPosGroup?tdcPosGroup(pos,(window.TDC_NIL&&TDC_NIL.htIn(height))||null):'W';
  return g==='G'?'G':g==='B'?'B':'W';
}
// Proven-player retention: the population lag model regresses everyone toward the
// D1 mean, which unrealistically flattens/declines elite returners (a 93-grade
// scorer is NOT going to shrink to the average). Scale the stability coefficient
// up with grade so stars keep — and, via the class-growth curve, build on — their
// production, while average/role players still regress normally.
function _gradeHold(grade, maxB){
  const g=parseFloat(grade)||77;
  return Math.max(-0.04, Math.min(maxB, (g-77)/15*maxB));
}
// per-40 projection: class/pos growth applied to the deviation-preserved rate,
// then shrunk toward the D1 mean by the stat's measured year-to-year stability
function _projRate40(k40,statK,v40,cls,grp,grade){
  const L=PROJ_TRENDS.lag1[k40]; if(!L) return v40;
  const g=(PROJ_TRENDS.growth[cls]&&PROJ_TRENDS.growth[cls][grp]&&PROJ_TRENDS.growth[cls][grp][statK])||1.0;
  const b=Math.min(0.97, L.b + _gradeHold(grade, 0.22));
  return Math.max(0, L.m + b*(v40*g - L.m));
}
// shooting % projection: shrink toward the D1 mean (3P% hardest — but stability
// scales with attempt volume AND grade, so proven high-volume shooters keep their
// number), plus the measured class-transition delta.
function _projPct(k,cur,cls,attemptsPerG,grade){
  const L=PROJ_TRENDS.lag1[k]; if(!L||!isFinite(cur)||cur<=0) return cur;
  let b=L.b;
  if(k==='tp_pct') b=Math.min(0.78, L.b + Math.min(0.5,(attemptsPerG||0)/6*0.5)); // binomial: more attempts → more signal
  if(k==='ft_pct') b=Math.min(0.80, L.b + Math.min(0.3,(attemptsPerG||0)/5*0.3));
  b=Math.min(0.96, b + _gradeHold(grade, 0.34));   // proven shooters barely regress
  // the small age-based shooting drift also shouldn't apply to proven shooters
  const d=((PROJ_TRENDS.eff[cls]||{})[k==='fg_pct'?'fg':k==='tp_pct'?'tp':'ft']||0)*(1-_gradeHold(grade,0.8));
  return L.m + b*(cur - L.m) + d;
}
// advanced-stat projection from current bbref advanced (lag model + class delta)
function projectAdvanced(adv, cls, projMpg){
  if(!adv) return null;
  const L=PROJ_TRENDS.lag1, D=PROJ_TRENDS.advDelta[cls]||PROJ_TRENDS.advDelta.SR;
  const pf=v=>{const n=parseFloat(v);return isNaN(n)?null:n;};
  const sh=(k,v,d)=>v==null?null:L[k].m + L[k].b*(v-L[k].m) + (d||0);
  const usg=sh('usg',pf(adv.usg_pct),D.usg), bpm=sh('bpm',pf(adv.bpm),D.bpm);
  const per=sh('per',pf(adv.per),D.per),    ws40=sh('ws40',pf(adv.ws_per_40),D.ws40);
  const tsRaw=pf(adv.ts_pct); const ts=tsRaw==null?null:L.ts.m + L.ts.b*(tsRaw*100-L.ts.m) + ((PROJ_TRENDS.eff[cls]||{}).ts||0);
  // Wins Added from projected WS/40 over projected minutes (≈31-game season)
  const mp=(projMpg||0)*31;
  const wa=ws40==null?null:Math.round((ws40-0.04)*mp/40*10)/10;
  const r1=v=>v==null?null:Math.round(v*10)/10;
  return {usg:r1(usg), bpm:r1(bpm), per:r1(per), ws40:ws40==null?null:Math.round(ws40*1000)/1000, ts:r1(ts), wa:wa};
}
// grade-based advanced estimate for freshmen / no-data players (labeled EST)
function estimateAdvanced(grade, projMpg, fgaPerG){
  const N=window.TDC_NIL;
  const bpm=N?N.gradeImpact(grade):((grade-77)/5*2.2-0.6);
  const per=14.2+(grade-77)*0.35;
  const usg=Math.min(30,14+(fgaPerG||6)*0.9);
  const ws40=Math.max(0,0.098+(grade-77)*0.004);
  const ts=52.9+(grade-80)*0.15;
  const mp=(projMpg||0)*31, wa=Math.round((ws40-0.04)*mp/40*10)/10;
  const r1=v=>Math.round(v*10)/10;
  return {usg:r1(usg), bpm:r1(bpm), per:r1(per), ws40:Math.round(ws40*1000)/1000, ts:r1(ts), wa:wa, _est:true};
}

// ── COACHING CONTEXT ─────────────────────────────────────────────────────────
// Fold the team's CURRENT coach tendencies into the projection. Pages call
// loadProjCoachStyle(team) (which sets window._projCoach) before projecting, and
// buildTeamProjections applies applyCoachContext() as a bounded, no-op-safe final
// step. v1 = PACE: normalize the projected team's tempo to the coach's career
// possessions/game. Self-correcting — a returner-heavy roster under the same coach
// already plays near his pace, so paceScale ≈ 1; transfers/freshmen (whose prior
// context differs) get pulled to the coach's system. Keeps shooting %s intact
// (makes + attempts scale together).
async function loadProjCoachStyle(team){
  window._projCoach=null;
  if(!team) return;
  try{
    if(!window._projCoachCache){
      const [prof,seas,dna]=await Promise.all([
        fetch('scripts/data/coach_profiles.json').then(r=>r.ok?r.json():[]).catch(()=>[]),
        fetch('scripts/data/coach_seasons.json').then(r=>r.ok?r.json():[]).catch(()=>[]),
        fetch('scripts/data/team_dna.json').then(r=>r.ok?r.json():null).catch(()=>null)
      ]);
      const bySlug={}; prof.forEach(p=>bySlug[p.coach_slug]=p);
      const byTeam={};  // school -> most recent {y, slug}
      seas.forEach(s=>{ if(!s.school||!s.coach_slug)return; const c=byTeam[s.school];
        if(!c||s.season_year>c.y) byTeam[s.school]={y:s.season_year,slug:s.coach_slug}; });
      // league-median pace (coaches with >=3 seasons) — the reference tempo so the
      // adjustment is CENTERED (half of coaches faster, half slower), not biased.
      const paces=prof.filter(p=>(p.seasons||0)>=3&&p.poss_pg).map(p=>p.poss_pg).sort((a,b)=>a-b);
      const lgPace=paces.length?paces[Math.floor(paces.length/2)]:68;
      // team DEFENSIVE havoc (forced-TO%) by team, so a transfer entering a pressure
      // system (Pitino, etc.) projects for MORE steals — centered on the league median.
      const havoc={}; const hv=[];
      const tms=(dna&&dna['2026']&&dna['2026'].teams)||{};
      Object.keys(tms).forEach(f=>{ const d=tms[f]&&tms[f].dTOV; if(d!=null){ havoc[f.toLowerCase()]=d; hv.push(d); } });
      hv.sort((a,b)=>a-b); const lgHavoc=hv.length?hv[Math.floor(hv.length/2)]:15;
      window._projCoachCache={bySlug,byTeam,lgPace,havoc,lgHavoc};
    }
    const {bySlug,byTeam,lgPace,havoc,lgHavoc}=window._projCoachCache;
    // resolve this team's defensive havoc (full name in team_dna vs the roster's short name)
    let teamHavoc=null;
    if(havoc){ const lo=team.toLowerCase();
      teamHavoc = havoc[lo]; if(teamHavoc==null){ const hk=Object.keys(havoc).find(f=>f===lo||f.startsWith(lo+' ')||(lo.length>=6&&f.indexOf(lo)===0)); if(hk) teamHavoc=havoc[hk]; } }
    let entry=byTeam[team];
    if(!entry){ const lo=team.toLowerCase();
      const k=Object.keys(byTeam).find(s=>{const sl=s.toLowerCase();
        return sl===lo||sl.startsWith(lo+' ')||lo.startsWith(sl+' ')||(lo.length>=6&&(sl.includes(lo)||lo.includes(sl)));});
      if(k) entry=byTeam[k]; }
    if(entry){ const p=bySlug[entry.slug];
      if(p) window._projCoach={poss_pg:p.poss_pg, lgPace:lgPace||68,
        three_pa_pctl:(p.pctl&&p.pctl.three_pa_rate)||null,
        star_pctl:(p.pctl&&p.pctl.top_scorer_share)||null,
        havoc:teamHavoc, lgHavoc:lgHavoc||15,
        archetype:p.archetype, coach:p.coach}; }
    else if(teamHavoc!=null){ window._projCoach={lgPace:lgPace||68, havoc:teamHavoc, lgHavoc:lgHavoc||15}; }
  }catch(e){}
}
// Apply the coach's TEMPO to newcomers only. A returner's prior stats already reflect
// this coach's pace, so scaling them would double-count; but a TRANSFER (prior stats
// at his old team's tempo) and a FRESHMAN (a league-average baseline) get pulled to the
// coach's system. Scale is the coach's pace vs the league-median pace, bounded ±10-12%.
// Shift a player's shot diet toward/away from the three, holding total FGA constant
// (extra 3PA come out of 2PA and vice-versa) and keeping his own 3P%/2P% intact, then
// re-derive points. leanScale>1 = more threes. Mutates sp in place.
function _applyThreeLean(sp, leanScale){
  const fga=parseFloat(sp.fga)||0, tpa=parseFloat(sp.tpa)||0, fgm=parseFloat(sp.fgm)||0, tpm=parseFloat(sp.tpm)||0;
  if(fga<=0||tpa<=0) return;
  const newTpa=Math.max(0, Math.min(fga, tpa*leanScale));
  const threePct=tpm/tpa;                       // hold his own 3P%
  const twoA=fga-tpa, twoM=fgm-tpm, twoPct=twoA>0?twoM/twoA:0;
  const newTwoA=fga-newTpa;                      // FGA held constant → 2s and 3s trade off
  const newTpm=newTpa*threePct, newTwoM=newTwoA*twoPct;
  const dPts=(3*newTpm+2*newTwoM)-(3*tpm+2*twoM);
  sp.tpa=newTpa; sp.tpm=newTpm; sp.fgm=newTpm+newTwoM;   // fga unchanged
  if(sp.ppg!=null) sp.ppg=parseFloat(sp.ppg)+dPts;
}
// Coach context v2 — PACE (v1) + 3PA-LEAN + STAR USAGE-CONCENTRATION. Pace and 3PA-lean
// apply to NEWCOMERS only (a returner's stats already reflect this coach's system, so
// scaling them double-counts); star concentration nudges whoever is the top scorer, since
// the coach's system funnels usage there regardless. All bounded and no-op-safe.
function applyCoachContext(roster){
  const C=window._projCoach; if(!C) return roster;
  const lg=C.lgPace||68;
  const paceScale = C.poss_pg ? Math.max(0.90,Math.min(1.12, C.poss_pg/lg)) : 1;
  const threeLean = C.three_pa_pctl!=null ? Math.max(0.82,Math.min(1.18, 1+0.34*(C.three_pa_pctl-50)/100)) : 1;
  const starPctl  = (C.star_pctl!=null) ? C.star_pctl : null;
  // DEFENSIVE havoc: a transfer entering a high-pressure D (forced-TO% above league
  // median) projects for MORE steals; a passive D, fewer. Centered on the median.
  const havocScale = (C.havoc!=null&&C.lgHavoc) ? Math.max(0.80,Math.min(1.30, C.havoc/C.lgHavoc)) : 1;
  const paceOn=Math.abs(paceScale-1)>=0.008, threeOn=Math.abs(threeLean-1)>=0.01, starOn=(starPctl!=null&&starPctl>60), havocOn=Math.abs(havocScale-1)>=0.02;
  if(!paceOn && !threeOn && !starOn && !havocOn) return roster;   // ~neutral system → no-op
  const r1=v=>v==null?null:Math.round(v*10)/10;
  const VOL=['ppg','rpg','apg','stl','blk','tovs','oreb','dreb','fgm','fga','tpm','tpa','ftm','fta'];
  const active=roster.filter(p=>!p._dnp&&!p._injured);
  const topScorer=active.slice().sort((a,b)=>(parseFloat(b.ppg)||0)-(parseFloat(a.ppg)||0))[0];
  const starUsg=starOn?Math.max(1,Math.min(1.06, 1+0.06*(starPctl-60)/40)):1;
  return roster.map(p=>{
    if(p._dnp||p._injured) return p;
    const isTransfer=!!(p.hometown&&(''+p.hometown).trim());
    const isFrosh=!!(p._frosh||p._noStatEst||p._isFrosh);
    const newcomer=isTransfer||isFrosh;
    const hasLine=!!parseFloat(p.ppg||0)||p._noStatEst;
    let sp=p, changed=false;
    if(newcomer && hasLine && (paceOn||threeOn||havocOn)){
      sp={...p}; changed=true;
      if(paceOn){ VOL.forEach(k=>{ if(sp[k]!=null) sp[k]=parseFloat(sp[k]||0)*paceScale; }); sp._paceScale=Math.round(paceScale*1000)/1000; }
      if(threeOn){ _applyThreeLean(sp, threeLean); sp._threeLean=Math.round(threeLean*1000)/1000; }
      if(havocOn){   // defense-driven: pace already scaled steals for possessions; this is
                     // the ADDITIONAL per-possession pressure of the new system
        if(sp.stl!=null) sp.stl=parseFloat(sp.stl||0)*havocScale;
        if(sp.tovs!=null) sp.tovs=parseFloat(sp.tovs||0)*(1+0.30*(havocScale-1));  // pressure systems turn it over a touch more too
        sp._havoc=Math.round(havocScale*1000)/1000;
      }
    }
    if(starOn && p===topScorer && starUsg>1.004 && hasLine){
      if(!changed){ sp={...p}; changed=true; }
      ['ppg','fgm','fga','tpm','tpa','ftm','fta','apg','tovs'].forEach(k=>{ if(sp[k]!=null) sp[k]=parseFloat(sp[k]||0)*starUsg; });
      sp._starUsg=Math.round(starUsg*1000)/1000;
    }
    if(changed){ VOL.forEach(k=>{ if(sp[k]!=null) sp[k]=r1(sp[k]); }); if(C.poss_pg) sp._coachPace=Math.round(C.poss_pg*10)/10; }
    return changed?sp:p;
  });
}
function buildTeamProjections(players, conf){
  // Injured players (out for the season): zero stats, excluded from the roster
  // BEFORE projection so they take no minutes/shots and aren't double-listed.
  // Honors both the DB flag and the sheet convention ("Injured"/"Out" in the
  // From column) HERE, so every page projects the identical roster.
  const _isOut = p => { const hs=((p.hometown||'')+'').trim().toLowerCase(); return !!p.is_injured||hs==='injured'||hs==='out'; };
  const injuredDnp = players
    .filter(p => p.name && p.name !== '—' && _isOut(p))
    .map(p => ({...p, ppg:0, rpg:0, apg:0, mpg:0, fgm:0, fga:0, tpm:0, tpa:0,
      ftm:0, fta:0, oreb:0, dreb:0, stl:0, blk:0, tovs:0, _dnp:true, _injured:true}));

  const roster = players
    .filter(p => p.name && p.name !== '—' && !_isOut(p))
    // Rank by GRADE, not the scrambled depth_order (see computePlayerMpg) so minutes /
    // usage track quality and stay consistent with the OVR and depth chart.
    .sort((a,b) => ((parseFloat(b.tdc_grade)||0)-(parseFloat(a.tdc_grade)||0))||((a.depth_order||99)-(b.depth_order||99)));

  // ── USAGE VACANCY ─────────────────────────────────────────────────────────
  // Departures leave shots behind. Compare the roster's returning last-season
  // volume to a typical team's ~59 FGA/game; the missing share is redistributed
  // to returners in proportion to their existing volume. bbref advanced gates
  // it: max-usage players (USG ≥ 28) can't inherit much more, and inefficient
  // scorers (TS ≤ 50%) don't get force-fed. Transfers, arriving into an
  // unfamiliar offense, inherit only a sliver.
  // Returnees' volume counts in full; transfers' came against DIFFERENT teams,
  // so it only partially transfers (they re-earn their role) — otherwise a
  // portal-heavy roster hides the vacancy its departures actually left.
  const _retFga = roster.reduce((s,x)=>{
    if((parseFloat(x.ppg)||0)<=0) return s;
    const isTr=!!(x.hometown&&(''+x.hometown).trim());
    return s+(parseFloat(x.fga)||0)*(isTr?0.7:1.0);
  },0);
  const _vac = Math.max(0, Math.min(0.45, (59-_retFga)/59));

  if(!roster.length) return [];

  // ── SHOT-BUDGET ALLOCATION (pecking-order redistribution) ─────────────────
  // The vacancy sum above says how many shots a team LOSES, not who absorbs them.
  // Six former #1 options arriving via the portal can't each keep 8-12 FGA — one
  // team only takes ~58. So distribute a fixed team shot budget across the roster
  // by a blend of demonstrated shot appetite and grade-rank: the best options
  // command a bigger slice when shots are scarce and inherit the vacancy when it
  // exists, while a stack of carried-over transfer volumes compresses DOWN to fit
  // one basketball. A returning star on a gutted roster projects UP as a result.
  // Feeds `vacMult` below (the shot-volume multiplier threaded through the line).
  // Projected minutes come from the SAME rotation model as the depth chart and the
  // grades (tdc-projgrade v5), so the stat line and the depth chart can never
  // disagree — a 9-minute bench player isn't credited 32 minutes of production, and
  // a returning starter who moves up the rotation gets his real minutes. Falls back
  // to the local grade+depth formula if the module isn't loaded on a given page.
  const _v5min={};
  if(typeof window!=='undefined' && window.TDCProjGrade && typeof window.TDCProjGrade.gradeRoster==='function'){
    try{
      const _gr=window.TDCProjGrade.gradeRoster(roster);
      roster.forEach((r,i)=>{ if(_gr[i] && isFinite(_gr[i].min)) _v5min[r.name]=_gr[i].min; });
    }catch(e){}
  }
  const _mpgOf = x => (_v5min[x.name]!=null ? _v5min[x.name] : computePlayerMpg(x, roster));

  const _apptRate = x => {
    const mp=parseFloat(x.mpg||0)||0, fg=parseFloat(x.fga||0)||0;
    if(mp>=6 && fg>0) return fg/mp;                       // demonstrated shots per minute
    const g=parseFloat(x.tdc_grade)||70;                 // no stats → grade-based prior
    return g>=92?0.40:g>=87?0.35:g>=80?0.30:g>=73?0.26:0.22;
  };
  const _usgOf = x => {
    const a=(window._advByEspn && x.espn_id!=null) ? window._advByEspn[x.espn_id] : null;
    return a ? parseFloat(a.usg_pct) : NaN;
  };
  const _allocRows = roster.map(x=>{
    const g=parseFloat(x.tdc_grade)||70;
    const hw=(x.hometown&&(''+x.hometown).trim())||'';
    const isTr=!!(hw && hw.indexOf(',')<0);              // portal arrival (school in hometown)
    const m=_mpgOf(x);
    // transfers re-earn their role (0.85), BUT a proven high-usage scorer keeps more of his
    // shot appetite — the coach brought him in to be an option, not a bystander — so the
    // discount eases toward 1.0 with demonstrated usage (a 30+ alpha ~ no appetite haircut).
    const _u=_usgOf(x);
    const _trDisc = isTr ? (isFinite(_u)&&_u>=22 ? Math.min(1.0, 0.85+(_u-22)*0.014) : 0.85) : 1.0;
    const rate=_apptRate(x)*_trDisc;
    return {name:x.name, m,
      demand: rate*m,                                     // shots wanted at projected minutes
      gradeWeight: Math.pow(Math.max(1,g-55),1.7)*m,      // quality × minutes (pecking order)
      naive: (parseFloat(x.fga||0)||0)*(m/Math.max(1,parseFloat(x.mpg||0)||m)) };
  });
  const _sumDemand=_allocRows.reduce((s,r)=>s+r.demand,0)||1;
  const _sumGW=_allocRows.reduce((s,r)=>s+r.gradeWeight,0)||1;
  const _budget=Math.max(56, Math.min(64, _sumDemand));   // a team takes ~56-64 FGA/game
  const W_ROLE=0.40;                                       // how far grade-rank overrides raw appetite
  const _shotAlloc={};
  _allocRows.forEach(r=>{
    const share=(r.demand/_sumDemand)*(1-W_ROLE)+(r.gradeWeight/_sumGW)*W_ROLE;
    _shotAlloc[r.name]={projFGA:_budget*share, naive:r.naive};
  });

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
    let newMpg      = _mpgOf(p);
    const actualMpg = parseFloat(p.mpg||0)||0;
    // Elite returning starters keep their minutes — the redistribution model
    // shouldn't shave a 93+ returnee who already logged starter minutes here.
    if(grade>=93 && actualMpg>=30 && !(p.hometown&&(''+p.hometown).trim()))
      newMpg=Math.max(newMpg, Math.min(34, actualMpg-0.5));

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

    // Prefer the players-table row as the base season whenever it has stats:
    // it IS last season, and it's identical on every page — career-history rows
    // for the same season come from different sources (player_history vs bbref)
    // with slightly different fields (FTA especially), which made the team and
    // player pages disagree. History still drives trend + career smoothing.
    const base    = hasCurrentStats ? p : (hasCareerStats ? latestH : p);
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
    // Class-transition growth now comes from PROJ_TRENDS (measured per-stat, per
    // position group, from 36k real season pairs) — applied below via _projRate40.
    // What remains here is TDC-specific context the data can't see:
    // returning-in-system familiarity, transfer adjustment, elite-senior ceiling.
    const srYr       = grade>=87 ? 1.02 : 1.0;
    // proven returners develop — give high-grade returning starters a real volume
    // bump (a 90+ returner isn't projected flat), tapered for seniors at their peak
    const returnBoost  = isReturnee ? (1.0 + (isSr?0.01:0.025) + Math.max(0,grade-80)/15*0.03) : 1.0;
    const transferTrim = isTransferIn ? 0.96 : 1.0;
    const ctxMult = (isSr?srYr:1.0) * returnBoost * transferTrim;
    const projCls = _projCls(yr), projGrp = _projGroup(pos, p.height);

    const gradeExpPpg = grade>=95?22:grade>=92?20:grade>=90?19:grade>=85?16:grade>=80?13:grade>=75?10:grade>=70?8:6;
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

    const rateGrowth = ctxMult * gapMult * trendMult;
    // data-derived per-40 projection for a stat: class/pos growth + shrinkage,
    // then TDC context multipliers layered on top
    const d40=(k40,statK,perMin)=>_projRate40(k40,statK,perMin*40,projCls,projGrp,grade)/40 * rateGrowth;

    let transferFactor = 1.0, volTrans = 1.0;
    if(p.hometown && p.hometown.trim()){
      const originConf = getProjSchoolConf(p.hometown)||getSchoolConfFallback(p.hometown);
      if(originConf && conf){
        transferFactor = getProjTransFactor(originConf, conf, grade);
        // Per-minute SHOT VOLUME also translates by conference strength: an
        // 18-shot night in the WCC is not an 18-shot night in the SEC. Moving
        // down (or lateral) never boosts volume.
        volTrans = Math.min(1, (PROJ_CONF_MULT[originConf]||0.85)/(PROJ_CONF_MULT[conf]||0.85));
      }
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
    // shooting-% base weighted by ATTEMPT VOLUME × recency: a 36.8% year on 4.5
    // threes is real, a 26.6% freshman year on 1.9 is noise — the reliable, recent
    // season should dominate so a proven shooter's number isn't dragged down.
    const shootBase=(arr,key,volKey)=>{
      if(!arr.length) return 0;
      if(arr.length===1) return parseFloat(arr[0][key]||0);
      let sw=0,sv=0;
      arr.forEach((h,i)=>{ const val=parseFloat(h[key]||0); if(!(val>0)) return;
        const vol=Math.max(0.3,parseFloat(h[volKey]||0));
        const rec=i===0?2.0:i===1?1.0:0.6;
        const w=vol*rec; sw+=w; sv+=w*val; });
      return sw>0?sv/sw:parseFloat(arr[0][key]||0);
    };

    // FG%: recency-weighted career smooth, lean heavily on most recent season
    const fgBase      = parseFloat(base.fg_pct||0)||44;
    const careerFgPct = meaningful.length>=2 ? shootBase(meaningful,'fg_pct','fga') : fgBase;
    const fgSmoothed  = fgBase*0.55 + careerFgPct*0.45;

    const tpBase = meaningful.length
      ? (meaningful.length>=2 ? shootBase(meaningful,'tp_pct','tpa') : parseFloat(meaningful[0].tp_pct||0))
      : (parseFloat(base.tp_pct||0)||parseFloat(p.tp_pct||0)||33);

    const ftBase      = parseFloat(base.ft_pct||0)||70;
    const careerFtPct = meaningful.length>=2 ? shootBase(meaningful,'ft_pct','fta') : ftBase;
    const ftSmoothed  = ftBase*0.70 + careerFtPct*0.30;

    const oldFga     = parseFloat(base.fga||0)||1;
    // vacancy multiplier for THIS player (share-weighted, advanced-gated)
    const _adv   = (window._advByEspn && p.espn_id!=null) ? window._advByEspn[p.espn_id] : null;
    const _usgNow= _adv?parseFloat(_adv.usg_pct):NaN;
    const _tsNow = _adv?parseFloat(_adv.ts_pct):NaN;
    // vacMult = this player's SHARE of the team shot budget vs a naive minutes-only
    // projection. >1 = he absorbs vacated/scarce shots (top option on a weak roster);
    // <1 = his carried-over volume compresses to fit the pecking order.
    const _alloc    = _shotAlloc[p.name];
    const _naiveFga = oldFga*(newMpg/baseMpg);
    let vacMult = (_alloc && _naiveFga>0) ? _alloc.projFGA/_naiveFga : 1;
    // advanced-stat guardrails: max-usage guys can't balloon much further; inefficient
    // scorers aren't force-fed extra volume; proven efficiency gets a longer leash.
    if(isFinite(_usgNow) && _usgNow>=28) vacMult=Math.min(vacMult,1.25);
    if(isFinite(_tsNow)  && _tsNow<0.50) vacMult=Math.min(vacMult,1.15);
    vacMult=Math.max(0.55, Math.min(1.85, vacMult));
    const fgaGrow=(PROJ_TRENDS.growth[projCls][projGrp]||{}).fga||1.0;
    const newFgaE    = oldFga*(newMpg/baseMpg)*fgaGrow*vacMult*(typeof volTrans!=='undefined'?volTrans:1);
    const volChange  = (baseMpg>=12) ? (newFgaE/oldFga-1) : 0;
    // efficiency cost of added volume, tempered by proven efficiency (TS%)
    let volPenalty = volChange*3.5;
    if(isFinite(_tsNow)){ if(_tsNow>=0.58) volPenalty*=0.5; else if(_tsNow<=0.50) volPenalty*=1.3; }

    // Role-reduction efficiency boost: returning players in reduced shot volume
    // take only their best shots → FG% rises. High-assist PGs also benefit
    // from playing within a system (they create easier looks for themselves too).
    // Not for transfers stepping up — they're still adjusting.
    const roleVolDrop = (isReturnee && baseMpg >= 15 && volChange < -0.12);
    const roleEffBoost = roleVolDrop ? Math.min(2.5, Math.abs(volChange) * 12) : 0;
    const pgSystemBoost = (pos==='PG' && parseFloat(p.apg||0)>=4 && isReturnee && !isTransferIn && !isFr)
      ? 1.0 : 0;

    // Shooting %s: shrink toward the D1 mean by measured year-to-year stability
    // (3P% b=.22 + attempt-volume bonus; FG% b=.62; FT% b=.50), plus the measured
    // class delta, then the TDC context adjustments (volume, transfer, role).
    const fgDataProj = _projPct('fg_pct', fgSmoothed, projCls, oldFga, grade);
    const fgProj = r1(clamp(fgDataProj - volPenalty + transPctAdj + roleEffBoost + pgSystemBoost, 30, 65));

    const careerTpa  = meaningful.length
      ? meaningful.reduce((s,h)=>s+parseFloat(h.tpa||0),0)/meaningful.length
      : parseFloat(base.tpa||0);
    const is3Shooter = careerTpa >= 0.5;
    // added-volume cost on 3P%, tempered for proven shooters (a 90+ marksman
    // doesn't lose his stroke taking a few more attempts) — mirrors the FG% temper
    const tpVolPen = (volChange>0?volChange*2:volChange) * (grade>=88?0.35:grade>=82?0.6:1);
    const tpProj = is3Shooter
      ? r1(clamp(_projPct('tp_pct', tpBase, projCls, careerTpa, grade) - tpVolPen + transPctAdj*0.6, 20, 50))
      : tpBase;
    const ftProj = r1(clamp(_projPct('ft_pct', ftSmoothed, projCls, parseFloat(base.fta||0), grade), 45, 97));

    // Transfer scoring penalty for big conference jumps — applied to SHOT VOLUME (not
    // PPG alone) so the projected line stays internally consistent (PPG = 2·FGM+3PM+FTM).
    // Discounting only PPG cratered a transfer's IMPLIED efficiency (fake-low TS%/estBPM),
    // which then dragged the grade even though his stats looked fine.
    let scoringTransMult = (isTransferIn && transferFactor < 0.95)
      ? Math.max(0.78, 0.52 + transferFactor * 0.48) : 1.0;
    // A proven high-usage scorer stays a focal point at the new school — the offense
    // still runs through him — so the conference scoring discount on his shot VOLUME
    // is gentler the higher his demonstrated usage. Efficiency (transPctAdj / FG%)
    // still translates fully; this preserves his shot appetite, not his percentages.
    if(isTransferIn && scoringTransMult < 1 && isFinite(_usgNow) && _usgNow >= 22){
      // a true 30+-usage alpha pays essentially NO extra conference scoring tax on volume;
      // mid-usage transfers get partial relief. His SHARE (vacMult) still compresses him
      // behind better teammates, and his FG% still translates down — so he doesn't run away.
      scoringTransMult = Math.min(1, scoringTransMult + Math.min(0.22, (_usgNow - 22) * 0.028));
    }
    // Shot volume: minutes-driven, with class/pos FGA growth, usage vacancy, conference
    // translation, and the transfer scoring penalty.
    const newFga = r1(pm.fga*fgaGrow*newMpg*vacMult*volTrans*scoringTransMult);
    const newTpa = r1(pm.tpa*fgaGrow*newMpg*vacMult*volTrans*scoringTransMult);

    const pf     = posFitMult;
    // Derive all stats from components so PPG is always consistent with FGA.
    // Year progression shows through efficiency (fgProj) not shot-volume inflation.
    const fgm_v  = r1(newFga*(fgProj/100)*pf);
    const tpm_v  = r1(newTpa*(tpProj/100)*pf);
    const fta_v  = r1(pm.fta*newMpg*pf*vacMult*volTrans*scoringTransMult);
    const ftm_v  = r1(fta_v*(ftProj/100));
    // PPG from components: 2×FGM + bonus point per 3PM + FTM
    const ppg_comp = fgm_v*2 + tpm_v + ftm_v;
    // PPG floor: per-minute scoring rate × new minutes × rateGrowth.
    // Catches cases where player_history FTA is incomplete (under-projects free throws).
    const ppgFloorMult = grade>=90?0.95:grade>=83?0.91:0.88;
    const ppg_floor = d40('p40','ppg',pm.ppg) * newMpg * pf * ppgFloorMult * (1+(vacMult-1)*0.7) * volTrans * scoringTransMult;

    // scoringTransMult already applied to the shot line above, so PPG stays consistent.
    const ppg_v  = r1(Math.max(ppg_comp, ppg_floor));

    // Rebounds/assists/stocks: measured class-growth + stability shrinkage per stat.
    // Blocks regress hard for perimeter players; rebounds are the stickiest skill.
    const rpgRate = d40('r40','rpg',pm.rpg);
    const rebScale = pm.rpg>0 ? rpgRate/pm.rpg : 1;   // preserve OR/DR split
    const rawRpg = r1(rpgRate*newMpg*pf);
    const rawApg = r1(d40('a40','apg',pm.apg)*newMpg*pf*(1+_vac*(isGuard?0.25:0.10)));

    return {...p,
      ppg:  ppg_v,
      rpg:  r1(Math.max(0, rawRpg + rpgConfAdj)),
      apg:  r1(Math.max(0, rawApg + apgConfAdj)),
      mpg:  r1(newMpg),
      fgm:  fgm_v, fga: r1(newFga*pf), fg_pct:fgProj,
      tpm:  tpm_v,  tpa: r1(newTpa*pf), tp_pct:tpProj,
      ftm:  ftm_v,  fta: fta_v,         ft_pct:ftProj,
      oreb: r1(pm.oreb*rebScale*newMpg*pf),
      dreb: r1(pm.dreb*rebScale*newMpg*pf),
      stl:  r1(d40('s40','stl',pm.stl)*newMpg*pf),
      blk:  r1(d40('b40','blk',pm.blk)*newMpg*pf),
      // Turnovers: don't use rateGrowth — experience improves ball security.
      // Expanded roles get a proportional increase; same/reduced roles get a slight cut.
      // baseMpg already defined above from the career/current base season.
      tovs: r1((()=>{
        const roleRatio = baseMpg > 0 ? newMpg/baseMpg : 1;
        // Returning players in same/smaller role: veteran experience = fewer TOs
        const tovBase = d40('t40','tovs',pm.tovs) * newMpg * pf;
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
      _frosh:false, _factor:transferFactor, _trend:trendMult, _seasons:played.length, _vacMult:r1(vacMult),
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

// Reference MPG used in the baseline (starters = ~32 MPG)
const FR_BASE_MPG = 32;

function getFrBase(grade, pos){
  const tier = grade>=92?'92+':grade>=85?'85-91':grade>=75?'75-84':'below75';
  const posKey = ['PG','SG','SF','PF','C'].includes(pos)?pos:'SG';
  return FR_BASE[tier][posKey];
}

// ── GRADE → STAT EXPECTATION ──────────────────────────────
// Maps a TDC grade to what a player at that grade "should" produce at starter minutes
// Used to detect grade vs stats gap
function gradeToStatExpectation(grade, pos){
  const posKey = ['PG','SG','SF','PF','C'].includes(pos)?pos:'SG';
  // Interpolate: grade 70 → low, grade 97 → elite
  const t = Math.max(0, Math.min(1, (grade-60)/37)); // 0 at grade 60, 1 at grade 97
  const elite = {PG:{ppg:19,rpg:4,apg:6},SG:{ppg:20,rpg:5,apg:3},SF:{ppg:19,rpg:7,apg:3},PF:{ppg:16,rpg:9,apg:2},C:{ppg:14,rpg:11,apg:1.5}};
  const low   = {PG:{ppg:5,rpg:2,apg:1.5},SG:{ppg:5,rpg:2,apg:1},SF:{ppg:5,rpg:3,apg:1},PF:{ppg:4,rpg:4,apg:0.8},C:{ppg:4,rpg:5,apg:0.7}};
  const e=elite[posKey], l=low[posKey];
  return {ppg:l.ppg+t*(e.ppg-l.ppg), rpg:l.rpg+t*(e.rpg-l.rpg), apg:l.apg+t*(e.apg-l.apg)};
}

// ── YEAR PROGRESSION ─────────────────────────────────────
// Returns stat growth multiplier based on class year transition
// These are per-minute rate multipliers (not counting minutes change)
function getYearProgMult(yr){
  const y=yr.toLowerCase();
  if(y.includes('fr.')||y.includes('r-fr')) return 1.10; // So. leap is biggest
  if(y.includes('so.')||y.includes('r-so')) return 1.06;
  if(y.includes('jr.')||y.includes('r-jr')) return 1.03;
  return 1.01; // Sr/Gr — minimal statistical change
}

// ── EFFICIENCY REGRESSION ─────────────────────────────────
// More FGA = slightly lower % (volume → marginal shot quality drops)
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


// ── PREDICTION WALL SCALING ──────────────────────────────────────────────────
// Scales player stats proportionally so team totals stay within realistic bounds.
// Preserves each player's relative contribution — best rebounders still rebound most.
// Wrapper applies the COACHING context (pace) as the FINAL step — after the walls,
// so a genuinely fast-paced coach's team keeps its higher totals instead of being
// clamped back to a league-average tempo. Both pages finalize through here.
function applyPredictionWalls(projected){ return applyCoachContext(_applyPredictionWallsRaw(projected)); }
function _applyPredictionWallsRaw(projected){
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
