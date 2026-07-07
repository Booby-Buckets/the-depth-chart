/* tdc-shotflow.js — Sankey "shot flow" for a player (or team).
   TDC_SHOTFLOW.render(el, shots, opts)
     shots: [{x,y,made,sv,stype,ast_name}]
     opts:  {title, subtitle}
   Flows every field-goal attempt through ZONE -> TYPE -> OUTCOME -> ASSIST.
   Ribbons are threaded by outcome (green = made, tan = missed) so you can trace
   how a player's shot diet converts. Missed shots terminate at OUTCOME (no
   assist); made shots continue to who set them up. */
(function(){
  var GREEN='rgba(56,150,100,', TAN='rgba(198,168,112,';

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

    // ── SVG ──
    var svg='<svg class="sf-svg" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet">';
    // ribbons
    L.sort(function(a,b){return b.w-a.w;}).forEach(function(l,i){
      var x0=colX[l.col]+NW, x1=colX[l.col+1], xm=(x0+x1)/2;
      var col=(l.made?GREEN:TAN);
      var d='M '+x0+' '+l.sy0.toFixed(1)+' C '+xm+' '+l.sy0.toFixed(1)+' '+xm+' '+l.ty0.toFixed(1)+' '+x1+' '+l.ty0.toFixed(1)+
            ' L '+x1+' '+l.ty1.toFixed(1)+' C '+xm+' '+l.ty1.toFixed(1)+' '+xm+' '+l.sy1.toFixed(1)+' '+x0+' '+l.sy1.toFixed(1)+' Z';
      var made=Math.round(l.w/(l.made?1:1)); // weight
      var tip=l.src+' → '+l.tgt+' · '+l.w+' shot'+(l.w>1?'s':'')+' ('+(l.made?'made':'missed')+')';
      svg+='<path class="sf-rib" data-t="'+tip+'" data-src="'+l.col+':'+l.src+'" data-tgt="'+(l.col+1)+':'+l.tgt+'" d="'+d+'" fill="'+col+'.62)" style="animation-delay:'+Math.min(i*10,600)+'ms"/>';
    });
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
      '<div class="sf-legend"><span><i class="sf-g"></i>Made</span><span><i class="sf-t"></i>Missed</span>'+
      '<span style="margin-left:auto;color:var(--text3);">'+N+' FGA · '+Math.round(made/N*100)+'% made · '+Math.round(asst/Math.max(1,made)*100)+'% of makes assisted</span></div>';
    el.innerHTML=head+'<div class="sf-scroll"><div class="sf-wrap">'+svg+'<div class="sf-tip"></div></div></div>';
    wire(el);
    clearTimeout(el._sfSettle); el._sfSettle=setTimeout(function(){el.classList.add('sf-settled');},1200);
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
      '@keyframes sfRib{from{opacity:0;}to{opacity:1;}}'+
      '@keyframes sfUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}'+
      '.sf-title{font-size:13px;font-weight:700;color:var(--text2);margin-bottom:8px;}'+
      '.sf-legend{display:flex;align-items:center;gap:14px;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:10px;flex-wrap:wrap;}'+
      '.sf-legend span{display:inline-flex;align-items:center;gap:6px;}'+
      '.sf-g{width:16px;height:9px;border-radius:2px;background:rgba(56,150,100,.75);display:inline-block;}'+
      '.sf-t{width:16px;height:9px;border-radius:2px;background:rgba(198,168,112,.85);display:inline-block;}'+
      '.sf-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;}'+
      '.sf-wrap{position:relative;min-width:660px;max-width:900px;margin:0 auto;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:8px 6px;}'+
      '.sf-svg{width:100%;height:auto;display:block;overflow:visible;}'+
      '.sf-rib{animation:sfRib .5s ease backwards;transition:fill-opacity .15s,opacity .15s;cursor:pointer;}'+
      '.sf-rib:hover{fill-opacity:.9!important;}'+
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
      '.sf-settled .sf-rib{animation:none!important;}';
    document.head.appendChild(st);
  }
  window.TDC_SHOTFLOW={render:render};
})();
