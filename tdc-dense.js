/* ============================================================
   TDC DENSE JS  ·  the homepage right rail (model meta, title contenders, movers,
   sleepers, shot-making leaders …), rebuilt to match the selected season.
   The rankings table itself (logos, heat shading, sorting) is rendered by index.html
   as a tdc-sheets.css sheet, like the CFB rankings; the old row dropdown and trend
   sparkline are gone (Sept 2026).
============================================================ */
(function(){
  function norm(s){ return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[&.'’]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
  var SB='https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/';
  var HD={apikey:'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye',Authorization:'Bearer sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye'};
  function curSeason(){ var s=document.getElementById('seasonSel'); return s?(+s.value||2027):2027; }


  /* ---- right rail: rebuilds to match the selected season ---- */
  var CABBR={
    // full names (team_seasons)
    'Southeastern Conference':'SEC','Atlantic Coast Conference':'ACC','Big Ten Conference':'B10','Big 12 Conference':'B12','Big East Conference':'BE',
    'Mountain West Conference':'MWC','American Athletic Conference':'AAC','American Conference':'AAC','West Coast Conference':'WCC','Atlantic 10 Conference':'A-10',
    'Missouri Valley Conference':'MVC','Coastal Athletic Association':'CAA','Colonial Athletic Association':'CAA','Big Sky Conference':'BSky','Southern Conference':'SoCon',
    'Sun Belt Conference':'SBC','Conference USA':'CUSA','Ohio Valley Conference':'OVC','Horizon League':'Horz','Ivy League':'Ivy','Metro Atlantic Athletic Conference':'MAAC',
    'Mid-American Conference':'MAC','Mid-Eastern Athletic Conference':'MEAC','Northeast Conference':'NEC','Patriot League':'Pat','Southland Conference':'SLC',
    'Southwestern Athletic Conference':'SWAC','Summit League':'Summit','America East Conference':'AE','Big West Conference':'BW','Big South Conference':'BSth',
    'Atlantic Sun Conference':'ASUN','United Athletic Conference':'UAC','Western Athletic Conference':'WAC','Pac-12 Conference':'Pac12','Pacific-12 Conference':'Pac12',
    // short forms (projection TDC_RATINGS)
    'BIG-12':'B12','Big-East':'BE'
  };
  function shortConf(c){ return CABBR[c]||c; }
  function card(head,sub,body,tip){ var ta=(tip&&window.tipAttr)?window.tipAttr(tip):'';
    var cls='rl-ht'+(ta?' rl-htip':'');
    return '<div class="rl-card"><div class="rl-h"><span class="'+cls+'"'+ta+'>'+head+'</span> <span>'+sub+'</span></div>'+body+'</div>'; }
  function kk(l,v){ return '<div class="rl-k"><div class="rl-kl">'+l+'</div><div class="rl-kv">'+v+'</div></div>'; }
  // Some teams carry a mascot in their short name ("Saint Louis Billikens") while
  // most don't ("Duke"). Trim the mascot back to the school, but ONLY when a
  // shorter prefix maps to the SAME team (identical logo) — so "Michigan State"
  // is left intact (its "Michigan" prefix is a different team).
  function shortSchool(name){
    if(window.tdcShortSchool) return window.tdcShortSchool(name);   // shared impl in team-colors.js
    var M=window.TDC_TEAM_COLORS; if(!M||!name) return name||'';
    var norm=function(s){ return s.toLowerCase().replace(/&/g,' ').replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim(); };
    var full=(''+name).trim(), rec=M[norm(full)]; if(!rec) return full;
    var w=full.split(/\s+/);
    for(var n=w.length-1;n>=1;n--){ var cand=w.slice(0,n).join(' '), r2=M[norm(cand)]; if(r2 && r2.logo===rec.logo) return cand; }
    return full;
  }
  function confBars(pairs){ var mx=Math.max.apply(null,pairs.map(function(x){return x.avg;}))||1;
    return pairs.map(function(x){ return '<div class="rl-conf"><span class="rl-cl">'+shortConf(x.c)+'</span><span class="rl-bar"><i style="width:'+Math.max(6,x.avg/mx*100)+'%"></i></span><span class="rl-mono">'+x.avg.toFixed(1)+'</span></div>'; }).join(''); }
  function moverRows(movers){ return movers.length?movers.map(function(m){ var up=m.delta>0; return '<div class="rl-row"><span>'+shortSchool(m.team)+'</span><span class="rl-badge '+(up?'up':'dn')+'">'+(up?'▲ +':'▼ ')+m.delta+'</span></div>'; }).join(''):'<div class="rl-empty">—</div>'; }
  // generic "team  →  value" leaderboard rows
  function leaderRows(arr, fmt){ return arr.length?arr.map(function(x){ return '<div class="rl-row"><span>'+shortSchool(x.team)+'</span><span class="rl-mono acc">'+fmt(x.v)+'</span></div>'; }).join(''):'<div class="rl-empty">—</div>'; }
  // sleepers show the ranking they're beating, as a muted "#NN"
  function sleeperRows(arr){ return arr.length?arr.map(function(x){ return '<div class="rl-row"><span>'+shortSchool(x.team)+'</span><span class="rl-mono">#'+x.v+'</span></div>'; }).join(''):'<div class="rl-empty">—</div>'; }
  var _p1=function(v){ return (v>=0?'+':'')+v.toFixed(1); }, _f1=function(v){ return v.toFixed(1); };
  function railToggle(){ return '<button type="button" class="rl-collapse" onclick="window.__tdcRail&&window.__tdcRail(true)" title="Slide the panels off screen">Hide panels ⟩</button>'; }

  // Shot Genome team numbers (2025-26), keyed by full name — cached once
  var _sgRail=null;
  function loadSG(){ if(_sgRail) return Promise.resolve(_sgRail);
    return fetch('scripts/data/shot_genome_teams.json').then(function(r){return r.ok?r.json():null;}).then(function(j){
      var m={}; ((j&&j.teams)||[]).forEach(function(t){ m[(t.team||'').toLowerCase().trim()]={lq:(t.off?t.off.lq:null), sm:(t.off?t.off.smAdj:null)}; });
      _sgRail=m; return m;
    }).catch(function(){ _sgRail={}; return _sgRail; });
  }

  function buildProjectionRail(finish){
    if(!window.TDC_RATINGS){ finish(null); return; }
    Promise.all([window.TDC_RATINGS.get(), loadSG()]).then(function(res){
      var d=res[0], sg=res[1]||{};
      if(!d||!d.teams){ finish(null); return; }
      var teams=d.teams.slice().sort(function(a,b){return a.rank-b.rank;}), model=d.model||{};
      // preseason → now movers
      var byPrior=d.teams.slice().filter(function(t){return t.prior!=null;}).sort(function(a,b){return b.prior-a.prior;});
      var pr={}; byPrior.forEach(function(t,i){ pr[t.team]=i+1; });
      var movers=teams.filter(function(t){return t.rank<=140&&pr[t.team];}).map(function(t){return {team:t.team,delta:pr[t.team]-t.rank};})
        .sort(function(a,b){return Math.abs(b.delta)-Math.abs(a.delta);}).slice(0,5);
      // title contenders — best projected net
      var contenders=teams.slice(0,4).map(function(t){return {team:t.team,v:t.rating};});
      // sleepers — strongest roster grade still ranked outside the top 25
      var sleepers=teams.filter(function(t){return t.rank>25 && t.roster!=null;})
        .sort(function(a,b){return b.roster-a.roster;}).slice(0,4).map(function(t){return {team:t.team,v:t.rank};});
      // shot-making / look-quality leaders (join Shot Genome by full name)
      var withSg=teams.map(function(t){ var s=sg[(t.full||'').toLowerCase().trim()]; return s?{team:t.team,sm:s.sm,lq:s.lq}:null; }).filter(Boolean);
      var smLeaders=withSg.filter(function(x){return x.sm!=null;}).sort(function(a,b){return b.sm-a.sm;}).slice(0,4).map(function(x){return {team:x.team,v:x.sm};});
      var lqLeaders=withSg.filter(function(x){return x.lq!=null;}).sort(function(a,b){return b.lq-a.lq;}).slice(0,4).map(function(x){return {team:x.team,v:x.lq};});
      // conference strength
      var bc={}; d.teams.forEach(function(t){ if(t.rating!=null){ (bc[t.conf]=bc[t.conf]||[]).push(t.rating); } });
      var conf=Object.keys(bc).map(function(c){ return {c:c,avg:bc[c].reduce(function(a,b){return a+b;},0)/bc[c].length}; }).sort(function(a,b){return b.avg-a.avg;}).slice(0,6);

      var rail=document.createElement('aside'); rail.className='tdc-rail';
      rail.innerHTML=
        railToggle()
        +'<div class="rl-card rl-kstrip">'
          +kk('Home edge','+'+(model.homeAdv||3.7))
          +kk('Sigma',(model.sigma||11).toFixed(1))
          +kk('Teams',teams.length)
          +kk('Roster wt',Math.round((model.blendRoster||.9)*100)+'%')
        +'</div>'
        +card('Title contenders','projected net', leaderRows(contenders,_p1), 'contenders')
        +card('Biggest movers','preseason → now', moverRows(movers))
        +card('Sleepers','best roster · outside T25', sleeperRows(sleepers), 'sleepers')
        +(smLeaders.length?card('Shot-Making leaders','SM+ / 100', leaderRows(smLeaders,_p1), 'shotmaking'):'')
        +(lqLeaders.length?card('Best shot diets','Look Quality', leaderRows(lqLeaders,_f1), 'lookq'):'')
        +card('Conference strength','avg net', confBars(conf));
      finish(rail);
    }).catch(function(){ finish(null); });
  }

  function buildSeasonRail(cs, finish){
    function q(y){ return fetch(SB+'team_seasons?season_year=eq.'+y+'&select=team,conference,srs,ppg&order=srs.desc.nullslast',{headers:HD}).then(function(r){return r.ok?r.json():[];}).catch(function(){return[];}); }
    // Shot Genome only exists for 2025-26 (cs 2026); skip the fetch otherwise
    Promise.all([q(cs), q(cs-1), (cs===2026?loadSG():Promise.resolve(null))]).then(function(res){
      var cur=(res[0]||[]).filter(function(t){return t.srs!=null;});
      if(!cur.length){ finish(null); return; }
      var sg=res[2];
      cur.sort(function(a,b){return b.srs-a.srs;});
      var currRank={}; cur.forEach(function(t,i){ currRank[t.team]=i+1; });
      var prev=(res[1]||[]).filter(function(t){return t.srs!=null;}).sort(function(a,b){return b.srs-a.srs;});
      var prevRank={}; prev.forEach(function(t,i){ prevRank[t.team]=i+1; });
      var movers=cur.filter(function(t){return currRank[t.team]<=140 && prevRank[t.team];}).map(function(t){return {team:t.team, delta:prevRank[t.team]-currRank[t.team]};})
        .sort(function(a,b){return Math.abs(b.delta)-Math.abs(a.delta);}).slice(0,5);
      var contenders=cur.slice(0,4).map(function(t){return {team:t.team,v:t.srs};});
      var bc={}; cur.forEach(function(t){ if(t.conference){ (bc[t.conference]=bc[t.conference]||[]).push(t.srs); } });
      var conf=Object.keys(bc).map(function(c){ return {c:c,avg:bc[c].reduce(function(a,b){return a+b;},0)/bc[c].length}; }).sort(function(a,b){return b.avg-a.avg;}).slice(0,6);
      var scorers=cur.filter(function(t){return t.ppg!=null;}).slice().sort(function(a,b){return b.ppg-a.ppg;}).slice(0,4).map(function(t){return {team:t.team,v:t.ppg};});
      var top=cur[0], t25=cur.slice(0,25), avg25=t25.reduce(function(s,t){return s+t.srs;},0)/t25.length, spread=cur[0].srs-cur[cur.length-1].srs;
      var priorLbl=(cs-2)+'–'+(''+(cs-1)).slice(2);
      // shot-making / look-quality leaders (2025-26 only)
      var smLeaders=[], lqLeaders=[];
      if(sg){ var withSg=cur.map(function(t){ var s=sg[(t.team||'').toLowerCase().trim()]; return s?{team:t.team,sm:s.sm,lq:s.lq}:null; }).filter(Boolean);
        smLeaders=withSg.filter(function(x){return x.sm!=null;}).sort(function(a,b){return b.sm-a.sm;}).slice(0,4).map(function(x){return {team:x.team,v:x.sm};});
        lqLeaders=withSg.filter(function(x){return x.lq!=null;}).sort(function(a,b){return b.lq-a.lq;}).slice(0,4).map(function(x){return {team:x.team,v:x.lq};});
      }
      var rail=document.createElement('aside'); rail.className='tdc-rail';
      rail.innerHTML=
        railToggle()
        +'<div class="rl-card rl-kstrip">'
          +kk('Teams',cur.length)
          +kk('Top NET','+'+top.srs.toFixed(1))
          +kk('T25 avg','+'+avg25.toFixed(1))
          +kk('Spread',spread.toFixed(0))
        +'</div>'
        +card('Title contenders','top net', leaderRows(contenders,_p1), 'contenders')
        +card('Biggest movers','vs '+priorLbl, moverRows(movers))
        +(smLeaders.length?card('Shot-Making leaders','SM+ / 100', leaderRows(smLeaders,_p1), 'shotmaking'):'')
        +(lqLeaders.length?card('Best shot diets','Look Quality', leaderRows(lqLeaders,_f1), 'lookq'):'')
        +card('Points per game','top 4', leaderRows(scorers,_f1))
        +card('Conference strength','avg net', confBars(conf));
      finish(rail);
    }).catch(function(){ finish(null); });
  }

  /* ---- collapse / slide-off control ---- */
  function railHidden(){ try{ return localStorage.getItem('tdcRailHidden')==='1'; }catch(e){ return false; } }
  function isTablet(){ return window.matchMedia('(min-width:760px) and (max-width:1199px)').matches; }
  function ensureHandle(){
    if(!document.getElementById('tdcRailReopen')){
      var b=document.createElement('button'); b.id='tdcRailReopen'; b.type='button'; b.className='rail-reopen';
      b.innerHTML='⟨ Panels'; b.title='Show the panels';
      b.onclick=function(){ setRail(false); };
      document.body.appendChild(b);
    }
    if(!document.getElementById('tdcRailBackdrop')){
      var bd=document.createElement('div'); bd.id='tdcRailBackdrop'; bd.className='rail-backdrop';
      bd.onclick=function(){ setRail(true); };
      document.body.appendChild(bd);
    }
  }
  // on=true → hide/close. On tablet the rail is an overlay drawer (body.rail-drawer-open);
  // on desktop it collapses inline (rail.collapsed + body.rail-collapsed drives the handle).
  function setRail(on){
    if(isTablet()){
      document.body.classList.toggle('rail-drawer-open', !on);
      return;
    }
    try{ localStorage.setItem('tdcRailHidden', on?'1':'0'); }catch(e){}
    document.body.classList.toggle('rail-collapsed', on);
    var rail=document.querySelector('.tdc-rail'); if(rail) rail.classList.toggle('collapsed', on);
  }
  window.__tdcRail=setRail;

  function buildRail(){
    var sec=document.querySelector('.table-section'); if(!sec) return;
    var cs=curSeason();
    if(sec.dataset.railSeason===String(cs) || sec.dataset.railBuilding===String(cs)) return;
    sec.dataset.railBuilding=String(cs);
    var finish=function(rail){
      sec.dataset.railBuilding='';
      if(curSeason()!==cs){ buildRail(); return; }              // season changed mid-build → rebuild
      var old=sec.querySelector('.tdc-rail'); if(old) old.remove();
      if(rail && rail.children.length){ sec.appendChild(rail); ensureHandle();
        // desktop: honor the saved collapse preference. tablet: drawer defaults closed
        // (body has no rail-drawer-open class) and a rebuild must NOT slam it shut.
        if(!isTablet()) setRail(railHidden()); }
      sec.dataset.railSeason=String(cs);
    };
    if(cs>=2027) buildProjectionRail(finish);
    else buildSeasonRail(cs, finish);
  }

  function boot(){
    buildRail();
    var list=document.getElementById('rankingsList');
    if(list){
      var t=null;
      new MutationObserver(function(){ if(t)return; t=setTimeout(function(){ t=null; buildRail(); },80); })
        .observe(list,{childList:true});
    }
    [400,1200,2600].forEach(function(ms){ setTimeout(buildRail,ms); });   // catch async first render
    // crossing the tablet/desktop line: close the drawer so state doesn't leak across modes
    var rt=null; window.addEventListener('resize',function(){ if(rt)return; rt=setTimeout(function(){ rt=null;
      if(!isTablet()) document.body.classList.remove('rail-drawer-open'); },150); });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
