var window = { _careerHistoryMap:{}, _advByEspn:{}, _projCoach:null, _projCoachCache:{} };
var localStorage = { getItem:function(){return null;} };
load('/Users/aidanlee/the-depth-chart/tdc-projgrade.js'); load('/Users/aidanlee/the-depth-chart/tdc-proj.js'); load('/private/tmp/claude-501/-Users-aidanlee-the-depth-chart/1d95c2f3-7530-4191-aac9-5f4fbef225ba/scratchpad/allplayers.js');
function estBPM(L){
  var mpg=Math.max(8, parseFloat(L.mpg)||20), k=36/mpg;
  var pts=parseFloat(L.ppg)||0, trb=parseFloat(L.rpg)||0, ast=parseFloat(L.apg)||0,
      stl=parseFloat(L.stl)||0, blk=parseFloat(L.blk)||0, tov=parseFloat(L.tovs)||0,
      fga=parseFloat(L.fga)||Math.max(2,mpg*0.30), fta=parseFloat(L.fta)||0;
  var tsa=fga+0.44*fta, ts=tsa>0?pts/(2*tsa):0.53;
  var poss=fga+0.44*fta+tov, teamPoss=(mpg/40)*68, usg=teamPoss>0?100*poss/teamPoss:20;
  return -3.9475 + 0.1852*pts*k + 0.2810*trb*k + 1.1877*ast*k + 1.7021*stl*k
         + 1.1577*blk*k - 2.6101*tov*k + 0.2469*(ts-0.53)*100 + 0.1772*(usg-20);
}
var A=73.42,B=1.174,K=0.5,R=8;
var byTeam={}; ALLPLAYERS.forEach(function(p){ (byTeam[p.team]=byTeam[p.team]||[]).push(p); });
var info={}, pairs=[];
Object.keys(byTeam).forEach(function(tn){
  var roster=byTeam[tn], conf=TCONF[tn]||'';
  var gr=window.TDCProjGrade.gradeRoster(roster);
  var proj=buildTeamProjections(roster, conf); var byN={}; proj.forEach(function(p){byN[p.name]=p;});
  roster.forEach(function(r,i){
    var a=gr[i]&&gr[i].grade; if(a==null||r.id==null) return;
    var pl=byN[r.name], lg=null;
    if(pl && parseFloat(pl.mpg)>=8){ lg=A+B*estBPM(pl); pairs.push([a,lg]); }
    info[r.id]={a:a,line:lg};
  });
});
var n=pairs.length,sx=0,sy=0,sxx=0,sxy=0;
pairs.forEach(function(p){sx+=p[0];sy+=p[1];sxx+=p[0]*p[0];sxy+=p[0]*p[1];});
var c1=(n*sxy-sx*sy)/(n*sxx-sx*sx), c0=(sy-c1*sx)/n;
var grades={}, up=0, down=0;
Object.keys(info).forEach(function(id){
  var d=info[id]; if(d.line==null) return;
  var e=c0+c1*d.a, coupled=Math.round(d.a + K*Math.max(-R,Math.min(R,d.line-e)));
  if(coupled!==d.a){ grades[id]=coupled; if(coupled>d.a)up++; else down++; }
});
print(JSON.stringify({_meta:{model:"relative-to-cohort v1",curve:"line="+Math.round(c0*100)/100+"+"+Math.round(c1*1000)/1000+"*anchor",K:K,R:R,n:n,movers:Object.keys(grades).length,up:up,down:down},grades:grades}));
