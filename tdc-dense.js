/* ============================================================
   TDC DENSE JS  ·  team logos + per-column heat coloring for the
   rankings grid. Reads values straight off the rendered cells so
   it works with the existing render/sort/filter untouched.
============================================================ */
(function(){
  /* force the dark navy theme this look is designed for */
  try{ document.documentElement.setAttribute('data-theme','dark'); }catch(e){}

  /* ---- team logos (from TDC_TEAM_COLORS, loaded site-wide) ---- */
  function norm(s){ return (s||'').toLowerCase().replace(/&/g,' ').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
  function logoFor(name){
    var C=window.TDC_TEAM_COLORS; if(!C||!name) return null;
    var n=norm(name); if(C[n]&&C[n].logo) return C[n].logo;
    var p=n.split(' ');
    for(var i=p.length;i>0;i--){ var k=p.slice(0,i).join(' '); if(C[k]&&C[k].logo) return C[k].logo; }
    return null;
  }
  function addLogos(){
    document.querySelectorAll('#rankingsList .tr-team-name:not([data-dl])').forEach(function(a){
      a.setAttribute('data-dl','1');
      var url=logoFor(a.textContent); if(!url) return;
      var cell=a.closest('.tr-team-cell')||a.parentNode;
      var img=document.createElement('img');
      img.src=url; img.alt=''; img.className='tr-dlogo'; img.loading='lazy';
      img.onerror=function(){ this.remove(); };
      cell.insertBefore(img, cell.firstChild);
    });
  }

  /* ---- per-column heat map ---- */
  var INVERT={ 'OPP':1, 'TOV':1 };      // lower is better
  var SKIP={ 'W-L':1 };                  // not numeric
  function heat(t, invert){
    if(invert) t=1-t;
    t=Math.max(0,Math.min(1,t));
    if(t>=.5){ return 'rgba(52,211,153,'+(0.04+(t-.5)*2*0.30).toFixed(3)+')'; }
    return 'rgba(248,113,113,'+(0.04+(.5-t)*2*0.30).toFixed(3)+')';
  }
  function applyHeat(){
    var rows=document.querySelectorAll('#rankingsList .team-row');
    if(rows.length<3) return;
    var nCol=rows[0].querySelectorAll('.tr-stat').length;
    for(var j=0;j<nCol;j++){
      var label=(rows[0].querySelectorAll('.tr-stat')[j].querySelector('span')||{}).textContent||'';
      label=label.trim();
      if(SKIP[label]) continue;
      var cells=[], vals=[];
      rows.forEach(function(r){
        var c=r.querySelectorAll('.tr-stat')[j]; if(!c) return;
        var b=c.querySelector('b'); if(!b) return;
        var num=parseFloat((b.textContent||'').replace('%',''));
        if(isFinite(num)){ cells.push(c); vals.push(num); }
      });
      if(vals.length<3) continue;
      var mn=Math.min.apply(null,vals), mx=Math.max.apply(null,vals), inv=!!INVERT[label], rng=(mx-mn)||1;
      for(var i=0;i<cells.length;i++){ cells[i].style.background=heat((vals[i]-mn)/rng, inv); }
    }
  }

  /* ---- trend sparkline: cumulative scoring margin over every game of the season ---- */
  var SB='https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/';
  var HD={apikey:'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye',Authorization:'Bearer sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye'};
  var GAMES={};                 // season -> { fullName: [ game objects, each with opponent-adjusted rating ] }
  var SRS={};                   // season -> { fullName: srs }  (opponent quality)
  var LOADING={};               // season -> true while fetching
  function curSeason(){ var s=document.getElementById('seasonSel'); return s?(+s.value||2027):2027; }
  function ensureGames(season){
    if(GAMES[season]||LOADING[season]||season>=2027) return;   // 2027 = projection, no games of its own
    LOADING[season]=true;
    var all=[];
    // season NET (SRS) for every team → opponent quality
    var srsP = SRS[season] ? Promise.resolve(SRS[season]) :
      fetch(SB+'team_seasons?season_year=eq.'+season+'&select=team,srs',{headers:HD})
        .then(function(r){return r.ok?r.json():[];})
        .then(function(rows){ var m={}; (rows||[]).forEach(function(r){ if(r.srs!=null) m[r.team]=+r.srs; }); SRS[season]=m; return m; })
        .catch(function(){ SRS[season]={}; return {}; });
    function page(off){
      fetch(SB+'games?season_year=eq.'+season+'&status=eq.STATUS_FINAL&select=home,away,home_score,away_score,date&order=date.asc&limit=1000&offset='+off,{headers:HD})
        .then(function(r){return r.ok?r.json():[];})
        .then(function(rows){
          all=all.concat(rows||[]);
          if(rows&&rows.length===1000&&off<12000) page(off+1000);
          else build();
        }).catch(build);
    }
    function build(){
      srsP.then(function(srs){
        var m={};
        all.forEach(function(g){
          if(g.home_score==null||g.away_score==null) return;
          var mg=g.home_score-g.away_score;
          // adj = game margin + opponent's season NET  → an opponent-adjusted "how good was this performance"
          // (beat a +25 team by 5 → performed like +30; lose to a +25 team by 5 → still +20, above average)
          (m[g.home]=m[g.home]||[]).push({opp:g.away, ts:g.home_score, os:g.away_score, home:true,  date:g.date, adj:mg+(srs[g.away]||0)});
          (m[g.away]=m[g.away]||[]).push({opp:g.home, ts:g.away_score, os:g.home_score, home:false, date:g.date, adj:(-mg)+(srs[g.home]||0)});
        });
        GAMES[season]=m; LOADING[season]=false; addTrend();
      });
    }
    page(0);
  }
  // running (season-to-date) NET: expanding average of the opponent-adjusted game ratings.
  // Converges toward the team's season NET; a great loss nudges it up, a bad win nudges it down.
  function netTraj(glog){ var out=[],s=0; for(var i=0;i<glog.length;i++){ s+=glog[i].adj; out.push(s/(i+1)); } return out; }
  function sparkLine(vals){
    var n=vals.length; if(n<2) return '';
    var mn=Math.min.apply(null,vals), mx=Math.max.apply(null,vals), rng=(mx-mn)||1;
    var W=60,H=20, X=function(i){return i*(W/(n-1));}, Y=function(v){return H-2-((v-mn)/rng)*(H-4);};
    var d='M'+X(0).toFixed(1)+','+Y(vals[0]).toFixed(1);
    for(var j=1;j<n;j++) d+='L'+X(j).toFixed(1)+','+Y(vals[j]).toFixed(1);
    var end=vals[n-1], col=(end>=0)?'#2DE0A6':'#F87171';   // green = above-average NET, red = below
    return '<svg class="tr-trend-svg" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'
      +'<path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
      +'<circle cx="'+X(n-1).toFixed(1)+'" cy="'+Y(end).toFixed(1)+'" r="1.9" fill="'+col+'"/></svg>';
  }
  function addTrend(){
    var cs=curSeason();
    // The projected season has no games of its own, which left the TREND column
    // permanently empty on the default view. Show the last COMPLETED season's
    // trajectory instead, and say so in the header so it can't be misread as
    // this season's form.
    var src=(cs>=2027)?(cs-1):cs, borrowed=(src!==cs);
    var hd=document.querySelector('.table-header');
    if(hd){ var cells=hd.querySelectorAll('.th');
      var want=borrowed?('TREND \u2019'+String(src%100).padStart(2,'0')):'TREND';
      if(cells[3]&&cells[3].dataset.trh!==want){ cells[3].dataset.trh=want;
        cells[3].textContent=want; cells[3].classList.add('trendh');
        cells[3].title=borrowed?('Last completed season ('+(src-1)+'-'+String(src%100).padStart(2,'0')+')'):''; } }
    if(!GAMES[src]){ ensureGames(src); return; }
    var map=GAMES[src];
    document.querySelectorAll('#rankingsList .team-row').forEach(function(row){
      var sp=row.querySelector('.tr-spacer'); if(!sp||sp.dataset.tr===''+src) return;
      var a=row.querySelector('.tr-team-name'); if(!a) return;
      sp.dataset.tr=''+src;
      var glog=map[a.textContent.trim()];
      var traj=(glog&&glog.length>=2)?netTraj(glog):null;
      sp.innerHTML=traj?sparkLine(traj):'';
    });
  }

  /* ---- click-to-expand row (minimal inline dropdown) ---- */
  /* interactive season-margin chart: hover/click a point to see the game + score */
  function dropChart(glog){
    var wrap=document.createElement('div'); wrap.className='td-plot';
    if(!glog||glog.length<2){ wrap.innerHTML='<div class="td-empty">No game log yet — this is a projection.</div>'; return wrap; }
    var n=glog.length, traj=netTraj(glog);
    var mn=Math.min.apply(null,traj), mx=Math.max.apply(null,traj), pad=(mx-mn)*0.12||1; mn-=pad; mx+=pad;
    var rng=(mx-mn)||1;
    var W=430,H=96,pT=8,pB=8, X=function(i){return i*(W/(n-1));}, Y=function(v){return pT+(1-(v-mn)/rng)*(H-pT-pB);};
    var d='M'+X(0).toFixed(1)+','+Y(traj[0]).toFixed(1);
    for(var j=1;j<n;j++) d+='L'+X(j).toFixed(1)+','+Y(traj[j]).toFixed(1);
    var area=d+'L'+X(n-1).toFixed(1)+','+(H-pB)+'L0,'+(H-pB)+'Z';
    var col=(traj[n-1]>=0)?'#2DE0A6':'#F87171';
    var zeroLine=(mn<0&&mx>0)?'<line x1="0" y1="'+Y(0).toFixed(1)+'" x2="'+W+'" y2="'+Y(0).toFixed(1)+'" stroke="rgba(130,150,200,.2)" stroke-dasharray="3 4"/>':'';
    wrap.innerHTML='<svg class="td-svg" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'
      +'<defs><linearGradient id="tdga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+col+'" stop-opacity=".22"/><stop offset="1" stop-color="'+col+'" stop-opacity="0"/></linearGradient></defs>'
      +zeroLine
      +'<path d="'+area+'" fill="url(#tdga)"/><path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="2" stroke-linejoin="round"/>'
      +'<line class="tdc-cross" x1="0" y1="'+pT+'" x2="0" y2="'+(H-pB)+'" stroke="'+col+'" stroke-width="1" stroke-dasharray="2 3" opacity="0"/>'
      +'<circle class="tdc-dot" r="3.5" fill="#0A0E17" stroke="'+col+'" stroke-width="2" opacity="0"/>'
      +'<rect class="tdc-hit" x="0" y="0" width="'+W+'" height="'+H+'" fill="transparent" style="cursor:crosshair"/></svg>'
      +'<div class="tdc-tip"></div>';
    var svg=wrap.querySelector('.td-svg'), hit=wrap.querySelector('.tdc-hit'),
        cross=wrap.querySelector('.tdc-cross'), dot=wrap.querySelector('.tdc-dot'), tip=wrap.querySelector('.tdc-tip');
    function fmtDate(s){ if(!s) return ''; var p=(''+s).split('-'); return p.length===3?(+p[1])+'/'+(+p[2]):''; }
    function show(i){
      var g=glog[i], w=(g.ts>g.os), net=traj[i];
      cross.setAttribute('x1',X(i)); cross.setAttribute('x2',X(i)); cross.setAttribute('opacity','1');
      dot.setAttribute('cx',X(i)); dot.setAttribute('cy',Y(net)); dot.setAttribute('opacity','1');
      var rect=svg.getBoundingClientRect(); if(!rect.width) return;
      tip.innerHTML='<b>Game '+(i+1)+'</b> <span class="tdc-dt">'+fmtDate(g.date)+'</span><br>'
        +(g.home?'vs ':'@ ')+g.opp+' <span class="tdc-res '+(w?'w':'l')+'">'+(w?'W':'L')+' '+g.ts+'–'+g.os+'</span>'
        +' <span class="tdc-dt">· NET '+(net>=0?'+':'')+net.toFixed(1)+'</span>';
      // keep the whole popup inside the panel: clamp x, and flip below when the point sits high
      var lx=X(i)*(rect.width/W), half=tip.offsetWidth/2, contW=wrap.clientWidth||rect.width;
      tip.style.left=Math.max(half+4, Math.min(contW-half-4, lx))+'px';
      tip.style.top=(Y(net)*(rect.height/H))+'px';
      tip.classList.toggle('below', Y(net) < H*0.42);
      tip.classList.add('on');
    }
    function idxFromEvent(e){ var rect=svg.getBoundingClientRect(); var mx2=(e.clientX-rect.left)*(W/rect.width); var i=Math.round(mx2/(W/(n-1))); return Math.max(0,Math.min(n-1,i)); }
    hit.addEventListener('mousemove',function(e){ show(idxFromEvent(e)); });
    hit.addEventListener('click',function(e){ e.stopPropagation(); show(idxFromEvent(e)); });
    hit.addEventListener('mouseleave',function(){ tip.classList.remove('on'); cross.setAttribute('opacity','0'); dot.setAttribute('opacity','0'); });
    return wrap;   // no tooltip until the user hovers / taps a game
  }
  /* position sort: PG → SG → G → SF → F → PF → C (center last) */
  function posRank(p){
    var m={PG:1,'PG/SG':1.5,G:2,SG:3,'SG/SF':3.5,GF:3.5,SF:4,'SF/PF':4.5,F:5,PF:6,'PF/C':6.5,FC:6.5,C:7};
    var k=(p||'').toUpperCase().trim();
    return m[k]!=null?m[k]:5.5;
  }
  /* starting 5 + sixth man for the viewed season */
  function dropRoster(short, season){
    var box=document.createElement('div'); box.className='td-roster';
    box.innerHTML='<div class="td-title">Starting 5 <span class="td-hint">· sixth man</span></div><div class="td-players"><div class="td-loading">Loading roster…</div></div>';
    var url = season>=2027
      ? 'players?team=eq.'+encodeURIComponent(short)+'&select=*&order=depth_order.asc&limit=6'   // full row so TDCProjGrade can compute the projected OVR
      : 'player_history?team=eq.'+encodeURIComponent(short)+'&season_year=eq.'+season+'&select=name,position,tdc_grade,mpg,height&order=mpg.desc.nullslast&limit=8';
    fetch(SB+url,{headers:HD}).then(function(r){return r.ok?r.json():[];}).then(function(rows){
      var el=box.querySelector('.td-players');
      if(!rows||!rows.length){ el.innerHTML='<div class="td-empty" style="width:auto;padding:6px 0">No roster on file.</div>'; return; }
      function ht(h){ if(!h) return 0; var m=(''+h).split('-'); return m.length===2?(+m[0]*12 + (+m[1]||0)):0; }
      function htPos(h){ var n=ht(h); return n?(n<73?'PG':n<75.5?'SG':n<78.5?'SF':n<81?'PF':'C'):'—'; }
      // real PG/SG/SF/PF exist (projected rosters) → trust them; else generic G/F/C → slot 5 starters by height
      var specific=rows.some(function(p){ return /^(PG|SG|SF|PF)$/i.test(((p.position||'')+'').trim()); });
      var starters, labels, sixth, sixthLbl;
      if(specific){
        starters=rows.slice(0,5).sort(function(a,b){ return posRank(a.position)-posRank(b.position); });
        labels=starters.map(function(p){ return ((p.position||'')+'').toUpperCase()||'—'; });
        sixth=rows.slice(5,6);
        sixthLbl=sixth[0]?(((sixth[0].position||'')+'').toUpperCase()||'—'):'';
      } else {
        // generic G/F/C → build a balanced PG..C lineup by best height-fit so a real big
        // is pulled in (avoids "5 guards"); minutes only breaks ties.
        var pool=rows.slice(), ideal={C:84,PF:81,SF:79,SG:76,PG:73}, picks={};
        ['C','PF','SF','SG','PG'].forEach(function(slot){
          var best=-1, bs=1e9;
          pool.forEach(function(p,idx){ if(p._u) return; var h=ht(p.height)||76; var sc=Math.abs(h-ideal[slot])-idx*0.12; if(sc<bs){ bs=sc; best=idx; } });
          if(best>=0){ pool[best]._u=true; picks[slot]=pool[best]; }
        });
        starters=['PG','SG','SF','PF','C'].map(function(s){ return picks[s]; }).filter(Boolean);
        labels=starters.map(function(p){ for(var s in picks){ if(picks[s]===p) return s; } return '—'; });
        var rest=pool.filter(function(p){ return !p._u; });
        sixth=rest.slice(0,1);
        sixthLbl=sixth[0]?htPos(sixth[0].height):'';
      }
      var ordered=starters.concat(sixth);
      el.innerHTML=ordered.map(function(p,i){
        // returners show the site-wide PROJECTED grade (TDCProjGrade), matching the team/player pages
        var g=(season>=2027 && window.TDCProjGrade && window.TDCProjGrade.ovr) ? (window.TDCProjGrade.ovr(p)||p.tdc_grade||'—') : (p.tdc_grade||'—');
        var six=(i===5), pos=six?sixthLbl:(labels[i]||'—');
        return '<div class="td-p"><span class="td-slot'+(six?' six':'')+'">'+(six?'6':(i+1))+'</span>'
          +'<span class="td-pos">'+pos+'</span>'
          +'<span class="td-name">'+p.name+'</span>'
          +'<span class="td-g">'+g+'</span></div>';
      }).join('');
    }).catch(function(){});
    return box;
  }
  function buildDrop(row){
    var a=row.querySelector('.tr-team-name'); var name=a?a.textContent.trim():'';
    var href=a?a.getAttribute('href'):'#';
    var short=decodeURIComponent((href.split('team=')[1]||'').split('&')[0]||'');
    var cs=curSeason();
    var glog=(GAMES[cs]&&GAMES[cs][name])||null;
    var d=document.createElement('div'); d.className='tr-drop';
    var inner=document.createElement('div'); inner.className='tr-drop-inner';
    var chart=document.createElement('div'); chart.className='td-chart';
    chart.innerHTML='<div class="td-title">'+name+' · NET through the season <span class="td-hint">— hover / tap a game</span></div>';
    chart.appendChild(dropChart(glog));
    var link=document.createElement('a'); link.className='td-link'; link.href=href; link.textContent='Open full page →';
    inner.appendChild(chart);
    inner.appendChild(dropRoster(short, cs));
    inner.appendChild(link);
    d.appendChild(inner);
    return d;
  }
  function closeDrops(except){
    document.querySelectorAll('#rankingsList .tr-drop').forEach(function(d){
      var r=d.previousElementSibling;
      if(r===except) return;
      d.classList.remove('open'); if(r) r.classList.remove('tr-open');
      setTimeout(function(){ d.remove(); },300);
    });
  }
  function toggleDrop(row){
    var nx=row.nextElementSibling;
    if(nx&&nx.classList&&nx.classList.contains('tr-drop')){
      nx.classList.remove('open'); row.classList.remove('tr-open');
      setTimeout(function(){ nx.remove(); },300);
      return;
    }
    closeDrops(null);
    var d=buildDrop(row);
    row.parentNode.insertBefore(d, row.nextElementSibling);
    row.classList.add('tr-open');
    void d.offsetHeight;                 // reflow so the transition fires
    d.classList.add('open');
  }
  function wireExpand(){
    var list=document.getElementById('rankingsList'); if(!list||list.dataset.exp) return;
    list.dataset.exp='1';
    list.addEventListener('click',function(e){
      if(e.target.closest('.tr-drop')) return;         // let panel links/buttons work
      if(e.target.closest('.tr-team-name')) return;    // team name is a hyperlink → let it navigate
      var row=e.target.closest('.team-row'); if(!row) return;
      e.preventDefault();
      toggleDrop(row);
    });
  }

  function run(){ addLogos(); applyHeat(); addTrend(); wireExpand(); buildRail(); }

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
  function card(head,sub,body){ return '<div class="rl-card"><div class="rl-h">'+head+' <span>'+sub+'</span></div>'+body+'</div>'; }
  function confBars(pairs){ var mx=Math.max.apply(null,pairs.map(function(x){return x.avg;}))||1;
    return pairs.map(function(x){ return '<div class="rl-conf"><span class="rl-cl">'+shortConf(x.c)+'</span><span class="rl-bar"><i style="width:'+Math.max(6,x.avg/mx*100)+'%"></i></span><span class="rl-mono">'+x.avg.toFixed(1)+'</span></div>'; }).join(''); }
  function moverRows(movers){ return movers.length?movers.map(function(m){ var up=m.delta>0; return '<div class="rl-row"><span>'+m.team+'</span><span class="rl-badge '+(up?'up':'dn')+'">'+(up?'▲ +':'▼ ')+m.delta+'</span></div>'; }).join(''):'<div class="rl-empty">—</div>'; }

  function buildProjectionRail(finish){
    if(!window.TDC_RATINGS){ finish(null); return; }
    window.TDC_RATINGS.get().then(function(d){
      if(!d||!d.teams){ finish(null); return; }
      var teams=d.teams.slice().sort(function(a,b){return a.rank-b.rank;}), model=d.model||{};
      var byPrior=d.teams.slice().filter(function(t){return t.prior!=null;}).sort(function(a,b){return b.prior-a.prior;});
      var pr={}; byPrior.forEach(function(t,i){ pr[t.team]=i+1; });
      var movers=teams.filter(function(t){return t.rank<=140&&pr[t.team];}).map(function(t){return {team:t.team,delta:pr[t.team]-t.rank};})
        .sort(function(a,b){return Math.abs(b.delta)-Math.abs(a.delta);}).slice(0,5);
      var flips=[];
      try{ for(var i=0;i<26&&i+1<teams.length;i++){ var f=window.TDC_RATINGS.lineFor(teams[i],teams[i+1],'neutral');
        if(f&&Math.abs(f.probA-50)<=3.5) flips.push({a:teams[i].team,b:teams[i+1].team,p:f.probA.toFixed(1)}); }
        flips.sort(function(a,b){return Math.abs(a.p-50)-Math.abs(b.p-50);}); flips=flips.slice(0,4);
      }catch(e){}
      var bc={}; d.teams.forEach(function(t){ if(t.rating!=null){ (bc[t.conf]=bc[t.conf]||[]).push(t.rating); } });
      var conf=Object.keys(bc).map(function(c){ return {c:c,avg:bc[c].reduce(function(a,b){return a+b;},0)/bc[c].length}; }).sort(function(a,b){return b.avg-a.avg;}).slice(0,6);
      var flipsH=flips.length?flips.map(function(f){ return '<div class="rl-row"><span>'+f.a+' / '+f.b+'</span><span class="rl-mono acc">'+f.p+'%</span></div>'; }).join(''):'<div class="rl-empty">—</div>';
      var rail=document.createElement('aside'); rail.className='tdc-rail';
      rail.innerHTML=
        '<div class="rl-card rl-kstrip">'
          +'<div class="rl-k"><div class="rl-kl">Home edge</div><div class="rl-kv">+'+(model.homeAdv||3.7)+'</div></div>'
          +'<div class="rl-k"><div class="rl-kl">Sigma</div><div class="rl-kv">'+(model.sigma||11).toFixed(1)+'</div></div>'
          +'<div class="rl-k"><div class="rl-kl">Teams</div><div class="rl-kv">'+teams.length+'</div></div>'
          +'<div class="rl-k"><div class="rl-kl">Roster wt</div><div class="rl-kv">'+Math.round((model.blendRoster||.9)*100)+'%</div></div>'
        +'</div>'
        +card('Biggest movers','preseason → now', moverRows(movers))
        +card('Coin flips','neutral · win %', flipsH)
        +card('Conference strength','avg net', confBars(conf));
      finish(rail);
    }).catch(function(){ finish(null); });
  }

  function buildSeasonRail(cs, finish){
    function q(y){ return fetch(SB+'team_seasons?season_year=eq.'+y+'&select=team,conference,srs,ppg&order=srs.desc.nullslast',{headers:HD}).then(function(r){return r.ok?r.json():[];}).catch(function(){return[];}); }
    Promise.all([q(cs), q(cs-1)]).then(function(res){
      var cur=(res[0]||[]).filter(function(t){return t.srs!=null;});
      if(!cur.length){ finish(null); return; }
      cur.sort(function(a,b){return b.srs-a.srs;});
      var currRank={}; cur.forEach(function(t,i){ currRank[t.team]=i+1; });
      var prev=(res[1]||[]).filter(function(t){return t.srs!=null;}).sort(function(a,b){return b.srs-a.srs;});
      var prevRank={}; prev.forEach(function(t,i){ prevRank[t.team]=i+1; });
      var movers=cur.filter(function(t){return currRank[t.team]<=140 && prevRank[t.team];}).map(function(t){return {team:t.team, delta:prevRank[t.team]-currRank[t.team]};})
        .sort(function(a,b){return Math.abs(b.delta)-Math.abs(a.delta);}).slice(0,5);
      var bc={}; cur.forEach(function(t){ if(t.conference){ (bc[t.conference]=bc[t.conference]||[]).push(t.srs); } });
      var conf=Object.keys(bc).map(function(c){ return {c:c,avg:bc[c].reduce(function(a,b){return a+b;},0)/bc[c].length}; }).sort(function(a,b){return b.avg-a.avg;}).slice(0,6);
      var scorers=cur.filter(function(t){return t.ppg!=null;}).slice().sort(function(a,b){return b.ppg-a.ppg;}).slice(0,4);
      var top=cur[0], t25=cur.slice(0,25), avg25=t25.reduce(function(s,t){return s+t.srs;},0)/t25.length, spread=cur[0].srs-cur[cur.length-1].srs;
      var priorLbl=(cs-2)+'–'+(''+(cs-1)).slice(2);
      var scorersH=scorers.length?scorers.map(function(t){ return '<div class="rl-row"><span>'+t.team+'</span><span class="rl-mono acc">'+t.ppg.toFixed(1)+'</span></div>'; }).join(''):'<div class="rl-empty">—</div>';
      var rail=document.createElement('aside'); rail.className='tdc-rail';
      rail.innerHTML=
        '<div class="rl-card rl-kstrip">'
          +'<div class="rl-k"><div class="rl-kl">Teams</div><div class="rl-kv">'+cur.length+'</div></div>'
          +'<div class="rl-k"><div class="rl-kl">Top NET</div><div class="rl-kv">+'+top.srs.toFixed(1)+'</div></div>'
          +'<div class="rl-k"><div class="rl-kl">T25 avg</div><div class="rl-kv">+'+avg25.toFixed(1)+'</div></div>'
          +'<div class="rl-k"><div class="rl-kl">Spread</div><div class="rl-kv">'+spread.toFixed(0)+'</div></div>'
        +'</div>'
        +card('Biggest movers','vs '+priorLbl, moverRows(movers))
        +card('Points per game','top 4', scorersH)
        +card('Conference strength','avg net', confBars(conf));
      finish(rail);
    }).catch(function(){ finish(null); });
  }

  function buildRail(){
    var sec=document.querySelector('.table-section'); if(!sec) return;
    var cs=curSeason();
    if(sec.dataset.railSeason===String(cs) || sec.dataset.railBuilding===String(cs)) return;
    sec.dataset.railBuilding=String(cs);
    var finish=function(rail){
      sec.dataset.railBuilding='';
      if(curSeason()!==cs){ buildRail(); return; }              // season changed mid-build → rebuild
      var old=sec.querySelector('.tdc-rail'); if(old) old.remove();
      if(rail && rail.children.length) sec.appendChild(rail);
      sec.dataset.railSeason=String(cs);
    };
    if(cs>=2027) buildProjectionRail(finish);
    else buildSeasonRail(cs, finish);
  }

  function boot(){
    run();
    var list=document.getElementById('rankingsList');
    if(list){
      var t=null;
      new MutationObserver(function(){ if(t)return; t=setTimeout(function(){ t=null; run(); },80); })
        .observe(list,{childList:true});
    }
    [400,1200,2600].forEach(function(ms){ setTimeout(run,ms); });   // catch async first render
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
