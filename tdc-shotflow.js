/* tdc-shotflow.js — "shot flow" ledger for a player (or team).
   TDC_SHOTFLOW.render(el, shots, opts)
     shots: [{x,y,made,sv,stype,ast_name}]
     opts:  {title, subtitle, team}   // team name -> brand colors for the ribbons
   Flows every field-goal attempt through ZONE -> TYPE -> OUTCOME -> ASSIST.
   Made ribbons take the team's primary color; missed ribbons a ghosted version
   (falls back to green/tan if the team is unknown). On open the ribbons flow in
   left->right and a light band sweeps through every path; re-renders on resize.
   Hovering an ASSIST node traces that assister's exact shots (their sub-flow)
   back through zone->type->outcome, dimming everything else. */
(function(){
  var GREEN='rgba(56,150,100,', TAN='rgba(198,168,112,';
  // ── team-brand colors: made = team primary, missed = a ghosted (desaturated)
  //    version of the same hue, so the chart is on-brand yet made/miss stay clear ──
  function hexRgb(h){ h=(h||'').replace('#',''); if(h.length===3) h=h.split('').map(function(c){return c+c;}).join(''); var n=parseInt(h,16); return isNaN(n)?null:[(n>>16)&255,(n>>8)&255,n&255]; }
  function lum(c){ return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; }
  function mix(c,g,f){ return [c[0]+(g-c[0])*f|0,c[1]+(g-c[1])*f|0,c[2]+(g-c[2])*f|0]; }
  function rgba(c,a){ return 'rgba('+c[0]+','+c[1]+','+c[2]+','+a+')'; }
  function cdist(a,b){ var dr=a[0]-b[0],dg=a[1]-b[1],db=a[2]-b[2]; return Math.sqrt(dr*dr+dg*dg+db*db); }
  function usable(c){ return c && lum(c)>=26 && lum(c)<=228; }
  function teamColors(name){
    var CO=window.TDC_TEAM_COLORS||{}, t=CO[(name||'').toLowerCase()]||(window.tdcTeamColor&&window.tdcTeamColor(name));
    if(!t) return null;
    var c1=hexRgb(t.c1), c2=hexRgb(t.c2); if(!c1) return null;
    // if the primary is near-white/near-black, swap in the secondary as "made"
    if(!usable(c1) && usable(c2)){ var tmp=c1; c1=c2; c2=tmp; }
    // missed = the secondary brand color when it's usable & clearly different from
    // the primary (so two-color teams show both logo colors); else a ghosted primary
    var miss=(usable(c2) && cdist(c1,c2)>70) ? c2 : mix(c1,150,0.62);
    return { made:c1, miss:miss };
  }

  var UID=0, HOSTS=[], _rzT=null;
  // re-render every live chart on resize so the Sankey re-lays-out (and replays
  // its flow animation) instead of just stretching
  window.addEventListener('resize',function(){
    clearTimeout(_rzT);
    _rzT=setTimeout(function(){
      HOSTS=HOSTS.filter(function(h){return h.el && document.body.contains(h.el);});
      HOSTS.forEach(function(h){ if(h.el._sfShots) render(h.el, h.el._sfShots, h.el._sfOpts); });
    },220);
  });

  // ── stage extractors ──
  function zoneOf(s){
    if(s.sv===3) return (s.y!=null && s.y<9.5) ? 'Corner 3' : 'Above the Break 3';
    var dx=(s.x||25)-25, dy=(s.y||5.25)-5.25, d=Math.sqrt(dx*dx+dy*dy);
    if(d<=4) return 'Restricted Area';
    if(s.x>=18 && s.x<=32 && s.y<=19) return 'Paint';
    return 'Mid-Range';
  }
  var TYPE_LABEL={layup:'Layup',dunk:'Dunk',tip:'Tip',floater:'Floater',pullup:'Pullup',hook:'Hook',stepback:'Step Back',fadeaway:'Fadeaway',jumper:'Jump Shot'};
  function typeOf(s){ return TYPE_LABEL[s.stype]|| (s.sv===3?'Jump Shot':'Jump Shot'); }
  function outcomeOf(s){ return s.made?'Made':'Missed'; }

  var ZONE_ORDER=['Restricted Area','Paint','Mid-Range','Corner 3','Above the Break 3'];
  var TYPE_ORDER=['Layup','Dunk','Tip','Floater','Hook','Pullup','Step Back','Fadeaway','Jump Shot'];
  var OUT_ORDER=['Made','Missed'];

  function build(shots){
    // assist stage: keep top assisters, fold the rest into "Other"
    var acount={};
    shots.forEach(function(s){ if(s.made){ var a=s.ast_name||'Unassisted'; acount[a]=(acount[a]||0)+1; }});
    var names=Object.keys(acount).filter(function(a){return a!=='Unassisted';})
                    .sort(function(a,b){return acount[b]-acount[a];});
    var keep={}; names.slice(0,6).forEach(function(n){keep[n]=1;});
    function assistOf(s){
      if(!s.made) return null;                      // missed -> terminal
      var a=s.ast_name||'Unassisted';
      if(a==='Unassisted') return 'Unassisted';
      return keep[a]?a:'Other';
    }
    var astOrder=['Unassisted'].concat(names.slice(0,6));
    if(names.length>6) astOrder.push('Other');

    var cols=[
      {key:'zone',label:'ZONE',fn:zoneOf,order:ZONE_ORDER},
      {key:'type',label:'TYPE',fn:typeOf,order:TYPE_ORDER},
      {key:'out', label:'OUTCOME',fn:outcomeOf,order:OUT_ORDER},
      {key:'ast', label:'ASSIST',fn:assistOf,order:astOrder}
    ];
    // per-shot stage values
    var vals=shots.map(function(s){ return cols.map(function(c){return c.fn(s);}); });
    return {cols:cols, vals:vals, made:shots.map(function(s){return s.made;})};
  }

  function shortName(n){
    if(n==='Unassisted'||n==='Other') return n;
    var p=n.trim().split(/\s+/); return p.length>1 ? p[p.length-1] : n;
  }
  // ── SHOT FLOW as a ledger (no Sankey): three row groups in the site's percentile-row
  //    vocabulary. Each row = a bucket; its bar is the bucket's SHARE of attempts (longest =
  //    the biggest bucket) split into made-assisted / made-unassisted / missed; the number
  //    on the right is FG%. WHERE (zone) → HOW (shot type) → WHO SETS HIM UP (assister). ──
  function tally(shots, keyFn){
    var m={}, order=[];
    shots.forEach(function(s){ var k=keyFn(s); if(k==null) return; if(!m[k]){ m[k]={n:0,ma:0,mu:0,x:0}; order.push(k); }
      var b=m[k]; b.n++; if(s.made){ if(s.ast_name) b.ma++; else b.mu++; } else b.x++; });
    return {m:m, order:order};
  }
  function row(label, sub, b, maxN, val, valSub){
    var w=maxN?100*b.n/maxN:0, pa=b.n?100*b.ma/b.n:0, pu=b.n?100*b.mu/b.n:0, px=b.n?100*b.x/b.n:0;
    var tip=b.n+' FGA · '+(b.ma+b.mu)+' made ('+b.ma+' assisted) · '+b.x+' missed';
    return '<div class="sf2-row" title="'+tip+'"><div class="sf2-l">'+label+(sub?'<span class="sf2-sub">'+sub+'</span>':'')+'</div>'+
      '<div class="sf2-track"><div class="sf2-bar" style="width:'+w.toFixed(1)+'%"><i class="sf2-ma" style="width:'+pa.toFixed(1)+'%"></i><i class="sf2-mu" style="width:'+pu.toFixed(1)+'%"></i><i class="sf2-x" style="width:'+px.toFixed(1)+'%"></i></div></div>'+
      '<div class="sf2-v">'+val+(valSub?'<span class="sf2-sub">'+valSub+'</span>':'')+'</div></div>';
  }
  function sec(t,cap){ return '<div class="sf2-sec"><span>'+t+'</span><span class="sf2-cap">'+cap+'</span></div>'; }
  function fgp(b){ return b.n?Math.round(100*(b.ma+b.mu)/b.n)+'%':'—'; }

  function render(el, shots, opts){
    opts=opts||{}; if(!el) return;
    shots=(shots||[]).filter(function(s){return s.x!=null;});
    el.classList.add('sf-host'); el._sfShots=shots; el._sfOpts=opts;
    if(shots.length<8){ el.innerHTML='<div style="padding:36px;text-align:center;color:var(--text3);font-size:13px;">Not enough shot data'+(opts.subtitle?' for '+opts.subtitle:'')+' yet for a shot flow.</div>'; return; }
    var N=shots.length, made=shots.filter(function(s){return s.made;}).length, asst=shots.filter(function(s){return s.made&&s.ast_name;}).length;
    // WHERE
    var Z=tally(shots, zoneOf), zOrder=ZONE_ORDER.filter(function(k){return Z.m[k];});
    var zMax=Math.max.apply(null, zOrder.map(function(k){return Z.m[k].n;}));
    var whereHtml=zOrder.map(function(k){ var b=Z.m[k]; return row(k, b.n+' · '+Math.round(100*b.n/N)+'%', b, zMax, fgp(b), 'FG%'); }).join('');
    // HOW — shot types; rare ones (<3% of attempts) fold into "Other"
    var T=tally(shots, typeOf), tOrder=TYPE_ORDER.filter(function(k){return T.m[k];});
    var other={n:0,ma:0,mu:0,x:0}, keep=[];
    tOrder.forEach(function(k){ var b=T.m[k]; if(b.n/N<0.03 && k!=='Jump Shot'){ other.n+=b.n; other.ma+=b.ma; other.mu+=b.mu; other.x+=b.x; } else keep.push(k); });
    keep.sort(function(a,b){return T.m[b].n-T.m[a].n;});
    var tList=keep.map(function(k){return [k,T.m[k]];}); if(other.n) tList.push(['Other',other]);
    var tMax=Math.max.apply(null, tList.map(function(x){return x[1].n;}));
    var howHtml=tList.map(function(x){ return row(x[0], x[1].n+' · '+Math.round(100*x[1].n/N)+'%', x[1], tMax, fgp(x[1]), 'FG%'); }).join('');
    // WHO — assisters on made shots (share of assisted makes); unassisted makes as the last row
    var madeShots=shots.filter(function(s){return s.made;});
    var A=tally(madeShots, function(s){ return s.ast_name||'Unassisted'; });
    var names=A.order.filter(function(k){return k!=='Unassisted';}).sort(function(a,b){return A.m[b].n-A.m[a].n;});
    var top=names.slice(0,6), rest=names.slice(6), oth={n:0,ma:0,mu:0,x:0};
    rest.forEach(function(k){ oth.n+=A.m[k].n; oth.ma+=A.m[k].ma; });
    var aList=top.map(function(k){return [shortName(k),A.m[k]];}); if(oth.n) aList.push(['Other',oth]);
    var aMax=Math.max.apply(null, aList.concat(A.m['Unassisted']?[['u',A.m['Unassisted']]]:[]).map(function(x){return x[1].n;}));
    var whoHtml=aList.map(function(x){ return row(x[0], x[1].n+' assists', x[1], aMax, Math.round(100*x[1].n/Math.max(1,made))+'%', 'of makes'); }).join('');
    if(A.m['Unassisted']){ var u=A.m['Unassisted']; whoHtml+=row('Unassisted', u.n+' makes', u, aMax, Math.round(100*u.n/Math.max(1,made))+'%', 'of makes'); }
    var head=(opts.title?'<div class="sf-title">'+opts.title+'</div>':'')+
      '<div class="sf-legend"><span><i class="sf-sw sf-sw-ma"></i>Made · assisted</span><span><i class="sf-sw sf-sw-mu"></i>Made · unassisted</span><span><i class="sf-sw sf-sw-x"></i>Missed</span>'+
      '<span style="margin-left:auto;color:var(--text3);">'+N+' FGA · '+Math.round(made/N*100)+'% made · '+Math.round(asst/Math.max(1,made)*100)+'% of makes assisted</span></div>';
    el.innerHTML=head+'<div class="sf2">'+
      sec('Where','zone · attempts · share of shots · FG%')+whereHtml+
      sec('How','shot type · attempts · share · FG%')+howHtml+
      (aList.length||A.m['Unassisted']?sec(opts.who||'Who sets him up','assister · assisted makes · share of all makes')+whoHtml:'')+
      '<div class="sf2-foot">Bar length is the bucket\'s share of attempts (the biggest bucket runs the full width); the split inside is assisted makes / unassisted makes / misses.</div></div>';
    if(!HOSTS.some(function(h){return h.el===el;})) HOSTS.push({el:el});
  }

  if(!document.getElementById('sf-styles')){
    var st=document.createElement('style'); st.id='sf-styles';
    st.textContent=
      '.sf-title{font-size:13px;font-weight:700;color:var(--text2);margin-bottom:8px;}'+
      '.sf-legend{display:flex;align-items:center;gap:14px;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:10px;flex-wrap:wrap;}'+
      '.sf-legend span{display:inline-flex;align-items:center;gap:6px;}'+
      '.sf-host{--sf-ink:26,42,76;}'+
      '[data-theme="dark"] .sf-host{--sf-ink:170,192,236;}'+
      '.sf-sw{width:16px;height:9px;border-radius:2px;display:inline-block;}'+
      '.sf-sw-ma{background:rgba(var(--sf-ink),1);} .sf-sw-mu{background:rgba(var(--sf-ink),.5);} .sf-sw-x{background:var(--bg3);border:1px solid var(--border2);}'+
      '.sf2{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:6px 18px 12px;}'+
      '.sf2-sec{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:2px solid var(--text);padding:12px 0 8px;margin-bottom:2px;}'+
      '.sf2-sec span:first-child{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--text);}'+
      '.sf2-cap{font-size:11px;color:var(--text3);}'+
      '.sf2-row{display:grid;grid-template-columns:minmax(120px,170px) 1fr 74px;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid var(--border);}'+
      '.sf2-l{font-size:12.5px;font-weight:600;color:var(--text);display:flex;flex-direction:column;gap:1px;}'+
      '.sf2-sub{font-size:10.5px;font-weight:500;color:var(--text3);font-variant-numeric:tabular-nums;}'+
      '.sf2-track{position:relative;height:12px;}'+
      '.sf2-bar{position:absolute;left:0;top:0;bottom:0;display:flex;border-radius:3px;overflow:hidden;min-width:6px;background:var(--bg3);}'+
      '.sf2-bar i{display:block;height:100%;}'+
      '.sf2-ma{background:rgba(var(--sf-ink),1);} .sf2-mu{background:rgba(var(--sf-ink),.5);} .sf2-x{background:transparent;}'+
      '.sf2-v{font-size:13px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;color:var(--text);display:flex;flex-direction:column;gap:1px;}'+
      '.sf2-v .sf2-sub{text-align:right;}'+
      '.sf2-foot{font-size:11px;color:var(--text3);line-height:1.5;padding:10px 0 0;}'+
      '@media(max-width:520px){.sf2-row{grid-template-columns:110px 1fr 64px;}}';
    document.head.appendChild(st);
  }
  window.TDC_SHOTFLOW={render:render};
})();
