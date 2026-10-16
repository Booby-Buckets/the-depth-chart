/* tdc-scrimflow.js — game flow, rotations, +/- and five-man lineups for a preseason scrimmage, from the
   Sidearm play-by-play scripts/scrim_boxes.py saves (scripts/data/scrimmage_pbp_2027.json).
   TDC_SCRIMFLOW.load()                       → the PBP file ({id: {src, plays}})
   TDC_SCRIMFLOW.build(pbp, box, meta)        → {G, R} from tdc-gameflow.js (fromSummary), or null
       pbp.plays = "per|clock|side|name|ACTION|TYPE|hs|as|flags" (side h/a = listed home/away, name = box name)
       meta = {home:{name,abbr,color,logo}, away:{...}, date, href(side,name)}
   TDC_SCRIMFLOW.plusMinus(res)               → {'h|Dame Sarr': 28, ...}
   TDC_SCRIMFLOW.shotSplit(pbp)               → {h:{team:{rim,mid,three}, players:{name:{...}}}, a:{...}}
   The PBP is turned into the ESPN summary shape tdc-gameflow.js already reads, so the margin chart,
   stints and lineups are the same code as game.html. Display only: nothing here feeds a rating. */
(function(){
  var cache=null;
  function load(){
    if(!cache) cache=fetch('scripts/data/scrimmage_pbp_2027.json?v=1',{cache:'no-cache'}).then(function(r){ return r.ok?r.json():{}; }).catch(function(){ return {}; });
    return cache;
  }
  function rows(pbp){
    return ((pbp&&pbp.plays)||[]).map(function(s){ var f=s.split('|');
      return {per:+f[0]||1, clock:f[1]||'0:00', side:f[2], name:f[3], act:f[4], typ:f[5], hs:+f[6]||0, as:+f[7]||0, paint:/p/.test(f[8]||''), fb:/f/.test(f[8]||'')}; });
  }
  // "ERHERIENE,GODSWILL" (a player the box score left out) → "Godswill Erheriene"
  function pretty(n){ if(n.indexOf(',')<0) return n; var a=n.split(','), t=function(x){ return x.trim().toLowerCase().replace(/(^|[\s'-])\S/g,function(c){ return c.toUpperCase(); }); };
    return t(a[1])+' '+t(a[0]); }
  var SHOT={LAYUP:'LayUpShot',DUNK:'DunkShot',TIPIN:'TipShot',JUMPER:'JumpShot','3PTR':'JumpShot'};
  var KIND={LAYUP:'rim',DUNK:'rim',TIPIN:'rim',JUMPER:'mid','3PTR':'three'};

  function summary(pbp,box,meta){
    var P=rows(pbp); if(P.length<50||!box||!box.home||!box.away) return null;
    // athletes: every box-score player, plus anyone the PBP names that the box left out
    var ath={h:{},a:{}};
    ['h','a'].forEach(function(s){ ((box[s==='h'?'home':'away'].players)||[]).forEach(function(p){
      ath[s][p.name]={id:s+'|'+p.name,name:p.name,starter:!!p.gs,pts:+p.pts||0,min:+p.min||0}; }); });
    P.forEach(function(r){ if(r.name!=='TEAM'&&!ath[r.side][r.name]) ath[r.side][r.name]={id:r.side+'|'+r.name,name:pretty(r.name),starter:false,pts:0,min:0}; });
    ['h','a'].forEach(function(s){ var st=Object.keys(ath[s]).filter(function(k){ return ath[s][k].starter; }); if(st.length!==5) Object.keys(ath[s]).forEach(function(k){ ath[s][k].starter=false; }); });
    // within one dead ball, subs out before subs in (Sidearm sometimes logs the IN first)
    for(var i=0;i<P.length;){ var j=i; while(j<P.length&&P[j].act==='SUB'&&P[j].per===P[i].per&&P[j].clock===P[i].clock) j++;
      if(j>i+1){ var blk=P.slice(i,j); blk.sort(function(x,y){ return (x.typ==='IN')-(y.typ==='IN'); }); for(var k=i;k<j;k++) P[k]=blk[k-i]; }
      i=Math.max(j,i+1); }
    // team points that only a play log can give: paint, fast break, off turnovers
    var extra={h:{paint:0,fb:0,pot:0},a:{paint:0,fb:0,pot:0}}, toFor=null, toEndClock=null;
    var plays=[], seq=0, lastShot=null;
    P.forEach(function(r){
      var opp=r.side==='h'?'a':'h', A=r.name==='TEAM'?null:ath[r.side][r.name];
      var part=A?[{athlete:{id:A.id}}]:[];
      var base={id:String(++seq),period:{number:r.per},clock:{displayValue:r.clock},team:{id:r.side},homeScore:r.hs,awayScore:r.as,participants:part,text:''};
      // points off turnovers: the other team's points until it loses the ball or the first team gets it back
      if(toFor){ var off=r.side!==toFor;
        if(toEndClock&&r.clock!==toEndClock){ toFor=null; toEndClock=null; }   // and-one free throws at the same clock still count
        else if(off&&(r.act==='GOOD'||r.act==='MISS'||r.act==='TURNOVER'||(r.act==='REBOUND'&&r.typ!=='DEADB'))) { toFor=null; toEndClock=null; } }
      if(r.act==='GOOD'){ var v=r.typ==='FT'?1:r.typ==='3PTR'?3:2;
        if(r.typ!=='FT'&&r.paint) extra[r.side].paint+=v;
        if(r.fb) extra[r.side].fb+=v;
        if(toFor===r.side){ extra[r.side].pot+=v; if(r.typ!=='FT') toEndClock=r.clock; } }
      if(r.act==='TURNOVER'){ toFor=opp; toEndClock=null; }
      if(r.act==='SUB'){ plays.push(Object.assign(base,{type:{text:'Substitution'},text:(A?A.name:'')+' subbing '+(r.typ==='IN'?'in':'out')})); return; }
      if(r.act==='ASSIST'){   // ESPN puts the assist on the made shot: participants[1] + "Assisted by"
        if(lastShot&&lastShot.team.id===r.side&&A){ lastShot.participants[1]={athlete:{id:A.id}}; lastShot.text+=' Assisted by '+A.name+'.'; }
        return; }
      if(r.act==='GOOD'||r.act==='MISS'){
        var made=r.act==='GOOD';
        if(r.typ==='FT'){ plays.push(Object.assign(base,{type:{text:made?'MadeFreeThrow':'MissedFreeThrow'},shootingPlay:true,scoringPlay:made,scoreValue:made?1:0,pointsAttempted:1,text:'free throw'})); return; }
        var three=r.typ==='3PTR', sp=Object.assign(base,{type:{text:SHOT[r.typ]||'JumpShot'},shootingPlay:true,scoringPlay:made,scoreValue:made?(three?3:2):0,pointsAttempted:three?3:2,text:(three?'three point ':'')+(r.typ||'').toLowerCase()});
        plays.push(sp); lastShot=made?sp:null; return; }
      var t={REBOUND:r.typ==='OFF'?'Offensive Rebound':r.typ==='DEF'?'Defensive Rebound':'Dead Ball Team Rebound',TURNOVER:'Lost Ball Turnover',STEAL:'Steal',BLOCK:'Block Shot',FOUL:'Personal Foul',TIMEOUT:'Timeout'}[r.act];
      if(t) plays.push(Object.assign(base,{type:{text:t}}));
    });
    // halves (and OT) from the running score
    var lines={h:[],a:[]}, last={h:0,a:0};
    var maxPer=Math.max.apply(null,P.map(function(r){ return r.per; }));
    for(var n=1;n<=maxPer;n++){ var e=P.filter(function(r){ return r.per===n; }).pop(); var hs=e?e.hs:last.h, as=e?e.as:last.a;
      lines.h.push(String(hs-last.h)); lines.a.push(String(as-last.a)); last={h:hs,a:as}; }
    var fin=P[P.length-1];
    var hex=function(c){ return String(c||'').replace('#',''); };
    var team=function(s){ var m=meta[s==='h'?'home':'away']||{}; return {id:s,location:m.name,displayName:m.name,abbreviation:m.abbr,color:hex(m.color),logo:m.logo}; };
    // the box's own team counts (player lines summed) so the panel's box rows are the official ones
    var tbox=function(s){ var B=box[s==='h'?'home':'away'], ps=B.players||[], T=B.totals||{}, sum=function(k){ return ps.reduce(function(a,p){ return a+(+p[k]||0); },0); };
      var g=function(k){ return T[k]!=null?+T[k]:sum(k); };
      var st=[['assists',g('ast')],['steals',g('stl')],['blocks',g('blk')],['totalTurnovers',g('tov')],['fouls',sum('pf')],['offensiveRebounds',sum('oreb')],['defensiveRebounds',sum('dreb')],
        ['pointsInPaint',extra[s].paint],['fastBreakPoints',extra[s].fb],['turnoverPoints',extra[s].pot]];
      return {team:{id:s},statistics:st.map(function(x){ return {name:x[0],displayValue:String(x[1])}; })}; };
    return {
      header:{competitions:[{date:meta.date,notes:[{headline:'Scrimmage · unofficial'}],competitors:[
        {homeAway:'home',team:team('h'),score:String(fin.hs),linescores:lines.h.map(function(v){ return {displayValue:v}; })},
        {homeAway:'away',team:team('a'),score:String(fin.as),linescores:lines.a.map(function(v){ return {displayValue:v}; })}]}]},
      boxscore:{players:['h','a'].map(function(s){ return {team:{id:s},statistics:[{keys:['minutes','points'],athletes:Object.keys(ath[s]).map(function(k){ var x=ath[s][k];
          return {athlete:{id:x.id,displayName:x.name},starter:x.starter,stats:[String(x.min),String(x.pts)]}; })}]}; }),
        teams:[tbox('h'),tbox('a')]},
      plays:plays, gameInfo:{venue:meta.venue?{fullName:meta.venue}:null}
    };
  }
  function build(pbp,box,meta){
    if(!window.TDC_GAMEFLOW||!TDC_GAMEFLOW.fromSummary) return null;
    var d=summary(pbp,box,meta); if(!d) return null;
    var res=TDC_GAMEFLOW.fromSummary(d,{panel:'lead',srcLabel:'the box score’s',noHead:true,
      href:function(id){ var i=id.indexOf('|'); return meta.href?meta.href(id.slice(0,i),id.slice(i+1)):null; }});
    if(!res) return null;
    // a team's on-floor rebuild is trusted only if every player's minutes land within 6 of the box score
    // (some stat crews log the wrong names: Wake Forest's feed for Georgetown, Michigan State's for UIW)
    res.ok={};
    ['h','a'].forEach(function(s){ var worst=0;
      ((box[s==='h'?'home':'away'].players)||[]).forEach(function(p){ var st=res.R.stints[s+'|'+p.name]||[], sec=st.reduce(function(a,x){ return a+x.e-x.s; },0);
        if(p.min!=null) worst=Math.max(worst,Math.abs(sec/60-p.min)); });
      res.ok[s]=worst<=6; });
    res.G.rotTeams=['h','a'].filter(function(s){ return res.ok[s]; });
    return res;
  }
  function plusMinus(res){
    var out={}; if(!res) return out;
    Object.keys(res.R.stints).forEach(function(id){ out[id]=res.R.stints[id].reduce(function(s,x){ return s+x.pm; },0); });
    return out;
  }
  // rim (layup / dunk / tip) · mid (2-pt jumper) · three, per team and per player
  function shotSplit(pbp){
    var z=function(){ return {rim:[0,0],mid:[0,0],three:[0,0]}; }, out={h:{team:z(),players:{}},a:{team:z(),players:{}}};
    rows(pbp).forEach(function(r){ var k=KIND[r.typ]; if(!k||(r.act!=='GOOD'&&r.act!=='MISS')) return;
      var S=out[r.side], p=S.players[r.name]||(S.players[r.name]=z()), m=r.act==='GOOD'?1:0;
      S.team[k][0]+=m; S.team[k][1]++; p[k][0]+=m; p[k][1]++; });
    return out;
  }
  window.TDC_SCRIMFLOW={load:load,build:build,summary:summary,plusMinus:plusMinus,shotSplit:shotSplit,pretty:pretty};
})();
