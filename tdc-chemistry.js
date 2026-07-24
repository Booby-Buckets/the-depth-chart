/* tdc-chemistry.js — shared lineup-chemistry engine + renderer.
   TDCChem.render(el, rosterRows, opts) draws a "Lineup Identity" panel (OVR,
   synergy, trait bars, edge/gap) next to a half-court with the 5 starters
   positioned by play-style and connected by synergy lines. Pure logic on top of
   TDCPortalFit.profile/archetype, so it matches the team page's read.
   Also exposes pairSynergy / lineupAnalysis / assignStarters for reuse. */
(function(global){
  function prof(p){ try{ return (global.TDCPortalFit&&TDCPortalFit.profile)?TDCPortalFit.profile(p):{}; }catch(e){ return {}; } }
  function arch(p){ try{ return (global.TDCPortalFit&&TDCPortalFit.archetype)?TDCPortalFit.archetype(p):''; }catch(e){ return ''; } }
  function num(p,k){ var n=parseFloat(p&&p[k]); return isNaN(n)?0:n; }
  function synCol(v){ return v>=63?'#5ab875':v>=52?'#d4a24a':'#e07070'; }
  function ovrCol(g){ g=parseFloat(g); if(isNaN(g))return 'var(--text3)'; if(g>=88)return '#5ab875'; if(g>=80)return 'var(--accent)'; if(g>=72)return 'var(--text)'; return 'var(--text2)'; }

  // synergy between two players (0-99), + the reasons behind it
  function pairSynergy(a,b){
    var A=prof(a), B=prof(b), aA=arch(a), aB=arch(b), g=function(o,k){return +(o[k]||0);};
    var s=55, R=[]; var add=function(d,t){ s+=d; if(Math.abs(d)>=2) R.push({d:Math.round(d),t:t}); };
    var shootMax=Math.max(g(A,'shooter'),g(B,'shooter'));
    var iA=g(A,'finisher')*g(A,'size'), iB=g(B,'finisher')*g(B,'size'), interior=Math.max(iA,iB);
    var shArch=g(A,'shooter')>=g(B,'shooter')?aA:aB, inArch=iA>=iB?aA:aB;
    add(18*shootMax*Math.max(interior,0.4), shArch+' spacing opens driving lanes for the '+inArch);
    add(7*Math.min(g(A,'shooter'),g(B,'shooter')), 'Two floor-spacers ('+aA+' & '+aB+') stretch the D');
    if(shootMax<0.28 && interior>0.5){ var clog=(iA>=iB)?aB:aA; add(-13, clog+' gives no spacing next to the '+inArch); }
    var creator=Math.max(g(A,'creator'),g(B,'creator'));
    var crArch=g(A,'creator')>=g(B,'creator')?aA:aB, tgArch=g(A,'creator')>=g(B,'creator')?aB:aA;
    var tgt=(g(A,'creator')>g(B,'creator'))?(g(B,'finisher')*0.6+g(B,'shooter')*0.6+g(B,'scorer')*0.3):(g(A,'finisher')*0.6+g(A,'shooter')*0.6+g(A,'scorer')*0.3);
    add(16*creator*Math.min(1,tgt), crArch+' creates open looks for the '+tgArch);
    if(g(A,'creator')>0.6 && g(B,'creator')>0.6) add(-9, aA+' & '+aB+' both need the ball in their hands');
    else if(g(A,'ballDom')>0.7 && g(B,'ballDom')>0.7) add(-7, 'Overlapping ball-dominance — '+aA+' & '+aB);
    var rimArch=g(A,'rimProtect')>=g(B,'rimProtect')?aA:aB, perArch=g(A,'rimProtect')>=g(B,'rimProtect')?aB:aA;
    add(13*Math.max(g(A,'rimProtect')*g(B,'perimD'), g(B,'rimProtect')*g(A,'perimD')), rimArch+' anchors behind the '+perArch+' on defense');
    add(5*Math.min(g(A,'perimD')+g(B,'perimD'),2)/2, 'Both hound the ball on the perimeter');
    if(g(A,'rimProtect')<0.2 && g(B,'rimProtect')<0.2) add(-5, 'Neither the '+aA+' nor '+aB+' protects the rim');
    if(g(A,'size')>0.6 && g(B,'size')>0.6 && g(A,'shooter')<0.3 && g(B,'shooter')<0.3) add(-10, aA+' + '+aB+' — two non-shooting bigs clog the paint');
    var keys=['shooter','creator','finisher','rimProtect','rebounder','perimD'], sim=0;
    keys.forEach(function(k){ sim+=1-Math.abs(g(A,k)-g(B,k)); }); sim/=keys.length;
    if(sim>0.76) add(-13*(sim-0.74), aA===aB?('Two '+aA+'s — redundant roles'):(aA+' & '+aB+' overlap — redundant'));
    R.sort(function(x,y){return Math.abs(y.d)-Math.abs(x.d);});
    return { score:Math.max(22,Math.min(99,Math.round(s))), reasons:R, archA:aA, archB:aB };
  }

  // whole-lineup identity from the 5 starters
  function lineupAnalysis(starters){
    var ps=starters.filter(function(s){return s.p;}).map(function(s){return s.p;});
    if(ps.length<2) return null;
    var sum=0,cnt=0; for(var i=0;i<ps.length;i++) for(var j=i+1;j<ps.length;j++){ sum+=pairSynergy(ps[i],ps[j]).score; cnt++; }
    var overall=Math.round(sum/cnt);
    var S=function(k){ return ps.reduce(function(t,p){return t+num(p,k);},0); };
    var nz=function(v,lo,hi){ return Math.max(3,Math.min(100,Math.round((v-lo)/(hi-lo)*100))); };
    var spacers=ps.filter(function(p){ return num(p,'tp_pct')>=32 && num(p,'tpa')>=1.5; }).length;
    var elite=ps.filter(function(p){ return num(p,'tp_pct')>=37 && num(p,'tpa')>=3; }).length;
    var blks=ps.map(function(p){return num(p,'blk');}).sort(function(a,b){return b-a;});
    var anchor=blks[0]||0, second=blks[1]||0;
    var dims={ Scoring:nz(S('ppg'),38,78), Spacing:nz(spacers*19+elite*9,8,78),
      Playmaking:nz(S('apg'),7,19), Rebounding:nz(S('rpg'),15,38),
      'Perimeter D':nz(S('stl'),2,7), 'Rim Protect':nz(anchor*22+second*11+S('blk')*2,10,68) };
    var grades=ps.map(function(p){return parseFloat(p.tdc_grade);}).filter(function(g){return !isNaN(g);});
    var rating=grades.length?Math.round(grades.reduce(function(a,b){return a+b;},0)/grades.length):null;
    return {overall:overall,dims:dims,rating:rating,shooters:spacers,count:ps.length};
  }

  // pick a starting five from a roster and slot them PG..C by position
  function assignStarters(rows){
    var R=(rows||[]).filter(function(p){return p&&(num(p,'mpg')>=1)&&p.name;});
    R.sort(function(a,b){return num(b,'mpg')-num(a,'mpg');});
    var top=R.slice(0,5);
    var ord={PG:0,G:0,SG:1,CG:1,SF:2,F:2,PF:3,C:4};
    var po=function(p){ var pos=((p.position||'')+'').toUpperCase().split(/[\/, ]/)[0]; return ord[pos]!=null?ord[pos]:2; };
    top.sort(function(a,b){return po(a)-po(b) || num(b,'mpg')-num(a,'mpg');});
    var slots=['PG','SG','SF','PF','C'];
    return top.map(function(p,i){ return {pos:slots[i]||'SF', p:p}; });
  }

  var COURT_XY={ C:{x:58,y:19}, PF:{x:31,y:28}, SF:{x:19,y:57}, SG:{x:81,y:57}, PG:{x:50,y:61} };
  function courtPos(p,pos){
    var b=COURT_XY[pos]||{x:50,y:50}; if(!p) return b;
    var P=prof(p), isBig=(pos==='C'||pos==='PF'), x=b.x, y=b.y;
    y += (+P.shooter||0)*(isBig?26:9);
    y -= (+P.finisher||0)*(1-(+P.shooter||0))*(isBig?6:14);
    if(isBig && (+P.shooter||0)>0.4) x += (x<50?-1:1)*(+P.shooter)*8;
    return { x:Math.max(10,Math.min(90,Math.round(x*10)/10)), y:Math.max(12,Math.min(86,Math.round(y*10)/10)) };
  }
  function initials(n){ var p=(n||'').trim().split(/\s+/); return ((p[0]||'')[0]||'')+((p[p.length-1]||'')[0]||''); }
  function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }

  function panelHtml(an){
    if(!an) return '<div class="chm-panel"><div class="chm-h">Lineup Identity</div><div style="color:var(--text3);font-size:12px;">Not enough roster data.</div></div>';
    var dimBar=function(kv){ var k=kv[0],v=kv[1]; return '<div class="chm-dim"><div class="chm-dim-top"><span>'+k+'</span><b>'+v+'</b></div><div class="chm-dim-bar"><span style="width:'+v+'%;background:'+(v>=70?'#5ab875':v>=45?'var(--accent)':'var(--text3)')+';"></span></div></div>'; };
    var ents=Object.keys(an.dims).map(function(k){return [k,an.dims[k]];});
    var top=ents.slice().sort(function(a,b){return b[1]-a[1];})[0], low=ents.slice().sort(function(a,b){return a[1]-b[1];})[0];
    var word=an.overall>=74?'Elite fit':an.overall>=64?'Complementary':an.overall>=54?'Workable':'Redundant';
    return '<div class="chm-panel"><div class="chm-h">Lineup Identity</div>'
      +'<div class="chm-rr"><div class="chm-rc"><div class="chm-big" style="color:'+ovrCol(an.rating)+'">'+(an.rating||'—')+'</div><div class="chm-lbl">Lineup OVR</div></div>'
      +'<div class="chm-rc"><div class="chm-big" style="color:'+synCol(an.overall)+'">'+an.overall+'</div><div class="chm-lbl">Synergy</div></div></div>'
      +'<div class="chm-word" style="color:'+synCol(an.overall)+'">'+word+'</div>'
      +'<div class="chm-dims">'+ents.map(dimBar).join('')+'</div>'
      +'<div class="chm-note"><b style="color:#5ab875;">Edge:</b> '+top[0]+' &nbsp; <b style="color:#e07070;">Gap:</b> '+low[0]+'</div>'
      +'<div class="chm-note" style="color:var(--text3);">'+an.shooters+' of '+an.count+' starters space the floor.</div></div>';
  }

  function courtHtml(starters){
    var pts=starters.filter(function(s){return s.p;}).map(function(s){ var xy=courtPos(s.p,s.pos); return {pos:s.pos, p:s.p, x:xy.x, y:xy.y}; });
    var line='rgba(255,255,255,.14)';
    var lines='';
    for(var i=0;i<pts.length;i++) for(var j=i+1;j<pts.length;j++){
      var syn=pairSynergy(pts[i].p, pts[j].p).score, str=Math.min(1,Math.abs(syn-55)/30);
      lines+='<line x1="'+pts[i].x+'" y1="'+pts[i].y+'" x2="'+pts[j].x+'" y2="'+pts[j].y+'" stroke="'+synCol(syn)+'" stroke-width="'+(0.4+str*0.9).toFixed(2)+'" stroke-opacity="'+(0.22+str*0.5).toFixed(2)+'" stroke-dasharray="'+(syn<52?'2 1.4':'none')+'"/>';
    }
    var showPhoto=(global.tdcShowPhotos&&global.tdcShowPhotos());
    var nodes=pts.map(function(pt){
      var g=(pt.p.tdc_grade!=null?pt.p.tdc_grade:'')||'', photo=(showPhoto&&pt.p.espn_id)?('https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/'+pt.p.espn_id+'.png'):'';
      return '<div class="chm-node" style="left:'+pt.x+'%;top:'+pt.y+'%;">'
        +'<div class="chm-ava">'+(photo?'<img src="'+photo+'" alt="" loading="lazy">':'')+'<span class="chm-init">'+esc(initials(pt.p.name))+'</span></div>'
        +'<div class="chm-tag"><span class="chm-ovr" style="color:'+ovrCol(g)+'">'+(g||'—')+'</span><span class="chm-pos">'+pt.pos+'</span></div>'
        +'<div class="chm-nm">'+esc(pt.p.name)+'</div></div>';
    }).join('');
    return '<div class="chm-court"><svg class="chm-lines" viewBox="0 0 120 80" preserveAspectRatio="none">'
      +'<line x1="0" y1="0" x2="120" y2="80" stroke="transparent"/>'   /* keeps viewBox */
      +lines
      +'</svg><svg class="chm-court-bg" viewBox="0 0 120 80" preserveAspectRatio="none">'
      +'<rect x="1" y="1" width="118" height="78" fill="none" stroke="'+line+'" stroke-width=".4"/>'
      +'<rect x="48" y="1" width="24" height="30" fill="none" stroke="'+line+'" stroke-width=".4"/>'
      +'<circle cx="60" cy="31" r="8" fill="none" stroke="'+line+'" stroke-width=".4"/>'
      +'<line x1="53" y1="4.5" x2="67" y2="4.5" stroke="'+line+'" stroke-width=".7"/>'
      +'<path d="M14,1 L14,12 A46,33 0 0 0 106,12 L106,1" fill="none" stroke="'+line+'" stroke-width=".4"/>'
      +'</svg>'+nodes+'</div>';
  }

  function css(){
    if(document.getElementById('chm-css')) return;
    var st=document.createElement('style'); st.id='chm-css';
    st.textContent=
      ".chm-wrap{display:grid;grid-template-columns:210px 1fr;gap:20px;align-items:start;background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:18px;}"
      +"@media(max-width:720px){.chm-wrap{grid-template-columns:1fr;}}"
      +".chm-panel{background:rgba(0,0,0,.14);border:1px solid var(--border);border-radius:14px;padding:16px;}"
      +".chm-h{font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:12px;}"
      +".chm-rr{display:grid;grid-template-columns:1fr 1fr;gap:10px;}"
      +".chm-rc{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:10px 6px;text-align:center;}"
      +".chm-big{font-family:'Playfair Display',serif;font-weight:800;font-size:30px;line-height:1;}"
      +".chm-lbl{font-size:8.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-top:4px;}"
      +".chm-word{text-align:center;font-size:14px;font-weight:800;margin:11px 0 13px;}"
      +".chm-dim{margin-bottom:8px;}"
      +".chm-dim-top{display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:3px;}.chm-dim-top b{color:var(--text);}"
      +".chm-dim-bar{height:5px;border-radius:3px;background:var(--bg3,rgba(128,128,128,.2));overflow:hidden;}.chm-dim-bar span{display:block;height:100%;border-radius:3px;}"
      +".chm-note{font-size:11px;color:var(--text2);margin-top:9px;}"
      +".chm-court{position:relative;width:100%;aspect-ratio:3/2;border-radius:14px;overflow:hidden;border:1px solid var(--border);background:linear-gradient(150deg,#0e1626,#0a0f1c);}"
      +".chm-lines,.chm-court-bg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}.chm-court-bg{opacity:.9;}"
      +".chm-node{position:absolute;transform:translate(-50%,-50%);text-align:center;width:78px;}"
      +".chm-ava{width:46px;height:46px;border-radius:50%;margin:0 auto;background:var(--bg2);border:2px solid var(--border2);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;}"
      +".chm-ava img{width:100%;height:100%;object-fit:cover;}"
      +".chm-init{font-size:15px;font-weight:800;color:var(--text2);}"
      +".chm-tag{display:inline-flex;align-items:center;gap:4px;background:rgba(8,12,22,.82);border-radius:7px;padding:1px 6px;margin-top:-8px;position:relative;}"
      +".chm-ovr{font-family:'Playfair Display',serif;font-weight:800;font-size:13px;}"
      +".chm-pos{font-size:8.5px;font-weight:700;color:var(--text3);}"
      +".chm-nm{font-size:10.5px;font-weight:700;color:var(--text);margin-top:2px;line-height:1.15;text-shadow:0 1px 3px rgba(0,0,0,.7);}";
    document.head.appendChild(st);
  }

  function render(el, rows, opts){
    if(!el) return null;
    css();
    var starters=assignStarters(rows);
    var an=lineupAnalysis(starters);
    if(!an){ el.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px;">Not enough roster data for a chemistry read.</div>'; return null; }
    el.innerHTML='<div class="chm-wrap">'+panelHtml(an)+courtHtml(starters)+'</div>';
    return an;
  }

  global.TDCChem={ pairSynergy:pairSynergy, lineupAnalysis:lineupAnalysis, assignStarters:assignStarters, courtPos:courtPos, synCol:synCol, ovrCol:ovrCol, panelHtml:panelHtml, courtHtml:courtHtml, render:render };
})(typeof window!=='undefined'?window:this);
