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
  var GAMES=32, FANTASY_BUDGET=20, MAX_ROSTER=15;
  var S={mode:'program', team:null, budget:null, roster:[], cut:[], hist:[], tpos:'all', tmax:'', tq:'', tlimit:20, goal:25, tsort:'surplus'};
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
      fetch('nil-data.json?v=gradesync18').then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
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
    // q = the PRODUCTION key every roster decision uses (who starts, who the auto-fill and target list rank first):
    // his NIL basis (last season · career · projected line, all stats — patch_nil_grades.py), else per-40
    // production quality. The OVR is shown, never used (owner rule, Oct 2026).
    var q=(n&&n.ng!=null&&isFinite(+n.ng))?+n.ng:null;
    if(q==null){ try{ if(window.TDCProjGrade&&TDCProjGrade.statQual) q=TDCProjGrade.statQual(Object.assign({},row,{team:team})); }catch(e){} }
    return {key:nk(team,row.name), name:row.name, team:team, row:row, pos:pos5((n&&n.pos)||row.position||''), cls:(row.yr||row.class_year||'').replace(/\./g,''),
      ovr:ovr, q:(q!=null&&isFinite(q))?Math.round(q):null, cost:isFinite(cost)?cost:0.4};
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
    // bodies (a replacement-level walk-on, no stat line — tdc-ratings REPL_BPM), so a thin roster can't hand its starters 38 minutes
    // and rate like a contender — and every real bench signing beats the replacement it displaces.
    for(var k=rows.length;k<10;k++) rows.push({name:'Replacement '+(k+1), team:team, depth_order:k+1, yr:'Sr.', mpg:0, ppg:0, espn_id:null, _repl:true});
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
    POS5.forEach(function(s){ var p=sp[s]; var v=p?(p.q!=null?p.q:-1):-1; if(w==null||v<w.v) w={pos:s,v:v,p:p}; }); return w; }
  function insertSigning(list,p){   // a more productive player at his spot starts; otherwise he joins the bench by production (q)
    var L=list.slice(), sp=spots(L), cur=sp[p.pos];
    if(!cur || (p.q||0)>(cur.q||0)){
      if(cur){ var at=L.indexOf(cur); L[at]=p; L.splice(Math.min(5,L.length),0,cur); }   // he takes the spot; the old starter is the 6th man
      else L.splice(Math.min(L.length,4),0,p);                                            // an open spot: he joins the five (5th starter → 6th)
      return L; }
    var at2=5; while(at2<L.length && (L[at2].q||0)>=(p.q||0)) at2++; L.splice(at2,0,p); return L;
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

  // ── Moneyball math (Oct 2026) ───────────────────────────────────────────
  // PRICE OF A RATING POINT at this level: what the market charges for one more point of power rating, from the
  // league's roster-cost curve (TCURVE, $M by rating) — the slope where this roster sits.
  // PRICE OF A RATING POINT: what D-I programs pay, per point of rating ABOVE a roster of replacement-level players —
  // every program's real roster rated by the engine, and the same program with replacements in every slot; the median of
  // roster cost ÷ (rating − replacement rating). One league price, so player → roster → league surplus all add up.
  var PRICE=null, PRICE_N=0;
  function replOf(p,i){ return {key:'repl'+i, name:'Replacement', team:p?p.team:'', pos:p?p.pos:'SF', cls:'', cost:0, q:0,
    row:{name:'Replacement '+(i+1), yr:'Sr.', mpg:0, ppg:0, espn_id:null, _repl:true}}; }
  function computePrice(){
    var R=window.TDC_RATINGS, xs=[];
    Object.keys(BYTEAM).forEach(function(t){ var L=BYTEAM[t]; if(L.length<8) return;
      try{ var n=Math.max(10,L.length), mins=minutesFor(n);
        var rows=L.map(function(p,i){ return Object.assign({},p.row,{team:t,depth_order:i+1}); }); for(var k=rows.length;k<10;k++) rows.push({name:'Replacement '+(k+1),team:t,depth_order:k+1,yr:'Sr.',mpg:0,ppg:0,espn_id:null,_repl:true});
        var real=R.rateRoster(t, rows, {minutes:mins});
        var reps=rows.map(function(r,i){ return {name:'Replacement '+(i+1),team:t,depth_order:i+1,yr:'Sr.',mpg:0,ppg:0,espn_id:null,_repl:true}; });
        var r0=R.rateRoster(t, reps, {minutes:mins, baseMw:real.mw});
        var above=real.rating-r0.rating, cost=L.reduce(function(a,p){ return a+(p.cost||0); },0);
        if(above>2&&cost>0) xs.push(cost/above); }catch(e){} });
    xs.sort(function(a,b){return a-b;}); PRICE_N=xs.length; PRICE=xs.length?xs[Math.floor(xs.length/2)]:null;
  }
  function ppt(){ return PRICE; }
  // what each player is WORTH: the rating this roster loses if a replacement-level player takes his slot and minutes
  function worthAll(list){ var cur=shown(list); if(cur==null) return list.map(function(){ return null; });
    return list.map(function(p,i){ var L=list.slice(); L[i]=replOf(p,i); var w=shown(L); return w==null?null:cur-w; }); }
  function mi(p){ var e=p&&p.row&&p.row.espn_id; return (MI&&e!=null&&MI[String(e)]!=null)?MI[String(e)]:null; }
  var MI=null;
  function loadMI(){ return fetch('data/market_index_2026.json?v=1').then(function(r){ return r.ok?r.json():null; }).then(function(d){ MI=(d&&d.players)||{}; }).catch(function(){ MI={}; }); }

  // ── render ──────────────────────────────────────────────────────────────
  function render(){
    if(!host) return;
    if(!ready){ host.innerHTML='<div class="loading">Loading the ratings engine and every roster…</div>'; return; }
    var teams=Object.keys(BYTEAM).filter(function(t){ return BYTEAM[t].length>=5; }).sort();
    var rt=shown(S.roster), rk=rankOf(rt), w=winsOf(rt), cost=spend(S.roster), budget=S.budget||0;
    var pub=S.mode==='program'?pubOf(S.team):null, pubRk=S.mode==='program'?rankOf(pub):null;
    var dRt=(pub!=null&&rt!=null)?rt-pub:null, over=cost-budget, P=ppt(rt);
    var W=worthAll(S.roster); S._worth=W;
    var surplus=S.roster.reduce(function(a,p,i){ return a+((W[i]!=null&&P!=null)?W[i]*P-p.cost:0); },0);
    var g=goalRow(rt,rk);
    var cell=function(v,l,s,cls){ return '<div class="cell"><div class="v'+(cls?' '+cls:'')+'">'+v+'</div><div class="l">'+l+'</div>'+(s?'<div class="s">'+s+'</div>':'')+'</div>'; };
    host.innerHTML=
      '<div class="gm-bar">'+
        '<div class="gm-mode" role="group" aria-label="Mode"><button type="button" data-m="program" class="'+(S.mode==='program'?'on':'')+'">My program</button><button type="button" data-m="fantasy" class="'+(S.mode==='fantasy'?'on':'')+'">Fantasy build</button></div>'+
        (S.mode==='program'?'<label class="gm-lab">Program <select id="gmTeam" class="gm-sel">'+teams.map(function(t){ return '<option'+(t===S.team?' selected':'')+'>'+esc(t)+'</option>'; }).join('')+'</select></label>':'')+
        '<label class="gm-lab">Goal <select id="gmGoal" class="gm-sel">'+GOALS.map(function(x){ return '<option value="'+x[0]+'"'+(S.goal===x[0]?' selected':'')+'>'+x[1]+'</option>'; }).join('')+'</select></label>'+
        '<label class="gm-lab">Budget $<input id="gmBudget" class="gm-num" type="number" min="0" step="0.5" value="'+(+budget).toFixed(1)+'">M</label>'+
        (S.mode==='fantasy'?'<button type="button" class="gm-btn add" id="gmAuto">Auto-fill to budget</button>':'')+
        '<button type="button" class="gm-btn" id="gmUndo"'+(S.hist.length?'':' disabled')+'>Undo</button>'+
        '<button type="button" class="gm-btn" id="gmReset">'+(S.mode==='program'?'Reset to real roster':'Clear roster')+'</button>'+
      '</div>'+
      '<div class="mb-band" style="--n:6">'+
        cell(rk?'#'+rk:'—','Projected rank', S.mode==='program'&&pubRk?('was #'+pubRk):'of '+((D.teams||[]).length))+
        cell(rt!=null?sgn(rt):'—','Power rating', dRt!=null&&Math.abs(dRt)>=0.05?(sgn(dRt)+' vs real roster'):(w!=null?(w+'–'+Math.max(0,GAMES-w)+' projected'):'sign five players'))+
        cell(fM(cost),'Roster cost', over>0?('<span class="dn">'+fM(over)+' over budget</span>'):(fM(-over)+' room · budget '+fM(budget)))+
        cell(P!=null?fM(P):'—','Price of a rating point','D-I median per point above replacement · '+PRICE_N+' programs')+
        cell(P!=null?(surplus>=0?'+':'')+fM(surplus):'—','Roster surplus','what your players are worth at that price, minus what they cost', P!=null?(surplus>=0?'up':'dn'):'')+
        cell(g.v,'Goal: '+g.lbl, g.note, g.cls==='c4'?'up':g.cls==='c1'?'dn':'')+
      '</div>'+
      '<div class="gm-h">Roster value <em>what each player is worth: the rating you lose if a replacement-level player takes his minutes, priced at the league rate · top five start, arrows set the depth chart</em></div>'+rosterHTML(W,P)+
      '<div class="gm-h">Path to the goal <em>the cheapest signings that reach it, and the cuts that free the most money for the least rating</em></div>'+
      '<div id="gmPath"><button type="button" class="gm-btn add" id="gmPathBtn">Find the cheapest path</button></div>'+
      '<div class="gm-h">Targets <em id="gmTgtNote"></em></div>'+
        '<div class="gm-filt">'+
          '<select id="gmTSort" class="gm-sel"><option value="surplus"'+(S.tsort==='surplus'?' selected':'')+'>Best value</option><option value="per"'+(S.tsort==='per'?' selected':'')+'>Rating per $1M</option><option value="adds"'+(S.tsort==='adds'?' selected':'')+'>Most rating added</option><option value="mi"'+(S.tsort==='mi'?' selected':'')+'>Market blind spot</option></select>'+
          '<select id="gmTPos" class="gm-sel"><option value="all"'+(S.tpos==='all'||S.tpos==='need'?' selected':'')+'>All positions</option>'+POS5.map(function(p){ return '<option value="'+p+'"'+(S.tpos===p?' selected':'')+'>'+p+'</option>'; }).join('')+'</select>'+
          '<select id="gmTMax" class="gm-sel"><option value="">Any price</option>'+[1,2,3,5].map(function(v){ return '<option value="'+v+'"'+(+S.tmax===v?' selected':'')+'>Under $'+v+'M</option>'; }).join('')+'<option value="room"'+(S.tmax==='room'?' selected':'')+'>Fits my budget</option></select>'+
          '<input id="gmTQ" class="gm-q" placeholder="Search a player or school…" value="'+esc(S.tq)+'" autocomplete="off" aria-label="Search targets">'+
        '</div><div id="gmFrontier"></div><div id="gmTargets"><div class="loading">Scoring targets…</div></div>'+
      '<div class="disclaimer" style="margin-top:14px">Rating comes from the national rankings engine with minutes from your depth chart over '+(S.mode==='program'?esc(S.team)+'\'s coach\'s real rotation':'a typical D-I rotation')+'. Costs are open-market NIL values, not actual contracts. The price of a rating point is the D-I median of roster cost per point of rating above a roster of replacement-level players. Market blind spot is a D-I percentile from the transfer study: high = steals, assists, blocks and offensive rebounding the market underpays; low = minutes, height and turnovers it overpays.</div>';
    wire();
    setTimeout(renderTargets,0);
  }
  function heat(v,a,b){ if(v==null) return ''; return v>=b?'c4':v>=a?'c3':v>=0?'c2':v>=-a?'c1':'c0'; }
  function rosterHTML(W,P){
    var mins=minutesFor(S.roster.length);
    var rows=S.roster.map(function(p,i){
      var slot=i<5?'Starter':(i+1)+'th', wv=W[i], sur=(wv!=null&&P!=null)?wv*P-p.cost:null, per=(wv!=null&&wv>0.05)?p.cost/wv:null, m=mi(p);
      return '<tr'+(p._new?' class="gm-new"':'')+'><td class="l dim">'+slot+'</td><td class="l nm">'+esc(p.name)+(p._new?' <span class="gm-tag n">Signed</span>':'')+(S.mode==='program'&&p.team!==S.team?' <span class="dim">from '+esc(p.team)+'</span>':'')+'</td><td class="l dim">'+p.pos+'</td><td class="l dim">'+esc(p.cls||'')+'</td>'+
        '<td>'+Math.round(mins[i])+'</td><td>'+fM(p.cost)+'</td>'+
        '<td class="strong '+heat(wv,0.8,1.6)+'">'+(wv==null?'—':sgn(wv))+'</td>'+
        '<td class="dim">'+(per==null?'—':fM(per))+'</td>'+
        '<td class="strong '+(sur==null?'':sur>=0.5?'c4':sur>=0?'c3':sur>=-0.5?'c1':'c0')+'">'+(sur==null?'—':(sur>=0?'+':'')+fM(sur))+'</td>'+
        '<td class="'+(m==null?'':m>=80?'c4':m>=60?'c3':m>=40?'c2':m>=20?'c1':'c0')+'">'+(m==null?'—':m)+'</td>'+
        '<td class="gm-act"><button type="button" class="gm-ic" data-up="'+i+'" aria-label="Move '+esc(p.name)+' up"'+(i===0?' disabled':'')+'>↑</button><button type="button" class="gm-ic" data-dn="'+i+'" aria-label="Move '+esc(p.name)+' down"'+(i===S.roster.length-1?' disabled':'')+'>↓</button><button type="button" class="gm-btn sm cut" data-cut="'+i+'">Cut</button></td></tr>'; }).join('');
    var cuts=S.cut.map(function(p,i){ return '<tr class="gm-cut"><td class="l dim">—</td><td class="l nm">'+esc(p.name)+' <span class="gm-tag c">Cut</span></td><td class="l dim">'+p.pos+'</td><td class="l dim">'+esc(p.cls||'')+'</td><td>0</td><td>'+fM(p.cost)+'</td><td></td><td></td><td></td><td>'+(mi(p)==null?'—':mi(p))+'</td><td class="gm-act"><button type="button" class="gm-btn sm" data-resign="'+i+'">Re-sign</button></td></tr>'; }).join('');
    if(!rows&&!cuts) return '<div class="gm-empty">No one signed yet. Add players from Targets.</div>';
    return '<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense gm-ros"><thead><tr><th class="l">Slot</th><th class="l">Player</th><th class="l">Pos</th><th class="l">Yr</th><th>MPG</th><th>Cost</th><th title="Power rating this roster loses if a replacement-level player takes his slot and minutes">Worth</th><th title="Cost per rating point he is worth">$ / point</th><th title="Worth × the league price of a rating point, minus his cost">Surplus</th><th title="Market blind spot, D-I percentile (transfer study)">Blind spot</th><th></th></tr></thead><tbody>'+rows+cuts+'</tbody></table></div>';
  }
  function candidates(){
    var on={}; S.roster.concat(S.cut).forEach(function(p){ on[p.key]=1; });
    var pos=(S.tpos==='all'||S.tpos==='need')?null:S.tpos;
    var room=(S.budget||0)-spend(S.roster), max=S.tmax==='room'?room:(S.tmax?+S.tmax:null), q=S.tq.trim().toLowerCase();
    var cand=POOL.filter(function(p){ return !on[p.key] && (S.mode!=='program'||p.team!==S.team) && p.q!=null && p.q>=60 &&
      (!pos||p.pos===pos) && (max==null||p.cost<=max) && (!q||p.name.toLowerCase().indexOf(q)>=0||p.team.toLowerCase().indexOf(q)>=0); });
    cand.sort(function(a,b){ return (b.q-a.q)||(a.cost-b.cost); });
    return cand.slice(0,q?40:90);
  }
  function score(list, cur, P){ return list.map(function(p){ var after=shown(insertSigning(S.roster,Object.assign({},p))); var d=(after!=null&&cur!=null)?after-cur:null;
    return {p:p, d:d, after:after, per:(d!=null&&p.cost>0)?d/p.cost:null, sur:(d!=null&&P!=null)?d*P-p.cost:null, mi:mi(p)}; }); }
  function renderTargets(){
    var el=document.getElementById('gmTargets'); if(!el) return;
    var cur=shown(S.roster), P=ppt(cur), rated=cur!=null;
    var scored=score(candidates(), cur, P);
    var key={surplus:'sur',per:'per',adds:'d',mi:'mi'}[S.tsort]||'sur';
    if(rated) scored.sort(function(a,b){ return (b[key]==null?-1e9:b[key])-(a[key]==null?-1e9:a[key]); });
    var note=document.getElementById('gmTgtNote'); if(note) note.textContent=rated?'what each one adds to this roster, what it costs, and its value at the league price of a rating point':'sign five players to see what each one adds';
    frontier(scored.filter(function(x){ return x.d!=null; }));
    var list=scored.slice(0,S.tlimit);
    if(!list.length){ el.innerHTML='<div class="gm-empty">No players match these filters.</div>'; return; }
    el.innerHTML='<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense gm-tgt"><thead><tr><th class="l">Player</th><th class="l">From</th><th class="l">Pos</th><th>Cost</th><th title="Change in power rating if signed">Adds</th><th title="Rating added per $1M">Per $1M</th><th title="Rating added × the league price of a rating point, minus his cost">Value</th><th title="Market blind spot, D-I percentile">Blind spot</th><th>Rank after</th><th></th></tr></thead><tbody>'+
      list.map(function(x){ var p=x.p, ra=x.after!=null?rankOf(x.after):null;
        return '<tr><td class="l nm"><a href="player.html?espn='+encodeURIComponent(p.row.espn_id||'')+'&team='+encodeURIComponent(p.team)+'">'+esc(p.name)+'</a></td><td class="l dim">'+esc(p.team)+'</td><td class="l dim">'+p.pos+'</td><td>'+fM(p.cost)+'</td>'+
          '<td class="strong '+heat(x.d,0.8,1.6)+'">'+(x.d==null?'—':sgn(x.d))+'</td><td class="dim">'+(x.per==null?'—':x.per.toFixed(2))+'</td>'+
          '<td class="strong '+(x.sur==null?'':x.sur>=0.5?'c4':x.sur>=0?'c3':x.sur>=-0.5?'c1':'c0')+'">'+(x.sur==null?'—':(x.sur>=0?'+':'')+fM(x.sur))+'</td>'+
          '<td class="'+(x.mi==null?'':x.mi>=80?'c4':x.mi>=60?'c3':x.mi>=40?'c2':x.mi>=20?'c1':'c0')+'">'+(x.mi==null?'—':x.mi)+'</td><td class="dim">'+(ra?'#'+ra:'—')+'</td>'+
          '<td><button type="button" class="gm-btn sm add" data-sign="'+esc(p.key)+'"'+(S.roster.length>=MAX_ROSTER?' disabled title="Roster full"':'')+'>Sign</button></td></tr>'; }).join('')+
      '</tbody></table></div>'+(scored.length>list.length?'<button type="button" class="gm-btn" id="gmMore" style="margin-top:10px">Show more</button>':'');
    el.querySelectorAll('[data-sign]').forEach(function(b){ b.addEventListener('click',function(){ sign(b.dataset.sign); }); });
    var mb=document.getElementById('gmMore'); if(mb) mb.addEventListener('click',function(){ S.tlimit+=20; renderTargets(); });
  }
  function sign(key){ var p=POOL.find(function(x){return x.key===key;}); if(!p) return; push(); S.roster=insertSigning(S.roster,Object.assign({},p,{_new:true})); render(); }
  // cost vs rating added for every scored target; the efficient frontier (most rating at or below each price) is joined
  function frontier(xs){
    var el=document.getElementById('gmFrontier'); if(!el) return;
    if(xs.length<4){ el.innerHTML=''; return; }
    var Wd=760, Hd=250, L=46, R=14, T=20, B=34;
    var xmax=Math.max.apply(null,xs.map(function(x){return x.p.cost;}))*1.05, ymin=Math.min(0,Math.min.apply(null,xs.map(function(x){return x.d;}))), ymax=Math.max(0.5,Math.max.apply(null,xs.map(function(x){return x.d;})))*1.1;
    var X=function(v){ return L+(Wd-L-R)*v/xmax; }, Y=function(v){ return T+(Hd-T-B)*(1-(v-ymin)/(ymax-ymin)); };
    var srt=xs.slice().sort(function(a,b){ return a.p.cost-b.p.cost; }), best=-1e9, F=[];
    best=0.05; srt.forEach(function(x){ if(x.d>best+0.01){ best=x.d; F.push(x); } });   // only signings that add rating
    var onF={}; F.forEach(function(x){ onF[x.p.key]=1; });
    var ticks=[], step=xmax>6?2:xmax>3?1:0.5; for(var t=0;t<=xmax;t+=step) ticks.push(t);
    var yt=[], ys=(ymax-ymin)>4?1:0.5; for(var u=Math.ceil(ymin/ys)*ys;u<=ymax;u+=ys) yt.push(+u.toFixed(2));
    var svg='<svg viewBox="0 0 '+Wd+' '+Hd+'" width="100%" role="img" aria-label="Cost versus rating added for every target">'+
      yt.map(function(v){ return '<line x1="'+L+'" x2="'+(Wd-R)+'" y1="'+Y(v)+'" y2="'+Y(v)+'" stroke="var(--border)" stroke-width="'+(v===0?1.5:1)+'"/><text x="'+(L-6)+'" y="'+(Y(v)+4)+'" text-anchor="end" font-size="10.5" fill="var(--text3)">'+(v>0?'+':'')+v+'</text>'; }).join('')+
      ticks.map(function(v){ return '<text x="'+X(v)+'" y="'+(Hd-B+16)+'" text-anchor="middle" font-size="10.5" fill="var(--text3)">$'+v+'M</text>'; }).join('')+
      '<text x="'+(Wd-R)+'" y="'+(Hd-4)+'" text-anchor="end" font-size="10.5" fill="var(--text3)">cost →</text><text x="'+(L+4)+'" y="'+(T+2)+'" font-size="10.5" fill="var(--text3)">↑ rating added</text>'+
      '<polyline fill="none" stroke="var(--mi-win,#B07D17)" stroke-width="2" points="'+F.map(function(x){ return X(x.p.cost)+','+Y(x.d); }).join(' ')+'"/>'+
      xs.map(function(x){ var f=onF[x.p.key]; return '<circle cx="'+X(x.p.cost)+'" cy="'+Y(x.d)+'" r="'+(f?5.5:4)+'" fill="'+(f?'var(--mi-win,#B07D17)':'var(--text3)')+'" fill-opacity="'+(f?1:0.45)+'" stroke="var(--bg2)" stroke-width="1.5" style="cursor:pointer" data-k="'+esc(x.p.key)+'"><title>'+esc(x.p.name)+' · '+esc(x.p.team)+' · '+fM(x.p.cost)+' · '+sgn(x.d,2)+' rating</title></circle>'; }).join('')+
      (function(){ var out='', lastX=-99, lastY=-99; F.slice().reverse().forEach(function(x){ var px=X(x.p.cost), py=Y(x.d);
        if(Math.abs(px-lastX)<70&&Math.abs(py-lastY)<16) return; lastX=px; lastY=py;
        out+='<text x="'+(px+7)+'" y="'+(py-8)+'" font-size="10.5" font-weight="700" fill="var(--text2)">'+esc(x.p.name.split(' ').slice(-1)[0])+'</text>'; }); return out; })()+
      '</svg>';
    el.innerHTML='<div style="border:1px solid var(--border);border-radius:13px;background:var(--bg2);padding:10px 12px;margin:4px 0 12px;"><div style="font-size:11px;color:var(--text3);margin-bottom:4px"><b style="color:var(--text2)">The frontier</b> — gold line: the most rating any target adds at or below each price. Click a dot to sign him.</div>'+svg+'</div>';
    el.querySelectorAll('circle[data-k]').forEach(function(c){ c.addEventListener('click',function(){ sign(c.getAttribute('data-k')); }); });
  }
  // CHEAPEST PATH: greedy by rating added per $ until the goal's bar is cleared, the budget runs out or 5 moves;
  // plus the cuts that free the most money per rating point lost
  function findPath(){
    var el=document.getElementById('gmPath'); if(!el) return;
    var g=GOALS.find(function(x){return x[0]===S.goal;})||GOALS[2], me=S.mode==='program'?S.team:null;
    var field=(D.teams||[]).filter(function(t){ return t.team!==me&&t.rating!=null; }).map(function(t){return t.rating;}).sort(function(a,b){return b-a;});
    var bar=field[g[0]-1], start=shown(S.roster);
    if(start==null){ el.innerHTML='<div class="gm-empty">Sign at least five players first.</div>'; return; }
    var save={roster:S.roster.slice(), tmax:S.tmax, tpos:S.tpos, tq:S.tq}; S.tmax=''; S.tpos='all'; S.tq='';
    // 1 · dead money first: players outside the rotation (worth < 0.1) are cut to free budget
    var W0=S._worth||worthAll(S.roster), idle=S.roster.filter(function(p,i){ return W0[i]!=null&&W0[i]<0.1&&p.cost>0; });
    var run=function(limit){
      S.roster=save.roster.filter(function(p){ return idle.indexOf(p)<0; });
      var moves=[], room=(S.budget||0)-spend(S.roster), cur=shown(S.roster), guard=0;
      while(cur<bar && guard++<5 && S.roster.length<MAX_ROSTER){
        var sc=score(candidates(), cur, null).filter(function(x){ return x.d!=null&&x.d>0.05&&(!limit||x.p.cost<=room); });
        if(!sc.length) break;
        sc.sort(function(a,b){ return (b.d/Math.max(0.15,b.p.cost))-(a.d/Math.max(0.15,a.p.cost)); });
        var pk=sc[0]; S.roster=insertSigning(S.roster,Object.assign({},pk.p,{_new:true})); room-=pk.p.cost; cur=pk.after; moves.push(pk);
      }
      return {moves:moves, cur:cur, roster:S.roster.slice(), room:room};
    };
    var res=run(true), stretched=false;
    if(res.cur<bar){ var r2=run(false); if(r2.moves.length&&r2.cur>res.cur){ res=r2; stretched=true; } }
    S.roster=save.roster; S.tmax=save.tmax; S.tpos=save.tpos; S.tq=save.tq;
    var reached=res.cur>=bar, addCost=res.moves.reduce(function(a,x){return a+x.p.cost;},0), freed=idle.reduce(function(a,p){return a+p.cost;},0);
    var head='<div class="mb-band" style="--n:4"><div class="cell"><div class="v">'+(bar!=null?sgn(bar):'—')+'</div><div class="l">Rating the goal needs</div><div class="s">'+esc(g[1])+' · now '+sgn(start)+'</div></div>'+
      '<div class="cell"><div class="v '+(reached?'up':'dn')+'">'+sgn(res.cur)+'</div><div class="l">After these moves</div><div class="s">'+(reached?'goal reached':'short by '+(bar-res.cur).toFixed(1))+'</div></div>'+
      '<div class="cell"><div class="v">'+fM(addCost)+'</div><div class="l">Signings</div><div class="s">'+res.moves.length+' player'+(res.moves.length===1?'':'s')+(freed>0?' · '+fM(freed)+' freed by cuts':'')+'</div></div>'+
      '<div class="cell"><div class="v '+(res.room>=0?'up':'dn')+'">'+fM(Math.abs(res.room))+'</div><div class="l">'+(res.room>=0?'Budget left':'Over budget')+'</div><div class="s">'+(stretched?'the budget alone could not get there':'after every move')+'</div></div></div>';
    var rowsC=idle.map(function(p){ return '<tr><td class="rk">—</td><td class="l"><span class="gm-tag c">Cut</span></td><td class="l nm">'+esc(p.name)+'</td><td class="l dim">'+p.pos+'</td><td>−'+fM(p.cost)+'</td><td class="dim">not in the rotation</td><td></td><td>'+(mi(p)==null?'—':mi(p))+'</td></tr>'; }).join('');
    var rowsS=res.moves.map(function(x,i){ return '<tr><td class="rk">'+(i+1)+'</td><td class="l"><span class="gm-tag n">Sign</span></td><td class="l nm">'+esc(x.p.name)+' <span class="dim">'+esc(x.p.team)+'</span></td><td class="l dim">'+x.p.pos+'</td><td>'+fM(x.p.cost)+'</td><td class="strong">'+sgn(x.d)+'</td><td>'+sgn(x.after)+'</td><td>'+(x.mi==null?'—':x.mi)+'</td></tr>'; }).join('');
    var tbl=(rowsC||rowsS)?'<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="rk">#</th><th class="l">Move</th><th class="l">Player</th><th class="l">Pos</th><th>Cost</th><th>Adds</th><th>Rating after</th><th>Blind spot</th></tr></thead><tbody>'+rowsC+rowsS+'</tbody></table></div>'+
      (res.moves.length||idle.length?'<button type="button" class="gm-btn add" id="gmApply" style="margin-top:8px">Make these moves</button>':'')
      :'<div class="gm-empty">'+(start>=bar?'Already on track for this goal.':'No signing moves the rating.')+'</div>';
    el.innerHTML=head+tbl;
    var ap=document.getElementById('gmApply'); if(ap) ap.addEventListener('click',function(){ push(); idle.forEach(function(p){ if(!p._new) S.cut.push(p); }); S.roster=res.roster; render(); });
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
    var ts=document.getElementById('gmTSort'); if(ts) ts.addEventListener('change',function(){ S.tsort=ts.value; S.tlimit=20; renderTargets(); });
    var pb=document.getElementById('gmPathBtn'); if(pb) pb.addEventListener('click',function(){ pb.disabled=true; pb.textContent='Searching…'; setTimeout(findPath,20); });
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
        var c=POOL.filter(function(p){ return !on[p.key] && p.q!=null && open.indexOf(p.pos)>=0 && p.cost<=Math.min(cap,share); })
          .sort(function(a,b){ return (b.q-a.q)||(a.cost-b.cost); });
        pick=c[0]||null;
      } else {
        var cur=shown(S.roster);
        var c2=POOL.filter(function(p){ return !on[p.key] && p.q!=null && p.q>=66 && p.cost<=cap; })
          .sort(function(a,b){ return (b.q-a.q)||(a.cost-b.cost); }).slice(0,70);
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
      Promise.all([load(), loadMI()]).then(function(){ computePrice();
        var m=INIT.get('gm');
        if(m==='fantasy') setMode('fantasy'); else setTeam(defaultTeam());
      }).catch(function(e){ host.innerHTML='<div class="loading">GM Mode could not load ('+esc(e&&e.message||e)+').</div>'; });
    }
  };
})();
