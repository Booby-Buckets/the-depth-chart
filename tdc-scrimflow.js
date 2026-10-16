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

  // ── OUR CHARTS ──────────────────────────────────────────────────────────────
  function esc(x){ return String(x==null?'':x).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function sgn(v,d){ var t=Math.abs(v).toFixed(d||0); return v>0?'+'+t:v<0?'−'+t:(0).toFixed(d||0); }

  // HOW EACH TRIP ENDED: every possession from the play log, by what ended it. A team has the ball from its first
  // offensive act (shot, turnover, offensive rebound) or defensive rebound until the other team's.
  var OUT=[['three','Made 3'],['two','Made 2'],['ft','Free throws only'],['empty','Empty: missed shot'],['tov','Turnover']];
  function possessions(pbp){
    var z=function(){ var o={n:0,pts:0}; OUT.forEach(function(k){ o[k[0]]={n:0,pts:0}; }); return o; }, T={h:z(),a:z()};
    var cur=null, per=0;
    var close=function(){ if(!cur) return; var c=cur, k=c.tov&&!c.pts?'tov':c.three?'three':c.two?'two':c.pts?'ft':'empty';
      T[c.side].n++; T[c.side].pts+=c.pts; T[c.side][k].n++; T[c.side][k].pts+=c.pts; cur=null; };
    rows(pbp).forEach(function(r){
      if(r.per!==per){ close(); per=r.per; }
      var off=(r.act==='GOOD'||r.act==='MISS'||r.act==='TURNOVER'||(r.act==='REBOUND'&&(r.typ==='OFF'||r.typ==='DEF')));
      if(off&&(!cur||cur.side!==r.side)){ close(); cur={side:r.side,pts:0,three:0,two:0,tov:0}; }
      if(!cur||cur.side!==r.side) return;
      if(r.act==='GOOD'){ var v=r.typ==='FT'?1:r.typ==='3PTR'?3:2; cur.pts+=v; if(v===3) cur.three=1; if(v===2) cur.two=1; }
      if(r.act==='TURNOVER') cur.tov=1;
    });
    close(); return T;
  }
  var OCOL={three:'var(--po-3)',two:'var(--po-2)',ft:'var(--po-ft)',empty:'var(--po-e)',tov:'var(--po-to)'};
  function possessionsHtml(pbp,names){
    var T=possessions(pbp); if(!T.h.n||!T.a.n) return '';
    var bar=function(s){ var t=T[s];
      return '<div class="po-row"><div class="po-nm"><b>'+esc(names[s])+'</b><span>'+t.n+' trips · '+(t.pts/t.n).toFixed(2)+' pts per trip</span></div><div class="po-bar">'+
        OUT.map(function(o){ var x=t[o[0]], w=100*x.n/t.n; if(!x.n) return '';
          return '<i style="width:'+w.toFixed(2)+'%;background:'+OCOL[o[0]]+';color:'+(o[0]==='three'||o[0]==='tov'?'#fff':'#1d1d22')+'" title="'+esc(names[s])+' · '+o[1]+': '+x.n+' trips ('+Math.round(w)+'%), '+x.pts+' pts">'+(w>=7?Math.round(w)+'%':'')+'</i>'; }).join('')+'</div></div>'; };
    var leg='<div class="po-leg">'+OUT.map(function(o){ return '<span><i style="background:'+OCOL[o[0]]+'"></i>'+o[1]+'</span>'; }).join('')+'</div>';
    // the same counts as a sheet (exact numbers, points from each kind of trip)
    var tbl='<div class="sheet-wrap" style="max-height:none;margin-top:12px;"><table class="sheet dense po-tbl"><thead><tr><th class="l">Trips ended by</th><th>'+esc(names.a)+'</th><th></th><th>'+esc(names.h)+'</th><th></th></tr></thead><tbody>'+
      OUT.map(function(o){ return '<tr><td class="l"><i class="po-sw" style="background:'+OCOL[o[0]]+'"></i>'+o[1]+'</td>'+['a','h'].map(function(s){ var x=T[s][o[0]];
        return '<td>'+x.n+' <span class="dim">('+Math.round(100*x.n/T[s].n)+'%)</span></td><td class="dim">'+x.pts+' pts</td>'; }).join('')+'</tr>'; }).join('')+
      '<tr class="tot"><td class="l">All trips</td>'+['a','h'].map(function(s){ return '<td>'+T[s].n+'</td><td class="dim">'+T[s].pts+' pts</td>'; }).join('')+'</tr></tbody></table></div>';
    return leg+bar('a')+bar('h')+tbl;
  }

  // STARTERS VS BENCH: the score while 5, 4, 3, 2 or fewer of the team's starters were on the floor together
  function units(res,s){
    var G=res.G, B=[{k:5,lab:'All 5 starters'},{k:4,lab:'4 starters'},{k:3,lab:'3 starters'},{k:2,lab:'2 starters'},{k:1,lab:'0–1 starters'}];
    B.forEach(function(b){ b.sec=0; b.pf=0; b.pa=0; });
    Object.keys(res.R.LU[s]).forEach(function(key){ var L=res.R.LU[s][key]; if(L.ids.length!==5) return;
      var n=L.ids.filter(function(id){ return G.P[id]&&G.P[id].starter; }).length, b=B[5-Math.max(1,n)];
      b.sec+=L.sec; b.pf+=L.pf; b.pa+=L.pa; });
    return B;
  }
  function unitsHtml(res,names){
    var sides=['a','h'].filter(function(s){ return res.ok[s]&&Object.keys(res.G.P).some(function(id){ return id.slice(0,2)===s+'|'&&res.G.P[id].starter; }); });
    if(!sides.length) return '';
    var all=sides.map(function(s){ return units(res,s); }), mx=4;
    all.forEach(function(B){ B.forEach(function(b){ if(b.sec>=60) mx=Math.max(mx,Math.abs(b.pf-b.pa)); }); });
    return '<div class="un-grid">'+sides.map(function(s,i){ var B=all[i];
      return '<div><div class="un-h">'+esc(names[s])+'</div>'+B.map(function(b){
        if(b.sec<60) return '<div class="un-row dim"><span class="un-l">'+b.lab+'</span><span class="un-m">'+(b.sec?Math.round(b.sec/60)+' min':'—')+'</span><span class="un-b"></span><span class="un-v"></span></div>';
        var d=b.pf-b.pa, r10=d/(b.sec/60)*10, w=Math.min(50,Math.abs(d)/mx*50);
        return '<div class="un-row" title="'+esc(names[s])+' · '+b.lab+': '+mmss(b.sec)+', '+b.pf+'–'+b.pa+' ('+sgn(r10,1)+' per 10 min)"><span class="un-l">'+b.lab+'</span><span class="un-m">'+mmss(b.sec)+'<em>'+b.pf+'–'+b.pa+'</em></span>'+
          '<span class="un-b"><i class="'+(d>=0?'p':'n')+'" style="'+(d>=0?'left:50%':'right:50%')+';width:'+w.toFixed(1)+'%"></i></span><span class="un-v">'+sgn(d)+'</span></div>'; }).join('')+'</div>'; }).join('')+'</div>';
  }
  function mmss(sec){ sec=Math.round(sec); return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'); }

  // VS OUR PROJECTION (scrim_trends_2027.json, build_scrim_trends.py): minutes we projected before the scrimmages
  // vs minutes played, and Game Score vs what our projection expected for the minutes he actually played
  var tcache=null;
  function loadTrends(){ if(!tcache) tcache=fetch('scripts/data/scrim_trends_2027.json?v=1',{cache:'no-cache'}).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; }); return tcache; }
  function projRows(T,gid,full){
    var out=[]; if(!T) return out;
    var all=[]; [T.players,T.fresh].forEach(function(o){ Object.keys(o||{}).forEach(function(k){ all.push(o[k]); }); });   // returners + newcomers
    all.forEach(function(p){ if(p.full!==full) return;
      (p.games||[]).forEach(function(x){ if(x.id===gid&&x.proj&&x.exp&&x.exp.gmsc!=null) out.push({name:p.name,min:x.min||0,pmin:x.proj.min,gs:x.gmsc,egs:x.exp.gmsc,pts:x.pts,epts:x.exp.pts,started:x.gs}); }); });
    return out.sort(function(a,b){ return b.min-a.min; });
  }
  function projHtml(T,gid,sides){
    var blocks=sides.map(function(sd){ var R=projRows(T,gid,sd.full); return {sd:sd,R:R}; }).filter(function(b){ return b.R.length; });
    if(!blocks.length) return '';
    var mx=8; blocks.forEach(function(b){ b.R.forEach(function(r){ mx=Math.max(mx,Math.abs(r.gs-r.egs)); }); });
    var M=40;
    return '<div class="pj-leg"><span><i class="pj-o"></i>Projected minutes</span><span><i class="pj-x"></i>Played</span><span><i class="pj-p"></i>Beat our projection</span><span><i class="pj-n"></i>Below it</span></div><div class="un-grid">'+blocks.map(function(b){
      return '<div><div class="pj-row pj-head"><span>'+esc(b.sd.name)+'</span><span>Minutes <em>0–40</em></span><span>Game Score vs projected</span></div>'+b.R.map(function(r){
        var a=Math.min(r.min,M)/M*100, p=Math.min(r.pmin,M)/M*100, lo=Math.min(a,p), d=r.gs-r.egs, w=Math.min(50,Math.abs(d)/mx*50);
        return '<div class="pj-row" title="'+esc(r.name)+': '+r.min+' min (projected '+r.pmin.toFixed(1)+') · Game Score '+r.gs.toFixed(1)+' vs '+r.egs.toFixed(1)+' projected for '+r.min+' min · '+r.pts+' pts vs '+(r.epts!=null?r.epts.toFixed(1):'—')+'">'+
          '<span class="pj-nm">'+esc(b.sd.short(r.name))+(r.started?' <b class="dim">*</b>':'')+'</span>'+
          '<span class="pj-mn"><i class="pj-ln" style="left:'+lo.toFixed(1)+'%;width:'+Math.abs(a-p).toFixed(1)+'%"></i><i class="pj-o" style="left:'+p.toFixed(1)+'%"></i><i class="pj-x" style="left:'+a.toFixed(1)+'%"></i></span>'+
          '<span class="pj-gs"><span class="un-b"><i class="'+(d>=0?'p':'n')+'" style="'+(d>=0?'left:50%':'right:50%')+';width:'+w.toFixed(1)+'%"></i></span><b>'+sgn(d,1)+'</b></span></div>'; }).join('')+'</div>'; }).join('')+'</div>';
  }


  // ── OUR LOOK for the flow + rotation (scrimmage.html; game.html keeps tdc-gameflow.js's own views) ──
  function rgba(c,a){ c=c||[90,100,120]; return 'rgba('+c[0]+','+c[1]+','+c[2]+','+a+')'; }
  function perLenOf(n){ return n<=2?1200:300; } function perStartOf(n){ return n<=2?(n-1)*1200:2400+(n-3)*300; }
  function marginAt(R,t){ var m=0; for(var i=0;i<R.flow.length&&R.flow[i][0]<=t;i++) m=R.flow[i][1]; return m; }
  function lastWord(n){ n=String(n||'').replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i,''); var w=n.split(' '); return w.length>1?w.slice(1).join(' '):n; }
  function initialOf(n){ var w=String(n||'').split(' '); return w.length>1?w[0].charAt(0)+'. '+w.slice(1).join(' '):n; }
  // scoring runs of 8+ unanswered points: [{team, pts, s, e}]
  function runs(G,R){
    var out=[], cur=null, F=R.flow;
    for(var i=1;i<F.length;i++){ var d=F[i][1]-F[i-1][1]; if(!d) continue; var t=d>0?G.home:G.away;
      if(cur&&cur.team===t){ cur.pts+=Math.abs(d); cur.e=F[i][0]; }
      else { if(cur&&cur.pts>=8) out.push(cur); cur={team:t,pts:Math.abs(d),s:F[i-1][0],e:F[i][0]}; } }
    if(cur&&cur.pts>=8) out.push(cur);
    return out.sort(function(a,b){ return b.pts-a.pts; }).slice(0,4);
  }
  function flowView(el,G,R,names){
    var H=G.home, A=G.away, cw=el.clientWidth||900, W=Math.max(320,Math.min(1100,cw)), Hh=W<600?250:330;
    var padL=W<600?34:44, padR=W<600?30:40, top=30, bot=28, ih=Hh-top-bot, iw=W-padL-padR;
    var Y=10; R.flow.forEach(function(f){ Y=Math.max(Y,Math.abs(f[1])); }); Y=Math.ceil(Y/10)*10;
    var x=function(e){ return padL+iw*e/G.total; }, y=function(m){ return top+ih/2-m/Y*(ih/2); };
    var ch=G.T[H].color, ca=G.T[A].color;
    var g='<svg class="sf-flow" viewBox="0 0 '+W+' '+Hh+'" role="img" aria-label="Score margin through the game">';
    // runs first, as bands behind everything
    runs(G,R).forEach(function(r){ var a=x(r.s), b=Math.max(x(r.e),a+3), col=r.team===H?ch:ca;
      g+='<rect x="'+a.toFixed(1)+'" y="'+top+'" width="'+(b-a).toFixed(1)+'" height="'+ih+'" fill="'+rgba(col,.13)+'"/>'+
        '<text class="sf-run" x="'+((a+b)/2).toFixed(1)+'" y="'+(top-9)+'" text-anchor="middle">'+r.pts+'–0 '+esc(names[r.team===H?'h':'a'])+'</text>'; });
    for(var v=-Y; v<=Y; v+=10){ g+='<line class="sf-grid'+(v?'':' z')+'" x1="'+padL+'" x2="'+(W-padR)+'" y1="'+y(v)+'" y2="'+y(v)+'"/>';
      if(v) g+='<text class="sf-ax" x="'+(padL-6)+'" y="'+(y(v)+4)+'" text-anchor="end">'+Math.abs(v)+'</text>'; }
    // which side is which, written on the plot
    g+='<text class="sf-side" x="'+(padL+6)+'" y="'+(top+13)+'">'+esc(names.h)+' ahead ↑</text><text class="sf-side" x="'+(padL+6)+'" y="'+(top+ih-6)+'">'+esc(names.a)+' ahead ↓</text>';
    var d='M '+x(0)+' '+y(0); R.flow.forEach(function(f){ d+=' H '+x(f[0]).toFixed(1)+' V '+y(f[1]).toFixed(1); });
    var id='sf'+Math.random().toString(36).slice(2,7), z=y(0);
    g+='<defs><clipPath id="'+id+'u"><rect x="0" y="0" width="'+W+'" height="'+z+'"/></clipPath><clipPath id="'+id+'d"><rect x="0" y="'+z+'" width="'+W+'" height="'+(Hh-z)+'"/></clipPath></defs>';
    var area=d+' H '+x(G.total)+' V '+z+' Z';
    g+='<path d="'+area+'" fill="'+rgba(ch,.28)+'" clip-path="url(#'+id+'u)"/><path d="'+area+'" fill="'+rgba(ca,.28)+'" clip-path="url(#'+id+'d)"/>';
    g+='<path d="'+d+'" class="sf-line"/>';
    // halves + minute marks (elapsed)
    for(var n=2;n<=G.lastPer;n++){ var sx=x(perStartOf(n)); g+='<line class="sf-half" x1="'+sx+'" x2="'+sx+'" y1="'+top+'" y2="'+(top+ih)+'"/>'; }
    for(var mnt=0; mnt*60<=G.total; mnt+=10) g+='<text class="sf-ax" x="'+x(mnt*60)+'" y="'+(Hh-8)+'" text-anchor="middle">'+(mnt?mnt+'′':'Tip')+'</text>';
    var fin=R.flow[R.flow.length-1][1];
    g+='<circle cx="'+x(G.total)+'" cy="'+y(fin)+'" r="4.5" class="sf-end"/><text class="sf-fin" x="'+(x(G.total)+7)+'" y="'+(y(fin)+4)+'">'+(fin>0?'+':fin<0?'−':'')+Math.abs(fin)+'</text>';
    g+='</svg>';
    // the numbers behind it, as a sheet
    var C=R.C, bx=function(t,k){ return G.T[t].box?(+G.T[t].box[k]||0):0; };
    var rowsT=[['Largest lead',C[A].lead,C[H].lead],['Largest run',C[A].run,C[H].run,function(v){ return v+'–0'; }],['Time leading',C[A].led,C[H].led,function(v){ return mmss(v); }],
      ['sec','Where the points came from'],['In the paint',bx(A,'pointsInPaint'),bx(H,'pointsInPaint')],['Second chance',C[A].second,C[H].second],['Off turnovers',bx(A,'turnoverPoints'),bx(H,'turnoverPoints')],['Fast break',bx(A,'fastBreakPoints'),bx(H,'fastBreakPoints')],['Bench',C[A].bench,C[H].bench]];
    var tb='<div class="sheet-wrap" style="max-height:none;margin-top:10px;"><table class="sheet dense sf-tbl"><thead><tr><th class="l">Control</th><th>'+esc(names.a)+'</th><th>'+esc(names.h)+'</th></tr></thead><tbody>'+
      rowsT.map(function(r){ if(r[0]==='sec') return '<tr data-noheat><td class="l sub" colspan="3">'+r[1]+'</td></tr>'; var f=r[3]||function(v){ return v; };
        return '<tr><td class="l">'+r[0]+'</td><td class="'+(r[1]>r[2]?'c3':'')+'">'+f(r[1])+'</td><td class="'+(r[2]>r[1]?'c3':'')+'">'+f(r[2])+'</td></tr>'; }).join('')+'</tbody></table></div>';
    el.innerHTML='<div class="sf-chart">'+g+'</div>'+tb;
  }

  // ROTATION as a minute grid: one square per minute of the game, filled when he played most of it,
  // blue/orange by whether his team won or lost that minute; then five-man units in one sheet
  function rotationView(el,G,R,tid,names){
    var teams=[G.away,G.home].filter(function(t){ return !G.rotTeams||G.rotTeams.indexOf(t)>=0; });
    if(teams.indexOf(tid)<0) tid=teams[0];
    var P=G.P, sgnT=tid===G.home?1:-1;
    var ids=Object.keys(R.stints).filter(function(id){ return P[id]&&P[id].team===tid; });
    var on=function(id,a,b){ return R.stints[id].reduce(function(s,x){ return s+Math.max(0,Math.min(b,x.e)-Math.max(a,x.s)); },0); };
    var secOf=function(id){ return on(id,0,G.total); }, pmOf=function(id){ return R.stints[id].reduce(function(s,x){ return s+x.pm; },0); };
    ids.sort(function(a,b){ return (P[b].starter-P[a].starter)||(secOf(b)-secOf(a)); });
    var mins=G.total/60, net=[]; for(var k=0;k<mins;k++) net.push((marginAt(R,(k+1)*60)-marginAt(R,k*60))*sgnT);
    var pers=[]; for(var n=1;n<=G.lastPer;n++) pers.push(n);
    var grid=function(id){ return pers.map(function(n){ var a=perStartOf(n)/60, L=perLenOf(n)/60, c='';
      for(var k=a;k<a+L;k++){ var s=on(id,k*60,(k+1)*60), cls=s>=30?(net[k]>0?'p':net[k]<0?'n':'e'):s>0?'h':'';
        c+='<i class="'+cls+'"></i>'; }
      return '<span class="sr-per" style="grid-template-columns:repeat('+L+',1fr)">'+c+'</span>'; }).join(''); };
    var pmCls=function(v){ return v>0?'pos':v<0?'neg':''; };
    var head='<div class="sr-row sr-head"><span>Player</span><span class="sr-mins">'+pers.map(function(n){ return '<span>'+(n===1?'1st half':n===2?'2nd half':'OT'+(n>3?n-2:''))+'</span>'; }).join('')+'</span><span>Min</span><span>+/−</span></div>';
    var body=ids.map(function(id,i){ var pm=pmOf(id), sep=i>0&&P[ids[i-1]].starter&&!P[id].starter?' sr-bench':'';
      var h=G.href?G.href(id):null, nm=esc(initialOf(P[id].name));
      return '<div class="sr-row'+sep+'"><span class="sr-nm">'+(h?'<a href="'+esc(h)+'">'+nm+'</a>':nm)+'</span><span class="sr-mins">'+grid(id)+'</span><span class="sr-n">'+Math.round(secOf(id)/60)+'</span><span class="sr-n b '+pmCls(pm)+'">'+sgn(pm)+'</span></div>'; }).join('');
    var leg='<div class="pj-leg"><span><i class="sr-k p"></i>On, team won the minute</span><span><i class="sr-k n"></i>On, team lost it</span><span><i class="sr-k e"></i>On, even</span><span><i class="sr-k h"></i>Part of it</span></div>';
    // five-man units
    var L=Object.keys(R.LU[tid]).map(function(k){ return R.LU[tid][k]; }).filter(function(x){ return x.ids.length===5&&x.sec>=60; }).sort(function(a,b){ return b.sec-a.sec; }).slice(0,10);
    var sh=function(d){ return d>=6?' c4':d>=2?' c3':d<=-6?' c0':d<=-2?' c1':''; };
    var lu=L.length?'<div class="sf-cap">Five-man units</div><div class="sheet-wrap" style="max-height:none;"><table class="sheet dense sf-lu"><thead><tr><th class="l">Unit</th><th>Min</th><th>Score</th><th>+/−</th><th title="Margin per 40 minutes at this unit’s pace">Per 40</th><th>FG</th><th>3PT</th><th>TO</th></tr></thead><tbody>'+
      L.map(function(x){ var ord=x.ids.slice().sort(function(a,b){ return ids.indexOf(a)-ids.indexOf(b); }), d=x.pf-x.pa, p40=d/(x.sec/2400);
        return '<tr><td class="l sf-unit">'+ord.map(function(id){ return esc(lastWord(P[id]?P[id].name:id)); }).join(' · ')+'</td><td>'+mmss(x.sec)+'</td><td>'+x.pf+'–'+x.pa+'</td><td class="strong'+sh(d)+'">'+sgn(d)+'</td><td class="dim">'+(x.sec>=300?sgn(p40):'—')+'</td><td>'+x.fgm+'-'+x.fga+'</td><td>'+x.tpm+'-'+x.tpa+'</td><td>'+x.tov+'</td></tr>'; }).join('')+'</tbody></table></div>':'';
    var tabs=teams.length>1?'<div class="sr-tabs">'+teams.map(function(t){ return '<button class="'+(t===tid?'on':'')+'" data-t="'+t+'">'+esc(names[t===G.home?'h':'a'])+'</button>'; }).join('')+'</div>':'';
    el.innerHTML=tabs+leg+'<div class="sr-grid">'+head+body+'</div>'+lu;
    el.querySelectorAll('.sr-tabs button').forEach(function(b){ b.onclick=function(){ rotationView(el,G,R,b.getAttribute('data-t'),names); }; });
  }
  if(!document.getElementById('sf-styles')){
    var st=document.createElement('style'); st.id='sf-styles';
    st.textContent=
      ':root{--po-3:#2a78d6;--po-2:#1baf7a;--po-ft:#eda100;--po-e:#a9a8a2;--po-to:#eb6834;--un-p:#2a78d6;--un-n:#eb6834;}'+
      ':root[data-theme="dark"]{--po-3:#3987e5;--po-2:#199e70;--po-ft:#c98500;--po-e:#6c6b66;--po-to:#d95926;--un-p:#3987e5;--un-n:#d95926;}'+
      '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--po-3:#3987e5;--po-2:#199e70;--po-ft:#c98500;--po-e:#6c6b66;--po-to:#d95926;--un-p:#3987e5;--un-n:#d95926;}}'+
      '.po-leg,.pj-leg{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--text2);margin:2px 0 12px;} .po-leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px;}'+
      '.po-row{display:grid;grid-template-columns:190px 1fr;gap:14px;align-items:center;margin:8px 0;} .po-nm b{display:block;font-size:14px;} .po-nm span{font-size:11.5px;color:var(--text3);}'+
      '.po-bar{display:flex;gap:2px;height:30px;} .po-bar i{display:flex;align-items:center;justify-content:center;font-style:normal;font-size:11.5px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;}'+
      '.po-bar i:first-child{border-radius:4px 0 0 4px;} .po-bar i:last-child{border-radius:0 4px 4px 0;}'+
      '.po-sw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:7px;vertical-align:0;} .po-tbl{max-width:620px;}'+
      '.un-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 40px;} @media(max-width:760px){.un-grid{grid-template-columns:1fr;} .po-row{grid-template-columns:1fr;gap:4px;}}'+
      '.un-h{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;border-bottom:1.5px solid var(--text);padding-bottom:5px;margin-bottom:4px;}'+
      '.un-row{display:grid;grid-template-columns:104px 92px 1fr 44px;gap:10px;align-items:center;min-height:34px;border-bottom:1px solid var(--border);font-size:13px;}'+
      '.un-l{font-weight:700;} .un-m{font-variant-numeric:tabular-nums;color:var(--text2);} .un-m em{font-style:normal;color:var(--text3);margin-left:6px;font-size:12px;}'+
      '.un-b{position:relative;height:14px;} .un-b:before{content:"";position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:var(--text3);}'+
      '.un-b i{position:absolute;top:0;height:100%;} .un-b i.p{background:var(--un-p);border-radius:0 4px 4px 0;} .un-b i.n{background:var(--un-n);border-radius:4px 0 0 4px;}'+
      '.un-v{text-align:right;font-weight:800;font-variant-numeric:tabular-nums;}'+
      '.pj-row{display:grid;grid-template-columns:118px 1fr 1fr;gap:12px;align-items:center;min-height:32px;border-bottom:1px solid var(--border);font-size:13px;}'+
      '.pj-head{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;border-bottom:1.5px solid var(--text);min-height:26px;} .pj-head em{font-style:normal;color:var(--text3);font-weight:600;letter-spacing:0;text-transform:none;}'+
      '.pj-nm{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'+
      '.pj-mn{position:relative;height:16px;border-left:1px solid var(--border2);border-right:1px solid var(--border2);} .pj-mn i{position:absolute;top:50%;}'+
      '.pj-ln{height:2px;margin-top:-1px;background:var(--text3);}'+
      '.pj-o,.pj-x{width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;} .pj-mn .pj-o,.pj-leg .pj-o{border:2px solid var(--text2);background:var(--bg);box-sizing:border-box;} .pj-mn .pj-x,.pj-leg .pj-x{background:var(--text);}'+
      '.pj-leg i{display:inline-block;position:static;margin:0 6px 0 0;vertical-align:-1px;width:10px;height:10px;} .pj-leg .pj-p{background:var(--un-p);border-radius:2px;} .pj-leg .pj-n{background:var(--un-n);border-radius:2px;}'+
      '.pj-gs{display:grid;grid-template-columns:1fr 40px;gap:8px;align-items:center;} .pj-gs b{text-align:right;font-variant-numeric:tabular-nums;}'+
      '.sf-chart{margin:4px 0 6px;} .sf-flow{width:100%;height:auto;display:block;} .sf-grid{stroke:var(--border);stroke-width:1;} .sf-grid.z{stroke:var(--text3);stroke-width:1.2;}'+
      '.sf-ax{font-size:11px;fill:var(--text3);font-variant-numeric:tabular-nums;} .sf-side{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;fill:var(--text3);}'+
      '.sf-line{fill:none;stroke:var(--text);stroke-width:2;stroke-linejoin:round;} .sf-half{stroke:var(--text3);stroke-dasharray:3 4;} .sf-end{fill:var(--text);stroke:var(--bg);stroke-width:2;}'+
      '.sf-fin{font-size:12px;font-weight:800;fill:var(--text);font-variant-numeric:tabular-nums;} .sf-run{font-size:11px;font-weight:800;fill:var(--text2);}'+
      '.sf-tbl{max-width:560px;} .sf-tbl td.sub{font-size:10px!important;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);background:var(--bg2)!important;}'+
      '.sf-cap{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin:20px 0 7px;color:var(--text2);} .sf-unit{white-space:normal!important;min-width:240px;font-weight:600;}'+
      '.sr-tabs{display:inline-flex;gap:6px;margin-bottom:10px;} .sr-tabs button{border:1px solid var(--border2);background:none;color:var(--text2);font:700 12px Inter,system-ui,sans-serif;padding:5px 12px;border-radius:999px;cursor:pointer;} .sr-tabs button.on{background:var(--text);color:var(--bg);border-color:var(--text);}'+
      '.sr-grid{display:flex;flex-direction:column;} .sr-row{display:grid;grid-template-columns:130px 1fr 38px 44px;gap:10px;align-items:center;min-height:28px;border-bottom:1px solid var(--border);font-size:13px;}'+
      '.sr-head{font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);border-bottom:1.5px solid var(--text);} .sr-bench{border-top:1.5px solid var(--text3);}'+
      '.sr-nm{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;} .sr-nm a{color:inherit;text-decoration:none;} .sr-n{text-align:right;font-variant-numeric:tabular-nums;} .sr-n.b{font-weight:800;} .sr-n.pos{color:var(--un-p);} .sr-n.neg{color:var(--un-n);}'+
      '.sr-mins{display:flex;gap:8px;} .sr-mins > span{flex:20;} .sr-head .sr-mins > span{text-align:left;}'+
      '.sr-per{display:grid;gap:2px;} .sr-per i{height:14px;border-radius:2px;background:transparent;box-shadow:inset 0 0 0 1px var(--border);} .sr-per i.p{background:var(--un-p);box-shadow:none;} .sr-per i.n{background:var(--un-n);box-shadow:none;} .sr-per i.e{background:var(--text3);box-shadow:none;} .sr-per i.h{background:linear-gradient(transparent 55%,var(--text3) 55%);box-shadow:inset 0 0 0 1px var(--border);}'+
      '.sr-k{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px;} .sr-k.p{background:var(--un-p);} .sr-k.n{background:var(--un-n);} .sr-k.e{background:var(--text3);} .sr-k.h{background:linear-gradient(transparent 55%,var(--text3) 55%);box-shadow:inset 0 0 0 1px var(--border2);}'+
      '@media(max-width:600px){.sr-row{grid-template-columns:78px 1fr 24px 30px;gap:5px;font-size:11.5px;} .sr-mins{gap:4px;} .sr-per{gap:1px;} .sr-per i{height:12px;border-radius:1px;}}'+
      '@media(max-width:480px){.un-row{grid-template-columns:86px 70px 1fr 34px;gap:6px;font-size:12px;} .un-m em{display:none;} .pj-row{grid-template-columns:84px 1fr 1fr;gap:8px;font-size:12px;}}';
    document.head.appendChild(st);
  }

  window.TDC_SCRIMFLOW={load:load,build:build,summary:summary,plusMinus:plusMinus,shotSplit:shotSplit,pretty:pretty,
    possessions:possessions,possessionsHtml:possessionsHtml,flowView:flowView,rotationView:rotationView,runs:runs,units:units,unitsHtml:unitsHtml,loadTrends:loadTrends,projHtml:projHtml};
})();
