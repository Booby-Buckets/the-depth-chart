// build_grade_couple.js — regenerate scripts/data/player_coupled_grades.json  (run with jsc)
//
// Relative-to-cohort grade coupling v2 (role-aware). Moves each returner/transfer's
// projected OVR by (a) how far his projected LINE beats/lags his grade-cohort, and
// (b) his MINUTES/role jump vs the population (rewards a featured returner stepping up;
// trims a redundant transfer or one losing his role). Re-centered + anchor-tapered so
// the top stays intact (a 94 isn't leapfrogged by a role bump) and the population mean
// barely drifts (no site-wide inflation). Only "movers" are written; everyone else keeps
// the live-computed v5 grade.
//
// Regenerate:
//   1. Fetch players+confs into scratchpad/allplayers.js:  var ALLPLAYERS=[...]; var TCONF={team:conf,...};
//      (players?select=*  filtered to name!='—' & has team;  teams?select=name,conf)
//   2. jsc scripts/build_grade_couple.js  > scripts/data/player_coupled_grades.json
//   (the path constants below point at repo files + the scratchpad data)
//
// PARAMS tuned so: McNeil 85->88, Aberdeen 84->89, Drew 76->73, Hadnot 79->75, Stokes 94->92.

var window = { _careerHistoryMap:{}, _advByEspn:{}, _projCoach:null, _projCoachCache:{} };
var localStorage = { getItem:function(){ return null; } };
load('/Users/aidanlee/the-depth-chart/tdc-projgrade.js');
load('/Users/aidanlee/the-depth-chart/tdc-proj.js');
// NB: versatility is deliberately NOT loaded here — the coupling anchors on the
// vers-FREE grade, and the versatility bump is added on top at display time. Baking it
// into the anchor double-lifts a versatile+featured player (coupling + versatility).
load('/private/tmp/claude-501/-Users-aidanlee-the-depth-chart/1d95c2f3-7530-4191-aac9-5f4fbef225ba/scratchpad/allplayers.js');

var A = 73.42, B = 1.174;          // estBPM -> grade bridge
var KL = 0.5;                       // line-residual weight
var KUP = 10, KDN = 5;             // role (minutes-jump) weight — up vs down (softer downside)
var LINE_LO = -8, LINE_HI = 12;
var ADJ_LO = -5, ADJ_HI = 7;      // how far any single grade can move from its v5 anchor
var JUMP_LO = -0.4, JUMP_HI = 0.7;

function estBPM(L){
  var mpg=Math.max(8,parseFloat(L.mpg)||20), k=36/mpg;
  var pts=parseFloat(L.ppg)||0, trb=parseFloat(L.rpg)||0, ast=parseFloat(L.apg)||0,
      stl=parseFloat(L.stl)||0, blk=parseFloat(L.blk)||0, tov=parseFloat(L.tovs)||0,
      fga=parseFloat(L.fga)||Math.max(2,mpg*0.30), fta=parseFloat(L.fta)||0;
  var tsa=fga+0.44*fta, ts=tsa>0?pts/(2*tsa):0.53;
  var poss=fga+0.44*fta+tov, teamPoss=(mpg/40)*68, usg=teamPoss>0?100*poss/teamPoss:20;
  return -3.9475 + 0.1852*pts*k + 0.2810*trb*k + 1.1877*ast*k + 1.7021*stl*k
         + 1.1577*blk*k - 2.6101*tov*k + 0.2469*(ts-0.53)*100 + 0.1772*(usg-20);
}
function clamp(v,lo,hi){ return Math.max(lo, Math.min(hi, v)); }

var byTeam={}; ALLPLAYERS.forEach(function(p){ (byTeam[p.team]=byTeam[p.team]||[]).push(p); });
var rec=[];
Object.keys(byTeam).forEach(function(tn){
  var roster=byTeam[tn], conf=TCONF[tn]||'';
  var gr=window.TDCProjGrade.gradeRoster(roster);
  var proj=buildTeamProjections(roster, conf); var byN={}; proj.forEach(function(p){ byN[p.name]=p; });
  roster.forEach(function(r,i){
    var a=gr[i]&&gr[i].grade; if(a==null||r.id==null) return;
    var pl=byN[r.name]; if(!pl || !(parseFloat(pl.mpg)>=8)) return;   // rotation players only
    rec.push({ id:r.id, anchor:a, projMin:gr[i].min, lastMpg:parseFloat(r.mpg)||0, lineG:A+B*estBPM(pl) });
  });
});

// fit E[line|anchor] = c0 + c1*anchor  (line-residual baseline)
var n=rec.length, sx=0,sy=0,sxx=0,sxy=0;
rec.forEach(function(d){ sx+=d.anchor; sy+=d.lineG; sxx+=d.anchor*d.anchor; sxy+=d.anchor*d.lineG; });
var c1=(n*sxy-sx*sy)/(n*sxx-sx*sx), c0=(sy-c1*sx)/n;
rec.forEach(function(d){ d.minJump = d.lastMpg>0 ? (d.projMin/d.lastMpg - 1) : 0; });
var MEANJ = rec.reduce(function(a,d){ return a+d.minJump; }, 0) / (rec.length||1);

function coupledOf(d){
  var taper = clamp(1 - Math.max(0, d.anchor-86)/12, 0.3, 1);   // elites barely move on the role term
  var lineResid = d.lineG - (c0 + c1*d.anchor);
  var dj = clamp(d.minJump, JUMP_LO, JUMP_HI) - MEANJ;
  var roleTerm = (dj>=0 ? KUP : KDN) * dj * taper;
  var adj = KL*clamp(lineResid, LINE_LO, LINE_HI) + roleTerm;
  return Math.round(d.anchor + clamp(adj, ADJ_LO, ADJ_HI));
}

var grades={}, up=0, down=0;
rec.forEach(function(d){ var c=coupledOf(d); if(c!==d.anchor){ grades[d.id]=c; if(c>d.anchor) up++; else down++; } });
print(JSON.stringify({
  _meta:{ model:"relative-to-cohort v2 (role-aware)",
          curve:"line="+Math.round(c0*100)/100+"+"+Math.round(c1*1000)/1000+"*anchor",
          KL:KL, KUP:KUP, KDN:KDN, meanJump:Math.round(MEANJ*1000)/1000,
          n:n, movers:Object.keys(grades).length, up:up, down:down },
  grades:grades
}));
