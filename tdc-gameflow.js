/* tdc-gameflow.js — Game Flow + Rotation for one game, built from ESPN play-by-play.
   TDC_GAMEFLOW.mount(el, gameId)   fetches the ESPN summary and draws both sections.
   - Game flow: the scoring margin over the whole game as a step chart (the winner above the
     line in its colour, the other team below), largest leads called out, then a mirrored
     panel: shooting, efficiency, lead, box, fouls, points.
   - Rotation: every player's stints on a 40-minute timeline coloured by stint +/-, minutes
     and +/-, then the five-man lineups with minutes, score, +/-, FG, 3PT, REB, AST, TOV.
   Who's on the floor is rebuilt from ESPN's substitution plays: starters open the game, each
   later period opens with the players whose first event in it isn't a sub-in, and a player
   who shows up in a play without a logged sub-in is put on (dropping whoever has been idle
   longest) so lineups stay at five. */
(function(){
  var ESPN='https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=';
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function clockSec(c){ var t=(c&&c.displayValue)||'0:00'; if(t.indexOf(':')<0) return parseFloat(t)||0; var a=t.split(':'); return (+a[0])*60+(parseFloat(a[1])||0); }
  function perStart(n){ return n<=2?(n-1)*1200:2400+(n-3)*300; }
  function perLen(n){ return n<=2?1200:300; }
  function elapsed(p){ var n=(p.period&&p.period.number)||1; return perStart(n)+perLen(n)-clockSec(p.clock); }
  function mmss(s){ s=Math.round(s); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
  function lastName(n){ n=String(n||'').replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i,''); var w=n.split(' '); return w.length>1?w.slice(1).join(' '):n; }
  function shortName(n){ var w=String(n||'').split(' '); return w.length>1?w[0].charAt(0)+'. '+w.slice(1).join(' '):n; }
  function dark(){ var t=document.documentElement.getAttribute('data-theme'); if(t) return t==='dark'; return !!(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches); }
  function rgbOf(h){ h=String(h||'').replace('#',''); if(!/^[0-9a-f]{6}$/i.test(h)) return null; return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
  function lum(c){ return (0.2126*c[0]+0.7152*c[1]+0.0722*c[2])/255; }
  function dist(a,b){ return Math.sqrt(Math.pow(a[0]-b[0],2)+Math.pow(a[1]-b[1],2)+Math.pow(a[2]-b[2],2)); }
  function readable(c){ c=c.slice(); var L=lum(c);
    if(dark()&&L<0.28){ var f=0.45; c=c.map(function(v){return v+(255-v)*f|0;}); }
    if(!dark()&&L>0.78){ c=c.map(function(v){return v*0.55|0;}); }
    return c; }
  function css(c){ return 'rgb('+c.join(',')+')'; }

  // ── parse an ESPN summary into everything both charts need ──
  function parse(d){
    var comp=d.header&&d.header.competitions&&d.header.competitions[0]; if(!comp) return null;
    var T={}, order=[];
    comp.competitors.forEach(function(c){ var t=c.team||{};
      T[t.id]={id:t.id,ha:c.homeAway,name:t.location||t.displayName,abbr:t.abbreviation,logo:(t.logos&&t.logos[0]&&t.logos[0].href)||t.logo,
        color:rgbOf(t.color)||[60,90,140],alt:rgbOf(t.alternateColor),score:+c.score||0,lines:(c.linescores||[]).map(function(l){return l.displayValue;})}; });
    var home=Object.keys(T).filter(function(k){return T[k].ha==='home';})[0], away=Object.keys(T).filter(function(k){return T[k].ha==='away';})[0];
    if(!home||!away) return null;
    // players, starters, team box stats
    var P={};
    ((d.boxscore&&d.boxscore.players)||[]).forEach(function(tp){ var tid=tp.team.id, st=tp.statistics&&tp.statistics[0]; if(!st) return;
      var keys=st.keys||[];
      (st.athletes||[]).forEach(function(a){ if(!a.athlete) return; var s={}; keys.forEach(function(k,i){ s[k]=(a.stats||[])[i]; });
        P[a.athlete.id]={id:a.athlete.id,name:a.athlete.displayName,team:tid,starter:!!a.starter,dnp:!!a.didNotPlay,pts:+s.points||0,min:+s.minutes||0}; }); });
    ((d.boxscore&&d.boxscore.teams)||[]).forEach(function(bt){ var t=T[bt.team.id]; if(!t) return; t.box={};
      (bt.statistics||[]).forEach(function(s){ t.box[s.name]=s.displayValue; }); });
    var plays=(d.plays||[]).slice(); if(plays.length<20) return null;
    var lastPer=Math.max.apply(null,plays.map(function(p){return (p.period&&p.period.number)||1;}));
    var total=perStart(lastPer)+perLen(lastPer);
    return {T:T,home:home,away:away,P:P,plays:plays,lastPer:lastPer,total:total,
      venue:d.gameInfo&&d.gameInfo.venue&&d.gameInfo.venue.fullName, date:comp.date, note:(comp.notes&&comp.notes[0]&&comp.notes[0].headline)||''};
  }

  // ── walk the plays once: margin, on-floor sets, stints, lineups, team counters ──
  function crunch(G){
    var T=G.T, P=G.P, H=G.home, A=G.away, plays=G.plays;
    var teamOf=function(id){ return P[id]&&P[id].team; };
    var on={}; on[H]={}; on[A]={};
    var lastSeen={}, stints={}, open={};
    var LU={}; LU[H]={}; LU[A]={};
    var flow=[[0,0]], prevH=0, prevA=0;
    var C={}; [H,A].forEach(function(t){ C[t]={fgm:0,fga:0,tpm:0,tpa:0,ftm:0,fta:0,oreb:0,dreb:0,ast:0,tov:0,stl:0,blk:0,pf:0,trips:0,and1:0,and1m:0,and1a:0,second:0,run:0,lead:0,led:0,bench:0}; });
    function luKey(t){ return Object.keys(on[t]).sort().join(','); }
    function lu(t){ var k=luKey(t), L=LU[t][k]||(LU[t][k]={ids:Object.keys(on[t]),sec:0,pf:0,pa:0,fgm:0,fga:0,tpm:0,tpa:0,reb:0,ast:0,tov:0}); return L; }
    function enter(id,e){ var t=teamOf(id); if(!t||on[t][id]) return; on[t][id]=1; open[id]={s:e,pf:0,pa:0}; }
    function leave(id,e){ var t=teamOf(id); if(!t||!on[t][id]) return; delete on[t][id]; var o=open[id]; if(o){ (stints[id]=stints[id]||[]).push({s:o.s,e:e,pm:o.pf-o.pa}); delete open[id]; } }
    // period-opening fives
    var byPer={}; plays.forEach(function(p){ var n=(p.period&&p.period.number)||1; (byPer[n]=byPer[n]||[]).push(p); });
    function opening(n, prevOn){
      var first={}; (byPer[n]||[]).forEach(function(p){
        var isSub=p.type&&p.type.text==='Substitution', inn=isSub&&/subbing in/i.test(p.text||'');
        (p.participants||[]).forEach(function(x,i){ var id=x.athlete&&x.athlete.id; if(!id||!P[id]||first[id]) return; if(isSub&&i>0) return; first[id]=isSub?(inn?'in':'out'):'act'; }); });
      var res={}; [H,A].forEach(function(t){
        var s=Object.keys(first).filter(function(id){ return teamOf(id)===t&&first[id]!=='in'; });
        if(s.length<5) Object.keys(prevOn[t]||{}).forEach(function(id){ if(s.length<5&&s.indexOf(id)<0&&first[id]!=='in') s.push(id); });
        res[t]=s.slice(0,5); });
      return res; }
    var startFive={}; [H,A].forEach(function(t){ startFive[t]=Object.keys(P).filter(function(id){ return P[id].team===t&&P[id].starter; }); });
    var curPer=0, lastE=0, runT=null, runN=0, offFlag={}, lastFG={};
    function advance(e){ var dt=e-lastE; if(dt>0){ [H,A].forEach(function(t){ if(Object.keys(on[t]).length) lu(t).sec+=dt; });
      var m=prevH-prevA; if(m>0) C[H].led+=dt; else if(m<0) C[A].led+=dt; } lastE=Math.max(lastE,e); }
    plays.forEach(function(p){
      var n=(p.period&&p.period.number)||1, e=elapsed(p);
      if(n!==curPer){
        var prevOn={}; [H,A].forEach(function(t){ prevOn[t]=Object.assign({},on[t]); });
        if(curPer){ advance(perStart(curPer)+perLen(curPer)); [H,A].forEach(function(t){ Object.keys(on[t]).forEach(function(id){ leave(id,perStart(curPer)+perLen(curPer)); }); }); }
        curPer=n; lastE=perStart(n);
        var five=n===1?{}:opening(n,prevOn);
        if(n===1){ var op=opening(1,{}); [H,A].forEach(function(t){ five[t]=startFive[t].length===5?startFive[t]:op[t]; }); }
        [H,A].forEach(function(t){ five[t].forEach(function(id){ enter(id,perStart(n)); lastSeen[id]=perStart(n); }); });
      }
      advance(e);
      var tt=p.type&&p.type.text||'', tid=p.team&&p.team.id, opp=tid===H?A:H;
      if(tt==='Substitution'){
        var sid=p.participants&&p.participants[0]&&p.participants[0].athlete&&p.participants[0].athlete.id;
        if(sid){ if(/subbing in/i.test(p.text||'')){ var st=teamOf(sid); enter(sid,e); lastSeen[sid]=e;
            if(st&&Object.keys(on[st]).length>5){ var idle=Object.keys(on[st]).filter(function(x){return x!==sid;}).sort(function(a,b){return (lastSeen[a]||0)-(lastSeen[b]||0);})[0]; leave(idle,e); } }
          else leave(sid,e); }
        return; }
      // a player acting without a logged sub-in goes on the floor
      (p.participants||[]).forEach(function(x){ var id=x.athlete&&x.athlete.id, t=teamOf(id); if(!t) return; lastSeen[id]=e;
        if(!on[t][id]){ enter(id,e); if(Object.keys(on[t]).length>5){ var idle=Object.keys(on[t]).filter(function(y){return y!==id;}).sort(function(a,b){return (lastSeen[a]||0)-(lastSeen[b]||0);})[0]; leave(idle,e); } } });
      // scoring
      var hs=+p.homeScore||0, as=+p.awayScore||0, dh=hs-prevH, da=as-prevA;
      if(dh||da){
        [[H,dh,da],[A,da,dh]].forEach(function(r){ var t=r[0];
          Object.keys(on[t]).forEach(function(id){ if(open[id]){ open[id].pf+=r[1]; open[id].pa+=r[2]; } });
          if(Object.keys(on[t]).length){ var L=lu(t); L.pf+=r[1]; L.pa+=r[2]; } });
        var st2=dh>0?H:A, pts=dh>0?dh:da;
        if(runT===st2) runN+=pts; else { runT=st2; runN=pts; }
        if(runN>C[st2].run) C[st2].run=runN;
        if(offFlag[st2]) C[st2].second+=pts;
        prevH=hs; prevA=as; flow.push([e,hs-as]);
        var mg=hs-as; if(mg>C[H].lead) C[H].lead=mg; if(-mg>C[A].lead) C[A].lead=-mg;
      }
      if(!tid||!C[tid]) return;
      var c=C[tid], L=Object.keys(on[tid]).length?lu(tid):null;
      if(p.shootingPlay){
        if(/FreeThrow/i.test(tt)){ c.fta++; if(p.scoringPlay) c.ftm++;
          var sh=p.participants&&p.participants[0]&&p.participants[0].athlete&&p.participants[0].athlete.id, key=tid+'|'+sh+'|'+e;
          if(!c._ft||c._ft!==key){ c.trips++; c._ft=key; c._ftn=0;
            if(lastFG[tid]&&lastFG[tid].k===sh+'|'+e){ c.and1++; c._and=true; } else c._and=false; }
          if(c._and){ c.and1a++; if(p.scoringPlay) c.and1m++; } }
        else { var three=p.pointsAttempted===3||/three point/i.test(p.text||''); c.fga++; if(L) L.fga++; if(three){ c.tpa++; if(L) L.tpa++; }
          if(p.scoringPlay){ c.fgm++; if(L) L.fgm++; if(three){ c.tpm++; if(L) L.tpm++; }
            if(/assist/i.test(p.text||'')){ c.ast++; if(L) L.ast++; }
            var shooter=p.participants&&p.participants[0]&&p.participants[0].athlete&&p.participants[0].athlete.id; lastFG[tid]={k:shooter+'|'+e};
            offFlag[tid]=false; } }
      }
      if(tt==='Offensive Rebound'){ c.oreb++; if(L) L.reb++; offFlag[tid]=true; }
      else if(tt==='Defensive Rebound'){ c.dreb++; if(L) L.reb++; offFlag[opp]=false; }
      else if(/Turnover/i.test(tt)){ c.tov++; if(L) L.tov++; offFlag[tid]=false; }
      else if(tt==='Steal') c.stl++;
      else if(tt==='Block Shot') c.blk++;
      else if(/Foul/i.test(tt)) c.pf++;
    });
    advance(G.total); [H,A].forEach(function(t){ Object.keys(on[t]).forEach(function(id){ leave(id,G.total); }); });
    // bench points from the box
    Object.keys(P).forEach(function(id){ var q=P[id]; if(!q.starter&&C[q.team]) C[q.team].bench+=q.pts; });
    flow.push([G.total,prevH-prevA]);
    return {C:C,flow:flow,stints:stints,LU:LU};
  }

  // ── colours: winner up, loser down; separate them if they're close ──
  function colors(G){
    var H=G.home, A=G.away, up=G.T[H].score>=G.T[A].score?H:A, dn=up===H?A:H;
    var cu=readable(G.T[up].color), cd=readable(G.T[dn].color);
    if(dist(cu,cd)<110){ var alt=G.T[dn].alt&&readable(G.T[dn].alt); if(alt&&dist(cu,alt)>dist(cu,cd)) cd=alt; if(dist(cu,cd)<110) cd=dark()?[240,110,110]:[200,40,60]; }
    return {up:up,dn:dn,cu:cu,cd:cd};
  }
  function logo(t,sz){ return t.logo?'<img class="gf-logo" src="'+esc(t.logo)+'" alt="" width="'+sz+'" height="'+sz+'" loading="lazy">':''; }

  // ── GAME FLOW ──
  function flowSvg(G,R,K,cw){
    var W=Math.max(520,Math.min(1000,cw||1000)), Hh=W<700?300:360, padL=46, padR=14, top=22, bot=34, ih=Hh-top-bot, iw=W-padL-padR;
    var sgn=K.up===G.home?1:-1;
    var maxAbs=10; R.flow.forEach(function(f){ maxAbs=Math.max(maxAbs,Math.abs(f[1])); });
    var Y=Math.ceil(maxAbs/10)*10;
    var x=function(e){ return padL+iw*e/G.total; }, y=function(m){ return top+ih/2-(m*sgn)/Y*(ih/2); };
    var g='<svg class="gf-svg" viewBox="0 0 '+W+' '+Hh+'" role="img" aria-label="Scoring margin through the game">';
    for(var v=-Y; v<=Y; v+=10){ if(!v) continue; g+='<line class="gf-grid" x1="'+padL+'" x2="'+(W-padR)+'" y1="'+y(v*sgn)+'" y2="'+y(v*sgn)+'"/><text class="gf-ax" x="'+(padL-8)+'" y="'+(y(v*sgn)+4)+'" text-anchor="end">'+Math.abs(v)+'</text>'; }
    // step path
    var d='M '+x(0)+' '+y(0), pm=0;
    R.flow.forEach(function(f){ d+=' H '+x(f[0]).toFixed(1)+' V '+y(f[1]).toFixed(1); pm=f[1]; });
    d+=' H '+x(G.total)+' V '+y(0)+' Z';
    var id='gf'+Math.random().toString(36).slice(2,7);
    g+='<defs><clipPath id="'+id+'u"><rect x="0" y="0" width="'+W+'" height="'+y(0)+'"/></clipPath><clipPath id="'+id+'d"><rect x="0" y="'+y(0)+'" width="'+W+'" height="'+(Hh-y(0))+'"/></clipPath></defs>';
    g+='<path d="'+d+'" fill="'+css(K.cu)+'" clip-path="url(#'+id+'u)"/><path d="'+d+'" fill="'+css(K.cd)+'" clip-path="url(#'+id+'d)"/>';
    g+='<line class="gf-zero" x1="'+padL+'" x2="'+(W-padR)+'" y1="'+y(0)+'" y2="'+y(0)+'"/>';
    // period dividers + labels
    for(var n=1;n<=G.lastPer;n++){ var s=perStart(n), e=s+perLen(n);
      if(n>1) g+='<line class="gf-div" x1="'+x(s)+'" x2="'+x(s)+'" y1="'+(top-8)+'" y2="'+(Hh-bot+4)+'"/>';
      g+='<text class="gf-per" x="'+((x(s)+x(e))/2)+'" y="'+(Hh-8)+'" text-anchor="middle">'+(n===1?'1ST HALF':n===2?'2ND HALF':(n===3?'OT':(n-2)+'OT'))+'</text>'; }
    // largest leads
    var callout=function(t,col,sign){ var best=null; R.flow.forEach(function(f){ var m=f[1]*(t===G.home?1:-1); if(m>0&&(!best||m>best[1])) best=[f[0],m]; });
      if(!best) return ''; var bx=x(best[0]), by=y(best[1]*(t===G.home?1:-1)), anchor=bx>W*0.7?'end':'start', tx=bx+(anchor==='end'?-8:8);
      var ty=sign>0?Math.max(top+4,by-10):Math.min(Hh-bot-4,by+20);
      return '<circle cx="'+bx.toFixed(1)+'" cy="'+by.toFixed(1)+'" r="5" fill="'+css(col)+'" stroke="var(--bg,#fff)" stroke-width="1.5"/>'+
        '<text class="gf-call" x="'+tx.toFixed(1)+'" y="'+ty.toFixed(1)+'" text-anchor="'+anchor+'" fill="'+css(col)+'">'+esc(G.T[t].name)+' by '+best[1]+'</text>'; };
    g+=callout(K.up,K.cu,1)+callout(K.dn,K.cd,-1);
    // team marks on the axis
    g+='<text class="gf-tm" x="4" y="'+(top+ih/4)+'" fill="'+css(K.cu)+'">'+esc(G.T[K.up].abbr||'')+'</text><text class="gf-tm" x="4" y="'+(top+ih*3/4+8)+'" fill="'+css(K.cd)+'">'+esc(G.T[K.dn].abbr||'')+'</text>';
    return g+'</svg>';
  }
  function cmpPanel(G,R,K){
    var a=K.up, b=K.dn, ca=R.C[a], cb=R.C[b], ta=G.T[a], tb=G.T[b];
    var pct=function(m,n){ return n?Math.round(m/n*100)+'%':'—'; };
    var poss=function(c,o){ return c.fga-c.oreb+c.tov+0.44*c.fta; };
    var pa=poss(ca,cb), pb=poss(cb,ca), P_=Math.round((pa+pb)/2)||1;
    var efg=function(c){ return c.fga?(c.fgm+0.5*c.tpm)/c.fga:0; };
    var bx=function(t,k){ return t.box?(+t.box[k]||0):0; };
    // [label, left value, right value, numeric left, numeric right, higherIsBetter, left sub, right sub]
    var row=function(lab,va,vb,na,nb,hib,sa,sb){ var aw=na!=null&&nb!=null&&na!==nb?((na>nb)===hib):null;
      return '<div class="gf-r"><span class="gf-s">'+(sa||'')+'</span><b'+(aw===true?' style="color:'+css(K.cu)+'"':'')+'>'+va+'</b><span class="gf-l">'+lab+'</span><b'+(aw===false?' style="color:'+css(K.cd)+'"':'')+'>'+vb+'</b><span class="gf-s">'+(sb||'')+'</span></div>'; };
    var head=function(t){ return '<div class="gf-h"><span></span><span>'+logo(ta,22)+'</span><span>'+t+'</span><span>'+logo(tb,22)+'</span><span></span></div>'; };
    var two=function(c){ return [c.fgm-c.tpm,c.fga-c.tpa]; };
    var a2=two(ca), b2=two(cb);
    var left=head('Shooting')+
      row('Field goals',pct(ca.fgm,ca.fga),pct(cb.fgm,cb.fga),ca.fgm/(ca.fga||1),cb.fgm/(cb.fga||1),true,ca.fgm+'-'+ca.fga,cb.fgm+'-'+cb.fga)+
      row('2-pointers',pct(a2[0],a2[1]),pct(b2[0],b2[1]),a2[0]/(a2[1]||1),b2[0]/(b2[1]||1),true,a2.join('-'),b2.join('-'))+
      row('3-pointers',pct(ca.tpm,ca.tpa),pct(cb.tpm,cb.tpa),ca.tpm/(ca.tpa||1),cb.tpm/(cb.tpa||1),true,ca.tpm+'-'+ca.tpa,cb.tpm+'-'+cb.tpa)+
      row('Free throws',pct(ca.ftm,ca.fta),pct(cb.ftm,cb.fta),ca.ftm/(ca.fta||1),cb.ftm/(cb.fta||1),true,ca.ftm+'-'+ca.fta,cb.ftm+'-'+cb.fta)+
      row('Effective FG%',Math.round(efg(ca)*100)+'%',Math.round(efg(cb)*100)+'%',efg(ca),efg(cb),true)+
      row('FT rate',(ca.fta/(ca.fga||1)).toFixed(2),(cb.fta/(cb.fga||1)).toFixed(2),ca.fta/(ca.fga||1),cb.fta/(cb.fga||1),true)+
      head('Efficiency')+
      row('Possessions',P_,P_,null,null,true)+
      row('Points per possession',(ta.score/P_).toFixed(2),(tb.score/P_).toFixed(2),ta.score,tb.score,true)+
      row('Turnover rate',Math.round(ca.tov/P_*100)+'%',Math.round(cb.tov/P_*100)+'%',ca.tov,cb.tov,false)+
      row('Off. rebound rate',pct(ca.oreb,ca.oreb+cb.dreb),pct(cb.oreb,cb.oreb+ca.dreb),ca.oreb/((ca.oreb+cb.dreb)||1),cb.oreb/((cb.oreb+ca.dreb)||1),true)+
      head('Lead')+
      row('Largest lead',ca.lead,cb.lead,ca.lead,cb.lead,true)+
      row('Largest run',ca.run+'–0',cb.run+'–0',ca.run,cb.run,true)+
      row('Time leading',mmss(ca.led),mmss(cb.led),ca.led,cb.led,true);
    // full-game counts: ESPN's official team box when present (the play text misses some assists)
    var ob=function(c,t){ var o=Object.assign({},c), m={ast:'assists',stl:'steals',blk:'blocks',tov:'totalTurnovers',pf:'fouls',oreb:'offensiveRebounds',dreb:'defensiveRebounds'};
      Object.keys(m).forEach(function(k){ if(t.box&&t.box[m[k]]!=null&&t.box[m[k]]!=='') o[k]=+t.box[m[k]]; }); return o; };
    ca=ob(ca,ta); cb=ob(cb,tb);
    var ra=ca.oreb+ca.dreb, rb=cb.oreb+cb.dreb;
    var right=head('Box')+
      row('Rebounds',ra,rb,ra,rb,true)+row('Offensive',ca.oreb,cb.oreb,ca.oreb,cb.oreb,true)+row('Defensive',ca.dreb,cb.dreb,ca.dreb,cb.dreb,true)+
      row('Assists',ca.ast,cb.ast,ca.ast,cb.ast,true)+row('Turnovers',ca.tov,cb.tov,ca.tov,cb.tov,false)+
      row('Steals',ca.stl,cb.stl,ca.stl,cb.stl,true)+row('Blocks',ca.blk,cb.blk,ca.blk,cb.blk,true)+
      head('Fouls')+
      row('Fouls',ca.pf,cb.pf,ca.pf,cb.pf,false)+row('Free throw trips',ca.trips,cb.trips,ca.trips,cb.trips,true)+
      row('And-ones',ca.and1,cb.and1,ca.and1,cb.and1,true,ca.and1?ca.and1m+'-'+ca.and1a+' FT':'',cb.and1?cb.and1m+'-'+cb.and1a+' FT':'')+
      head('Points')+
      row('In the paint',bx(ta,'pointsInPaint'),bx(tb,'pointsInPaint'),bx(ta,'pointsInPaint'),bx(tb,'pointsInPaint'),true)+
      row('Second chance',ca.second,cb.second,ca.second,cb.second,true)+
      row('Off turnovers',bx(ta,'turnoverPoints'),bx(tb,'turnoverPoints'),bx(ta,'turnoverPoints'),bx(tb,'turnoverPoints'),true)+
      row('Fast break',bx(ta,'fastBreakPoints'),bx(tb,'fastBreakPoints'),bx(ta,'fastBreakPoints'),bx(tb,'fastBreakPoints'),true)+
      row('Bench',ca.bench,cb.bench,ca.bench,cb.bench,true);
    return '<div class="gf-cmp"><div>'+left+'</div><div>'+right+'</div></div>';
  }
  function scoreHead(G,K,title){
    var a=G.T[K.up], b=G.T[K.dn], half=function(i){ return (a.lines[i]!=null&&b.lines[i]!=null)?'<span><i>'+(i===0?'1st':i===1?'2nd':(i===2?'OT':(i-1)+'OT'))+'</i> '+a.lines[i]+'–'+b.lines[i]+'</span>':''; };
    var meta=[G.note,G.venue,G.date?new Date(G.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):''].filter(Boolean).map(esc).join(' / ');
    return '<div class="gf-top"><div><div class="gf-meta">'+meta+'</div><div class="gf-title">'+title+'</div></div>'+
      '<div class="gf-score"><div class="gf-sc">'+logo(a,30)+'<b>'+a.score+'</b><em>–</em><b class="lo">'+b.score+'</b>'+logo(b,30)+'</div><div class="gf-halves">'+a.lines.map(function(_,i){return half(i);}).join('')+'</div></div></div>';
  }
  function renderFlow(el,G,R){
    var K=colors(G);
    el.innerHTML=scoreHead(G,K,'Game flow')+'<div class="gf-chart">'+flowSvg(G,R,K,el.clientWidth)+'</div>'+cmpPanel(G,R,K);
  }

  // ── ROTATION ──
  var PM=['#a8123e','#d81b50','#ec6f8c','#f6bccb','#e6e7ea','#c8daf0','#8db6e3','#4a86c8','#0f56a3'];
  function pmColor(v){ var i=Math.round(Math.max(-10,Math.min(10,v))/2.5)+4; i=Math.max(0,Math.min(8,i)); return PM[i]; }
  function pmText(v){ var i=Math.round(Math.max(-10,Math.min(10,v))/2.5)+4; return (i<=1||i>=7)?'#fff':'#1d1d22'; }
  function signed(v){ return v>0?'+'+v:v<0?'−'+Math.abs(v):'0'; }
  function rotationHtml(G,R,tid){
    var P=G.P, ids=Object.keys(R.stints).filter(function(id){ return P[id]&&P[id].team===tid; });
    var sec=function(id){ return R.stints[id].reduce(function(s,x){return s+(x.e-x.s);},0); };
    var pm=function(id){ return R.stints[id].reduce(function(s,x){return s+x.pm;},0); };
    ids.sort(function(a,b){ return (P[b].starter-P[a].starter)||(sec(b)-sec(a)); });
    var pers=[]; for(var n=1;n<=G.lastPer;n++) pers.push(n);
    var colsTpl=pers.map(function(n){ return perLen(n)+'fr'; }).join(' ');
    var head='<div class="gr-row gr-head"><div class="gr-nm">Player</div><div class="gr-tl" style="grid-template-columns:'+colsTpl+'">'+
      pers.map(function(n){ return '<div class="gr-per"><span>'+(n===1?'1st half':n===2?'2nd half':(n===3?'OT':(n-2)+'OT'))+'</span>'+(n<=2?'<span class="gr-mid">10:00</span>':'')+'</div>'; }).join('')+
      '</div><div class="gr-n">Min</div><div class="gr-n">+/−</div></div>';
    var body=ids.map(function(id,ri){
      var segs=pers.map(function(n){ var s0=perStart(n), L=perLen(n);
        return '<div class="gr-cell">'+R.stints[id].filter(function(x){ return x.s>=s0&&x.s<s0+L; }).map(function(x){
          var l=(x.s-s0)/L*100, w=Math.max(0.6,(x.e-x.s)/L*100), mins=(x.e-x.s)/60;
          return '<i class="gr-bar" style="left:'+l.toFixed(2)+'%;width:'+w.toFixed(2)+'%;background:'+pmColor(x.pm)+';color:'+pmText(x.pm)+'" title="'+esc(P[id].name)+' · '+mmss(x.e-x.s)+' · '+signed(x.pm)+'">'+(mins>=3.2?signed(x.pm):'')+'</i>'; }).join('')+'</div>'; }).join('');
      var p=pm(id), sep=(ri>0&&P[ids[ri-1]].starter&&!P[id].starter)?' gr-sep':'';
      return '<div class="gr-row'+sep+'"><div class="gr-nm"><a href="player.html?espn='+id+'">'+esc(shortName(P[id].name))+'</a></div><div class="gr-tl" style="grid-template-columns:'+colsTpl+'">'+segs+'</div>'+
        '<div class="gr-n">'+Math.round(sec(id)/60)+'</div><div class="gr-n b" style="color:'+(p>0?'var(--gf-pos)':p<0?'var(--gf-neg)':'inherit')+'">'+signed(p)+'</div></div>'; }).join('');
    var legend='<div class="gr-leg"><b>Stint +/−</b><span>−10</span>'+PM.map(function(c){return '<i style="background:'+c+'"></i>';}).join('')+'<span>+10</span></div>';
    // five-man lineups
    var L=Object.keys(R.LU[tid]).map(function(k){ return R.LU[tid][k]; }).filter(function(x){ return x.ids.length===5&&x.sec>=30; })
      .sort(function(a,b){ return b.sec-a.sec; }).slice(0,12);
    var lut='';
    if(L.length){
      var nm=function(id){ return esc(P[id]?lastName(P[id].name):id); };
      lut='<div class="gf-cap">Five-man lineups</div><div class="sheet-wrap"><table class="sheet dense gr-lu"><thead><tr><th class="l" colspan="5">Lineup</th><th>Min</th><th>Score</th><th>+/−</th><th>FG</th><th>3PT</th><th>Reb</th><th>Ast</th><th>Tov</th></tr></thead><tbody>'+
        L.map(function(x){ var ord=x.ids.slice().sort(function(a,b){ return ids.indexOf(a)-ids.indexOf(b); });
          var d=x.pf-x.pa;
          return '<tr>'+ord.map(function(id){ return '<td class="l">'+nm(id)+'</td>'; }).join('')+'<td>'+mmss(x.sec)+'</td><td>'+x.pf+'–'+x.pa+'</td><td class="strong'+(d>=6?' c4':d>=2?' c3':d<=-6?' c0':d<=-2?' c1':'')+'">'+signed(d)+'</td><td>'+x.fgm+'-'+x.fga+'</td><td>'+x.tpm+'-'+x.tpa+'</td><td>'+x.reb+'</td><td>'+x.ast+'</td><td>'+x.tov+'</td></tr>'; }).join('')+
        '</tbody></table></div>';
    }
    return legend+'<div class="gr-grid">'+head+body+'</div>'+lut;
  }
  function renderRotation(el,G,R,tid){
    var K=colors(G); tid=tid||K.up;
    var tabs='<div class="gr-tabs">'+[K.up,K.dn].map(function(t){ return '<button class="'+(t===tid?'on':'')+'" data-t="'+t+'">'+logo(G.T[t],16)+esc(G.T[t].name)+'</button>'; }).join('')+'</div>';
    el.innerHTML=scoreHead(G,K,esc(G.T[tid].name)+'’s rotation')+tabs+rotationHtml(G,R,tid)+
      '<div class="gf-foot">Who was on the floor is rebuilt from ESPN’s substitution log; bars are each stint, coloured by the score margin while he was in.</div>';
    el.querySelectorAll('.gr-tabs button').forEach(function(b){ b.onclick=function(){ renderRotation(el,G,R,b.getAttribute('data-t')); }; });
  }

  var cache={};
  async function load(gid){
    if(cache[gid]) return cache[gid];
    var d=await fetch(ESPN+encodeURIComponent(gid)).then(function(r){ return r.ok?r.json():null; });
    var G=d&&parse(d); if(!G) return null;
    var out={G:G,R:crunch(G)}; cache[gid]=out; return out;
  }
  async function mount(el, gid, opts){
    if(!el||!gid) return false;
    var res=null; try{ res=await load(gid); }catch(e){}
    if(!res){ el.innerHTML=''; el.style.display='none'; return false; }
    el.style.display='';
    el.innerHTML='<section class="gf-card" id="gfFlow"></section><section class="gf-card" id="gfRot"></section>';
    renderFlow(el.querySelector('#gfFlow'),res.G,res.R);
    renderRotation(el.querySelector('#gfRot'),res.G,res.R,opts&&opts.team);
    return true;
  }

  if(!document.getElementById('gf-styles')){
    var st=document.createElement('style'); st.id='gf-styles';
    st.textContent=
      ':root{--gf-pos:#0f56a3;--gf-neg:#c8174a;--gf-rule:#1d1d22;} :root[data-theme="dark"]{--gf-pos:#6ea8ec;--gf-neg:#f2678c;--gf-rule:#e8eaf0;}'+
      '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--gf-pos:#6ea8ec;--gf-neg:#f2678c;--gf-rule:#e8eaf0;}}'+
      '.gf-card{margin:28px 0 8px;font-family:Inter,system-ui,sans-serif;color:var(--text);}'+
      '.gf-top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:2px solid var(--gf-rule);padding-bottom:10px;margin-bottom:14px;flex-wrap:wrap;}'+
      '.gf-meta{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:4px;}'+
      '.gf-title{font-family:"Oswald","Bebas Neue",Impact,"Arial Narrow",sans-serif;font-size:40px;font-weight:800;line-height:1;text-transform:uppercase;letter-spacing:-.01em;font-stretch:condensed;}'+
      '.gf-score{text-align:right;} .gf-sc{display:flex;align-items:center;gap:8px;justify-content:flex-end;} .gf-sc b{font-size:38px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;} .gf-sc b.lo{color:var(--text2);} .gf-sc em{font-style:normal;font-size:26px;color:var(--text3);}'+
      '.gf-halves{display:flex;gap:14px;justify-content:flex-end;font-size:13px;color:var(--text2);margin-top:4px;font-variant-numeric:tabular-nums;} .gf-halves i{font-style:normal;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);}'+
      '.gf-logo{object-fit:contain;vertical-align:middle;}'+
      '.gf-chart{margin:4px 0 18px;} .gf-svg{width:100%;height:auto;display:block;}'+
      '.gf-grid{stroke:var(--text3);stroke-opacity:.45;stroke-dasharray:2 4;} .gf-zero{stroke:var(--gf-rule);stroke-width:1.5;} .gf-div{stroke:var(--gf-rule);stroke-width:1.2;}'+
      '.gf-ax{font-size:13px;fill:var(--text3);font-variant-numeric:tabular-nums;} .gf-per{font-size:13px;font-weight:800;letter-spacing:.06em;fill:var(--text);} .gf-call{font-size:17px;font-weight:800;paint-order:stroke;stroke:var(--bg,#fff);stroke-width:4px;} .gf-tm{font-size:12px;font-weight:900;letter-spacing:.04em;}'+
      '.gf-cmp{display:grid;grid-template-columns:1fr 1fr;gap:10px 40px;} @media(max-width:720px){.gf-cmp{grid-template-columns:1fr;}}'+
      '.gf-h,.gf-r{display:grid;grid-template-columns:62px 64px 1fr 64px 62px;align-items:center;gap:6px;}'+
      '.gf-h{border-bottom:1.5px solid var(--gf-rule);padding:12px 0 5px;margin-bottom:3px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;text-align:center;}'+
      '.gf-r{padding:3px 0;font-size:14px;font-variant-numeric:tabular-nums;} .gf-r b{text-align:center;font-weight:700;} .gf-r .gf-l{text-align:center;color:var(--text2);} .gf-r .gf-s{font-size:12px;color:var(--text3);} .gf-r .gf-s:first-child{text-align:left;} .gf-r .gf-s:last-child{text-align:right;}'+
      '@media(max-width:480px){.gf-h,.gf-r{grid-template-columns:44px 46px 1fr 46px 44px;} .gf-r{font-size:12.5px;} .gf-r .gf-s{font-size:10.5px;} .gf-title{font-size:30px;} .gf-sc b{font-size:28px;}}'+
      '.gf-cap{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin:22px 0 7px;}'+
      '.gf-foot{font-size:11.5px;color:var(--text3);margin-top:10px;line-height:1.5;}'+
      '.gr-tabs{display:inline-flex;gap:4px;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:3px;margin-bottom:12px;} .gr-tabs button{display:inline-flex;align-items:center;gap:6px;border:0;background:none;color:var(--text3);font:700 12px Inter,system-ui,sans-serif;padding:5px 12px;border-radius:5px;cursor:pointer;} .gr-tabs button.on{background:var(--bg);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.15);}'+
      '.gr-leg{display:flex;align-items:center;gap:2px;font-size:12px;color:var(--text2);margin-bottom:10px;flex-wrap:wrap;} .gr-leg b{font-weight:800;letter-spacing:.06em;text-transform:uppercase;font-size:11px;margin-right:10px;color:var(--text);} .gr-leg span{margin:0 6px;} .gr-leg i{width:26px;height:14px;display:inline-block;}'+
      '.gr-grid{display:flex;flex-direction:column;}'+
      '.gr-row{display:grid;grid-template-columns:150px 1fr 44px 48px;align-items:center;gap:10px;border-bottom:1px solid var(--border);min-height:38px;}'+
      '.gr-row.gr-sep{border-top:1.5px solid var(--gf-rule);} .gr-head{border-bottom:1.5px solid var(--gf-rule);min-height:30px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;}'+
      '.gr-nm{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;} .gr-nm a{color:inherit;text-decoration:none;}'+
      '.gr-n{text-align:right;font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;} .gr-n.b{font-weight:800;}'+
      '.gr-tl{display:grid;height:100%;} .gr-cell{position:relative;height:100%;border-left:1.5px solid var(--gf-rule);} .gr-cell:first-child{border-left:0;}'+
      '.gr-per{position:relative;display:flex;justify-content:space-between;padding:0 8px;color:var(--text);border-left:1.5px solid var(--gf-rule);} .gr-per:first-child{border-left:0;} .gr-mid{position:absolute;left:50%;transform:translateX(-50%);color:var(--text3);font-weight:600;}'+
      '.gr-bar{position:absolute;top:7px;bottom:7px;font-style:normal;font-size:11.5px;font-weight:800;display:flex;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap;font-variant-numeric:tabular-nums;}'+
      '@media(max-width:600px){.gr-row{grid-template-columns:86px 1fr 26px 30px;gap:5px;} .gr-nm{font-size:12px;} .gr-n{font-size:12px;} .gr-bar{font-size:0;} .gr-mid{display:none;} .gr-per{padding:0 3px;font-size:9px;}}'+
      '.gr-lu td.l{font-weight:600;}';
    document.head.appendChild(st);
  }
  window.TDC_GAMEFLOW={mount:mount,load:load,parse:parse,crunch:crunch};
})();
