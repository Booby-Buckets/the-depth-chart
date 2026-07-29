/* tdc-leaderboard.js — drop-in stat leaderboard modal for any page.
   Usage:  <script src="tdc-leaderboard.js"></script>
           onclick="TDC_LEADERBOARD.open('pts')"   // any stat key below
   Lazily fetches the 2025-26 player pool + team colors on first open (cached),
   so it never slows a page's initial load. Graphic top-10 + ranked 11-50.
   Headshots render only for the owner (tdcShowPhotos); team logos otherwise. */
(function(){
  if(window.TDC_LEADERBOARD) return;
  var SB='https://izlqhnxowdhtdofkwrho.supabase.co',
      KEY='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye',
      H={apikey:KEY,Authorization:'Bearer '+KEY};

  // stat catalog — get(row) reads pergame(pg)/advanced(adv)/grade; fr=fraction→%, pc=already 0-100
  var STATS=[
    {k:'grade',l:'TDC',d:0,get:function(r){return r.grade;}},
    {k:'pts',  l:'PPG',d:1,get:function(r){return r.pg.pts_per_g;}},
    {k:'trb',  l:'RPG',d:1,get:function(r){return r.pg.trb_per_g;}},
    {k:'ast',  l:'APG',d:1,get:function(r){return r.pg.ast_per_g;}},
    {k:'stl',  l:'SPG',d:1,get:function(r){return r.pg.stl_per_g;}},
    {k:'blk',  l:'BPG',d:1,get:function(r){return r.pg.blk_per_g;}},
    {k:'mpg',  l:'MPG',d:1,get:function(r){return r.pg.mp_per_g;}},
    {k:'ts',   l:'TS%', d:1,fr:1,get:function(r){return r.adv.ts_pct;}},
    {k:'efg',  l:'eFG%',d:1,fr:1,get:function(r){return r.pg.efg_pct;}},
    {k:'fg',   l:'FG%', d:1,fr:1,get:function(r){return r.pg.fg_pct;}},
    {k:'fg3',  l:'3P%', d:1,fr:1,get:function(r){return r.pg.fg3_pct;}},
    {k:'ft',   l:'FT%', d:1,fr:1,get:function(r){return r.pg.ft_pct;}},
    {k:'usg',  l:'USG%',d:1,pc:1,get:function(r){return r.adv.usg_pct;}},
    {k:'ast_pct',l:'AST%',d:1,pc:1,get:function(r){return r.adv.ast_pct;}},
    {k:'trb_pct',l:'TRB%',d:1,pc:1,get:function(r){return r.adv.trb_pct;}},
    {k:'stl_pct',l:'STL%',d:1,pc:1,get:function(r){return r.adv.stl_pct;}},
    {k:'blk_pct',l:'BLK%',d:1,pc:1,get:function(r){return r.adv.blk_pct;}},
    {k:'bpm',  l:'BPM',d:1,get:function(r){return r.adv.bpm;}},
    {k:'obpm', l:'OBPM',d:1,get:function(r){return r.adv.obpm;}},
    {k:'dbpm', l:'DBPM',d:1,get:function(r){return r.adv.dbpm;}},
    {k:'per',  l:'PER',d:1,get:function(r){return r.adv.per;}},
    {k:'ws',   l:'WS', d:1,get:function(r){return r.adv.ws;}}
  ];
  var LBL={grade:'TDC overall grade',pts:'Points per game',trb:'Rebounds per game',ast:'Assists per game',stl:'Steals per game',blk:'Blocks per game',mpg:'Minutes per game',ts:'True Shooting %',efg:'Effective FG %',fg:'Field-goal %',fg3:'Three-point %',ft:'Free-throw %',usg:'Usage rate',ast_pct:'Assist rate',trb_pct:'Rebound rate',stl_pct:'Steal rate',blk_pct:'Block rate',bpm:'Box Plus/Minus',obpm:'Offensive BPM',dbpm:'Defensive BPM',per:'Player Efficiency Rating',ws:'Win Shares'};
  var SMAP={}; STATS.forEach(function(s){SMAP[s.k]=s;});

  var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});};
  function val(r,s){ var v=s.get(r); return (v==null||isNaN(+v))?null:+v; }
  function fmt(r,s){ var v=val(r,s); if(v==null) return '—'; if(s.fr) return (v*100).toFixed(s.d)+'%'; if(s.pc) return v.toFixed(s.d)+'%'; return v.toFixed(s.d); }
  function fmtV(v,s){ if(v==null) return '—'; if(s.fr) return (v*100).toFixed(s.d)+'%'; if(s.pc) return v.toFixed(s.d)+'%'; return v.toFixed(s.d); }
  function norm(s){ return (''+(s||'')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
  function lastName(n){ var p=(''+(n||'')).trim().split(/\s+/); return p.length>1?p.slice(1).join(' '):(p[0]||''); }
  function showPhotos(){ try{ return !!(window.tdcShowPhotos&&window.tdcShowPhotos()); }catch(e){ return false; } }

  var POOL=null, COLORS=null, _loading=null;
  function teamMeta(school){ if(!COLORS) return null; var k=norm(school); if(COLORS[k]) return COLORS[k];
    for(var key in COLORS){ if(key&&(k.indexOf(key)===0||key.indexOf(k)===0)) return COLORS[key]; } return null; }

  async function fetchAll(url){ var out=[],off=0,PG=1000;
    while(true){ var r; try{ r=await fetch(url,{headers:Object.assign({},H,{'Range-Unit':'items','Range':off+'-'+(off+PG-1)})}); }catch(e){ break; }
      if(!r.ok) break; var b; try{ b=await r.json(); }catch(e){ break; } if(!Array.isArray(b)||!b.length) break;
      out=out.concat(b); if(b.length<PG) break; off+=PG; if(off>40000) break; } return out; }

  async function ensurePool(){
    if(POOL) return POOL; if(_loading) return _loading;
    _loading=(async function(){
      var col=fetch('scripts/data/team_colors.json',{cache:'no-cache'}).then(function(r){return r.ok?r.json():[];}).catch(function(){return [];});
      var rowsP=fetchAll(SB+'/rest/v1/bbref_seasons?season_year=eq.2026&tdc_grade=not.is.null&select=player,school,espn_id,tdc_grade,pergame,advanced');
      var arr=await col; COLORS={};
      (arr||[]).forEach(function(e){ if(!e) return; [e.location,e.display,e.name].forEach(function(kk){ if(kk) COLORS[norm(kk)]=e; }); });
      var raw=await rowsP;
      POOL=(raw||[]).map(function(r){ var pg=r.pergame||{}, adv=r.advanced||{};
          return {name:r.player,school:r.school,espn_id:r.espn_id,grade:(r.tdc_grade==null?null:+r.tdc_grade),pg:pg,adv:adv,gp:+pg.games||0,mpg:+pg.mp_per_g||0}; })
        .filter(function(r){ return r.name && r.gp>=10 && r.mpg>=12; });   // qualified rotation players
      return POOL;
    })();
    return _loading;
  }

  function injectCSS(){
    if(document.getElementById('tlb-css')) return;
    var css='.tlb-ov{position:fixed;inset:0;z-index:9000;background:rgba(20,18,14,.55);backdrop-filter:blur(4px);display:none;align-items:flex-start;justify-content:center;overflow-y:auto;padding:34px 16px 60px;}'
    +'.tlb-ov.on{display:flex;}'
    +'.tlb-panel{background:var(--bg,#faf9f6);color:var(--text,#1a1814);border:1px solid var(--border2,#c6c0b2);border-radius:18px;max-width:860px;width:100%;box-shadow:0 24px 70px rgba(0,0,0,.4);overflow:hidden;font-family:Inter,system-ui,sans-serif;}'
    +'.tlb-head{display:flex;align-items:flex-start;gap:14px;padding:20px 24px 16px;border-bottom:1px solid var(--border,#dedacf);flex-wrap:wrap;}'
    +'.tlb-l{flex:1;min-width:220px;} .tlb-t{font-family:"Playfair Display",Georgia,serif;font-weight:800;font-size:24px;line-height:1.05;} .tlb-d{font-size:12px;color:var(--text3,#8a867a);margin-top:4px;line-height:1.5;}'
    +'.tlb-sel{font-family:Inter,sans-serif;font-size:12.5px;font-weight:700;background:var(--bg2,#f1efea);border:1px solid var(--border2,#c6c0b2);color:var(--text,#1a1814);padding:8px 11px;border-radius:9px;outline:none;cursor:pointer;}'
    +'.tlb-x{background:none;border:1px solid var(--border2,#c6c0b2);color:var(--text3,#8a867a);width:32px;height:32px;border-radius:9px;font-size:16px;cursor:pointer;flex-shrink:0;}'
    +'.tlb-body{padding:20px 24px 26px;}'
    +'.tlb-cards{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;}'
    +'@media(max-width:720px){.tlb-cards{grid-template-columns:repeat(3,1fr);}}@media(max-width:460px){.tlb-cards{grid-template-columns:repeat(2,1fr);}}'
    +'.tlb-card{position:relative;border-radius:13px;overflow:hidden;aspect-ratio:3/4;display:flex;flex-direction:column;justify-content:flex-end;background:var(--bg3,#e6e3db);}'
    +'.tlb-bg{position:absolute;inset:0;} .tlb-face{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;} .tlb-face img{width:100%;height:100%;object-fit:cover;object-position:top center;} .tlb-logo{width:52%;height:52%;object-fit:contain;filter:drop-shadow(0 2px 4px rgba(0,0,0,.3));}'
    +'.tlb-rk{position:absolute;top:7px;left:8px;font-family:"Playfair Display",serif;font-weight:800;font-size:15px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6);z-index:2;}'
    +'.tlb-foot{position:relative;z-index:2;padding:22px 9px 9px;background:linear-gradient(to top,rgba(0,0,0,.82),rgba(0,0,0,.5) 60%,transparent);}'
    +'.tlb-nm{font-size:11px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:#fff;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px rgba(0,0,0,.7);}'
    +'.tlb-val{font-family:"Playfair Display",serif;font-weight:800;font-size:25px;color:#fff;line-height:1;margin-top:2px;text-shadow:0 1px 3px rgba(0,0,0,.7);}'
    +'.tlb-sec{display:inline-block;font-size:10px;font-weight:800;color:#fff;background:rgba(255,255,255,.22);border-radius:5px;padding:2px 7px;margin-top:5px;}'
    +'.tlb-card a{position:absolute;inset:0;z-index:3;}'
    +'.tlb-list{margin-top:16px;border:1px solid var(--border,#dedacf);border-radius:12px;overflow:hidden;}'
    +'.tlb-lh{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text3,#8a867a);padding:10px 16px 6px;}'
    +'.tlb-row{display:grid;grid-template-columns:34px 1fr 78px 52px;gap:10px;align-items:center;padding:9px 16px;border-top:1px solid var(--border,#dedacf);font-size:13px;}'
    +'.tlb-rk2{font-family:"Playfair Display",serif;font-weight:800;font-size:14px;color:var(--text3,#8a867a);text-align:center;}'
    +'.tlb-rnm{min-width:0;} .tlb-rnm a{font-weight:700;color:var(--text,#1a1814);text-decoration:none;} .tlb-rnm small{display:block;font-size:10.5px;color:var(--text3,#8a867a);font-weight:600;}'
    +'.tlb-rv{text-align:right;font-family:"Playfair Display",serif;font-weight:800;font-size:15px;} .tlb-rg{text-align:right;font-size:12px;font-weight:800;color:var(--text3,#8a867a);}'
    +'.tlb-load{padding:60px;text-align:center;color:var(--text3,#8a867a);}';
    var st=document.createElement('style'); st.id='tlb-css'; st.textContent=css; document.head.appendChild(st);
  }
  function injectDom(){
    if(document.getElementById('tlb-ov')) return;
    var d=document.createElement('div'); d.className='tlb-ov'; d.id='tlb-ov';
    d.innerHTML='<div class="tlb-panel" id="tlb-panel"></div>';
    d.addEventListener('click',function(e){ if(e.target===d) close(); });
    document.body.appendChild(d);
    document.addEventListener('keydown',function(e){ if(e.key==='Escape') close(); });
  }
  function show(){ document.getElementById('tlb-ov').classList.add('on'); document.body.style.overflow='hidden'; }
  function close(){ var o=document.getElementById('tlb-ov'); if(o) o.classList.remove('on'); document.body.style.overflow=''; }

  function render(k){
    var s=SMAP[k]; if(!s) return;
    var rows=POOL.map(function(r){ return {r:r,v:val(r,s)}; }).filter(function(x){ return x.v!=null; })
      .sort(function(a,b){ return b.v-a.v; }).slice(0,50);
    var opts=STATS.map(function(ss){ return '<option value="'+ss.k+'"'+(ss.k===k?' selected':'')+'>'+ss.l+'</option>'; }).join('');
    var cards=rows.slice(0,10).map(function(x,i){ var r=x.r, tm=teamMeta(r.school), c1=(tm&&tm.c1)||'#3a3a42', logo=tm&&tm.logo;
      var link=r.espn_id?('player.html?espn='+r.espn_id):('player.html?name='+encodeURIComponent(r.name)+'&team='+encodeURIComponent(r.school||''));
      var face=(showPhotos()&&r.espn_id)?'<img src="https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/'+r.espn_id+'.png" alt="" onerror="this.style.display=\'none\'">':(logo?'<img class="tlb-logo" src="'+logo+'" alt="">':'');
      var g=(r.grade!=null)?'<span class="tlb-sec">OVR '+Math.round(r.grade)+'</span>':'';
      return '<div class="tlb-card"><div class="tlb-bg" style="background:linear-gradient(160deg,'+c1+',rgba(0,0,0,.6))"></div><div class="tlb-face">'+face+'</div>'
        +'<div class="tlb-rk">'+(i+1)+'</div><div class="tlb-foot"><div class="tlb-nm">'+esc(lastName(r.name)||r.name)+'</div><div class="tlb-val">'+fmtV(x.v,s)+'</div>'+g+'</div><a href="'+link+'" aria-label="'+esc(r.name)+'"></a></div>';
    }).join('');
    var list=rows.slice(10).map(function(x,i){ var r=x.r;
      var link=r.espn_id?('player.html?espn='+r.espn_id):('player.html?name='+encodeURIComponent(r.name)+'&team='+encodeURIComponent(r.school||''));
      return '<div class="tlb-row"><div class="tlb-rk2">'+(i+11)+'</div><div class="tlb-rnm"><a href="'+link+'">'+esc(r.name)+'</a><small>'+esc(r.school)+'</small></div><div class="tlb-rv">'+fmtV(x.v,s)+'</div><div class="tlb-rg">'+(r.grade!=null?Math.round(r.grade):'—')+'</div></div>';
    }).join('');
    document.getElementById('tlb-panel').innerHTML=
      '<div class="tlb-head"><div class="tlb-l"><div class="tlb-t">'+s.l+' leaders</div><div class="tlb-d">'+(LBL[k]||'')+' · 2025-26 · min 10 GP</div></div>'
      +'<select class="tlb-sel" onchange="TDC_LEADERBOARD.open(this.value)" title="Switch stat">'+opts+'</select>'
      +'<button class="tlb-x" onclick="TDC_LEADERBOARD.close()" title="Close">✕</button></div>'
      +'<div class="tlb-body"><div class="tlb-cards">'+cards+'</div>'+(list?'<div class="tlb-list"><div class="tlb-lh">Ranks 11 – '+rows.length+'</div>'+list+'</div>':'')+'</div>';
  }

  async function open(k){
    if(!SMAP[k]) k='pts';
    injectCSS(); injectDom(); show();
    document.getElementById('tlb-panel').innerHTML='<div class="tlb-load">Loading the '+ (SMAP[k].l) +' leaderboard…</div>';
    try{ await ensurePool(); render(k); }
    catch(e){ document.getElementById('tlb-panel').innerHTML='<div class="tlb-load">Could not load the leaderboard.</div>'; }
  }
  window.TDC_LEADERBOARD={open:open, close:close};
})();
