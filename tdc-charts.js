/* tdc-charts.js — reusable league-analytics visualizations, our own data + rendering.
   TDC_CHARTS.quadrant(el, data, opts)   team offense vs defense efficiency, 4 quadrants
   TDC_CHARTS.bubbles (el, data, opts)   player scoring volume vs efficiency (bubble pack)
   TDC_CHARTS.march   (el, data, opts)   reg-season vs NCAA-tourney scoring by year (dumbbell)
   TDC_CHARTS.dropoff (el, data, opts)   tourney teams' offensive rating reg -> March (lollipop)
   Data comes from scripts/data/chart_*.json (built by scripts/build_charts.py). */
(function(){
  var CO=(window.TDC_TEAM_COLORS)||{};
  function col(name){ var k=(name||'').toLowerCase(); return CO[k]||{c1:'#7c6fb0',c2:'#cfc8e6',logo:''}; }
  function logo(name){ return col(name).logo||''; }
  function med(a){ a=a.slice().sort(function(x,y){return x-y;}); var m=a.length>>1; return a.length%2?a[m]:(a[m-1]+a[m])/2; }
  function lastName(n){ var p=(n||'').trim().split(/\s+/); while(p.length>1&&/^(jr|sr|ii|iii|iv|v)\.?$/i.test(p[p.length-1])) p.pop(); return p[p.length-1]||n; }
  function tipEl(host){ var t=host.querySelector('.tc-tip'); if(!t){ t=document.createElement('div'); t.className='tc-tip'; host.appendChild(t);} return t; }
  function wireTip(host){
    var t=tipEl(host);
    host.addEventListener('mousemove',function(e){
      var el=e.target.closest?e.target.closest('[data-t]'):null;
      if(!el){ t.classList.remove('on'); return; }
      var r=host.getBoundingClientRect();
      t.innerHTML=el.getAttribute('data-t');
      t.style.left=(e.clientX-r.left)+'px'; t.style.top=(e.clientY-r.top-14)+'px'; t.classList.add('on');
    });
    host.addEventListener('mouseleave',function(){ t.classList.remove('on'); });
  }
  // TS% color: pink (cold) -> pale -> green (hot)
  function tsColor(ts){
    var t=Math.max(0,Math.min(1,(ts-48)/(66-48)));
    var lo=[233,42,122], mid=[236,232,224], hi=[38,190,74];
    function lp(a,b,f){return 'rgb('+[0,1,2].map(function(i){return a[i]+(b[i]-a[i])*f|0;}).join(',')+')';}
    return t<0.5?lp(lo,mid,t*2):lp(mid,hi,(t-0.5)*2);
  }

  // ── 1) CONTENDER QUADRANT ──────────────────────────────────────────────
  function quadrant(el, data, opts){
    opts=opts||{}; if(!el) return; el.classList.add('tc-host');
    data=data.filter(function(d){return d.ortg&&d.drtg;});
    var W=760, H=560, P=54;
    var oR=[Math.min.apply(0,data.map(function(d){return d.ortg;}))-2, Math.max.apply(0,data.map(function(d){return d.ortg;}))+2];
    var dR=[Math.min.apply(0,data.map(function(d){return d.drtg;}))-2, Math.max.apply(0,data.map(function(d){return d.drtg;}))+2];
    var oMed=med(data.map(function(d){return d.ortg;})), dMed=med(data.map(function(d){return d.drtg;}));
    function X(o){ return P+(o-oR[0])/(oR[1]-oR[0])*(W-2*P); }
    function Y(d){ return P+(d-dR[0])/(dR[1]-dR[0])*(H-2*P); } // lower drtg (better D) -> smaller y -> higher
    var cx=X(oMed), cy=Y(dMed);
    var g='<svg viewBox="0 0 '+W+' '+H+'" class="tc-svg">';
    // quadrant tints
    g+='<rect x="'+cx+'" y="'+P+'" width="'+(W-P-cx)+'" height="'+(cy-P)+'" fill="rgba(56,170,90,.06)"/>';   // TR contenders
    g+='<rect x="'+P+'" y="'+cy+'" width="'+(cx-P)+'" height="'+(H-P-cy)+'" fill="rgba(200,60,50,.05)"/>';    // BL cellar
    // center lines
    g+='<line x1="'+cx+'" y1="'+P+'" x2="'+cx+'" y2="'+(H-P)+'" stroke="var(--border2)" stroke-dasharray="4 4"/>';
    g+='<line x1="'+P+'" y1="'+cy+'" x2="'+(W-P)+'" y2="'+cy+'" stroke="var(--border2)" stroke-dasharray="4 4"/>';
    // quadrant labels
    function ql(x,y,t,a){ return '<text class="tc-qlbl" x="'+x+'" y="'+y+'" text-anchor="'+a+'">'+t+'</text>'; }
    g+=ql(W-P-6,P+16,'CONTENDERS','end')+ql(P+6,P+16,'STINGY, NO PUNCH','start')+
       ql(W-P-6,H-P-8,'FIREPOWER, NO STOPS','end')+ql(P+6,H-P-8,'THE CELLAR','start');
    // dots
    data.forEach(function(d){
      var c=col(d.team), x=X(d.ortg), y=Y(d.drtg);
      var top=(d.net>=oMed*0+ (data[11]?data[11].net:8)); // top ~12 by net (data sorted desc)
      var tip='<b>'+d.team+'</b><br>ORtg '+d.ortg+' · DRtg '+d.drtg+'<br>Net '+(d.net>=0?'+':'')+d.net+' · '+d.w+'-'+d.l+(d.seed?' · '+d.seed+' seed':'');
      g+='<circle class="tc-dot" data-t="'+tip.replace(/"/g,'&quot;')+'" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+(top?6.5:4)+'" fill="'+c.c1+'" stroke="#fff" stroke-width="1"/>';
    });
    // logos + labels for the top teams
    data.slice(0,12).forEach(function(d){
      var x=X(d.ortg), y=Y(d.drtg), lg=logo(d.team);
      if(lg) g+='<image href="'+lg+'" x="'+(x-11)+'" y="'+(y-24)+'" width="22" height="22" style="pointer-events:none"/>';
    });
    // axes
    g+='<text class="tc-ax" x="'+(W/2)+'" y="'+(H-14)+'" text-anchor="middle">OFFENSIVE RATING  (points per 100 poss) →</text>';
    g+='<text class="tc-ax" x="18" y="'+(H/2)+'" text-anchor="middle" transform="rotate(-90 18 '+(H/2)+')">← BETTER DEFENSE</text>';
    g+='</svg>';
    el.innerHTML='<div class="tc-wrap">'+g+'</div>'; wireTip(el);
  }

  // ── 2) VOLUME vs EFFICIENCY BUBBLES ────────────────────────────────────
  function bubbles(el, data, opts){
    opts=opts||{}; if(!el) return; el.classList.add('tc-host');
    var W=760, H=680;
    var maxP=Math.max.apply(0,data.map(function(d){return d.pts;}));
    function rad(p){ return 12+58*Math.sqrt(p/maxP); }
    // greedy pack: largest first near top-center, each next placed at the nearest
    // non-overlapping spot scanning outward
    var placed=[]; var cx=W/2, cy=120;
    data.forEach(function(d,i){
      var r=rad(d.pts), best=null;
      if(!placed.length){ best={x:cx,y:cy+r}; }
      else{
        for(var ring=0; ring<4000 && !best; ring+=6){
          for(var a=0;a<360;a+=12){
            var ang=a*Math.PI/180, x=cx+Math.cos(ang)*ring, y=cy+r+Math.sin(ang)*ring*0.9;
            if(x-r<6||x+r>W-6||y-r<6){ continue; }
            var ok=true;
            for(var j=0;j<placed.length;j++){ var pl=placed[j],dx=x-pl.x,dy=y-pl.y; if(dx*dx+dy*dy<(r+pl.r+1.5)*(r+pl.r+1.5)){ok=false;break;} }
            if(ok){ best={x:x,y:y}; break; }
          }
        }
      }
      if(!best) best={x:cx,y:cy};
      placed.push({x:best.x,y:best.y,r:r,d:d});
    });
    var maxY=Math.max.apply(0,placed.map(function(p){return p.y+p.r;}))+16;
    var g='<svg viewBox="0 0 '+W+' '+Math.max(H,maxY)+'" class="tc-svg">';
    placed.forEach(function(p,i){
      var d=p.d, big=p.r>26;
      var tip='<b>'+d.player+'</b> · '+d.team+'<br>'+d.pts+' pts · '+d.fga+' FGA<br>'+d.ts+' TS%';
      g+='<g class="tc-bub" data-t="'+tip.replace(/"/g,'&quot;')+'" style="animation-delay:'+Math.min(i*14,900)+'ms">';
      g+='<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="'+p.r.toFixed(1)+'" fill="'+tsColor(d.ts)+'" stroke="rgba(0,0,0,.15)"/>';
      if(big){
        var nm=lastName(d.player);
        g+='<text class="tc-bnm" x="'+p.x.toFixed(1)+'" y="'+(p.y-1).toFixed(1)+'" text-anchor="middle">'+nm+'</text>';
        g+='<text class="tc-bsub" x="'+p.x.toFixed(1)+'" y="'+(p.y+11).toFixed(1)+'" text-anchor="middle">'+d.pts+'</text>';
      }
      g+='</g>';
    });
    g+='</svg>';
    el.innerHTML='<div class="tc-wrap">'+g+'</div>'; wireTip(el);
  }

  // ── 3) THE MARCH DROP-OFF (dumbbell by year) ───────────────────────────
  function march(el, data, opts){
    opts=opts||{}; if(!el) return; el.classList.add('tc-host');
    var W=820, H=440, P=48, PB=44;
    var vals=[]; data.forEach(function(d){vals.push(d.reg,d.tny);});
    var lo=Math.min.apply(0,vals)-2, hi=Math.max.apply(0,vals)+2;
    function X(i){ return P+i/(data.length-1)*(W-2*P); }
    function Y(v){ return (H-PB)-(v-lo)/(hi-lo)*(H-P-PB); }
    var avgDrop=data.reduce(function(s,d){return s+d.diff;},0)/data.length;
    var cur=data[data.length-1];
    var g='<svg viewBox="0 0 '+W+' '+H+'" class="tc-svg">';
    // gridlines
    for(var v=Math.ceil(lo/5)*5; v<hi; v+=5){ var y=Y(v); g+='<line x1="'+P+'" y1="'+y+'" x2="'+(W-P)+'" y2="'+y+'" stroke="var(--border)" stroke-width="1"/><text class="tc-ax" x="'+(P-8)+'" y="'+(y+3)+'" text-anchor="end">'+v+'</text>'; }
    data.forEach(function(d,i){
      var x=X(i), yr=Y(d.reg), yt=Y(d.tny), rise=d.diff>0;
      g+='<line class="tc-stem" x1="'+x+'" y1="'+yr+'" x2="'+x+'" y2="'+yt+'" stroke="'+(rise?'#2fa24e':'#d8483f')+'" stroke-width="3"/>';
      var tip='<b>'+((d.year-1)+'-'+(''+d.year).slice(2))+'</b><br>Reg season '+d.reg+' · Tourney '+d.tny+'<br>'+(d.diff>0?'+':'')+d.diff+' PPG';
      g+='<circle data-t="'+tip.replace(/"/g,'&quot;')+'" cx="'+x+'" cy="'+yr+'" r="4.5" fill="#8a8398"/>';
      g+='<circle data-t="'+tip.replace(/"/g,'&quot;')+'" cx="'+x+'" cy="'+yt+'" r="4.5" fill="#fff" stroke="#8a8398" stroke-width="1.5"/>';
      if(i%2===0||i===data.length-1) g+='<text class="tc-ax" x="'+x+'" y="'+(H-14)+'" text-anchor="middle">\''+(''+d.year).slice(2)+'</text>';
    });
    // current-year callout
    g+='<text class="tc-cur" x="'+X(data.length-1)+'" y="'+(Y(cur.reg)-12)+'" text-anchor="middle">This year</text>';
    g+='</svg>';
    var head='<div class="tc-note"><b>'+data.length+'-season pattern</b> · scoring drops in March every year · avg <b>'+avgDrop.toFixed(1)+' PPG</b>, this year <b style="color:#d8483f">'+cur.diff+' PPG</b></div>'+
      '<div class="tc-legend"><span><i style="background:#8a8398"></i>Reg-season PPG</span><span><i style="background:#fff;border:1.5px solid #8a8398"></i>Tournament PPG</span></div>';
    el.innerHTML=head+'<div class="tc-wrap">'+g+'</div>'; wireTip(el);
  }

  // ── 4) TOURNAMENT OFFENSIVE DROP-OFFS (lollipop) ───────────────────────
  function dropoff(el, data, opts){
    opts=opts||{}; if(!el) return; el.classList.add('tc-host');
    data=data.filter(function(d){return d.games>=2;}).sort(function(a,b){return b.reg-a.reg;}); // teams that advanced
    if(data.length>20) data=data.slice(0,20);
    var W=Math.max(760, data.length*56), H=460, P=40, PB=70;
    var vals=[]; data.forEach(function(d){vals.push(d.reg,d.tny);});
    var lo=Math.min.apply(0,vals)-3, hi=Math.max.apply(0,vals)+6;
    function X(i){ return P+(i+0.5)/data.length*(W-2*P); }
    function Y(v){ return (H-PB)-(v-lo)/(hi-lo)*(H-P-PB); }
    var regAvg=data.reduce(function(s,d){return s+d.reg;},0)/data.length;
    var tnyAvg=data.reduce(function(s,d){return s+d.tny;},0)/data.length;
    var g='<svg viewBox="0 0 '+W+' '+H+'" class="tc-svg">';
    g+='<line x1="'+P+'" y1="'+Y(regAvg)+'" x2="'+(W-P)+'" y2="'+Y(regAvg)+'" stroke="#2fa24e" stroke-dasharray="4 4" stroke-width="1"/><text class="tc-ax" x="'+(W-P)+'" y="'+(Y(regAvg)-4)+'" text-anchor="end" fill="#2fa24e">Reg. avg</text>';
    g+='<line x1="'+P+'" y1="'+Y(tnyAvg)+'" x2="'+(W-P)+'" y2="'+Y(tnyAvg)+'" stroke="#8a8398" stroke-dasharray="4 4" stroke-width="1"/><text class="tc-ax" x="'+(W-P)+'" y="'+(Y(tnyAvg)-4)+'" text-anchor="end">Tourney avg</text>';
    data.forEach(function(d,i){
      var x=X(i), yr=Y(d.reg), yt=Y(d.tny), rise=d.diff>0, c=rise?'#2fa24e':'#d8483f';
      var tip='<b>'+d.team+'</b>'+(d.seed?' ('+d.seed+' seed)':'')+'<br>Reg ORtg '+d.reg+' → Tourney '+d.tny+'<br>'+(d.diff>0?'+':'')+d.diff+' per 100';
      g+='<line class="tc-stem" data-t="'+tip.replace(/"/g,'&quot;')+'" x1="'+x+'" y1="'+yr+'" x2="'+x+'" y2="'+yt+'" stroke="'+c+'" stroke-width="4"/>';
      g+='<circle data-t="'+tip.replace(/"/g,'&quot;')+'" cx="'+x+'" cy="'+yr+'" r="4" fill="#8a8398"/>';
      g+='<rect data-t="'+tip.replace(/"/g,'&quot;')+'" x="'+(x-5)+'" y="'+(yt-5)+'" width="10" height="10" rx="2" fill="#fff" stroke="'+c+'" stroke-width="2"/>';
      g+='<text class="tc-diff" x="'+x+'" y="'+(yt+(rise?-12:20))+'" text-anchor="middle" fill="'+c+'">'+(d.diff>0?'+':'')+d.diff+'</text>';
      var lg=logo(d.team);
      if(lg) g+='<image href="'+lg+'" x="'+(x-11)+'" y="'+(H-PB+16)+'" width="22" height="22" style="pointer-events:none"/>';
    });
    g+='<text class="tc-ax" x="14" y="'+(H/2)+'" text-anchor="middle" transform="rotate(-90 14 '+(H/2)+')">OFFENSIVE RATING</text>';
    g+='</svg>';
    var head='<div class="tc-legend"><span><i style="background:#8a8398"></i>Reg-season ORtg</span><span><i style="background:#fff;border:2px solid #888"></i>Tournament ORtg</span><span style="color:var(--text3)">how each team\'s offense held up in March</span></div>';
    el.innerHTML=head+'<div class="tc-wrap tc-scroll">'+g+'</div>'; wireTip(el);
  }

  if(!document.getElementById('tc-styles')){
    var st=document.createElement('style'); st.id='tc-styles';
    st.textContent=
      '@keyframes tcPop{from{opacity:0;transform:scale(.4);}to{opacity:1;transform:scale(1);}}'+
      '.tc-host{position:relative;}'+
      '.tc-wrap{position:relative;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:10px;}'+
      '.tc-scroll{overflow-x:auto;}'+
      '.tc-svg{width:100%;height:auto;display:block;overflow:visible;}'+
      '.tc-dot{cursor:pointer;transition:r .12s;}.tc-dot:hover{r:8;}'+
      '.tc-qlbl{font-size:11px;font-weight:800;letter-spacing:.08em;fill:var(--text3);opacity:.75;}'+
      '.tc-ax{font-size:10.5px;font-weight:700;letter-spacing:.04em;fill:var(--text3);}'+
      '.tc-bub{cursor:pointer;animation:tcPop .5s cubic-bezier(.34,1.56,.64,1) backwards;transition:transform .12s;transform-box:fill-box;transform-origin:center;}'+
      '.tc-bub:hover{filter:brightness(1.08);}'+
      '.tc-bnm{font-family:\'Playfair Display\',Georgia,serif;font-weight:800;font-size:13px;fill:#0e2417;pointer-events:none;}'+
      '.tc-bsub{font-size:10px;font-weight:700;fill:#0e2417;opacity:.7;pointer-events:none;}'+
      '.tc-stem{cursor:pointer;}'+
      '.tc-cur{font-size:12px;font-weight:800;fill:#e0a800;}'+
      '.tc-diff{font-size:10px;font-weight:800;}'+
      '.tc-note{font-size:12.5px;color:var(--text2);margin-bottom:8px;}'+
      '.tc-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:10px;}'+
      '.tc-legend span{display:inline-flex;align-items:center;gap:6px;}'+
      '.tc-legend i{width:11px;height:11px;border-radius:50%;display:inline-block;}'+
      '.tc-tip{position:absolute;pointer-events:none;background:var(--text);color:var(--bg);font-size:11px;font-weight:600;line-height:1.5;padding:6px 10px;border-radius:8px;transform:translate(-50%,-100%);opacity:0;transition:opacity .12s;white-space:nowrap;z-index:30;box-shadow:0 8px 24px rgba(0,0,0,.32);}'+
      '.tc-tip.on{opacity:1;}'+
      '.tc-tip b{font-weight:800;}';
    document.head.appendChild(st);
  }
  window.TDC_CHARTS={quadrant:quadrant,bubbles:bubbles,march:march,dropoff:dropoff};
})();
