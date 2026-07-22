/* tdc-shotchart.js — half-court shot chart (player or team).
   TDC_SHOTCHART.render(el, shots, opts)
     shots: [{x,y,made,sv,dist}]  (ESPN coords: x 0-50 width, y feet from baseline)
     opts:  {title, subtitle, mode:'spots'|'hex'|'heat'|'shots'}
   Modes: Signature spots (default — best/worst high-volume zones lit and
   annotated, everything else greyed) · Hexbin (FG% vs D-1 avg) · Heat
   (frequency) · All shots (every made/missed marker).
   The court is cropped to the range shots actually occupy (-2.6 to 34.6 ft).
   Interactive: hover tooltips on shots/hexes, zone-card hover highlights that
   zone on the court, staggered entrance animations, court draw-in. */
(function(){
  var FT=10;                              // px per foot
  var HOOP_X=25, HOOP_Y=5.25;             // hoop center in feet
  // Crop to where shots actually are. The old frame ran to 42 ft while nothing
  // is taken past ~34, so a fifth of the panel was dead space; YMIN goes behind
  // the baseline because attempts are logged there and used to get clipped off.
  var YMIN=-0.4, YMAX=36.5;
  var W=50*FT, H=(YMAX-YMIN)*FT;
  function px(fx){return fx*FT;}
  function py(fy){return (YMAX-fy)*FT;}   // baseline near the bottom, y grows up
  function clampy(fy){return Math.max(YMIN+0.35,Math.min(YMAX-0.35,fy));}
  function clampx(v){return Math.max(0,Math.min(50,v));}
  // ESPN logs shot coordinates in FEET measured FROM THE BASKET: x across the court
  // (25 = the rim), y straight out from the rim. So the only conversion needed is a
  // 5.25 ft shift to express y as feet from the baseline.
  // Refitted against every shot carrying a reported distance (2,000-shot league
  // sample): identity + shift lands at 0.47 ft RMSE, while the previous
  // 1.022/1.266 stretch about a (25,5.25) origin was 2.09 ft off. That stretch
  // pushed rim attempts (y=1-3) down behind the rim and misread a 66% rim rate as
  // 27%. Independent check: the 3PT flag agrees with a 22 ft arc for 99.8% of shots.
  function fxf(x){ return (x==null?HOOP_X:x); }
  function fyf(y){ return (y==null?0:y)+HOOP_Y; }
  function edist(s){
    if(s.dist!=null && s.dist>=0) return s.dist;
    // fall back on the CONVERTED coords: ESPN's y axis is compressed ~1.27 ft per
    // unit, so measuring off the raw values under-reads every distance and dumps
    // mid-range attempts into the rim bucket
    var dx=fxf(s.x)-HOOP_X, dy=fyf(s.y)-HOOP_Y; return Math.sqrt(dx*dx+dy*dy);
  }
  function zoneOf(s){ return s.sv===3 ? 'three' : (edist(s)<=4 ? 'rim' : 'mid'); }
  // ── the ten places a shot comes from (drives Signature Spots) ──
  var R3=22.15, CORNER_X=3.35;
  var CORNER_Y=HOOP_Y+Math.sqrt(Math.max(0,R3*R3-(HOOP_X-CORNER_X)*(HOOP_X-CORNER_X)));
  // `at` is where the zone's ring is drawn, in feet from the baseline. These are
  // fixed anchors rather than the shots' centroid on purpose: the paint is an
  // annulus around the rim, so its centroid lands on the rim and the two rings
  // collapse onto each other.
  var ZMETA={
    rim  :{n:'the rim',      avg:0.615, at:[25,7.0]},
    paint:{n:'the paint',    avg:0.415, at:[25,14.5]},
    midl :{n:'mid left',     avg:0.380, at:[12,12]},
    midc :{n:'mid centre',   avg:0.380, at:[25,22.5]},
    midr :{n:'mid right',    avg:0.380, at:[38,12]},
    c3l  :{n:'left corner 3',avg:0.360, at:[2.5,7]},
    c3r  :{n:'right corner 3',avg:0.360,at:[47.5,7]},
    w3l  :{n:'left wing 3',  avg:0.335, at:[7,21]},
    t3   :{n:'top of the key 3',avg:0.335, at:[25,31]},
    w3r  :{n:'right wing 3', avg:0.335, at:[43,21]}
  };
  function zone10(s){
    var x=fxf(s.x), y=fyf(s.y), d=edist(s);
    if(s.sv===3) return (y<=CORNER_Y-0.4) ? (x<HOOP_X?'c3l':'c3r')
                : (x<19?'w3l':(x>31?'w3r':'t3'));
    if(d<=4) return 'rim';
    if(x>=19&&x<=31&&y<=19) return 'paint';
    return x<19?'midl':(x>31?'midr':'midc');
  }
  function court(line){
    var hx=px(HOOP_X), hy=py(HOOP_Y), g='', CL='class="sc-cl" pathLength="1"';
    g+='<rect '+CL+' x="1" y="1" width="'+(W-2)+'" height="'+(H-2)+'" fill="none" stroke="'+line+'" stroke-width="2"/>';
    g+='<rect '+CL+' x="'+px(19)+'" y="'+py(19)+'" width="'+px(12)+'" height="'+(py(0)-py(19))+'" fill="none" stroke="'+line+'" stroke-width="1.5"/>';
    g+='<circle '+CL+' cx="'+px(25)+'" cy="'+py(19)+'" r="'+px(6)+'" fill="none" stroke="'+line+'" stroke-width="1.5"/>';
    g+='<path '+CL+' d="M '+(hx-px(4))+' '+hy+' A '+px(4)+' '+px(4)+' 0 0 0 '+(hx+px(4))+' '+hy+'" fill="none" stroke="'+line+'" stroke-width="1.5"/>';
    g+='<line '+CL+' x1="'+(px(25)-px(3))+'" y1="'+py(4)+'" x2="'+(px(25)+px(3))+'" y2="'+py(4)+'" stroke="'+line+'" stroke-width="2"/>';
    g+='<circle '+CL+' cx="'+hx+'" cy="'+hy+'" r="'+px(0.75)+'" fill="none" stroke="'+line+'" stroke-width="2"/>';
    var cornerX=250-216.5, cornerYtop=hy-46.8;
    g+='<path '+CL+' d="M '+cornerX+' '+py(0)+' L '+cornerX+' '+cornerYtop+
        ' A 221.5 221.5 0 0 1 '+(500-cornerX)+' '+cornerYtop+' L '+(500-cornerX)+' '+py(0)+'" fill="none" stroke="'+line+'" stroke-width="1.5"/>';
    return g;
  }
  function zones(shots){
    var z={rim:[0,0],mid:[0,0],three:[0,0]};
    shots.forEach(function(s){ var k=zoneOf(s); z[k][1]++; if(s.made)z[k][0]++; });
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
  // diverging color for (playerFG - d1avg): below avg = red, above = green
  function effColor(diff){
    var t=Math.max(-1,Math.min(1,diff/0.15));
    var lo=[207,90,78], mid=[238,238,242], hi=[31,157,87];
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
      var k=axial(clampx(fxf(s.x)), clampy(fyf(s.y)));
      var b=bins[k]||(bins[k]={att:0,mk:0,three:0});
      b.att++; if(s.made)b.mk++; if(s.sv===3)b.three++;
    });
    var maxAtt=0; for(var k in bins) if(bins[k].att>maxAtt) maxAtt=bins[k].att;
    var g='', idx=0;
    for(var k in bins){
      var b=bins[k]; if(b.att<2) continue;
      var c=hexCenter(k), cx=px(c[0]), cy=py(c[1]);
      var fg=b.mk/b.att, isThree=b.three>b.att/2;
      var dh=Math.sqrt((c[0]-HOOP_X)*(c[0]-HOOP_X)+(c[1]-HOOP_Y)*(c[1]-HOOP_Y));
      var diff=fg-d1FG(dh,isThree);
      var rp=px(HS)*(0.42+0.58*Math.min(1,Math.sqrt(b.att/maxAtt)));   // size by volume
      var zc=isThree?'sc-zt':(dh<=4?'sc-zr':'sc-zm');
      var tip=b.mk+'/'+b.att+' · '+Math.round(fg*100)+'% FG · '+(diff>=0?'+':'')+Math.round(diff*100)+'% vs D-1';
      g+='<path class="sc-mark sc-hex '+zc+'" data-t="'+tip+'" style="animation-delay:'+Math.min(idx*12,700)+'ms" d="'+hexPath(cx,cy,rp)+'" fill="'+effColor(diff)+'" stroke="rgba(0,0,0,.25)" stroke-width="0.6"/>';
      idx++;
    }
    return g;
  }

  // ── heat colormap (on-brand purple ramp: dark -> accent -> light) ──
  var INF=[[8,5,16],[34,16,64],[64,28,124],[104,46,178],[139,63,224],[176,116,236],[214,180,248]];
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
    var GW=90, GH=76, grid=new Float32Array(GW*GH);
    function gx(fx){ return Math.max(0,Math.min(GW-1, Math.round(clampx(fx)/50*(GW-1)))); }
    function gy(fy){ fy=clampy(fy); return Math.max(0,Math.min(GH-1, Math.round((YMAX-fy)/(YMAX-YMIN)*(GH-1)))); }
    shots.forEach(function(s){ grid[gy(fyf(s.y))*GW+gx(fxf(s.x))]+=1; });
    blur(grid,GW,GH,2); blur(grid,GW,GH,2); blur(grid,GW,GH,2);
    // normalize to a high percentile (not the absolute max) so the ultra-dense
    // rim doesn't crush the visibility of the three-point band
    var nz=[]; for(var i=0;i<grid.length;i++) if(grid[i]>0) nz.push(grid[i]);
    nz.sort(function(a,b){return a-b;});
    var max=(nz.length?nz[Math.floor(nz.length*0.93)]:1)||1;
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

  // ── SIGNATURE SPOTS ──
  // Everything drops back to grey; only the best and worst high-volume zones are
  // lit and annotated. A spot has to clear a volume floor to qualify, so a 3-for-4
  // sample can never become the headline.
  var HOT='#F2622E', COLD='#3E7BD9';
  function spotsSvg(shots, out){
    var Z={}; Object.keys(ZMETA).forEach(function(k){ Z[k]={m:0,a:0}; });
    shots.forEach(function(s){ var k=zone10(s); if(!Z[k]) return; Z[k].a++; if(s.made)Z[k].m++; });
    var floor=Math.max(10, Math.round(shots.length*0.05));
    var ranked=Object.keys(ZMETA).filter(function(k){ return Z[k].a>=floor; })
      .map(function(k){ return {k:k,a:Z[k].a,p:Z[k].m/Z[k].a,d:Z[k].m/Z[k].a-ZMETA[k].avg}; })
      .sort(function(a,b){ return b.d-a.d; });
    var picks=[];
    if(ranked.length>=2){
      picks=ranked.slice(0,Math.min(2,ranked.length>3?2:1))
        .concat(ranked.slice(-(ranked.length>3?2:1)).reverse());
    } else picks=ranked.slice(0);
    // de-dupe when the pool is small enough that hot and cold overlap
    var seen={}; picks=picks.filter(function(z){ if(seen[z.k]) return false; seen[z.k]=true; return true; });
    out.picks=picks; out.floor=floor; out.Z=Z;

    var lit={}; picks.forEach(function(z){ lit[z.k]=z.d>=0?HOT:COLD; });
    var g='';
    shots.forEach(function(s,i){
      var k=zone10(s), cx=px(clampx(fxf(s.x))), cy=py(clampy(fyf(s.y)));
      var col=lit[k];
      var tip=(s.made?'Made':'Missed')+' '+(s.sv===3?'3PT':'2PT')+' \u00b7 '+Math.round(edist(s))+' ft';
      if(col){
        g+='<circle class="sc-mark sc-spot-on" data-t="'+tip+'" style="animation-delay:'+Math.min(i*2,600)+'ms" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+
           '" r="3.5" fill="'+col+'" fill-opacity="'+(s.made?0.95:0.32)+'"/>';
      } else {
        g+='<circle class="sc-spot-off" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="2.7"/>';
      }
    });
    // rings + callouts on top. Labels are placed with collision resolution and a
    // leader line, otherwise two adjacent spots overprint each other illegibly.
    // Ring sits on the zone's centroid, not a fixed anchor, and its radius grows
    // with volume — a 214-attempt paint and a 22-attempt wing shouldn't draw the
    // same circle.
    var maxA=Math.max.apply(null,picks.map(function(z){ return z.a; }).concat([1]));
    var placed=[], LH=30;
    function hits(b){
      for(var j=0;j<placed.length;j++){ var o=placed[j];
        if(b.x<o.x+o.w && b.x+b.w>o.x && b.y<o.y+o.h && b.y+b.h>o.y) return o; }
      return null;
    }
    // Lay the rings out first so overlaps can be resolved. Nested zones (the rim
    // sits inside the paint) otherwise draw as two concentric blobs that bury the
    // shots underneath them.
    var rings=picks.map(function(z){
      var at=ZMETA[z.k].at;
      return {z:z, r:px(2.4+3.4*Math.sqrt(z.a/maxA)), fx:at[0], fy:at[1]};
    });
    rings.forEach(function(rg){ rg.cx=px(rg.fx); rg.cy=py(rg.fy); });
    for(var pa=0; pa<rings.length; pa++){
      for(var pb=pa+1; pb<rings.length; pb++){
        var A=rings[pa], B=rings[pb];
        var dd=Math.hypot(A.cx-B.cx, A.cy-B.cy), want=A.r+B.r+4;
        if(dd<want && dd>0){                       // shrink both until they just clear
          var f=Math.max(0.42,(dd-4)/(A.r+B.r));
          A.r*=f; B.r*=f;
        } else if(dd===0){ B.r*=0.5; }
      }
    }
    rings.forEach(function(rg,i){
      var z=rg.z, col=z.d>=0?HOT:COLD, rr=rg.r, ctx0=rg.fx;
      var cx=Math.max(rr+3,Math.min(W-rr-3,rg.cx));           // keep the ring on court
      var cy=Math.max(rr+3,Math.min(H-rr-3,rg.cy));
      var sub=ZMETA[z.k].n+' \u00b7 '+z.a+' att';
      var wEst=Math.max(52, sub.length*5.9);
      var side=ctx0<25?-1:1;
      if(cx+rr+11+wEst>W-4) side=-1;
      if(cx-rr-11-wEst<4)   side=1;
      var lx=cx+side*(rr+11);
      var box={x:(side<0?lx-wEst:lx), y:cy-15, w:wEst, h:LH};
      for(var guard=0; guard<48; guard++){
        var o=hits(box); if(!o) break;
        box.y=(box.y<=o.y)?(o.y-LH-3):(o.y+LH+3);
      }
      box.y=Math.max(3,Math.min(H-LH-3,box.y));
      placed.push(box);
      var ly=box.y+15;
      if(Math.abs(ly-cy)>6){                                  // pushed away -> leader line
        g+='<path class="sc-lead" d="M '+(cx+side*rr).toFixed(1)+' '+cy.toFixed(1)+
           ' L '+lx.toFixed(1)+' '+ly.toFixed(1)+'" stroke="'+col+'" stroke-width="1" fill="none" opacity=".5"/>';
      }
      var anch=side<0?'end':'start';
      g+='<circle class="sc-ring" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+rr.toFixed(1)+
         '" fill="none" stroke="'+col+'" stroke-width="2" opacity=".92" style="animation-delay:'+(340+i*110)+'ms"/>';
      g+='<text class="sc-callout" x="'+lx.toFixed(1)+'" y="'+(ly-3).toFixed(1)+'" text-anchor="'+anch+
         '" style="animation-delay:'+(400+i*110)+'ms" fill="'+col+'">'+Math.round(z.p*100)+'%</text>';
      g+='<text class="sc-calsub" x="'+lx.toFixed(1)+'" y="'+(ly+11).toFixed(1)+'" text-anchor="'+anch+
         '" style="animation-delay:'+(440+i*110)+'ms">'+sub+'</text>';
    });
    return g;
  }
  function spotsCaption(out){
    var p=out.picks||[];
    if(!p.length) return 'Not enough volume from any one spot yet \u2014 needs '+(out.floor||10)+'+ attempts from a zone.';
    var hot=p.filter(function(z){return z.d>=0;}), cold=p.filter(function(z){return z.d<0;});
    function phr(z){ return '<b>'+ZMETA[z.k].n+'</b> '+(z.d>=0?'+':'')+Math.round(z.d*100); }
    var bits=[];
    if(hot.length)  bits.push('Best: '+hot.map(phr).join(', '));
    if(cold.length) bits.push('Worst: '+cold.map(phr).join(', '));
    return bits.join(' \u00b7 ')+' <span style="color:var(--text3)">vs the D-1 average, '+out.floor+'+ attempts</span>';
  }

  function statBox(l,v,s,zone,i){
    return '<div class="sc-z" '+(zone?'data-zone="'+zone+'"':'')+' style="animation-delay:'+(200+i*80)+'ms"><div class="sc-zv">'+v+'</div><div class="sc-zl">'+l+'</div><div class="sc-zs">'+s+'</div></div>';
  }
  function zoneStrip(shots){
    var made=shots.filter(function(s){return s.made;}), z=zones(shots);
    var fgp=Math.round(made.length/shots.length*100);
    var efg=Math.round((made.length+0.5*made.filter(function(s){return s.sv===3;}).length)/shots.length*100);
    return '<div class="sc-zones">'+statBox('FG%',fgp+'%',made.length+'/'+shots.length,null,0)+
      statBox('eFG%',efg+'%','shot quality',null,1)+statBox('At Rim',pct(z.rim)+'%',z.rim[1]+' att','rim',2)+
      statBox('Mid',pct(z.mid)+'%',z.mid[1]+' att','mid',3)+statBox('Three',pct(z.three)+'%',z.three[1]+' att','three',4)+'</div>';
  }

  // ESPN only ever published shot coordinates for a subset of games, so a season can
  // easily hold a third of the real attempts. Say so rather than drawing a confident
  // chart off partial data. opts.expected = the player's true FGA for that season.
  function coverageNote(shots, opts){
    var exp=parseFloat(opts&&opts.expected);
    if(!isFinite(exp) || exp<=0) return '';
    var pct=shots.length/exp;
    if(pct>=0.9) return '';
    return '<div class="sc-cov"><b>'+shots.length+' of about '+Math.round(exp)+' attempts'+
      ' ('+Math.round(pct*100)+'%)</b> \u2014 ESPN published shot locations for only some '+
      'games this season, so this chart is a partial picture.</div>';
  }

  function render(el, shots, opts){
    opts=opts||{}; if(!el) return;
    shots=(shots||[]).filter(function(s){return s.x!=null&&s.y!=null;});
    el.setAttribute('data-sc-host','1'); el.classList.add('sc-host'); el._shots=shots; el._opts=opts;
    if(!shots.length){
      var exp0=parseFloat(opts.expected);
      el.innerHTML='<div style="padding:34px 24px;text-align:center;color:var(--text3);font-size:13px;line-height:1.6;">'+
        '<b style="color:var(--text2)">No shot-location data for this season.</b><br>'+
        (isFinite(exp0)&&exp0>0?('ESPN never published coordinates for these games'+
          (opts.subtitle?' ('+opts.subtitle+' took about '+Math.round(exp0)+' shots)':'')+'.'):
          'ESPN never published coordinates for these games.')+
        '</div>'; return; }
    var mode=opts.mode||'spots';
    var toggle='<div class="sc-modes">'+
      '<button class="'+(mode==='spots'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'spots\')">Signature spots</button>'+
      '<button class="'+(mode==='hex'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'hex\')">Hexbin</button>'+
      '<button class="'+(mode==='heat'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'heat\')">Heat</button>'+
      '<button class="'+(mode==='shots'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'shots\')">All shots</button></div>';
    var head=(opts.title?'<div class="sc-title">'+opts.title+'</div>':'')+
      '<div class="sc-legend">'+toggle+'<span style="margin-left:auto;color:var(--text3);">'+shots.length+' field-goal attempts</span></div>';
    var body;
    if(mode==='spots'){
      var so={};
      var sg=spotsSvg(shots,so);
      body='<div class="sc-mk-legend"><span><i class="sc-hot"></i>Best spots</span><span><i class="sc-cold"></i>Worst spots</span>'+
        '<span style="margin-left:auto;color:var(--text3);font-size:10px;">solid = made \u00b7 faded = missed</span></div>'+
        '<div class="sc-court-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+court('rgba(130,123,156,.42)')+sg+'</svg><div class="sc-tip"></div></div>'+
        '<div class="sc-spot-cap">'+spotsCaption(so)+'</div>';
    } else if(mode==='hex'){
      body='<div class="sc-court-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+court('rgba(130,123,156,.55)')+hexbinSvg(shots)+'</svg><div class="sc-tip"></div></div>'+
        '<div class="sc-eff-legend"><span>Weak</span><i class="sc-effgrad"></i><span>Strong</span>'+
        '<span style="width:100%;text-align:center;color:var(--text3);font-weight:600;">Hex size = shot volume · color = FG% vs Division-1 average</span></div>';
    } else if(mode==='heat'){
      body='<div class="sc-court-wrap sc-heat-wrap"><canvas class="sc-heat"></canvas>'+
        '<svg class="sc-svg sc-heat-court" viewBox="0 0 '+W+' '+H+'">'+court('rgba(255,255,255,.38)')+'</svg></div>'+
        '<div class="sc-heat-legend"><span>Shot frequency</span><i class="sc-grad"></i><span style="color:var(--text3)">low → high</span></div>';
    } else {
      var dots=shots.map(function(s,i){
        var cx=px(clampx(fxf(s.x))), cy=py(clampy(fyf(s.y)));
        var zc={rim:'sc-zr',mid:'sc-zm',three:'sc-zt'}[zoneOf(s)];
        var tip=(s.made?'Made':'Missed')+' '+(s.sv===3?'3PT':'2PT')+' · '+Math.round(edist(s))+' ft';
        var dl='style="animation-delay:'+Math.min(i*2,750)+'ms"';
        return s.made
          ? '<circle class="sc-mark sc-dot '+zc+'" data-t="'+tip+'" '+dl+' cx="'+cx+'" cy="'+cy+'" r="3.6" fill="#1f9d57" fill-opacity="0.85"/>'
          : '<path class="sc-mark sc-dot '+zc+'" data-t="'+tip+'" '+dl+' d="M '+(cx-3)+' '+(cy-3)+' l 6 6 M '+(cx+3)+' '+(cy-3)+' l -6 6" stroke="#cf5a4e" stroke-width="1.7" stroke-opacity="0.8" fill="none"/>';
      }).join('');
      body='<div class="sc-mk-legend"><span><i class="sc-made"></i>Made</span><span><i class="sc-miss"></i>Missed</span>'+
        '<span style="margin-left:auto;color:var(--text3);font-size:10px;">hover a shot · hover a zone card to isolate it</span></div>'+
        '<div class="sc-court-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+court('rgba(130,123,156,.55)')+dots+'</svg><div class="sc-tip"></div></div>';
    }
    el.innerHTML=head+coverageNote(shots,opts)+'<div class="sc-main"><div class="sc-court-col">'+body+'</div>'+zoneStrip(shots)+'</div>';
    el.classList.remove('sc-settled');
    if(mode==='heat') drawHeat(el, shots);
    wire(el);
    // settle-guard: entrance animations are done by ~1.3s; force the final state
    // shortly after so environments that freeze/skip the animation clock (some
    // webviews, screenshotters) never leave the chart stuck invisible.
    clearTimeout(el._scSettle);
    el._scSettle=setTimeout(function(){ el.classList.add('sc-settled'); },1600);
  }

  // hover tooltips + zone-card isolation
  function wire(el){
    var wrap=el.querySelector('.sc-court-wrap'), tip=el.querySelector('.sc-tip');
    if(wrap&&tip){
      wrap.addEventListener('mousemove',function(e){
        var t=e.target.closest?e.target.closest('[data-t]'):null;
        if(!t){ tip.classList.remove('on'); return; }
        var r=wrap.getBoundingClientRect();
        tip.textContent=t.getAttribute('data-t');
        tip.style.left=(e.clientX-r.left)+'px';
        tip.style.top=(e.clientY-r.top-14)+'px';
        tip.classList.add('on');
      });
      wrap.addEventListener('mouseleave',function(){ tip.classList.remove('on'); });
    }
    el.querySelectorAll('.sc-z[data-zone]').forEach(function(card){
      var z=card.getAttribute('data-zone');
      card.addEventListener('mouseenter',function(){ el.classList.add('sc-hl','sc-hl-'+z); });
      card.addEventListener('mouseleave',function(){ el.classList.remove('sc-hl','sc-hl-'+z); });
    });
  }
  function _m(btn, mode){ var host=btn.closest('[data-sc-host]'); if(host&&host._shots) render(host, host._shots, Object.assign({},host._opts,{mode:mode})); }

  if(!document.getElementById('sc-styles')){
    var st=document.createElement('style'); st.id='sc-styles';
    st.textContent=
      '@keyframes scPop{from{opacity:0;transform:scale(0);}to{opacity:1;transform:scale(1);}}'+
      '@keyframes scUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}'+
      '@keyframes scFade{from{opacity:0;transform:scale(.97);}to{opacity:1;transform:scale(1);}}'+
      '@keyframes scDraw{from{stroke-dashoffset:1;}to{stroke-dashoffset:0;}}'+
      '.sc-title{font-size:13px;font-weight:700;color:var(--text2);margin-bottom:8px;animation:scUp .4s ease backwards;}'+
      '.sc-legend{display:flex;align-items:center;gap:14px;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:10px;animation:scUp .4s ease backwards;}'+
      '.sc-modes{display:inline-flex;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:3px;gap:3px;}'+
      '.sc-modes button{font-size:11.5px;font-weight:700;padding:5px 13px;border:none;border-radius:5px;background:none;color:var(--text3);cursor:pointer;transition:color .15s,background .15s;}'+
      '.sc-modes button:hover{color:var(--text);}'+
      '.sc-modes button.on{background:var(--accent);color:#fff;}'+
      '.sc-mk-legend{display:flex;align-items:center;gap:16px;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px;}'+
      '.sc-mk-legend span{display:inline-flex;align-items:center;gap:6px;}'+
      '.sc-made{width:11px;height:11px;border-radius:50%;background:#1f9d57;display:inline-block;}'+
      '.sc-cov{font-size:11.5px;color:var(--text2);background:var(--bg2);border:1px solid var(--border2);'+
        'border-left:2px solid #E0A030;border-radius:0 8px 8px 0;padding:8px 12px;margin-bottom:10px;}'+
      '.sc-cov b{color:var(--text);}'+
      '.sc-hot{width:11px;height:11px;border-radius:50%;background:#F2622E;display:inline-block;}'+
      '.sc-cold{width:11px;height:11px;border-radius:50%;background:#3E7BD9;display:inline-block;}'+
      '.sc-spot-off{fill:var(--text3);opacity:.20;}'+
      '.sc-spot-on{transform-box:fill-box;transform-origin:center;}'+
      '.sc-ring{animation:scPop .5s cubic-bezier(.34,1.56,.64,1) backwards;}'+
      '.sc-lead{animation:scFade .5s ease .4s backwards;}'+
      '.sc-callout{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:15px;font-weight:800;'+
        'paint-order:stroke;stroke:var(--bg2);stroke-width:4px;animation:scUp .45s ease backwards;}'+
      '.sc-calsub{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:9.5px;fill:var(--text2);'+
        'paint-order:stroke;stroke:var(--bg2);stroke-width:3.2px;animation:scUp .45s ease backwards;}'+
      '.sc-spot-cap{margin-top:10px;font-size:11.5px;color:var(--text2);padding-left:11px;'+
        'border-left:2px solid var(--border2);animation:scUp .5s ease .35s backwards;}'+
      '.sc-spot-cap b{color:var(--text);}'+
      '.sc-miss{width:9px;height:9px;border:1.6px solid #cf5a4e;display:inline-block;transform:rotate(45deg);}'+
      '.sc-main{display:flex;gap:12px;align-items:stretch;}'+
      '.sc-court-col{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;}'+
      '.sc-court-wrap{position:relative;min-width:0;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:10px;animation:scFade .5s ease backwards;}'+
      '.sc-heat-wrap{background:#07060c;border-color:#1a1626;}'+
      '.sc-svg{width:100%;height:auto;display:block;}'+
      '.sc-cl{stroke-dasharray:1;stroke-dashoffset:0;animation:scDraw 1s ease .1s backwards;}'+
      '.sc-mark{transform-box:fill-box;transform-origin:center;transition:transform .16s cubic-bezier(.34,1.56,.64,1),opacity .2s;animation:scPop .4s cubic-bezier(.34,1.56,.64,1) backwards;cursor:pointer;}'+
      '.sc-mark:hover{transform:scale(1.9);}'+
      '.sc-hex:hover{stroke:var(--accent);stroke-width:1.6;}'+
      '.sc-host.sc-hl .sc-mark{opacity:.07;}'+
      '.sc-host.sc-hl-rim .sc-zr,.sc-host.sc-hl-mid .sc-zm,.sc-host.sc-hl-three .sc-zt{opacity:1;}'+
      '.sc-tip{position:absolute;pointer-events:none;background:var(--text);color:var(--bg);font-size:11px;font-weight:700;padding:5px 9px;border-radius:7px;transform:translate(-50%,-100%);opacity:0;transition:opacity .12s;white-space:nowrap;z-index:20;box-shadow:0 6px 18px rgba(0,0,0,.3);}'+
      '.sc-tip.on{opacity:1;}'+
      '.sc-heat{width:100%;height:auto;display:block;border-radius:8px;animation:scFade .8s ease both;}'+
      '.sc-heat-court{position:absolute;left:10px;top:10px;width:calc(100% - 20px);}'+
      '.sc-heat-legend{max-width:580px;margin:10px auto 0;display:flex;align-items:center;gap:10px;font-size:11px;font-weight:600;color:var(--text2);justify-content:center;animation:scUp .5s ease .3s backwards;}'+
      '.sc-grad{width:150px;height:10px;border-radius:5px;display:inline-block;background:linear-gradient(90deg,#0a0614,#22104a,#40287c,#6a2eb2,#8b3fe0,#b078ec,#d6b4f8);}'+
      '.sc-eff-legend{max-width:580px;margin:10px auto 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;font-size:11px;font-weight:700;color:var(--text2);animation:scUp .5s ease .3s backwards;}'+
      '.sc-effgrad{width:160px;height:10px;border-radius:5px;display:inline-block;background:linear-gradient(90deg,#cf5a4e,#eeeef2,#1f9d57);}'+
      '.sc-zones{display:flex;flex-direction:column;gap:10px;flex:0 0 132px;}'+
      '.sc-z{flex:1;display:flex;flex-direction:column;justify-content:center;text-align:center;border:1px solid var(--border);border-radius:11px;padding:10px 6px;background:var(--bg2);animation:scUp .45s ease backwards;transition:transform .15s,border-color .15s,box-shadow .15s;}'+
      '@media(max-width:600px){.sc-main{flex-direction:column;}.sc-zones{flex-direction:row;flex:0 0 auto;}.sc-z{flex:1;}}'+
      '.sc-z[data-zone]{cursor:pointer;}'+
      '.sc-z[data-zone]:hover{transform:translateY(-2px);border-color:var(--accent);box-shadow:0 8px 20px rgba(80,40,150,.15);}'+
      '.sc-zv{font-family:\'Playfair Display\',serif;font-weight:800;font-size:19px;}'+
      '.sc-zl{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);margin-top:2px;}'+
      '.sc-zs{font-size:9px;color:var(--text3);margin-top:1px;}'+
      '.sc-settled .sc-lead,.sc-settled .sc-ring,.sc-settled .sc-callout,.sc-settled .sc-calsub,.sc-settled .sc-spot-cap,'+
      '.sc-settled .sc-mark,.sc-settled .sc-cl,.sc-settled .sc-z,.sc-settled .sc-court-wrap,.sc-settled .sc-title,.sc-settled .sc-legend,.sc-settled .sc-heat,.sc-settled .sc-heat-legend,.sc-settled .sc-eff-legend{animation:none!important;}';
    document.head.appendChild(st);
  }
  window.TDC_SHOTCHART={render:render,_m:_m};
})();
