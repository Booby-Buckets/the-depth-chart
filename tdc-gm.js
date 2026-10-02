/* GM Mode (Moneyball) — the "war room front office" (Oct 2026 rebuild).
   Two modes on one screen:
     My program  — start from a real 2026-27 roster + its NIL budget; cut, re-sign, reorder, sign targets.
     Fantasy     — empty roster + a budget; build from every player in the country.
   Team strength comes from the RANKINGS ENGINE itself (TDC_RATINGS.rateRoster — the same per-team
   function the national rankings run), with minutes split from the depth chart you set over the
   coach's real rotation shape (coach_rotation.json). In My program the shown rating is the published
   rating plus the engine's change from the real roster (both rated the same way), so an untouched
   roster reads exactly as the rankings do. Costs are the site's open-market NIL values (tdc-nil.js). */
(function(){
  var POS5=['PG','SG','SF','PF','C'];
  var SPOT={PG:['38%','40%'],SG:['6%','14%'],SF:['70%','14%'],PF:['12%','64%'],C:['60%','64%']};
  var GAMES=32, FANTASY_BUDGET=20, MAX_ROSTER=15;
  var S={mode:'program', team:null, budget:null, roster:[], cut:[], hist:[], tpos:'need', tmax:'', tq:'', tlimit:20, goal:25};
  var RATE=null, WINS=null, TCURVE=null;   // Moneyball's going rate ($M per win) + per-player projected wins, passed in by the page
  var GOALS=[[4,'Final Four contender (top 4)'],[10,'Top 10'],[25,'Top 25'],[45,'NCAA tournament (top 45)'],[75,'Bubble (top 75)']];
  var D=null, NIL={}, ROT={}, POOL=[], BYTEAM={}, BASE=null, host=null, projWins=null, ready=false;
  var INIT=new URLSearchParams(location.search);   // captured at load: the page rewrites the URL when it switches tabs

  function esc(s){ return (''+(s==null?'':s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function fM(m){ if(m==null||!isFinite(m)) return '—'; var a=Math.abs(m); return (m<0?'-':'')+(a>=1?'$'+a.toFixed(2)+'M':'$'+Math.round(a*1000)+'K'); }
  function sgn(x,d){ return (x>0?'+':x<0?'−':'±')+Math.abs(x).toFixed(d==null?1:d); }
  function hc(g){ return g>=90?'c4':g>=84?'c3':g>=76?'c2':g>=68?'c1':'c0'; }
  function pos5(p){ var N=window.TDC_NIL; return (N&&N.POS5)?N.POS5(p||''):'SF'; }
  function nk(team,name){ return (team||'')+'|'+((name||'').toLowerCase().trim()); }

  // ── data ────────────────────────────────────────────────────────────────
  function load(){
    var R=window.TDC_RATINGS, N=window.TDC_NIL;
    var waits=['pedigreeReady','defenseReady','adjustReady','injuryReady','programsReady'].map(function(k){ return (N&&N[k])?N[k].catch(function(){}):null; });
    return Promise.all([R.prepare(), R.get(),
      fetch('nil-data.json?v=gradesync15').then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
      fetch('scripts/data/coach_rotation.json?v=1').then(function(r){return r.ok?r.json():null;}).catch(function(){return null;})].concat(waits))
    .then(function(a){
      D=a[1]; ROT=a[3]||{}; var nd=a[2]||{teams:{}};
      Object.keys(nd.teams||{}).forEach(function(t){ (nd.teams[t].players||[]).forEach(function(p){ NIL[nk(t,p.name)]=p; }); NIL['__budget__'+t]=nd.teams[t].budget; });
      R.rosterTeams().forEach(function(t){
        BYTEAM[t]=R.rosterOf(t).slice().sort(function(a,b){ var x=+a.depth_order||99, y=+b.depth_order||99; return x-y; }).map(function(row){ return mk(row,t); });
        BYTEAM[t].forEach(function(p){ POOL.push(p); });
      });
      ready=true;
    });
  }
  function mk(row,team){
    var n=NIL[nk(team,row.name)], N=window.TDC_NIL;
    var ovr=(n&&n.grade!=null)?+n.grade:(row.tdc_grade!=null?+row.tdc_grade:null);
    var cost=(n&&N&&N.neutralValueOf)?N.neutralValueOf(n):0.4;
    return {key:nk(team,row.name), name:row.name, team:team, row:row, pos:pos5((n&&n.pos)||row.position||''), cls:(row.yr||row.class_year||'').replace(/\./g,''),
      ovr:ovr, cost:isFinite(cost)?cost:0.4};
  }

  // ── engine ──────────────────────────────────────────────────────────────
  function shape(){ var r=(S.mode==='program'&&ROT[S.team])||ROT._natl; return (r&&r.slots)||[31.6,29.1,26.7,24,21.3,18.1,14.9,11.7,8.7,6]; }
  function minutesFor(n){
    var sh=shape(), m=[]; for(var i=0;i<n;i++) m.push(i<sh.length?sh[i]:(i<12?1:0));
    var tot=m.reduce(function(a,b){return a+b;},0)||1, k=200/tot;
    m=m.map(function(x){ return Math.min(38,x*k); });
    return m;
  }
  function rate(list){
    var R=window.TDC_RATINGS, team=S.mode==='program'?S.team:'Fantasy';
    var rows=list.map(function(p,i){ return Object.assign({},p.row,{team:team, depth_order:i+1}); });
    // a real season needs a 10-man rotation: empty rotation spots are played by REPLACEMENT-level
    // bodies (a 70-grade walk-on, no stat line), so a thin roster can't hand its starters 38 minutes
    // and rate like a contender — and every real bench signing beats the replacement it displaces.
    for(var k=rows.length;k<10;k++) rows.push({name:'Replacement '+(k+1), team:team, depth_order:k+1, tdc_grade:70, yr:'Sr.', mpg:0, ppg:0, espn_id:null});
    var mins=minutesFor(rows.length);
    return R.rateRoster(team, rows, S.mode==='program'?{minutes:mins, baseMw:BASE?BASE.mw:null}:{minutes:mins, noProgram:true});
  }
  function pubOf(team){ var t=(D&&D.teams||[]).find(function(x){return x.team===team;}); return t?t.rating:null; }
  // displayed rating: published + the engine's change from the real roster (My program); raw (fantasy)
  function shown(list){
    if(S.mode==='fantasy'){ if(list.length<5) return null; return rate(list).rating; }
    var r=rate(list), pub=pubOf(S.team); if(pub==null||!BASE) return r.rating;
    return pub+(r.rating-BASE.rating);
  }
  function rankOf(rt){ if(rt==null) return null; var me=S.mode==='program'?S.team:null;
    return 1+(D.teams||[]).filter(function(t){ return t.team!==me&&t.rating>rt; }).length; }
  function winsOf(rt){ return rt==null?null:Math.round(projWins(rt)); }

  // ── roster helpers ──────────────────────────────────────────────────────
  function spots(list){   // assign the first five to the five spots, by listed position then nearest open
    var out={}, st=list.slice(0,5);
    st.forEach(function(p){ if(!out[p.pos]) out[p.pos]=p; else p._spill=true; });
    st.forEach(function(p){ if(!p._spill) return; delete p._spill;
      var i=POS5.indexOf(p.pos), best=null, bd=9; POS5.forEach(function(s,j){ if(!out[s]&&Math.abs(j-i)<bd){ bd=Math.abs(j-i); best=s; } });
      if(best) out[best]=p; });
    return out;
  }
  function weakest(list){ var sp=spots(list), w=null;
    POS5.forEach(function(s){ var p=sp[s]; var v=p?p.ovr:-1; if(w==null||v<w.v) w={pos:s,v:v,p:p}; }); return w; }
  function insertSigning(list,p){   // a better player at his spot starts; otherwise he joins the bench by OVR
    var L=list.slice(), sp=spots(L), cur=sp[p.pos];
    if(!cur || (p.ovr||0)>(cur.ovr||0)){
      if(cur){ var at=L.indexOf(cur); L[at]=p; L.splice(Math.min(5,L.length),0,cur); }   // he takes the spot; the old starter is the 6th man
      else L.splice(Math.min(L.length,4),0,p);                                            // an open spot: he joins the five (5th starter → 6th)
      return L; }
    var at2=5; while(at2<L.length && (L[at2].ovr||0)>=(p.ovr||0)) at2++; L.splice(at2,0,p); return L;
  }
  function winsSum(list){ if(!WINS) return null; return list.reduce(function(a,p){ var w=WINS(p.key); return a+(w!=null&&w>0?w:0); },0); }
  // goal = finish inside the top N: the rating the Nth team carries is the bar (excluding this program)
  function goalRow(rt,rk){
    var g=GOALS.find(function(x){return x[0]===S.goal;})||GOALS[2], me=S.mode==='program'?S.team:null;
    var field=(D.teams||[]).filter(function(t){ return t.team!==me&&t.rating!=null; }).map(function(t){return t.rating;}).sort(function(a,b){return b-a;});
    var bar=field[g[0]-1];
    if(rt==null) return {lbl:g[1], v:'—', cls:'', note:'add at least 5 players'};
    if(rk!=null&&rk<=g[0]) return {lbl:g[1], v:'On track', cls:'c4', note:'#'+rk+' clears the top '+g[0]+(bar!=null?(' by '+(rt-bar).toFixed(1)):'')};
    return {lbl:g[1], v:'Short', cls:'c1', note:'need '+(bar!=null?('+'+(bar-rt+0.05).toFixed(1)+' rating'):'more')+' to reach #'+g[0]};
  }
  function spend(list){ return list.reduce(function(a,p){ return a+(p.cost||0); },0); }
  function push(){ S.hist.push({roster:S.roster.slice(), cut:S.cut.slice()}); if(S.hist.length>60) S.hist.shift(); }

  // ── render ──────────────────────────────────────────────────────────────
  function render(){
    if(!host) return;
    if(!ready){ host.innerHTML='<div class="loading">Loading the ratings engine and every roster…</div>'; return; }
    var teams=Object.keys(BYTEAM).filter(function(t){ return BYTEAM[t].length>=5; }).sort();
    var rt=shown(S.roster), rk=rankOf(rt), w=winsOf(rt), cost=spend(S.roster), budget=S.budget||0;
    var pub=S.mode==='program'?pubOf(S.team):null, pubRk=S.mode==='program'?rankOf(pub):null, pubW=S.mode==='program'?winsOf(pub):null;
    var wk=weakest(S.roster);
    var dRt=(pub!=null&&rt!=null)?rt-pub:null;
    var over=cost-budget;
    var summary=[
      ['Projected rank', rk?('#'+rk):'—', rk?hc(100-rk/1.2):'', S.mode==='program'&&pubRk?((rk<pubRk?'<span class="up">▲'+(pubRk-rk)+'</span> ':rk>pubRk?'<span class="dn">▼'+(rk-pubRk)+'</span> ':'')+'was #'+pubRk):'of '+((D.teams||[]).length)],
      ['Power rating', rt!=null?sgn(rt):'—', rt!=null?hc(60+rt*1.4):'', dRt!=null?((Math.abs(dRt)>=0.05?'<span class="'+(dRt>0?'up':'dn')+'">'+sgn(dRt)+'</span> ':'')+'vs real roster'):(rt!=null?'points better than an average D-I team':'add at least 5 players')],
      ['Projected record', w!=null?(w+'–'+Math.max(0,GAMES-w)):'—','', pubW!=null?('was '+pubW+'–'+Math.max(0,GAMES-pubW)):'over a '+GAMES+'-game season'],
      ['Roster cost', fM(cost), over>0?'c1':'', 'budget '+fM(budget)],
      [over>0?'Over budget':'Room left', fM(Math.abs(over)), '', over>0?'<span class="dn">cut or trade down to fit</span>':(MAX_ROSTER-S.roster.length)+' roster spots open'],
      (function(){ if(!(w>0)) return ['Cost per win','—','','']; var cpw=cost/w, typ=(TCURVE&&rt!=null)?TCURVE(rt)/w:null;
        return ['Cost per win', fM(cpw), typ?(cpw<=typ?'c3':cpw>typ*1.25?'c1':'c2'):'', 'roster cost ÷ '+w+' projected wins'+(typ?(' · rosters this good: '+fM(typ)):'')]; })(),
      (function(){ if(!TCURVE||rt==null) return null; var ex=TCURVE(rt), v=ex-cost;
        return ['Rosters this good cost', fM(ex), v>=0?'c3':(v<-ex*0.25?'c1':'c2'), (v>=0?'you pay '+fM(v)+' less':'you pay '+fM(-v)+' more')+' than the market']; })(),
      (function(){ var g=goalRow(rt,rk); return ['Goal: '+g.lbl, g.v, g.cls, g.note]; })(),
      ['Weakest spot', wk&&wk.p?wk.pos:(wk?wk.pos:'—'), wk&&wk.p?hc(wk.v):'c0', wk&&wk.p?(esc(wk.p.name)+' · '+wk.v+' OVR'):'empty'],
      ['Roster', S.roster.length+' / '+MAX_ROSTER, '', S.cut.length?(S.cut.length+' cut'):'']
    ];
    host.innerHTML=
      '<div class="gm-bar">'+
        '<div class="gm-mode" role="group" aria-label="Mode"><button type="button" data-m="program" class="'+(S.mode==='program'?'on':'')+'">My program</button><button type="button" data-m="fantasy" class="'+(S.mode==='fantasy'?'on':'')+'">Fantasy build</button></div>'+
        (S.mode==='program'?'<label class="gm-lab">Program <select id="gmTeam" class="gm-sel">'+teams.map(function(t){ return '<option'+(t===S.team?' selected':'')+'>'+esc(t)+'</option>'; }).join('')+'</select></label>':'')+
        '<label class="gm-lab">Goal <select id="gmGoal" class="gm-sel">'+GOALS.map(function(g){ return '<option value="'+g[0]+'"'+(S.goal===g[0]?' selected':'')+'>'+g[1]+'</option>'; }).join('')+'</select></label>'+
        '<label class="gm-lab">Budget $<input id="gmBudget" class="gm-num" type="number" min="0" step="0.5" value="'+(+budget).toFixed(1)+'">M</label>'+
        (S.mode==='fantasy'?'<button type="button" class="gm-btn add" id="gmAuto">Auto-fill to budget</button>':'')+
        '<button type="button" class="gm-btn" id="gmUndo"'+(S.hist.length?'':' disabled')+'>Undo</button>'+
        '<button type="button" class="gm-btn" id="gmReset">'+(S.mode==='program'?'Reset to real roster':'Clear roster')+'</button>'+
      '</div>'+
      '<div class="gm-top">'+
        '<div class="gm-court" aria-label="Starting five">'+courtHTML()+'</div>'+
        '<div><div class="gm-h">Summary <em>'+(S.mode==='program'?'live · vs real roster':'live')+'</em></div>'+
          '<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense gm-sum"><tbody>'+summary.filter(Boolean).map(function(r){ return '<tr><td class="l nm">'+r[0]+'</td><td class="strong '+r[2]+'">'+r[1]+'</td><td class="l dim">'+r[3]+'</td></tr>'; }).join('')+'</tbody></table></div></div>'+
      '</div>'+
      '<div class="gm-bot">'+
        '<div><div class="gm-h">Your roster <em>top five start · use the arrows to change the depth chart</em></div>'+rosterHTML()+'</div>'+
        '<div><div class="gm-h">Targets <em id="gmTgtNote"></em></div>'+
          '<div class="gm-filt">'+
            '<select id="gmTPos" class="gm-sel"><option value="need"'+(S.tpos==='need'?' selected':'')+'>Need: '+(wk?wk.pos:'any')+'</option><option value="all"'+(S.tpos==='all'?' selected':'')+'>All positions</option>'+POS5.map(function(p){ return '<option value="'+p+'"'+(S.tpos===p?' selected':'')+'>'+p+'</option>'; }).join('')+'</select>'+
            '<select id="gmTMax" class="gm-sel"><option value="">Any price</option>'+[1,2,3,5].map(function(v){ return '<option value="'+v+'"'+(+S.tmax===v?' selected':'')+'>Under $'+v+'M</option>'; }).join('')+'<option value="room"'+(S.tmax==='room'?' selected':'')+'>Fits my budget</option></select>'+
            '<input id="gmTQ" class="gm-q" placeholder="Search a player or school…" value="'+esc(S.tq)+'" autocomplete="off" aria-label="Search targets">'+
          '</div><div id="gmTargets"><div class="loading">Scoring targets…</div></div></div>'+
      '</div>'+
      '<div class="disclaimer" style="margin-top:14px">Team strength is scored by the same engine as the national rankings: each player\'s projected impact weighted by minutes, with minutes split from your depth chart over '+(S.mode==='program'?esc(S.team)+'\'s coach\'s real rotation':'a typical D-I rotation')+'. '+(S.mode==='program'?'The rating starts from the published ranking and moves by what your changes do. ':'')+'Costs are open-market NIL values, not actual contracts.</div>';
    wire();
    setTimeout(renderTargets,0);
  }
  function courtHTML(){
    var sp=spots(S.roster), wk=weakest(S.roster);
    return POS5.map(function(s){ var p=sp[s], need=!p||(wk&&wk.pos===s&&(p.ovr||0)<80);
      return '<div class="gm-spot'+(need?' need':'')+(p&&p._new?' new':'')+'" style="left:'+SPOT[s][0]+';top:'+SPOT[s][1]+'">'+
        '<div class="p">'+s+(need?' · NEED':'')+(p&&p._new?' · SIGNED':'')+'</div>'+
        (p?'<div class="nm">'+esc(p.name)+'</div><div class="m">'+esc(p.cls||'')+(p.team!==S.team?' · from '+esc(p.team):'')+'</div><div class="g">'+(p.ovr!=null?p.ovr:'—')+'</div>'
          :'<div class="nm" style="color:var(--text3)">Open</div><div class="m">sign a '+s+'</div>')+'</div>'; }).join('');
  }
  function rosterHTML(){
    var mins=minutesFor(S.roster.length), sp=spots(S.roster), slotOf={}; POS5.forEach(function(s){ if(sp[s]) slotOf[sp[s].key]=s; });
    var rows=S.roster.map(function(p,i){
      var slot=i<5?(slotOf[p.key]||'Start'):(i+1)+(i===5?'th':i===6?'th':'th');
      return '<tr'+(p._new?' class="gm-new"':'')+'><td class="l dim">'+slot+'</td><td class="l nm">'+esc(p.name)+(p._new?' <span class="gm-tag n">Signed</span>':'')+'</td><td class="l dim">'+p.pos+'</td><td class="l dim">'+esc(p.cls||'')+'</td>'+
        '<td class="'+(p.ovr!=null?hc(p.ovr):'')+'">'+(p.ovr!=null?p.ovr:'—')+'</td><td>'+Math.round(mins[i])+'</td><td>'+fM(p.cost)+'</td>'+
        '<td class="gm-act"><button type="button" class="gm-ic" data-up="'+i+'" aria-label="Move '+esc(p.name)+' up"'+(i===0?' disabled':'')+'>↑</button><button type="button" class="gm-ic" data-dn="'+i+'" aria-label="Move '+esc(p.name)+' down"'+(i===S.roster.length-1?' disabled':'')+'>↓</button><button type="button" class="gm-btn sm cut" data-cut="'+i+'">Cut</button></td></tr>'; }).join('');
    var cuts=S.cut.map(function(p,i){ return '<tr class="gm-cut"><td class="l dim">—</td><td class="l nm">'+esc(p.name)+' <span class="gm-tag c">Cut</span></td><td class="l dim">'+p.pos+'</td><td class="l dim">'+esc(p.cls||'')+'</td><td>'+(p.ovr!=null?p.ovr:'—')+'</td><td>0</td><td>'+fM(p.cost)+'</td><td class="gm-act"><button type="button" class="gm-btn sm" data-resign="'+i+'">Re-sign</button></td></tr>'; }).join('');
    if(!rows&&!cuts) return '<div class="gm-empty">No one signed yet. Add players from Targets.</div>';
    return '<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense gm-ros"><thead><tr><th class="l">Slot</th><th class="l">Player</th><th class="l">Pos</th><th class="l">Yr</th><th>OVR</th><th>Proj MPG</th><th>Cost</th><th></th></tr></thead><tbody>'+rows+cuts+'</tbody></table></div>';
  }
  function renderTargets(){
    var el=document.getElementById('gmTargets'); if(!el) return;
    var on={}; S.roster.concat(S.cut).forEach(function(p){ on[p.key]=1; });
    var wk=weakest(S.roster), pos=S.tpos==='need'?(wk?wk.pos:null):(S.tpos==='all'?null:S.tpos);
    var room=(S.budget||0)-spend(S.roster), max=S.tmax==='room'?room:(S.tmax?+S.tmax:null), q=S.tq.trim().toLowerCase();
    var cand=POOL.filter(function(p){ return !on[p.key] && (S.mode!=='program'||p.team!==S.team) && p.ovr!=null && p.ovr>=60 &&
      (!pos||p.pos===pos) && (max==null||p.cost<=max) && (!q||p.name.toLowerCase().indexOf(q)>=0||p.team.toLowerCase().indexOf(q)>=0); });
    cand.sort(function(a,b){ return (b.ovr-a.ovr)||(a.cost-b.cost); });
    cand=cand.slice(0,q?40:Math.max(40,S.tlimit*2));
    var cur=shown(S.roster);
    var scored=cand.map(function(p){ var after=shown(insertSigning(S.roster,Object.assign({},p))); return {p:p, d:(after!=null&&cur!=null)?after-cur:(after!=null?after:null), after:after}; });
    var rated=cur!=null;
    if(rated) scored.sort(function(a,b){ return (b.d==null?-99:b.d)-(a.d==null?-99:a.d); });
    else scored.sort(function(a,b){ return (b.p.ovr-a.p.ovr)||(a.p.cost-b.p.cost); });
    var note=document.getElementById('gmTgtNote'); if(note) note.textContent=rated?((pos?('best fits at '+pos):'best fits')+' · ranked by what they add'):'sign five players to see what each one adds';
    var shownList=scored.slice(0,S.tlimit);
    if(!shownList.length){ el.innerHTML='<div class="gm-empty">No players match these filters.</div>'; return; }
    el.innerHTML='<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense gm-tgt"><thead><tr><th class="l">Player</th><th class="l">From</th><th class="l">Pos</th><th>OVR</th><th>Cost</th>'+(WINS?'<th title="projected 2026-27 wins added">Wins</th>':'')+'<th title="change in power rating if signed">Adds</th><th>Rank after</th><th></th></tr></thead><tbody>'+
      shownList.map(function(x){ var p=x.p, ra=x.after!=null?rankOf(x.after):null;
        return '<tr><td class="l nm"><a href="player.html?espn='+encodeURIComponent(p.row.espn_id||'')+'&team='+encodeURIComponent(p.team)+'">'+esc(p.name)+'</a></td><td class="l dim">'+esc(p.team)+'</td><td class="l dim">'+p.pos+'</td>'+
          '<td class="'+hc(p.ovr)+'">'+p.ovr+'</td><td>'+fM(p.cost)+'</td>'+(WINS?'<td class="dim">'+((WINS(p.key)!=null)?WINS(p.key).toFixed(1):'—')+'</td>':'')+'<td class="'+(x.d==null?'':x.d>=1.5?'c4':x.d>=0.8?'c3':x.d>=0.3?'c2':x.d>0?'c1':'c0')+'">'+(x.d==null?'—':(rated?sgn(x.d):'= '+sgn(x.after)))+'</td><td class="dim">'+(ra?'#'+ra:'—')+'</td>'+
          '<td><button type="button" class="gm-btn sm add" data-sign="'+esc(p.key)+'"'+(S.roster.length>=MAX_ROSTER?' disabled title="Roster full"':'')+'>Sign</button></td></tr>'; }).join('')+
      '</tbody></table></div>'+(scored.length>shownList.length?'<button type="button" class="gm-btn" id="gmMore" style="margin-top:10px">Show more</button>':'');
    el.querySelectorAll('[data-sign]').forEach(function(b){ b.addEventListener('click',function(){ var p=POOL.find(function(x){return x.key===b.dataset.sign;}); if(!p) return;
      push(); var q=Object.assign({},p,{_new:true}); S.roster=insertSigning(S.roster,q); render(); }); });
    var mb=document.getElementById('gmMore'); if(mb) mb.addEventListener('click',function(){ S.tlimit+=20; renderTargets(); });
  }
  function wire(){
    host.querySelectorAll('.gm-mode button').forEach(function(b){ b.addEventListener('click',function(){ if(S.mode===b.dataset.m) return; setMode(b.dataset.m); }); });
    var t=document.getElementById('gmTeam'); if(t) t.addEventListener('change',function(){ setTeam(t.value); });
    var gg=document.getElementById('gmGoal'); if(gg) gg.addEventListener('change',function(){ S.goal=+gg.value; render(); });
    var bu=document.getElementById('gmBudget'); if(bu) bu.addEventListener('change',function(){ S.budget=Math.max(0,+bu.value||0); render(); });
    var au=document.getElementById('gmAuto'); if(au) au.addEventListener('click',function(){ au.disabled=true; au.textContent='Filling…'; setTimeout(autoFill,20); });
    document.getElementById('gmUndo').addEventListener('click',function(){ var h=S.hist.pop(); if(!h) return; S.roster=h.roster; S.cut=h.cut; render(); });
    document.getElementById('gmReset').addEventListener('click',function(){ push(); if(S.mode==='program') setTeam(S.team,true); else { S.roster=[]; S.cut=[]; render(); } });
    host.querySelectorAll('[data-up]').forEach(function(b){ b.addEventListener('click',function(){ var i=+b.dataset.up; if(i<1) return; push(); var L=S.roster; var x=L[i]; L[i]=L[i-1]; L[i-1]=x; render(); }); });
    host.querySelectorAll('[data-dn]').forEach(function(b){ b.addEventListener('click',function(){ var i=+b.dataset.dn, L=S.roster; if(i>=L.length-1) return; push(); var x=L[i]; L[i]=L[i+1]; L[i+1]=x; render(); }); });
    host.querySelectorAll('[data-cut]').forEach(function(b){ b.addEventListener('click',function(){ push(); var p=S.roster.splice(+b.dataset.cut,1)[0]; if(p&&!p._new) S.cut.push(p); render(); }); });
    host.querySelectorAll('[data-resign]').forEach(function(b){ b.addEventListener('click',function(){ push(); var p=S.cut.splice(+b.dataset.resign,1)[0]; if(p) S.roster.push(p); render(); }); });
    var tp=document.getElementById('gmTPos'); if(tp) tp.addEventListener('change',function(){ S.tpos=tp.value; S.tlimit=20; renderTargets(); });
    var tm=document.getElementById('gmTMax'); if(tm) tm.addEventListener('change',function(){ S.tmax=tm.value; S.tlimit=20; renderTargets(); });
    var tq=document.getElementById('gmTQ'); if(tq){ var deb; tq.addEventListener('input',function(){ clearTimeout(deb); deb=setTimeout(function(){ S.tq=tq.value; S.tlimit=20; renderTargets(); },220); }); }
  }
  // FANTASY AUTO-FILL: fill to 13 within the budget. Starting five first (best OVR at each open spot,
  // keeping enough budget for the rest at ~$0.4M a head), then the bench greedily by rating added per $.
  function autoFill(){
    push();
    var MIN_COST=0.4, target=13, on={};
    S.roster.forEach(function(p){ on[p.key]=1; });
    var room=function(){ return (S.budget||0)-spend(S.roster); };
    var guard=0;
    while(S.roster.length<target && guard++<40){
      var left=target-S.roster.length, cap=room()-MIN_COST*(left-1); if(cap<MIN_COST*0.5) break;
      var sp=spots(S.roster), open=POS5.filter(function(x){ return !sp[x]; });
      var pick=null;
      if(S.roster.length<5){
        var share=(room()-MIN_COST*(target-5))/Math.max(1,5-S.roster.length)*1.25;   // the five split what's left after reserving the bench
        var c=POOL.filter(function(p){ return !on[p.key] && p.ovr!=null && open.indexOf(p.pos)>=0 && p.cost<=Math.min(cap,share); })
          .sort(function(a,b){ return (b.ovr-a.ovr)||(a.cost-b.cost); });
        pick=c[0]||null;
      } else {
        var cur=shown(S.roster);
        var c2=POOL.filter(function(p){ return !on[p.key] && p.ovr!=null && p.ovr>=66 && p.cost<=cap; })
          .sort(function(a,b){ return (b.ovr-a.ovr)||(a.cost-b.cost); }).slice(0,70);
        var best=null;
        c2.forEach(function(p){ var a=shown(insertSigning(S.roster,Object.assign({},p))); if(a==null||cur==null) return;
          var val=(a-cur)/Math.max(0.25,p.cost); if(!best||val>best.v) best={p:p,v:val}; });
        pick=best?best.p:null;
      }
      if(!pick) break;
      on[pick.key]=1; S.roster=insertSigning(S.roster,Object.assign({},pick,{_new:true}));
    }
    render();
  }
  function setMode(m){
    S.mode=m; S.hist=[]; S.cut=[]; S.tlimit=20;
    if(m==='fantasy'){ S.roster=[]; S.budget=FANTASY_BUDGET; BASE=null; render(); }
    else setTeam(S.team||defaultTeam(),true);
    try{ var sp=new URLSearchParams(location.search); sp.set('gm',m); if(m==='program'&&S.team) sp.set('team',S.team); else sp.delete('team'); history.replaceState(null,'',location.pathname+'?'+sp.toString()); }catch(e){}
  }
  function setTeam(t,keepHist){
    if(!BYTEAM[t]) t=defaultTeam();
    S.team=t; S.roster=BYTEAM[t].map(function(p){ return Object.assign({},p); }); S.cut=[]; if(!keepHist) S.hist=[];
    S.budget=NIL['__budget__'+t]||S.budget||FANTASY_BUDGET;
    BASE=null; BASE=rate(S.roster);   // the real roster, rated the GM way (its change vs itself is 0)
    try{ localStorage.setItem('tdc_coach_team',t); }catch(e){}
    try{ var sp=new URLSearchParams(location.search); sp.set('team',t); history.replaceState(null,'',location.pathname+'?'+sp.toString()); }catch(e){}
    render();
  }
  function defaultTeam(){
    var q=INIT.get('team'), mine=null; try{ mine=localStorage.getItem('tdc_coach_team'); }catch(e){}
    var ok=function(x){ return x&&BYTEAM[x]&&BYTEAM[x].length>=5; };
    if(ok(q)) return q; if(ok(mine)) return mine;
    var top=(D.teams||[]).find(function(x){ return ok(x.team); }); return top?top.team:Object.keys(BYTEAM)[0];
  }

  window.TDC_GM={
    boot:function(el, opts){
      host=el; RATE=(opts&&opts.rate)||null; TCURVE=(opts&&opts.teamCurve)||null; WINS=(opts&&opts.winsOf)||null; projWins=(opts&&opts.projWins)||function(r){ return Math.max(4,Math.min(35,15.91+0.548*r)); };
      render();
      load().then(function(){
        var m=INIT.get('gm');
        if(m==='fantasy') setMode('fantasy'); else setTeam(defaultTeam());
      }).catch(function(e){ host.innerHTML='<div class="loading">GM Mode could not load ('+esc(e&&e.message||e)+').</div>'; });
    }
  };
})();
