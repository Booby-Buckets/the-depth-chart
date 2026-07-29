/* tdc-teamlink.js — team logo + hyperlink badge for any page.
   Usage:  <script src="tdc-teamlink.js"></script>
           `... ${TDC_TEAM.badge(row.full)} ...`   // -> [logo] <a>Team Name</a>
   Loads team_colors.json once (cached). badge() degrades to a plain link if the
   logo map isn't ready yet, so it's safe to call in synchronous render code. */
(function(){
  if(window.TDC_TEAM) return;
  var MAP=null;
  function norm(s){ return (''+(s||'')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
  var ready=fetch('scripts/data/team_colors.json',{cache:'no-cache'})
    .then(function(r){ return r.ok?r.json():[]; })
    .then(function(arr){ MAP={}; (arr||[]).forEach(function(e){ if(!e) return; [e.location,e.display,e.name].forEach(function(k){ if(k) MAP[norm(k)]=e; }); }); return MAP; })
    .catch(function(){ MAP={}; return MAP; });
  function injectCSS(){ if(document.getElementById('tl-css')) return; var s=document.createElement('style'); s.id='tl-css';
    s.textContent='.tl-badge{display:inline-flex;align-items:center;gap:6px;vertical-align:middle;}'
      +'.tl-badge img{height:1.25em;width:auto;object-fit:contain;flex-shrink:0;}'
      +'.tl-badge a{color:inherit;text-decoration:none;border-bottom:1px solid transparent;transition:border-color .15s,color .15s;}'
      +'.tl-badge a:hover{color:var(--accent);border-bottom-color:var(--accent);}'
      +'.tl-mini{height:16px;width:16px;object-fit:contain;vertical-align:middle;margin-right:7px;flex-shrink:0;}';
    document.head.appendChild(s); }
  function logoImg(name){ injectCSS(); var lg=logo(name); return lg?'<img class="tl-mini" src="'+lg+'" alt="" onerror="this.style.display=\'none\'"/>':''; }
  function esc(s){ return (''+(s==null?'':s)).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function meta(name){ if(!MAP) return null; var k=norm(name); if(MAP[k]) return MAP[k];
    for(var key in MAP){ if(key&&(k.indexOf(key)===0||key.indexOf(k)===0)) return MAP[key]; } return null; }
  function logo(name){ var m=meta(name); return (m&&m.logo)||null; }
  function link(name){ return 'team.html?team='+encodeURIComponent(name||''); }
  function badge(name, opt){ injectCSS(); opt=opt||{}; var lg=logo(name), disp=opt.label!=null?opt.label:name;
    return '<span class="tl-badge">'+(lg?'<img src="'+lg+'" alt="" onerror="this.style.display=\'none\'"/>':'')
      +'<a href="'+link(name)+'">'+esc(disp)+'</a></span>'; }
  window.TDC_TEAM={ready:ready, badge:badge, logo:logo, logoImg:logoImg, link:link, meta:meta};
})();
