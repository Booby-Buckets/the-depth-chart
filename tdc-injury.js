/* ── Injury report (OWNER-ONLY) ─────────────────────────────────────────────
 * Lets the owner mark a player as hurt directly on the player page — a general
 * body part + a recovery timeline — instead of editing the Google Sheet. Records
 * are stored in the owner's profiles.freshman_projections jsonb (via TDCFresh's
 * shared key store) under "tdc_inj:<team>:<name>", so they load/save with the same
 * auth + single blob as the freshman editor. Nothing here renders for the public.
 *
 * Behavior (per owner spec):
 *   • A disclaimer states the player is hurt (body part + timeline).
 *   • A "will play / won't play" toggle decides whether the 2026-27 projection shows.
 *   • Any timeline longer than 3 months (multiple months / full season) FORCES
 *     out-of-rotation: no stat projection is shown at all.
 *
 * Public API — window.TDCInjury:
 *   isOwner()                  -> bool (delegates to TDCFresh)
 *   load()                     -> Promise (delegates to TDCFresh.load)
 *   get(player)                -> {part,timeline,play,note} | null  (owner only)
 *   outOfRotation(rec)         -> bool
 *   statusLabel(rec)           -> "Knee · 1–3 months"
 *   apply(player, proj)        -> mutates proj: sets _injInfo and, when out,
 *                                 _injured/_injOut (reuses the page's DNP path);
 *                                 otherwise _injHurt. Clears them when no record.
 *   forCards(proj)             -> {out, banner, outHTML} | null  (overview stats)
 *   heroButtonHTML(player)     -> owner-only hero-tag button
 *   openEditor(player, onSaved)
 */
