/* tdc-shotflow.js — Sankey "shot flow" for a player (or team).
   TDC_SHOTFLOW.render(el, shots, opts)
     shots: [{x,y,made,sv,stype,ast_name}]
     opts:  {title, subtitle, team}   // team name -> brand colors for the ribbons
   Flows every field-goal attempt through ZONE -> TYPE -> OUTCOME -> ASSIST.
   Made ribbons take the team's primary color; missed ribbons a ghosted version
   (falls back to green/tan if the team is unknown). On open the ribbons flow in
   left->right and a light band sweeps through every path; re-renders on resize. */
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
    var CO=window.TDC_TEAM_COLORS||{}, t=CO[(name||'').toLowerCase()];
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

  var W=900, H=500, PADT=20, PADB=36, NW=13, GAP=15, MINH=15; // MINH+GAP >= label-box height (26) so labels never overlap
  var colX=[]; // computed
  // find px-per-shot for one column so its nodes (each >= MINH tall) + gaps
  // exactly fill usableH; small nodes get pinned at MINH and the rest scale
  function fitPps(totals, usableH){
    var n=totals.length; if(!n) return Infinity;
    var avail=usableH-(n-1)*GAP, pinned={};
    for(var it=0;it<=n;it++){
      var freeSum=0, pinH=0;
      totals.forEach(function(t,i){ if(pinned[i]) pinH+=MINH; else freeSum+=t; });
      var pps=freeSum>0 ? (avail-pinH)/freeSum : 0;
      var changed=false;
      totals.forEach(function(t,i){ if(!pinned[i] && t*pps<MINH){ pinned[i]=1; changed=true; } });
      if(!changed) return pps;
    }
    return avail/Math.max(1,totals.reduce(function(s,t){return s+t;},0));
  }
  function shortName(n){
    if(n==='Unassisted'||n==='Other') return n;
    var p=n.trim().split(/\s+/); return p.length>1 ? p[p.length-1] : n;
  }

  function render(el, shots, opts){
    opts=opts||{}; if(!el) return;
    shots=(shots||[]).filter(function(s){return s.x!=null;});
    el.classList.add('sf-host'); el._sfShots=shots; el._sfOpts=opts;
    if(shots.length<8){ el.innerHTML='<div style="padding:36px;text-align:center;color:var(--text3);font-size:13px;">Not enough shot data'+(opts.subtitle?' for '+opts.subtitle:'')+' yet for a flow chart.</div>'; return; }
    var B=build(shots), cols=B.cols, N=shots.length;

    // node totals per column (through-flow); assist col only counts made shots
    var nodes=cols.map(function(c,ci){
      var tot={};
      B.vals.forEach(function(v){ var k=v[ci]; if(k==null) return; tot[k]=(tot[k]||0)+1; });
      var order=(c.order||Object.keys(tot)).filter(function(k){return tot[k];});
      return order.map(function(k){return {col:ci,name:k,tot:tot[k]};});
    });

    // vertical scale: the most-constrained column (most nodes / most pinned at
    // MINH) sets pxPerShot; every column then fits usableH with no overlap
    var usableH=H-PADT-PADB, pps=Infinity;
    nodes.forEach(function(list){
      if(!list.length) return;
      pps=Math.min(pps, fitPps(list.map(function(n){return n.tot;}), usableH));
    });
    // x positions
    var innerL=120, innerR=W-98, span=innerR-innerL;
    colX=cols.map(function(_,i){ return innerL + span*i/(cols.length-1); });

    // assign node y (center each column stack); small nodes get a min height so
    // their labels have room to breathe
    var nodeMap={}; // "col:name" -> node
    nodes.forEach(function(list,ci){
      var colH=0; list.forEach(function(n){colH+=Math.max(MINH,n.tot*pps);}); colH+=(list.length-1)*GAP;
      var y=PADT+(usableH-colH)/2;
      list.forEach(function(n){ n.h=Math.max(MINH,n.tot*pps); n.y0=y; n.y1=y+n.h; y+=n.h+GAP; nodeMap[ci+':'+n.name]=n; });
    });

    // links between consecutive columns, keyed by (src,tgt,made) for outcome color
    var links={};
    B.vals.forEach(function(v,si){
      var made=B.made[si];
      for(var c=0;c<cols.length-1;c++){
        var a=v[c], b=v[c+1]; if(a==null||b==null) continue;
        var key=c+'|'+a+'|'+b+'|'+(made?1:0);
        (links[key]||(links[key]={col:c,src:a,tgt:b,made:made,w:0})).w++;
      }
    });
    var L=Object.keys(links).map(function(k){return links[k];});
    L.forEach(function(l){ l.sn=nodeMap[l.col+':'+l.src]; l.tn=nodeMap[(l.col+1)+':'+l.tgt]; });
    L=L.filter(function(l){return l.sn&&l.tn;});

    // stack link bands on source right edges (ordered by target y) and target left edges (by source y)
    var so={}, to={};
    L.slice().sort(function(a,b){return a.sn.y0-b.sn.y0 || a.tn.y0-b.tn.y0;}).forEach(function(l){
      var id=l.col+':'+l.src, off=so[id]||0; l.sy0=l.sn.y0+off; l.sy1=l.sy0+l.w*pps; so[id]=off+l.w*pps;
    });
    L.slice().sort(function(a,b){return a.tn.y0-b.tn.y0 || a.sn.y0-b.sn.y0;}).forEach(function(l){
      var id=(l.col+1)+':'+l.tgt, off=to[id]||0; l.ty0=l.tn.y0+off; l.ty1=l.ty0+l.w*pps; to[id]=off+l.w*pps;
    });

    // ── colors: team brand if we know the team, else green/tan ──
    var tc=teamColors(opts.team);
    var madeFill=tc?rgba(tc.made,0.66):(GREEN+'.62)'), missFill=tc?rgba(tc.miss,0.6):(TAN+'.62)');

    // ── SVG ──
    var uid=++UID, revId='sfrev'+uid, uniId='sfuni'+uid, grdId='sfgrd'+uid;
    var svg='<svg class="sf-svg" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet">';
    // build ribbon paths once; reuse for both the drawn ribbons and the union clip
    var ribsHtml='', clipHtml='';
    L.sort(function(a,b){return b.w-a.w;}).forEach(function(l,i){
      var x0=colX[l.col]+NW, x1=colX[l.col+1], xm=(x0+x1)/2;
      var d='M '+x0+' '+l.sy0.toFixed(1)+' C '+xm+' '+l.sy0.toFixed(1)+' '+xm+' '+l.ty0.toFixed(1)+' '+x1+' '+l.ty0.toFixed(1)+
            ' L '+x1+' '+l.ty1.toFixed(1)+' C '+xm+' '+l.ty1.toFixed(1)+' '+xm+' '+l.sy1.toFixed(1)+' '+x0+' '+l.sy1.toFixed(1)+' Z';
      var tip=l.src+' → '+l.tgt+' · '+l.w+' shot'+(l.w>1?'s':'')+' ('+(l.made?'made':'missed')+')';
      ribsHtml+='<path class="sf-rib" data-t="'+tip+'" data-src="'+l.col+':'+l.src+'" data-tgt="'+(l.col+1)+':'+l.tgt+'" d="'+d+'" fill="'+(l.made?madeFill:missFill)+'"/>';
      clipHtml+='<path d="'+d+'"/>';
    });
    // defs: a left→right reveal clip (entrance) + a union-of-ribbons clip and a
    // bright band gradient (the continuous "flow through every path" shimmer)
    svg+='<defs>'+
      '<clipPath id="'+revId+'" clipPathUnits="userSpaceOnUse"><rect class="sf-revrect" x="0" y="0" width="'+W+'" height="'+H+'"/></clipPath>'+
      '<clipPath id="'+uniId+'" clipPathUnits="userSpaceOnUse">'+clipHtml+'</clipPath>'+
      '<linearGradient id="'+grdId+'" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'+
      '</defs>';
    // ribbons revealed flowing in from the left, then a repeating light sweep
    svg+='<g clip-path="url(#'+revId+')">'+ribsHtml+
         '<g clip-path="url(#'+uniId+')"><rect class="sf-sweep" x="-220" y="0" width="200" height="'+H+'" fill="url(#'+grdId+')"/></g>'+
         '</g>';
    // nodes + labels (with a readable background box; first & last columns label
    // to the OUTSIDE, middle columns to the right of their bar)
    var lastCol=cols.length-1;
    nodes.forEach(function(list,ci){
      list.forEach(function(n){
        svg+='<rect class="sf-node" data-node="'+ci+':'+n.name+'" x="'+colX[ci]+'" y="'+n.y0.toFixed(1)+'" width="'+NW+'" height="'+n.h.toFixed(1)+'" rx="1.5"/>';
        var nm=(ci===lastCol?shortName(n.name):n.name), sub=n.tot+' ('+Math.round(n.tot/N*100)+'%)';
        var toLeft=(ci===0||ci===lastCol), anchor=toLeft?'end':'start';
        var edgeX=toLeft?(colX[ci]-7):(colX[ci]+NW+7);
        var cy=(n.y0+n.y1)/2;
        var tw=Math.max(nm.length*7.2, sub.length*5.6)+10;
        var bx=toLeft?(edgeX-tw):edgeX-2;
        svg+='<rect class="sf-lbg" x="'+bx.toFixed(1)+'" y="'+(cy-13).toFixed(1)+'" width="'+tw.toFixed(1)+'" height="26" rx="4"/>';
        svg+='<text class="sf-lbl" x="'+edgeX.toFixed(1)+'" y="'+(cy-2).toFixed(1)+'" text-anchor="'+anchor+'">'+nm+'</text>';
        svg+='<text class="sf-sub" x="'+edgeX.toFixed(1)+'" y="'+(cy+10).toFixed(1)+'" text-anchor="'+anchor+'">'+sub+'</text>';
      });
    });
    // column headers
    cols.forEach(function(c,ci){
      svg+='<text class="sf-hdr" x="'+(colX[ci]+NW/2)+'" y="'+(H-10)+'" text-anchor="middle">'+c.label+'</text>';
    });
    svg+='</svg>';

    var made=shots.filter(function(s){return s.made;}).length;
    var asst=shots.filter(function(s){return s.made&&s.ast_name;}).length;
    var head=(opts.title?'<div class="sf-title">'+opts.title+'</div>':'')+
      '<div class="sf-legend"><span><i style="background:'+madeFill+'"></i>Made</span><span><i style="background:'+missFill+'"></i>Missed</span>'+
      '<span style="margin-left:auto;color:var(--text3);">'+N+' FGA · '+Math.round(made/N*100)+'% made · '+Math.round(asst/Math.max(1,made)*100)+'% of makes assisted</span></div>';
    el.innerHTML=head+'<div class="sf-scroll"><div class="sf-wrap">'+svg+'<div class="sf-tip"></div></div></div>';
    wire(el);
    if(!HOSTS.some(function(h){return h.el===el;})) HOSTS.push({el:el});
    clearTimeout(el._sfSettle); el._sfSettle=setTimeout(function(){el.classList.add('sf-settled');},1500);
  }

  function wire(el){
    var wrap=el.querySelector('.sf-wrap'), tip=el.querySelector('.sf-tip');
    if(!wrap) return;
    wrap.addEventListener('mousemove',function(e){
      var t=e.target.closest?e.target.closest('[data-t]'):null;
      if(!t){ tip.classList.remove('on'); return; }
      var r=wrap.getBoundingClientRect();
      tip.textContent=t.getAttribute('data-t');
      tip.style.left=(e.clientX-r.left)+'px'; tip.style.top=(e.clientY-r.top-12)+'px';
      tip.classList.add('on');
    });
    wrap.addEventListener('mouseleave',function(){ tip.classList.remove('on'); el.classList.remove('sf-focus'); });
    // node hover -> highlight only ribbons touching it
    el.querySelectorAll('.sf-node').forEach(function(nd){
      var id=nd.getAttribute('data-node');
      nd.addEventListener('mouseenter',function(){
        el.classList.add('sf-focus');
        el.querySelectorAll('.sf-rib').forEach(function(r){
          var on=r.getAttribute('data-src')===id||r.getAttribute('data-tgt')===id;
          r.classList.toggle('sf-on',on);
        });
      });
      nd.addEventListener('mouseleave',function(){ el.classList.remove('sf-focus'); el.querySelectorAll('.sf-rib.sf-on').forEach(function(r){r.classList.remove('sf-on');}); });
    });
  }

  if(!document.getElementById('sf-styles')){
    var st=document.createElement('style'); st.id='sf-styles';
    st.textContent=
      '@keyframes sfReveal{from{transform:scaleX(0);}to{transform:scaleX(1);}}'+
      '@keyframes sfSweep{from{transform:translateX(0);}to{transform:translateX(1140px);}}'+
      '.sf-title{font-size:13px;font-weight:700;color:var(--text2);margin-bottom:8px;}'+
      '.sf-legend{display:flex;align-items:center;gap:14px;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:10px;flex-wrap:wrap;}'+
      '.sf-legend span{display:inline-flex;align-items:center;gap:6px;}'+
      '.sf-legend i{width:16px;height:9px;border-radius:2px;display:inline-block;}'+
      '.sf-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;}'+
      '.sf-wrap{position:relative;min-width:660px;max-width:1200px;margin:0 auto;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:8px 6px;}'+
      '.sf-svg{width:100%;height:auto;display:block;overflow:visible;}'+
      // entrance: the reveal clip grows left->right so ribbons flow through the columns
      '.sf-revrect{transform-box:fill-box;transform-origin:left center;animation:sfReveal 1.25s cubic-bezier(.45,.05,.25,1) both;}'+
      // continuous flow: a light band sweeps through the ribbon union, on a loop
      '.sf-sweep{pointer-events:none;animation:sfSweep 2.6s linear 1.1s 3;mix-blend-mode:screen;}'+
      '.sf-rib{transition:fill-opacity .15s,opacity .15s;cursor:pointer;}'+
      '.sf-rib:hover{fill-opacity:.95!important;}'+
      '.sf-host.sf-focus .sf-rib{opacity:.12;}'+
      '.sf-host.sf-focus .sf-rib.sf-on{opacity:1;}'+
      '.sf-node{fill:var(--text);opacity:.9;cursor:pointer;transition:opacity .15s;}'+
      '.sf-node:hover{opacity:1;}'+
      '.sf-lbg{fill:var(--bg2);opacity:.72;pointer-events:none;}'+
      '.sf-lbl{font-family:\'Playfair Display\',Georgia,serif;font-weight:700;font-size:12.5px;fill:var(--text);}'+
      '.sf-sub{font-size:10px;fill:var(--text3);font-weight:600;}'+
      '.sf-hdr{font-size:11px;font-weight:800;letter-spacing:.12em;fill:var(--text3);}'+
      '.sf-tip{position:absolute;pointer-events:none;background:var(--text);color:var(--bg);font-size:11px;font-weight:700;padding:5px 9px;border-radius:7px;transform:translate(-50%,-100%);opacity:0;transition:opacity .12s;white-space:nowrap;z-index:20;box-shadow:0 6px 18px rgba(0,0,0,.3);}'+
      '.sf-tip.on{opacity:1;}'+
      // settle-guard: if the animation clock is frozen, force the reveal fully open
      '.sf-settled .sf-revrect{animation:none!important;transform:scaleX(1)!important;}'+
      '.sf-settled .sf-sweep{animation:none!important;}';
    document.head.appendChild(st);
  }
  window.TDC_SHOTFLOW={render:render};
})();
