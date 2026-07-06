/* tdc-shotchart.js — half-court shot chart + frequency heat map (player or team).
   TDC_SHOTCHART.render(el, shots, opts)
     shots: [{x,y,made,sv,dist}]  (ESPN coords: x 0-50 width, y feet from baseline)
     opts:  {title, subtitle, mode:'shots'|'heat'}
   Modes: "Shots" = made/missed markers; "Heat" = KDE shot-frequency heatmap. */
(function(){
  var FT=10;                              // px per foot
  var HOOP_X=25, HOOP_Y=5.25;             // hoop center in feet
  var W=50*FT, H=42*FT;                   // show 0-42 ft of the half court
  function px(fx){return fx*FT;}
  function py(fy){return H-fy*FT;}        // baseline at the bottom, y grows up
  function clampx(v){return Math.max(0,Math.min(50,v));}
  function edist(s){
    if(s.dist!=null && s.dist>=0) return s.dist;
    var dx=(s.x||0)-HOOP_X, dy=(s.y||0)-HOOP_Y; return Math.sqrt(dx*dx+dy*dy);
  }
  function court(line){
    var hx=px(HOOP_X), hy=py(HOOP_Y), g='';
    g+='<rect x="1" y="1" width="'+(W-2)+'" height="'+(H-2)+'" fill="none" stroke="'+line+'" stroke-width="2"/>';
    g+='<rect x="'+px(19)+'" y="'+py(19)+'" width="'+px(12)+'" height="'+(py(0)-py(19))+'" fill="none" stroke="'+line+'" stroke-width="1.5"/>';
    g+='<circle cx="'+px(25)+'" cy="'+py(19)+'" r="'+px(6)+'" fill="none" stroke="'+line+'" stroke-width="1.5"/>';
    g+='<path d="M '+(hx-px(4))+' '+hy+' A '+px(4)+' '+px(4)+' 0 0 0 '+(hx+px(4))+' '+hy+'" fill="none" stroke="'+line+'" stroke-width="1.5"/>';
    g+='<line x1="'+(px(25)-px(3))+'" y1="'+py(4)+'" x2="'+(px(25)+px(3))+'" y2="'+py(4)+'" stroke="'+line+'" stroke-width="2"/>';
    g+='<circle cx="'+hx+'" cy="'+hy+'" r="'+px(0.75)+'" fill="none" stroke="'+line+'" stroke-width="2"/>';
    var cornerX=250-216.5, cornerYtop=hy-46.8;
    g+='<path d="M '+cornerX+' '+py(0)+' L '+cornerX+' '+cornerYtop+
        ' A 221.5 221.5 0 0 1 '+(500-cornerX)+' '+cornerYtop+' L '+(500-cornerX)+' '+py(0)+'" fill="none" stroke="'+line+'" stroke-width="1.5"/>';
    return g;
  }
  function zones(shots){
    var z={rim:[0,0],mid:[0,0],three:[0,0]};
    shots.forEach(function(s){ var k=s.sv===3?'three':(edist(s)<=4?'rim':'mid'); z[k][1]++; if(s.made)z[k][0]++; });
    return z;
  }
  function pct(a){ return a[1] ? Math.round(a[0]/a[1]*100) : 0; }

  // ── Division-1 baseline FG% by distance (approx; refined from data post-backfill) ──
  function d1FG(dist, isThree){
    if(isThree) return dist>=23.5 ? 0.335 : 0.360;      // above-break vs corner 3
    if(dist<=4)  return 0.615;                           // at the rim
    if(dist<=9)  return 0.415;
    if(dist<=15) return 0.380;
    return 0.360;                                        // long two
  }
  // diverging color for (playerFG - d1avg), clamped to +/-15%
  function effColor(diff){
    var t=Math.max(-1,Math.min(1,diff/0.15));
    var lo=[62,116,204], mid=[238,238,242], hi=[196,54,46];
    function lerp(a,b,f){return [a[0]+(b[0]-a[0])*f|0,a[1]+(b[1]-a[1])*f|0,a[2]+(b[2]-a[2])*f|0];}
    var c = t<0 ? lerp(mid,lo,-t) : lerp(mid,hi,t);
    return 'rgb('+c[0]+','+c[1]+','+c[2]+')';
  }
  // ── hex grid (pointy-top) ──
  var HS=1.5;                                            // hex size in feet
  function axial(x,y){ var q=(Math.sqrt(3)/3*x - 1/3*y)/HS, r=(2/3*y)/HS; return hexRound(q,r); }
  function hexRound(q,r){
    var s=-q-r, rq=Math.round(q), rr=Math.round(r), rs=Math.round(s);
    var dq=Math.abs(rq-q), dr=Math.abs(rr-r), ds=Math.abs(rs-s);
    if(dq>dr&&dq>ds) rq=-rr-rs; else if(dr>ds) rr=-rq-rs;
    return rq+','+rr;
  }
  function hexCenter(key){ var a=key.split(','),q=+a[0],r=+a[1];
    return [HS*(Math.sqrt(3)*q + Math.sqrt(3)/2*r), HS*(3/2*r)]; }   // ft
  function hexPath(cx,cy,rp){ var p=''; for(var i=0;i<6;i++){var a=Math.PI/180*(60*i-90); p+=(i?'L':'M')+(cx+rp*Math.cos(a)).toFixed(1)+' '+(cy+rp*Math.sin(a)).toFixed(1);} return p+'Z'; }

  function hexbinSvg(shots){
    var bins={};
    shots.forEach(function(s){
      var k=axial(clampx(s.x), Math.max(-2,s.y));
      var b=bins[k]||(bins[k]={att:0,mk:0,three:0});
      b.att++; if(s.made)b.mk++; if(s.sv===3)b.three++;
    });
    var maxAtt=0; for(var k in bins) if(bins[k].att>maxAtt) maxAtt=bins[k].att;
    var g='';
    for(var k in bins){
      var b=bins[k]; if(b.att<2) continue;
      var c=hexCenter(k), cx=px(c[0]), cy=py(c[1]);
      var fg=b.mk/b.att, isThree=b.three> b.att/2;
      var dh=Math.sqrt((c[0]-HOOP_X)*(c[0]-HOOP_X)+(c[1]-HOOP_Y)*(c[1]-HOOP_Y));
      var rp=px(HS)*(0.42+0.58*Math.min(1,Math.sqrt(b.att/maxAtt)));   // size by volume
      g+='<path d="'+hexPath(cx,cy,rp)+'" fill="'+effColor(fg-d1FG(dh,isThree))+'" stroke="rgba(0,0,0,.25)" stroke-width="0.6"/>';
    }
    return g;
  }

  // ── inferno colormap ──
  var INF=[[0,0,4],[40,11,84],[101,21,110],[159,42,99],[212,72,66],[245,125,21],[250,193,39],[252,255,164]];
  function inferno(v){ v=v<0?0:v>1?1:v; var n=INF.length-1,x=v*n,i=Math.floor(x),f=x-i,a=INF[i],b=INF[Math.min(n,i+1)];
    return [a[0]+(b[0]-a[0])*f|0, a[1]+(b[1]-a[1])*f|0, a[2]+(b[2]-a[2])*f|0]; }

  // separable box blur on a float grid (smooths the density -> KDE look)
  function blur(g,w,h,rad){
    var t=new Float32Array(g.length),k,x,y,s,n;
    for(y=0;y<h;y++)for(x=0;x<w;x++){ s=0;n=0; for(k=-rad;k<=rad;k++){var xx=x+k; if(xx>=0&&xx<w){s+=g[y*w+xx];n++;}} t[y*w+x]=s/n; }
    for(y=0;y<h;y++)for(x=0;x<w;x++){ s=0;n=0; for(k=-rad;k<=rad;k++){var yy=y+k; if(yy>=0&&yy<h){s+=t[yy*w+x];n++;}} g[y*w+x]=s/n; }
  }
  function drawHeat(el, shots){
    var cv=el.querySelector('.sc-heat'); if(!cv||!cv.getContext) return;
    cv.width=W; cv.height=H; var ctx=cv.getContext('2d');
    // 1) bin shots into a coarse density grid (integer counts — never clips)
    var GW=90, GH=76, grid=new Float32Array(GW*GH);
    function gx(fx){ return Math.max(0,Math.min(GW-1, Math.round(clampx(fx)/50*(GW-1)))); }
    function gy(fy){ fy=Math.max(-2,Math.min(42,fy)); return Math.max(0,Math.min(GH-1, Math.round((1-fy/42)*(GH-1)))); }
    shots.forEach(function(s){ grid[gy(s.y)*GW+gx(s.x)]+=1; });
    // 2) smooth (bandwidth = blur passes)
    blur(grid,GW,GH,2); blur(grid,GW,GH,2); blur(grid,GW,GH,2);
    // normalize to a high percentile (not the absolute max) so the ultra-dense
    // rim doesn't crush the visibility of the three-point band
    var nz=[]; for(var i=0;i<grid.length;i++) if(grid[i]>0) nz.push(grid[i]);
    nz.sort(function(a,b){return a-b;});
    var max=(nz.length?nz[Math.floor(nz.length*0.93)]:1)||1;
    // 3) colormap into a small canvas, then upscale (browser smooths bilinearly)
    var sm=document.createElement('canvas'); sm.width=GW; sm.height=GH; var sc=sm.getContext('2d');
    var im=sc.createImageData(GW,GH), p=im.data;
    for(var i=0;i<grid.length;i++){
      var v=Math.min(1,grid[i]/max), o=i*4;
      if(v<0.04){ p[o+3]=0; continue; }
      var c=inferno(Math.pow(v,0.6)); p[o]=c[0]; p[o+1]=c[1]; p[o+2]=c[2];
      p[o+3]=Math.min(255, 55+v*255)|0;
    }
    sc.putImageData(im,0,0);
    ctx.fillStyle='#07060c'; ctx.fillRect(0,0,W,H);
    ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
    ctx.drawImage(sm,0,0,GW,GH,0,0,W,H);
  }

  function statBox(l,v,s){ return '<div class="sc-z"><div class="sc-zv">'+v+'</div><div class="sc-zl">'+l+'</div><div class="sc-zs">'+s+'</div></div>'; }
  function zoneStrip(shots){
    var made=shots.filter(function(s){return s.made;}), z=zones(shots);
    var fgp=Math.round(made.length/shots.length*100);
    var efg=Math.round((made.length+0.5*made.filter(function(s){return s.sv===3;}).length)/shots.length*100);
    return '<div class="sc-zones">'+statBox('FG%',fgp+'%',made.length+'/'+shots.length)+
      statBox('eFG%',efg+'%','shot quality')+statBox('At Rim',pct(z.rim)+'%',z.rim[1]+' att')+
      statBox('Mid',pct(z.mid)+'%',z.mid[1]+' att')+statBox('Three',pct(z.three)+'%',z.three[1]+' att')+'</div>';
  }

  function render(el, shots, opts){
    opts=opts||{}; if(!el) return;
    shots=(shots||[]).filter(function(s){return s.x!=null&&s.y!=null;});
    el.setAttribute('data-sc-host','1'); el._shots=shots; el._opts=opts;
    if(!shots.length){ el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3);font-size:13px;">No shot-location data'+(opts.subtitle?' for '+opts.subtitle:'')+' yet.</div>'; return; }
    var mode=opts.mode||'shots';
    var toggle='<div class="sc-modes">'+
      '<button class="'+(mode==='shots'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'shots\')">Shots</button>'+
      '<button class="'+(mode==='hex'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'hex\')">Hexbin</button>'+
      '<button class="'+(mode==='heat'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'heat\')">Heat</button></div>';
    var head=(opts.title?'<div class="sc-title">'+opts.title+'</div>':'')+
      '<div class="sc-legend">'+toggle+'<span style="margin-left:auto;color:var(--text3);">'+shots.length+' field-goal attempts</span></div>';
    var body;
    if(mode==='hex'){
      body='<div class="sc-court-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+court('rgba(130,123,156,.55)')+hexbinSvg(shots)+'</svg></div>'+
        '<div class="sc-eff-legend"><span>Weak</span><i class="sc-effgrad"></i><span>Strong</span>'+
        '<span style="width:100%;text-align:center;color:var(--text3);font-weight:600;">Hex size = shot volume · color = FG% vs Division-1 average</span></div>';
    } else if(mode==='heat'){
      body='<div class="sc-court-wrap sc-heat-wrap"><canvas class="sc-heat"></canvas>'+
        '<svg class="sc-svg sc-heat-court" viewBox="0 0 '+W+' '+H+'">'+court('rgba(255,255,255,.38)')+'</svg></div>'+
        '<div class="sc-heat-legend"><span>Shot frequency</span><i class="sc-grad"></i><span style="color:var(--text3)">low → high</span></div>';
    } else {
      var dots=shots.map(function(s){
        var cx=px(clampx(s.x)), cy=py(Math.max(-2,s.y));
        return s.made ? '<circle cx="'+cx+'" cy="'+cy+'" r="3.4" fill="#1f9d57" fill-opacity="0.85"/>'
          : '<path d="M '+(cx-3)+' '+(cy-3)+' l 6 6 M '+(cx+3)+' '+(cy-3)+' l -6 6" stroke="#cf5a4e" stroke-width="1.6" stroke-opacity="0.8"/>';
      }).join('');
      body='<div class="sc-mk-legend"><span><i class="sc-made"></i>Made</span><span><i class="sc-miss"></i>Missed</span></div>'+
        '<div class="sc-court-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+court('rgba(130,123,156,.55)')+dots+'</svg></div>';
    }
    el.innerHTML=head+body+zoneStrip(shots);
    if(mode==='heat') drawHeat(el, shots);
  }
  function _m(btn, mode){ var host=btn.closest('[data-sc-host]'); if(host&&host._shots) render(host, host._shots, Object.assign({},host._opts,{mode:mode})); }

  if(!document.getElementById('sc-styles')){
    var st=document.createElement('style'); st.id='sc-styles';
    st.textContent='.sc-title{font-size:13px;font-weight:700;color:var(--text2);margin-bottom:8px;}'+
      '.sc-legend{display:flex;align-items:center;gap:14px;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:10px;}'+
      '.sc-modes{display:inline-flex;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:3px;gap:3px;}'+
      '.sc-modes button{font-size:11.5px;font-weight:700;padding:5px 13px;border:none;border-radius:5px;background:none;color:var(--text3);cursor:pointer;}'+
      '.sc-modes button.on{background:var(--accent);color:#fff;}'+
      '.sc-mk-legend{display:flex;gap:16px;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px;}'+
      '.sc-mk-legend span{display:inline-flex;align-items:center;gap:6px;}'+
      '.sc-made{width:11px;height:11px;border-radius:50%;background:#1f9d57;display:inline-block;}'+
      '.sc-miss{width:9px;height:9px;border:1.6px solid #cf5a4e;display:inline-block;transform:rotate(45deg);}'+
      '.sc-court-wrap{position:relative;max-width:420px;margin:0 auto;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:8px;}'+
      '.sc-heat-wrap{background:#07060c;border-color:#1a1626;}'+
      '.sc-svg{width:100%;height:auto;display:block;}'+
      '.sc-heat{width:100%;height:auto;display:block;border-radius:6px;}'+
      '.sc-heat-court{position:absolute;left:8px;top:8px;width:calc(100% - 16px);}'+
      '.sc-heat-legend{max-width:420px;margin:10px auto 0;display:flex;align-items:center;gap:10px;font-size:11px;font-weight:600;color:var(--text2);justify-content:center;}'+
      '.sc-grad{width:150px;height:10px;border-radius:5px;display:inline-block;background:linear-gradient(90deg,#000004,#280b54,#65156e,#9f2a63,#d44842,#f57d15,#fac127,#fcffa4);}'+
      '.sc-eff-legend{max-width:440px;margin:10px auto 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;font-size:11px;font-weight:700;color:var(--text2);}'+
      '.sc-effgrad{width:160px;height:10px;border-radius:5px;display:inline-block;background:linear-gradient(90deg,#3e74cc,#eeeef2,#c4362e);}'+
      '.sc-zones{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:14px;max-width:440px;margin-left:auto;margin-right:auto;}'+
      '.sc-z{text-align:center;border:1px solid var(--border);border-radius:9px;padding:9px 4px;background:var(--bg2);}'+
      '.sc-zv{font-family:\'Playfair Display\',serif;font-weight:800;font-size:18px;}'+
      '.sc-zl{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);margin-top:2px;}'+
      '.sc-zs{font-size:9px;color:var(--text3);margin-top:1px;}';
    document.head.appendChild(st);
  }
  window.TDC_SHOTCHART={render:render,_m:_m};
})();