(function(){
  if(window.TDCInjury) return;

  var BODY_PARTS=['Head / Concussion','Neck','Shoulder','Arm / Elbow','Wrist / Hand',
    'Back','Core / Abdomen','Hip','Groin','Hamstring / Quad','Knee','Calf / Shin',
    'Ankle','Foot','Illness','Other'];
  // ordered soonest→longest; `out` = longer than 3 months → out of rotation, no stats
  var TIMELINES=[
    {k:'day-to-day', label:'Day-to-day',      out:false},
    {k:'1-3w',       label:'1–3 weeks',       out:false},
    {k:'1-3m',       label:'1–3 months',      out:false},
    {k:'multi',      label:'Multiple months', out:true },
    {k:'season',     label:'Full season',     out:true },
    {k:'none',       label:'No timeline',     out:false}
  ];
  function tl(k){ for(var i=0;i<TIMELINES.length;i++) if(TIMELINES[i].k===k) return TIMELINES[i]; return TIMELINES[0]; }

  function fresh(){ return (typeof window!=='undefined')?window.TDCFresh:null; }
  function isOwner(){ var F=fresh(); return !!(F&&F.isOwner&&F.isOwner()); }
  function load(cb){ var F=fresh(); return (F&&F.load)?F.load(cb):Promise.resolve(cb&&cb()); }
  function key(p){ return 'tdc_inj:'+((p&&p.team)||'')+':'+((p&&p.name)||''); }

  function get(p){
    if(!isOwner()||!p) return null;
    var F=fresh(); var r=(F&&F.getKey)?F.getKey(key(p)):null;
    return (r&&r.part)?r:null;
  }
  function save(p,rec){ var F=fresh(); return (F&&F.setKey)?F.setKey(key(p),rec):Promise.resolve({ok:false}); }
  function clear(p){ var F=fresh(); return (F&&F.setKey)?F.setKey(key(p),null):Promise.resolve({ok:false}); }

  function outOfRotation(rec){ return !!rec && (tl(rec.timeline).out || rec.play===false); }
  function statusLabel(rec){ if(!rec) return ''; return (rec.part||'Injury')+' · '+tl(rec.timeline).label; }

  // Mutate proj so the rest of the page reacts. Owner-only; clears flags when no record.
  function apply(p, proj){
    if(!proj) return;
    delete proj._injInfo; delete proj._injOut; delete proj._injHurt;
    if(proj._injuredByInj){ delete proj._injured; delete proj._injuredByInj; }  // undo a prior injury-set flag
    var rec=get(p); if(!rec) return;
    var out=outOfRotation(rec);
    proj._injInfo={part:rec.part, timeline:tl(rec.timeline).label, play:rec.play!==false, out:out, note:rec.note||''};
    if(out){ proj._injured=true; proj._injuredByInj=true; proj._injOut=true; }
    else { proj._injHurt=true; }
  }

  function _esc(s){ return (''+(s==null?'':s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

  // Disclaimer banner (hurt but expected to play).
  function bannerHTML(info){ if(!info) return '';
    return '<div class="inj-banner">'
      +'<span class="inj-ic">⚕</span>'
      +'<div><b>Injury report — '+_esc(info.part)+' · '+_esc(info.timeline)+'.</b> '
      +'This player is currently hurt but expected to play; the 2026-27 projection assumes a healthy role.'
      +(info.note?' <span class="inj-note">“'+_esc(info.note)+'”</span>':'')
      +'</div></div>'; }

  // Out-of-rotation replacement for the projected column.
  function outHTML(info){ info=info||{};
    return '<div class="inj-out">'
      +'<div class="inj-out-ic">🏥</div>'
      +'<div class="inj-out-h">Out of rotation</div>'
      +'<div class="inj-out-sub">'+_esc(info.part||'Injury')+' · '+_esc(info.timeline||'')+'</div>'
      +'<div class="inj-out-tx">Projected to miss significant time (3+ months), so he’s removed from the rotation — no stat projection.'
      +(info.note?' <span class="inj-note">“'+_esc(info.note)+'”</span>':'')+'</div>'
      +'</div>'; }

  // What buildOverviewCards needs: whether to blank stats, plus the banner/out HTML.
  function forCards(proj){
    if(!proj||!proj._injInfo) return null;
    return { out:!!proj._injOut, banner: proj._injOut?'':bannerHTML(proj._injInfo), outHTML:outHTML(proj._injInfo) };
  }

  // Compact depth-chart chip (owner-only), styled like the WAIVER? badge but red.
  // e.g. "Inj · 1–3 months" / "Out · Full season". Body part + note in the tooltip.
  function badgeHTML(p){
    var rec=get(p); if(!rec) return '';
    var out=outOfRotation(rec);
    var lbl=(out?'Out':'Inj')+' · '+tl(rec.timeline).label;
    var title=(rec.part||'Injury')+' · '+tl(rec.timeline).label+(out?' — out of rotation':' — expected to play')+(rec.note?' — '+rec.note:'');
    return '<span class="dc-injbadge'+(out?' out':'')+'" title="'+_esc(title)+'">'+_esc(lbl)+'</span>';
  }

  function heroButtonHTML(p){
    if(!isOwner()||!p) return '';
    var rec=get(p);
    var lbl = rec ? ('⚕ '+statusLabel(rec)) : '⚕ Add injury';
    return '<button class="hero-tag edit'+(rec?' inj-on':'')+'" onclick="TDCInjury._open()">'+_esc(lbl)+'</button>';
  }

  // ── editor modal ──
  function injectCSS(){ if(document.getElementById('injCss')) return; var st=document.createElement('style'); st.id='injCss';
    st.textContent=[
    '.inj-overlay{position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px;}',
    '.inj-modal{width:100%;max-width:440px;max-height:92vh;overflow-y:auto;background:var(--bg2);border:1px solid var(--border2);border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.6);font-family:Inter,sans-serif;}',
    '.inj-head{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 20px 14px;border-bottom:1px solid var(--border);}',
    '.inj-eyebrow{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#e0776f;}',
    '.inj-name{font-family:Playfair Display,serif;font-weight:800;font-size:22px;line-height:1.1;margin-top:3px;}',
    '.inj-sub{font-size:11px;color:var(--text3);font-weight:600;margin-top:2px;}',
    '.inj-x{background:none;border:none;color:var(--text3);font-size:26px;line-height:1;cursor:pointer;padding:0 2px;}',
    '.inj-body{padding:16px 20px;}.inj-field{margin-bottom:18px;}',
    '.inj-field>label{display:block;font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;}',
    '.inj-select{width:100%;padding:9px 10px;border:1px solid var(--border2);background:var(--bg);color:var(--text);border-radius:8px;font-size:13px;font-family:Inter,sans-serif;}',
    '.inj-toggle{display:grid;grid-template-columns:1fr 1fr;gap:8px;}',
    '.inj-tb{padding:10px 6px;border:1px solid var(--border);background:var(--bg);color:var(--text2);font-family:Inter,sans-serif;font-size:12px;font-weight:700;border-radius:9px;cursor:pointer;}',
    '.inj-tb.on{background:var(--accent);color:#0f1408;border-color:var(--accent);}',
    '.inj-tb.on.out{background:#e0776f;border-color:#e0776f;color:#2a0f0d;}',
    '.inj-tb:disabled{opacity:.4;cursor:not-allowed;}',
    '.inj-in{width:100%;padding:9px 10px;border:1px solid var(--border2);background:var(--bg);color:var(--text);border-radius:8px;font-size:13px;font-family:Inter,sans-serif;box-sizing:border-box;}',
    '.inj-hint{font-size:11px;color:var(--text3);line-height:1.5;margin-top:8px;padding:9px 11px;background:var(--bg);border:1px solid var(--border);border-radius:9px;}',
    '.inj-hint.out{color:#e0776f;border-color:rgba(224,119,111,.35);background:rgba(224,119,111,.07);}',
    '.inj-foot{display:flex;gap:10px;padding:14px 20px 18px;border-top:1px solid var(--border);align-items:center;}',
    '.inj-btn{flex:1;padding:11px;border-radius:10px;font-family:Inter,sans-serif;font-size:13px;font-weight:800;cursor:pointer;border:1px solid var(--border2);}',
    '.inj-btn.ghost{background:var(--bg);color:var(--text2);}.inj-btn.primary{background:#e0776f;color:#2a0f0d;border-color:#e0776f;}',
    '.inj-msg{font-size:11px;font-weight:700;color:#5ab875;flex:0 0 auto;opacity:0;transition:opacity .2s;}.inj-msg.show{opacity:1;}',
    /* page-side display */
    '.inj-banner{display:flex;gap:10px;align-items:flex-start;background:rgba(224,119,111,.08);border:1px solid rgba(224,119,111,.32);border-radius:10px;padding:11px 13px;margin-bottom:14px;font-size:12.5px;line-height:1.5;color:var(--text2);}',
    '.inj-banner .inj-ic{color:#e0776f;font-size:16px;line-height:1.2;flex:0 0 auto;}',
    '.inj-banner b{color:#e0776f;font-weight:800;}',
    '.inj-note{color:var(--text3);font-style:italic;}',
    '.inj-out{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:28px 16px;text-align:center;background:rgba(224,119,111,.06);border:1px solid rgba(224,119,111,.25);border-radius:10px;}',
    '.inj-out-ic{font-size:28px;}.inj-out-h{font-size:14px;font-weight:800;color:#e0776f;}',
    '.inj-out-sub{font-size:12px;font-weight:700;color:var(--text2);}',
    '.inj-out-tx{font-size:11.5px;color:var(--text3);line-height:1.5;max-width:240px;}',
    '.hero-tags .hero-tag.inj-on{border-color:rgba(224,119,111,.5) !important;color:#e0776f !important;background:rgba(224,119,111,.10) !important;}',
    '.dc-injbadge{display:inline-block;margin-top:3px;padding:0 5px;border-radius:3px;font-size:8.5px;font-weight:800;letter-spacing:.03em;border:1px solid rgba(224,119,111,.55);color:#e0776f;background:rgba(224,119,111,.10);line-height:1.6;white-space:nowrap;cursor:help;}'
    ].join(''); document.head.appendChild(st); }

  var _p=null,_d=null,_onSaved=null;
  function elm(){ var m=document.getElementById('injModal'); if(!m){ injectCSS(); m=document.createElement('div'); m.id='injModal'; m.className='inj-overlay';
    m.onclick=function(e){ if(e.target===m) close(); }; document.body.appendChild(m); } return m; }
  function close(){ var m=document.getElementById('injModal'); if(m) m.remove(); _p=null; _d=null; _onSaved=null; }

  function render(){ var m=elm(), p=_p, d=_d, forced=tl(d.timeline).out, out=forced||d.play===false;
    var parts=BODY_PARTS.map(function(b){return '<option value="'+_esc(b)+'"'+(b===d.part?' selected':'')+'>'+_esc(b)+'</option>';}).join('');
    var times=TIMELINES.map(function(t){return '<option value="'+t.k+'"'+(t.k===d.timeline?' selected':'')+'>'+t.label+(t.out?' (out)':'')+'</option>';}).join('');
    m.innerHTML='<div class="inj-modal"><div class="inj-head"><div><div class="inj-eyebrow">Injury Report</div><div class="inj-name">'+_esc(p.name)+'</div><div class="inj-sub">'+_esc(p.position||'')+' · '+_esc(p.team||'')+'</div></div><button class="inj-x" onclick="TDCInjury._close()">×</button></div>'+
      '<div class="inj-body">'+
        '<div class="inj-field"><label>Body part</label><select class="inj-select" onchange="TDCInjury._set(\'part\',this.value)">'+parts+'</select></div>'+
        '<div class="inj-field"><label>Recovery timeline</label><select class="inj-select" onchange="TDCInjury._set(\'timeline\',this.value)">'+times+'</select></div>'+
        '<div class="inj-field"><label>Will he play this season?</label><div class="inj-toggle">'+
          '<button class="inj-tb'+(!out?' on':'')+'" '+(forced?'disabled':'')+' onclick="TDCInjury._set(\'play\',true)">Will play</button>'+
          '<button class="inj-tb out'+(out?' on':'')+'" onclick="TDCInjury._set(\'play\',false)">Won’t play (out)</button>'+
        '</div>'+
        '<div class="inj-hint'+(out?' out':'')+'">'+(out
            ? (forced?'A timeline over 3 months forces him out of the rotation — no stat projection will show.'
                     :'Marked out — his 2026-27 stat projection will be hidden and he’s removed from the rotation.')
            : 'He’ll show his normal 2026-27 projection with a "hurt" disclaimer.')+'</div>'+
        '</div>'+
        '<div class="inj-field"><label>Note (optional)</label><input class="inj-in" type="text" maxlength="90" value="'+_esc(d.note||'')+'" placeholder="e.g. sprained left ankle vs. Duke" oninput="TDCInjury._set(\'note\',this.value)"/></div>'+
      '</div>'+
      '<div class="inj-foot"><span class="inj-msg" id="injMsg"></span>'+
        '<button class="inj-btn ghost" onclick="TDCInjury._clear()">Clear injury</button>'+
        '<button class="inj-btn primary" id="injSaveBtn" onclick="TDCInjury._save()">Save</button></div></div>';
  }
  function openEditor(p, onSaved){
    if(!isOwner()||!p) return;
    _p=p; _onSaved=(typeof onSaved==='function')?onSaved:null;
    _d=get(p)||{ part:BODY_PARTS[10], timeline:'day-to-day', play:true, note:'' };
    if(_d.play==null) _d.play=true;
    load(function(){ render(); });   // ensure blob is present, then draw
    render();
  }

  // Inject the display CSS eagerly (banner / out card / hero pill style) so it applies
  // before the editor modal is ever opened.
  try{ if(document.head) injectCSS(); else document.addEventListener('DOMContentLoaded',injectCSS); }catch(e){}

  window.TDCInjury={
    isOwner:isOwner, load:load, get:get, outOfRotation:outOfRotation, statusLabel:statusLabel,
    apply:apply, forCards:forCards, bannerHTML:bannerHTML, outHTML:outHTML, heroButtonHTML:heroButtonHTML, badgeHTML:badgeHTML, openEditor:openEditor,
    _open:function(){ if(window.player) openEditor(window.player, window._injOnSaved); },
    _close:close,
    _set:function(k,v){ if(k==='play') _d.play=(v===true||v==='true'); else _d[k]=v;
      if(k==='timeline'&&tl(v).out) _d.play=false;   // >3mo forces out
      render(); },
    _clear:function(){ var p=_p, cb=_onSaved; clear(p).then(function(){ close(); cb&&cb(); }); },
    _save:function(){ var p=_p, cb=_onSaved, btn=document.getElementById('injSaveBtn'), msg=document.getElementById('injMsg');
      if(btn){ btn.textContent='Saving…'; btn.disabled=true; }
      if(tl(_d.timeline).out) _d.play=false;
      save(p, {part:_d.part, timeline:_d.timeline, play:_d.play!==false, note:(_d.note||'').slice(0,90)}).then(function(res){
        var ok=!!(res&&res.ok);
        if(!ok){ if(msg){ msg.style.color='#e07070';
            msg.textContent=isOwner()?((res&&res.status===401)?'⚠ Not saved — sign-in expired. Sign in and re-save.':'⚠ Not saved'+(res&&res.status?' ('+res.status+')':'')+'. Try again.'):'⚠ Sign in as owner to save.';
            msg.classList.add('show'); }
          if(btn){ btn.textContent='Save'; btn.disabled=false; } return; }
        if(msg){ msg.style.color=''; msg.textContent='✓ Saved'; msg.classList.add('show'); }
        if(cb) cb(); setTimeout(close, 600);
      });
    }
  };
})();
