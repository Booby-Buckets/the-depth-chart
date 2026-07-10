/* ── Freshman projection engine + editor (shared) ─────────────────────────
 * Owner-only tool to project an unproven player by OVR + archetype + role +
 * playstyle sliders. Profiles are stored on the owner's Supabase profile row
 * (profiles.freshman_projections jsonb) keyed by "tdc_fr:<team>:<name>", cached
 * in memory + mirrored to localStorage. Both the player page (editor) and the
 * team Customize page (applies them to lineup projections) use this one module.
 *
 * Public API — window.TDCFresh:
 *   isOwner()            -> bool
 *   isFreshman(player)   -> bool (no real college stats)
 *   load(onReady)        -> Promise; pulls the owner's blob once
 *   profileFor(player)   -> saved {ovr,archetype,role,sliders} | null
 *   line(player, prof)   -> full projected stat line (with _frOvr/_frProfiled)
 *   archetypeOf(player)  -> default archetype string
 *   openEditor(player, onSaved)  -> opens the modal
 */
(function(){
  if(window.TDCFresh) return;
  var OWNER='blee4824@gmail.com';
  var SB='https://izlqhnxowdhtdofkwrho.supabase.co';
  var KEY='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';

  var FR_ROLE={ star:{mpg:30,usg:1.16,label:'Star'}, starter:{mpg:24,usg:1.0,label:'Starter'}, rotation:{mpg:15,usg:0.85,label:'Rotation'}, bench:{mpg:9,usg:0.72,label:'Bench'} };
  var FR_ARCH={
    'Lead Guard':{apg:1.22,ppg:1.05,tovs:1.1}, 'Floor General':{apg:1.32,ppg:0.85,tovs:1.15,tp_pct:2,stl:1.15},
    'Combo Guard':{ppg:1.05,apg:1.02}, 'Scoring Guard':{ppg:1.22,apg:0.82,tp_pct:2},
    'Sharpshooter':{ppg:1.05,tp_pct:6,ft_pct:4,apg:0.75,rpg:0.85,blk:0.5}, '3&D Guard':{tp_pct:5,stl:1.4,ppg:0.9,apg:0.9},
    'On-Ball Stopper':{stl:1.5,ppg:0.85,apg:1.05}, 'Point Forward':{apg:1.3,ppg:1.0,rpg:1.1},
    '3&D Wing':{tp_pct:5,stl:1.35,ppg:0.95,rpg:1.05}, 'Movement Shooter':{ppg:1.1,tp_pct:6,ft_pct:4,apg:0.75},
    'Wing Scorer':{ppg:1.25,tp_pct:1,apg:0.88}, 'Wing Stopper':{stl:1.4,blk:1.2,ppg:0.85},
    'Slasher':{ppg:1.15,fg_pct:2,tp_pct:-3,apg:0.9,oreb:1.15}, 'Connector Wing':{apg:1.15,tp_pct:2,ppg:0.95},
    'Rim Runner':{fg_pct:6,ppg:0.95,blk:1.3,oreb:1.5,dreb:1.1,tp_pct:-15,apg:0.6}, 'Stretch Big':{tp_pct:9,ppg:1.05,blk:0.85,oreb:0.8},
    'Rim Protector':{blk:1.9,rpg:1.2,dreb:1.15,ppg:0.85,fg_pct:3}, 'Two-Way Big':{blk:1.5,fg_pct:4,rpg:1.15,ppg:0.95},
    'Post Scorer':{ppg:1.25,fg_pct:3,rpg:1.1,tp_pct:-8,blk:0.9}, 'Glass Cleaner':{rpg:1.35,oreb:1.5,dreb:1.25,ppg:0.9,blk:1.1},
    'Interior Big':{rpg:1.1,fg_pct:3,blk:1.1,tp_pct:-10}
  };
  var FR_SLIDERS=[['scoring','Scoring volume'],['three','3PT shooting'],['mid','Mid-range'],['paint','Paint / finishing'],['ft','Free throw'],['playmaking','Playmaking'],['athleticism','Athleticism'],['steals','Steals / perimeter D'],['blocks','Blocks / rim protection'],['rebounding','Rebounding'],['ready','Ready to play']];
  // Migrate older saved profiles: the single "defense" slider became steals+blocks.
  function migrateSliders(sl){ if(sl&&sl.defense!=null){ if(sl.steals==null)sl.steals=sl.defense; if(sl.blocks==null)sl.blocks=sl.defense; } return sl; }

  var FR_BASE_FALLBACK={ '75-84':{SG:{ppg:7.5,rpg:2.2,apg:1.25,fg_pct:42,tp_pct:35.5,ft_pct:74.5,stl:0.7,blk:0.2,oreb:0.5,dreb:1.7,tovs:1.25}} };
  function FRB(){ return (typeof FR_BASE!=='undefined'&&FR_BASE)?FR_BASE:FR_BASE_FALLBACK; }
  function r1(v){ return v!=null?Math.round((v+Number.EPSILON)*10)/10:null; }
  function ht(h){ var m=/(\d+)[-'](\d+)/.exec(h||''); return m?(+m[1]*12 + +m[2]):0; }
  function c01(x){ return Math.max(0,Math.min(1,x)); }
  function traitProfile(p){
    var n=function(k){return parseFloat(p[k])||0;};
    var tpa=n('tpa'),tp=n('tp_pct'),fg=n('fg_pct'),apg=n('apg'),rpg=n('rpg'),blk=n('blk'),stl=n('stl'),ppg=n('ppg'),fga=n('fga')||9,h=ht(p.height)||78;
    return {shooter:c01((tp-31)/11)*c01(tpa/3.5), creator:c01((apg-1.6)/4),
      finisher:c01((fg-46)/12)*c01(1-(tpa/Math.max(fga,1))*1.4), rimProtect:c01((blk-0.4)/1.5),
      rebounder:c01((rpg-3)/6), perimD:c01((stl-0.5)/1.4), ballDom:c01((ppg-8)/14)*c01((tpa*0.5+apg+0.4)/8),
      size:c01((h-72)/12), scorer:c01((ppg-6)/16)};
  }
  function archetypeOf(p){
    var P=traitProfile(p), pos=(p.position||'').toUpperCase();
    var guard=pos==='PG'||pos==='SG'||pos==='CG'||pos==='G';
    var big=pos==='C'||pos==='PF'||(pos===''&&P.size>0.7);
    if(big){ if(P.shooter>0.42)return 'Stretch Big'; if(P.rimProtect>0.5&&P.finisher>0.35)return 'Two-Way Big';
      if(P.rimProtect>0.52)return 'Rim Protector'; if(P.scorer>0.6&&P.finisher>0.42)return 'Post Scorer';
      if(P.finisher>0.48)return 'Rim Runner'; if(P.rebounder>0.62)return 'Glass Cleaner'; return 'Interior Big'; }
    if(guard){ if(P.creator>0.62&&P.ballDom>0.48)return 'Lead Guard'; if(P.creator>0.5)return 'Floor General';
      if(P.shooter>0.5&&P.perimD>0.42)return '3&D Guard'; if(P.shooter>0.54)return 'Sharpshooter';
      if(P.scorer>0.62)return 'Scoring Guard'; if(P.perimD>0.55)return 'On-Ball Stopper'; return 'Combo Guard'; }
    if(P.creator>0.5)return 'Point Forward'; if(P.shooter>0.5&&P.perimD>0.42)return '3&D Wing';
    if(P.shooter>0.52)return 'Movement Shooter'; if(P.scorer>0.62)return 'Wing Scorer';
    if(P.perimD>0.55)return 'Wing Stopper'; if(P.finisher>0.5)return 'Slasher'; return 'Connector Wing';
  }
  function apply(line,mods){ for(var k in mods){ if(!mods.hasOwnProperty(k))continue; var v=mods[k];
    if(/_pct$/.test(k)) line[k]=(parseFloat(line[k])||0)+v; else line[k]=(parseFloat(line[k])||0)*v; } }
  function applySliders(line,sl,ctx){ ctx=ctx||{}; var size=(ctx.size!=null?ctx.size:0.4), guard=ctx.guard?1:0;
    var s=function(k){return (sl&&sl[k]!=null)?sl[k]:50;}, m=function(k,r){return 1+((s(k)-50)/50)*r;}, a=function(k,r){return ((s(k)-50)/50)*r;};
    // Counting stats sit on small bases (apg~1.3, stl~0.7, blk~0.2), so a pure
    // multiplier barely moves them. Each gets a raw additive term too, so 50→100
    // is a real swing. line() still caps every category to a believable ceiling.
    line.ppg*=m('scoring',0.45);                                    // overall shot volume / usage
    line.tp_pct+=a('three',11);                                     // 3-point %
    line.fg_pct+=a('mid',4)+a('paint',6);                          // mid-range jumper + rim finishing both lift 2pt FG%
    line.oreb*=m('paint',0.35); line.ppg*=m('paint',0.10);         // paint = putbacks + rim scoring
    line.ft_pct+=a('ft',12);                                        // free throw %
    // Playmaking — the biggest lever: strong multiplier + raw assists, weighted
    // toward guards (a big who "passes well" still won't rack up 5 dimes).
    line.apg=Math.max(0.1, line.apg*m('playmaking',0.7) + a('playmaking', 2.2+1.4*guard));
    line.tovs*=m('playmaking',0.20);
    line.oreb*=m('athleticism',0.45); line.blk*=m('athleticism',0.4); line.stl*=m('athleticism',0.25); line.ppg*=m('athleticism',0.07); line.dreb*=m('athleticism',0.14);
    var stlS=(sl&&sl.steals!=null)?sl.steals:((sl&&sl.defense!=null)?sl.defense:50);   // steals slider (fallback: old "defense")
    var blkS=(sl&&sl.blocks!=null)?sl.blocks:((sl&&sl.defense!=null)?sl.defense:50);   // blocks slider (fallback: old "defense")
    line.stl=Math.max(0.05, line.stl*(1+((stlS-50)/50)*0.6) + ((stlS-50)/50)*0.9);                  // perimeter D
    line.blk=Math.max(0.02, line.blk*(1+((blkS-50)/50)*0.6) + ((blkS-50)/50)*(0.5+1.4*size));       // rim protection — leans on size
    line.rpg=Math.max(0.3, line.rpg*m('rebounding',0.5) + a('rebounding', 1.2+2.0*size));           // boards — leans on size
    line.oreb*=m('rebounding',0.4); line.dreb*=m('rebounding',0.4);
    // Ready to play — how much of his ceiling shows up as a freshman. Low = high
    // potential but raw (size/intangibles); scales production & efficiency down,
    // and raises turnovers. 50 = the standard OVR-implied line.
    var rd=(sl&&sl.ready!=null)?sl.ready:50, pm=1+((rd-50)/50)*0.22;
    ['ppg','rpg','apg','stl','blk','oreb','dreb'].forEach(function(k){ line[k]*=pm; });
    line.fg_pct+=((rd-50)/50)*4; line.tp_pct+=((rd-50)/50)*3; line.ft_pct+=((rd-50)/50)*2; line.tovs*=1-((rd-50)/50)*0.20;
  }
  function line(p,profile){
    var B=FRB();
    var ovr=(profile&&profile.ovr!=null&&profile.ovr!=='')?parseFloat(profile.ovr):null;
    var grade=(ovr!=null?ovr:parseFloat(p.tdc_grade))||70;
    var pos=['PG','SG','SF','PF','C'].indexOf(p.position)>=0?p.position:(p.position==='CG'?'SG':'SG');
    var tier=grade>=92?'92+':grade>=85?'85-91':grade>=75?'75-84':'below75';
    var base=Object.assign({}, (B[tier]&&B[tier][pos])||(B['75-84']&&B['75-84']['SG'])||FR_BASE_FALLBACK['75-84']['SG']);
    if(profile&&profile.archetype&&FR_ARCH[profile.archetype]) apply(base,FR_ARCH[profile.archetype]);
    if(profile&&profile.sliders) applySliders(base,profile.sliders,{guard:(pos==='PG'||pos==='SG'),size:c01((ht(p.height)-72)/12)});
    base.fg_pct=Math.max(30,Math.min(70,base.fg_pct)); base.tp_pct=Math.max(0,Math.min(48,base.tp_pct)); base.ft_pct=Math.max(45,Math.min(95,base.ft_pct));
    var role=(profile&&profile.role)||(grade>=90?'star':grade>=82?'starter':grade>=74?'rotation':'bench');
    var R=FR_ROLE[role]||FR_ROLE.starter, mpg=R.mpg, scale=mpg/32, usg=R.usg, fga=Math.max(2,mpg*0.30*usg);
    // Realistic freshman ceilings — even an elite recruit on star minutes won't post
    // huge counting stats his first year, so cap each category to a believable max.
    var cap=function(v,mx){ return Math.min(v, mx); };
    base.apg=cap(base.apg*scale, 6.0)/scale; base.ppg=cap(base.ppg*scale*usg, 22)/(scale*usg);
    base.rpg=cap(base.rpg*scale, 11)/scale; base.stl=cap(base.stl*scale, 2.3)/scale; base.blk=cap(base.blk*scale, 3.0)/scale;
    return Object.assign({}, p, { mpg:r1(mpg), ppg:r1(base.ppg*scale*usg), rpg:r1(base.rpg*scale), apg:r1(base.apg*scale),
      fg_pct:r1(base.fg_pct), tp_pct:r1(base.tp_pct), ft_pct:r1(base.ft_pct),
      fga:r1(fga), fgm:r1(fga*base.fg_pct/100), tpa:r1(fga*0.42), tpm:r1(fga*0.42*base.tp_pct/100),
      fta:r1(mpg*0.09*usg), ftm:r1(mpg*0.09*usg*base.ft_pct/100),
      oreb:r1(base.oreb*scale), dreb:r1(base.dreb*scale), stl:r1(base.stl*scale), blk:r1(base.blk*scale), tovs:r1(base.tovs*scale),
      tdc_grade:(ovr!=null?''+Math.round(ovr):p.tdc_grade), _frOvr:ovr!=null, _noStatEst:true, _frProfiled:!!profile });
  }

  // ── storage ──
  function session(){ try{ return JSON.parse(localStorage.getItem('tdc_session')||'null'); }catch(e){ return null; } }
  function isOwner(){ var s=session(); return !!(s&&s.user&&(s.user.email||'').toLowerCase()===OWNER); }
  function isFreshman(p){ return !!p && !(parseFloat(p.ppg)>0); }
  function frKey(p){ return 'tdc_fr:'+((p&&p.team)||'')+':'+((p&&p.name)||''); }
  var _blob=null, _loaded=false, _loading=null;
  function profileFor(p){ var k=frKey(p); if(_blob&&typeof _blob==='object') return _blob[k]||null;
    try{ var s=localStorage.getItem(k); return s?JSON.parse(s):null; }catch(e){ return null; } }
  function pushBlob(){ var s=session(); if(!isOwner()||!s||!s.access_token||!s.user||!s.user.id) return Promise.resolve({ok:false});
    return fetch(SB+'/rest/v1/profiles?id=eq.'+s.user.id,{method:'PATCH',headers:{apikey:KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({freshman_projections:_blob||{}})})
      .then(function(r){return {ok:r.ok,status:r.status};}).catch(function(e){return {ok:false,error:e};}); }
  function saveProfile(p,prof){ var k=frKey(p); _blob=_blob||{};
    if(prof){ _blob[k]=prof; try{localStorage.setItem(k,JSON.stringify(prof));}catch(e){} }
    else { delete _blob[k]; try{localStorage.removeItem(k);}catch(e){} }
    return pushBlob(); }
  function load(onReady){
    if(_loaded){ onReady&&onReady(); return Promise.resolve(); }
    if(_loading){ if(onReady)_loading.then(onReady); return _loading; }
    var s=session();
    if(!isOwner()||!s||!s.access_token||!s.user||!s.user.id){ _blob=_blob||{}; _loaded=true; onReady&&onReady(); return Promise.resolve(); }
    _loading=fetch(SB+'/rest/v1/profiles?id=eq.'+s.user.id+'&select=freshman_projections',{headers:{apikey:KEY,Authorization:'Bearer '+s.access_token}})
      .then(function(r){return r.json();}).then(function(rows){
        _blob=(rows&&rows[0]&&rows[0].freshman_projections)||{};
        var migrated=false;
        for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k&&k.indexOf('tdc_fr:')===0&&!_blob[k]){ try{_blob[k]=JSON.parse(localStorage.getItem(k)); migrated=true;}catch(e){} } }
        if(migrated) pushBlob();
        _loaded=true;
      }).catch(function(e){ _blob=_blob||{}; _loaded=true; }).then(function(){ onReady&&onReady(); });
    return _loading;
  }

  // ── editor modal ──
  var _p=null,_d=null,_onSaved=null,_transform=null;
  function injectCSS(){ if(document.getElementById('frCss')) return; var st=document.createElement('style'); st.id='frCss';
    st.textContent=[
    '.fr-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px;}',
    '.fr-modal{width:100%;max-width:440px;max-height:92vh;overflow-y:auto;background:var(--bg2);border:1px solid var(--border2);border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.6);font-family:Inter,sans-serif;}',
    '.fr-head{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 20px 14px;border-bottom:1px solid var(--border);}',
    '.fr-eyebrow{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--tc-readable,var(--accent));}',
    '.fr-name{font-family:Playfair Display,serif;font-weight:800;font-size:22px;line-height:1.1;margin-top:3px;}',
    '.fr-sub{font-size:11px;color:var(--text3);font-weight:600;margin-top:2px;}',
    '.fr-x{background:none;border:none;color:var(--text3);font-size:26px;line-height:1;cursor:pointer;padding:0 2px;}',
    '.fr-body{padding:16px 20px;}.fr-field{margin-bottom:18px;}',
    '.fr-field>label{display:block;font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;}',
    '.fr-ovr-row{display:flex;align-items:center;gap:14px;}.fr-ovr-v{font-family:Playfair Display,serif;font-weight:800;font-size:34px;line-height:1;color:var(--tc-readable,var(--accent));min-width:52px;text-align:center;}',
    '.fr-select{width:100%;padding:9px 10px;border:1px solid var(--border2);background:var(--bg);color:var(--text);border-radius:8px;font-size:13px;font-family:Inter,sans-serif;}',
    '.fr-roles{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;}',
    '.fr-role{padding:8px 4px;border:1px solid var(--border);background:var(--bg);color:var(--text2);font-family:Inter,sans-serif;font-size:11px;font-weight:700;border-radius:8px;cursor:pointer;}',
    '.fr-role.on{background:var(--tc-readable,var(--accent));color:#221c08;border-color:var(--tc-readable,var(--accent));}',
    '.fr-sliders{display:flex;flex-direction:column;gap:12px;}.fr-sl-top{display:flex;justify-content:space-between;font-size:11px;font-weight:700;margin-bottom:4px;}',
    '.fr-sl-top b{font-family:Share Tech Mono,monospace;color:var(--tc-readable,var(--accent));}',
    '.fr-range{width:100%;height:5px;-webkit-appearance:none;appearance:none;background:var(--bg3);border-radius:4px;outline:none;}',
    '.fr-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--tc-readable,var(--accent));cursor:pointer;border:2px solid var(--bg2);}',
    '.fr-range::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--tc-readable,var(--accent));cursor:pointer;border:2px solid var(--bg2);}',
    '.fr-prev{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;}',
    '.fr-pv{text-align:center;}.fr-pv-v{font-family:Playfair Display,serif;font-weight:800;font-size:18px;line-height:1;}.fr-pv-l{font-size:8.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-top:4px;}',
    '.fr-foot{display:flex;gap:10px;padding:14px 20px 18px;border-top:1px solid var(--border);align-items:center;}',
    '.fr-btn{flex:1;padding:11px;border-radius:10px;font-family:Inter,sans-serif;font-size:13px;font-weight:800;cursor:pointer;border:1px solid var(--border2);}',
    '.fr-btn.ghost{background:var(--bg);color:var(--text2);}.fr-btn.primary{background:var(--tc-readable,var(--accent));color:#221c08;border-color:var(--tc-readable,var(--accent));}',
    '.fr-msg{font-size:11px;font-weight:700;color:#5ab875;flex:0 0 auto;opacity:0;transition:opacity .2s;}.fr-msg.show{opacity:1;}'
    ].join(''); document.head.appendChild(st); }
  function el(){ var m=document.getElementById('frModal'); if(!m){ injectCSS(); m=document.createElement('div'); m.id='frModal'; m.className='fr-overlay';
    m.onclick=function(e){ if(e.target===m) close(); }; document.body.appendChild(m); } return m; }
  function close(){ var m=document.getElementById('frModal'); if(m) m.remove(); _p=null; _d=null; _onSaved=null; }
  var _pvTimer=null;
  function paintPrev(L){ var host=document.getElementById('frPrev'); if(!host) return;
    var cells=[['PPG',L.ppg],['RPG',L.rpg],['APG',L.apg],['MPG',L.mpg],['FG%',L.fg_pct+'%'],['3P%',L.tp_pct+'%'],['STL',L.stl],['BLK',L.blk]];
    host.innerHTML=cells.map(function(c){return '<div class="fr-pv"><div class="fr-pv-v">'+c[1]+'</div><div class="fr-pv-l">'+c[0]+'</div></div>';}).join(''); }
  function preview(){ if(!_p) return; paintPrev(line(_p,_d)); }   // direct, fully-responsive line (every slider shows immediately)
  function render(){ var m=el(), p=_p, d=_d;
    var archOpts=Object.keys(FR_ARCH).map(function(a){return '<option value="'+a+'"'+(a===d.archetype?' selected':'')+'>'+a+'</option>';}).join('');
    var roleBtns=Object.keys(FR_ROLE).map(function(r){return '<button class="fr-role'+(r===d.role?' on':'')+'" onclick="TDCFresh._set(\''+'role\',\''+r+'\')">'+FR_ROLE[r].label+'</button>';}).join('');
    var sliders=FR_SLIDERS.map(function(kv){var k=kv[0],lbl=kv[1];return '<div class="fr-sl"><div class="fr-sl-top"><span>'+lbl+'</span><b id="frv-'+k+'">'+d.sliders[k]+'</b></div><input type="range" min="0" max="100" step="5" value="'+d.sliders[k]+'" class="fr-range" oninput="document.getElementById(\'frv-'+k+'\').textContent=this.value;TDCFresh._setSlider(\''+k+'\',this.value)"/></div>';}).join('');
    m.innerHTML='<div class="fr-modal"><div class="fr-head"><div><div class="fr-eyebrow">Freshman Projection</div><div class="fr-name">'+p.name+'</div><div class="fr-sub">'+(p.position||'')+' · '+(p.class_year||p.yr||'Fr.')+' · '+(p.team||'')+'</div></div><button class="fr-x" onclick="TDCFresh._close()">×</button></div>'+
      '<div class="fr-body">'+
        '<div class="fr-field"><label>Overall (OVR) — how good you think he is</label><div class="fr-ovr-row"><b class="fr-ovr-v" id="frOvrV">'+d.ovr+'</b><input type="range" min="55" max="99" step="1" value="'+d.ovr+'" class="fr-range" oninput="document.getElementById(\'frOvrV\').textContent=this.value;TDCFresh._setOvr(this.value)"/></div></div>'+
        '<div class="fr-field"><label>Archetype — how he plays</label><select class="fr-select" onchange="TDCFresh._set(\'archetype\',this.value)">'+archOpts+'</select></div>'+
        '<div class="fr-field"><label>Role — how big a part he is</label><div class="fr-roles">'+roleBtns+'</div></div>'+
        '<div class="fr-field"><label>Playstyle — fine-tune his tendencies</label><div class="fr-sliders">'+sliders+'</div></div>'+
        '<div class="fr-field"><label>Projected line</label><div class="fr-prev" id="frPrev"></div></div>'+
      '</div>'+
      '<div class="fr-foot"><span class="fr-msg" id="frMsg"></span><button class="fr-btn ghost" onclick="TDCFresh._reset()">Reset to model</button><button class="fr-btn primary" id="frSaveBtn" onclick="TDCFresh._save()">Save to my account</button></div></div>';
    preview();
  }
  function openEditor(p, opts){
    opts=opts||{}; if(typeof opts==='function') opts={onSaved:opts};
    _p=p; _onSaved=opts.onSaved||null; _transform=opts.transform||null;
    var g=Math.round(parseFloat(p.tdc_grade)||75);
    _d=profileFor(p)||{ archetype:archetypeOf(p), role:(g>=90?'star':g>=82?'starter':g>=74?'rotation':'bench'), sliders:{} };
    _d.sliders=migrateSliders(_d.sliders||{}); FR_SLIDERS.forEach(function(kv){ if(_d.sliders[kv[0]]==null) _d.sliders[kv[0]]=50; });
    if(_d.ovr==null) _d.ovr=g;
    render();
  }

  // Collect the owner's saved freshman OVRs as a grade-override map for the
  // projected-ratings rebuild (keyed off the stored blob "tdc_fr:<team>:<name>").
  function gradeOverrides(){ var out={byEspn:{},byNameTeam:{}};
    if(_blob&&typeof _blob==='object') Object.keys(_blob).forEach(function(k){
      var pr=_blob[k]; if(!pr||pr.ovr==null||pr.ovr==='') return;
      var rest=k.replace(/^tdc_fr:/,''), i=rest.indexOf(':'); if(i<0) return;
      out.byNameTeam[(rest.slice(0,i)+'|'+rest.slice(i+1)).toLowerCase()]=parseFloat(pr.ovr);
    });
    return out; }

  window.TDCFresh={
    isOwner:isOwner, isFreshman:isFreshman, load:load, profileFor:profileFor, line:line, archetypeOf:archetypeOf, openEditor:openEditor, gradeOverrides:gradeOverrides,
    _set:function(k,v){ if(k==='archetype')_d.archetype=v; else if(k==='role')_d.role=v; render(); },
    _setSlider:function(k,v){ _d.sliders[k]=+v; preview(); },
    _setOvr:function(v){ _d.ovr=+v; preview(); },
    _close:close,
    _reset:function(){ var p=_p, cb=_onSaved; saveProfile(p,null).then(function(){ close(); cb&&cb(); }); },
    _save:function(){
      var p=_p, cb=_onSaved, btn=document.getElementById('frSaveBtn'), msg=document.getElementById('frMsg');
      if(btn){ btn.textContent='Saving…'; btn.disabled=true; }
      saveProfile(p,_d).then(function(res){
        if(msg){ msg.textContent=(res&&res.ok)?'✓ Saved to your account':'✓ Saved (offline — will sync)'; msg.classList.add('show'); }
        if(cb) cb();
        // Canonical: rebuild the shared projected rankings with the freshman OVRs baked in.
        if(window.TDC_RATINGS && isOwner() && res && res.ok){
          if(msg) msg.textContent='✓ Saved · updating rankings…';
          TDC_RATINGS.rebuild(gradeOverrides()).then(function(){
            if(msg) msg.textContent='✓ Saved · rankings updated'; setTimeout(close, 700);
          }).catch(function(){ if(msg) msg.textContent='✓ Saved (rankings will update on next load)'; setTimeout(close, 900); });
        } else { setTimeout(close, 750); }
      });
    }
  };
})();
