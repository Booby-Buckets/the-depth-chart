/* tdc-shotchart.js — half-court shot chart (player or team).
   TDC_SHOTCHART.render(el, shots, opts)
     shots: [{x,y,made,sv,dist}]  (ESPN coords: x 0-50 width, y feet from baseline)
     opts:  {title, subtitle, mode:'spots'|'hex'|'heat'|'shots'}
   Modes: Signature spots (default — best/worst high-volume zones lit and
   annotated, everything else greyed) · Hexbin (FG% vs D-I avg) · Heat
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
  var YMIN=1.8, YMAX=36.5;
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
  // ── D-I zone benchmarks by season (scripts/data/shot_zone_ref.json, built from ~3.2M
  //    located shots 2019-20 → 2024-25 by build_shot_zone_ref.py). The ZMETA.avg values are
  //    only the fallback until the file arrives; a chart drawn before then is redrawn.
  var ZREF=null, REF=null, REF_YEAR=null;
  function avgOf(k){ return (REF&&REF[k]&&REF[k].p!=null)?REF[k].p:ZMETA[k].avg; }
  function useSeason(y){
    REF=null; REF_YEAR=null; if(!ZREF||!ZREF.seasons) return;
    var ys=Object.keys(ZREF.seasons).map(Number).sort(function(a,b){return a-b;}); if(!ys.length) return;
    y=parseInt(y,10); var pick=null;
    if(y){ ys.forEach(function(v){ if(v<=y) pick=v; }); if(pick==null) pick=ys[0]; } else pick=ys[ys.length-1];
    REF=ZREF.seasons[String(pick)].zones; REF_YEAR=pick;
  }
  try{
    fetch('scripts/data/shot_zone_ref.json?v=1').then(function(r){return r.ok?r.json():null;}).then(function(j){
      if(!j) return; ZREF=j;
      // redraw anything that rendered against the fallback numbers
      Array.prototype.forEach.call(document.querySelectorAll('[data-sc-host]'),function(el){ if(el._shots) render(el,el._shots,el._opts); });
    }).catch(function(){});
  }catch(e){}
  function zone10(s){
    var x=fxf(s.x), y=fyf(s.y), d=edist(s);
    if(s.sv===3) return (y<=CORNER_Y-0.4) ? (x<HOOP_X?'c3l':'c3r')
                : (x<19?'w3l':(x>31?'w3r':'t3'));
    if(d<=4) return 'rim';
    if(x>=19&&x<=31&&y<=19) return 'paint';
    return x<19?'midl':(x>31?'midr':'midc');
  }
  // the three-point line as a closed path (corner → arc → corner, back along the baseline)
  var ARC_CX=250-216.5, ARC_YT=py(HOOP_Y)-46.8;
  function arcPath(){ return 'M '+ARC_CX+' '+py(0)+' L '+ARC_CX+' '+ARC_YT+' A 221.5 221.5 0 0 1 '+(500-ARC_CX)+' '+ARC_YT+' L '+(500-ARC_CX)+' '+py(0); }
  // A real court: floor, a tinted lane, white lines, backboard and an orange rim. `line` is
  // kept for callers but the panel now draws on its own palette (var(--sc-*) — theme-aware).
  function court(line, opts){
    var hx=px(HOOP_X), hy=py(HOOP_Y), g='', CL='class="sc-cl" pathLength="1"', L='var(--sc-line)';
    var tc=(opts&&opts.color)||'var(--sc-accent)';
    g+='<rect x="0" y="0" width="'+W+'" height="'+H+'" fill="var(--sc-floor)"/>';
    // lane (paint) tinted with the team colour; the arc interior a hair lighter than the floor
    g+='<path d="'+arcPath()+' Z" fill="var(--sc-inside)"/>';
    g+='<g class="sc-lines" pointer-events="none">';
    g+='<rect '+CL+' x="'+px(19)+'" y="'+py(19)+'" width="'+px(12)+'" height="'+(py(0)-py(19))+'" fill="none" stroke="'+L+'" stroke-width="1.6"/>';
    // free-throw circle: solid on the far side, dashed inside the lane
    g+='<path '+CL+' d="M '+px(19)+' '+py(19)+' A '+px(6)+' '+px(6)+' 0 0 1 '+px(31)+' '+py(19)+'" fill="none" stroke="'+L+'" stroke-width="1.6"/>';
    g+='<path d="M '+px(19)+' '+py(19)+' A '+px(6)+' '+px(6)+' 0 0 0 '+px(31)+' '+py(19)+'" fill="none" stroke="'+L+'" stroke-width="1.4" stroke-dasharray="6 5"/>';
    g+='<path '+CL+' d="M '+(hx-px(4))+' '+hy+' A '+px(4)+' '+px(4)+' 0 0 1 '+(hx+px(4))+' '+hy+'" fill="none" stroke="'+L+'" stroke-width="1.4"/>';
    g+='<path '+CL+' d="'+arcPath()+'" fill="none" stroke="'+L+'" stroke-width="1.8"/>';
    g+='<line x1="0" y1="'+(H-1)+'" x2="'+W+'" y2="'+(H-1)+'" stroke="'+L+'" stroke-width="2"/>';
    // backboard + rim
    g+='<line x1="'+(px(25)-px(3))+'" y1="'+py(4)+'" x2="'+(px(25)+px(3))+'" y2="'+py(4)+'" stroke="'+L+'" stroke-width="2.4"/>';
    g+='<circle cx="'+hx+'" cy="'+hy+'" r="'+px(0.75)+'" fill="none" stroke="'+L+'" stroke-width="2"/>';
    g+='</g>';
    return g;
  }
  function defs(){
    return '<defs><radialGradient id="scVig" cx="50%" cy="20%" r="80%"><stop offset="0" stop-color="#ffffff" stop-opacity=".06"/><stop offset="1" stop-color="#000000" stop-opacity=".28"/></radialGradient></defs>';
  }
  // ── ZONES mode: the ten zones as filled regions, coloured by FG% vs the D-I average ──
  var _zid=0;
  function zonesSvg(shots){
    var Z={}; Object.keys(ZMETA).forEach(function(k){ Z[k]={m:0,a:0}; });
    shots.forEach(function(s){ var k=zone10(s); if(!Z[k]) return; Z[k].a++; if(s.made)Z[k].m++; });
    var id='z'+(++_zid), g='<defs>';
    // clip regions (px). inside = inside the arc; three = everything else
    g+='<clipPath id="'+id+'in"><path d="'+arcPath()+' Z"/></clipPath>';
    g+='<clipPath id="'+id+'out"><path fill-rule="evenodd" clip-rule="evenodd" d="M 0 0 H '+W+' V '+H+' H 0 Z '+arcPath()+' Z"/></clipPath>';
    g+='</defs>';
    var cy0=py(CORNER_Y-0.4);
    // [zone, clip, rect(x,y,w,h in px), label anchor override]
    var R=function(x0,y0,x1,y1){ return [px(x0),py(y1),px(x1)-px(x0),py(y0)-py(y1)]; };
    var regions=[
      ['c3l','out',R(0,YMIN,25,CORNER_Y-0.4)], ['c3r','out',R(25,YMIN,50,CORNER_Y-0.4)],
      ['w3l','out',R(0,CORNER_Y-0.4,19,YMAX)], ['t3','out',R(19,CORNER_Y-0.4,31,YMAX)], ['w3r','out',R(31,CORNER_Y-0.4,50,YMAX)],
      ['midl','in',R(0,YMIN,19,YMAX)], ['midr','in',R(31,YMIN,50,YMAX)], ['midc','in',R(19,19,31,YMAX)],
      ['paint','in',R(19,YMIN,31,19)]
    ];
    var floor=Math.max(6, Math.round(shots.length*0.02));
    var fillFor=function(k){ var z=Z[k]; if(z.a<floor) return 'rgba(140,140,150,.10)';
      var d=z.m/z.a-avgOf(k), t=Math.max(-1,Math.min(1,d/0.14));
      return t>=0 ? 'rgba(240,138,60,'+(0.10+0.34*t).toFixed(2)+')' : 'rgba(76,127,214,'+(0.10+0.34*(-t)).toFixed(2)+')'; };
    var tipFor=function(k){ var z=Z[k]; return ZMETA[k].n+'|'+(z.a?Math.round(z.m/z.a*100):0)+'|'+z.m+'/'+z.a+'|'+Math.round(avgOf(k)*100)+'|'+(z.a?((z.m/z.a-avgOf(k)>=0?'+':'')+Math.round((z.m/z.a-avgOf(k))*100)):'—'); };
    regions.forEach(function(r){ var b=r[2];
      g+='<rect class="sc-zone" data-zk="'+r[0]+'" data-ztip="'+tipFor(r[0])+'" clip-path="url(#'+id+r[1]+')" x="'+b[0]+'" y="'+b[1]+'" width="'+b[2]+'" height="'+b[3]+'" fill="'+fillFor(r[0])+'" stroke="var(--sc-line)" stroke-opacity=".35" stroke-width="1"/>'; });
    // the rim zone sits on top of the paint
    g+='<circle class="sc-zone" data-zk="rim" data-ztip="'+tipFor('rim')+'" cx="'+px(HOOP_X)+'" cy="'+py(HOOP_Y)+'" r="'+px(4)+'" fill="'+fillFor('rim')+'" stroke="var(--sc-line)" stroke-opacity=".5" stroke-width="1"/>';
    // labels
    var LAB={rim:[25,8.6],paint:[25,15.5],midl:[10.5,13],midc:[25,23.5],midr:[39.5,13],c3l:[3.3,9],c3r:[46.7,9],w3l:[8.5,25],t3:[25,31.5],w3r:[41.5,25]};
    Object.keys(LAB).forEach(function(k){ var z=Z[k], at=LAB[k]; if(!z.a) return;
      var big=z.a>=floor, p=Math.round(z.m/z.a*100);
      g+='<text class="sc-zlab'+(big?'':' dim')+'" x="'+px(at[0])+'" y="'+py(at[1])+'" text-anchor="middle">'+(big?p+'%':'—')+'</text>'+
         '<text class="sc-zsub" x="'+px(at[0])+'" y="'+(py(at[1])+12)+'" text-anchor="middle">'+z.m+'/'+z.a+'</text>'; });
    return g;
  }
  function zoneSheet(shots){
    var Z={}; Object.keys(ZMETA).forEach(function(k){ Z[k]={m:0,a:0}; });
    shots.forEach(function(s){ var k=zone10(s); if(!Z[k]) return; Z[k].a++; if(s.made)Z[k].m++; });
    var tot=shots.length||1;
    var rows=Object.keys(ZMETA).map(function(k){ var z=Z[k]; return {k:k,n:ZMETA[k].n,a:z.a,m:z.m,p:z.a?z.m/z.a:null,avg:avgOf(k)}; })
      .filter(function(r){ return r.a>0; }).sort(function(a,b){ return b.a-a.a; });
    var tr=rows.map(function(r){ var d=r.p!=null?(r.p-r.avg)*100:null, eff=r.k.indexOf('3')>=0||r.k==='t3'?(r.p*1.5):r.p;
      return '<tr data-zk="'+r.k+'"><td class="l nm">'+r.n.charAt(0).toUpperCase()+r.n.slice(1)+'</td><td>'+r.a+'</td><td class="dim">'+Math.round(r.a/tot*100)+'%</td><td class="strong">'+Math.round(r.p*100)+'%</td><td class="dim">'+Math.round(r.avg*100)+'%</td><td'+(d>=5?' class="c4"':d>=2?' class="c3"':d<=-5?' class="c0"':d<=-2?' class="c1"':'')+'>'+(d>0?'+':'')+Math.round(d)+'</td><td class="dim">'+(r.a>=8?Math.round(eff*100)+'%':'—')+'</td></tr>'; }).join('');
    return '<div class="sheet-wrap sc-sheet"><table class="sheet dense"><thead><tr><th class="l">Zone</th><th>FGA</th><th>Share</th><th>FG%</th><th>D-I'+(REF_YEAR?' \u2019'+String(REF_YEAR).slice(2):'')+'</th><th title="FG% minus the D-I figure, in points (shaded green above, red below by 2+)">Δ</th><th>eFG%</th></tr></thead><tbody>'+tr+'</tbody></table></div>';
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
    // ONE ink: FG% vs the D-I baseline from that distance maps to ink strength —
    // −10% (or worse) is a faint wash, the baseline is mid, +10% is solid ink.
    var t=Math.max(-1,Math.min(1,diff/0.15));
    var a=0.10+0.85*((t+1)/2);
    return 'rgba(var(--sc-ink-rgb),'+a.toFixed(3)+')';
  }
  // ── hex grid (pointy-top) ── smaller cells than before for a denser, smoother map
  var HS=1.75;                                           // hex size in feet (bigger cells read as a pattern, not speckle)
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
  var HXN=[[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];     // axial neighbors (for smoothing)
  // human-readable location for the tooltip
  function distLabel(dh,isThree){
    if(isThree) return Math.round(dh)+' ft · '+(dh>=23.5?'above-the-break':'corner')+' 3';
    if(dh<=1.6) return 'at the rim';
    if(dh<=4)   return Math.round(dh)+' ft — layup range';
    return Math.round(dh)+' ft from rim';
  }

  // FG% vs D-I from that distance -> the same navy (colder) / grey / orange (hotter) bands the
  // Hot & cold and 'Where the shots moved' charts use; 4 points per step, +/-14 tops out
  var HEX_NEG=['#3a4767','#6c7894','#9aa4ba','#c3c9d7'], HEX_MID='#dcdde2', HEX_POS=['#fbc6a4','#f8a577','#f5874a','#ef6a1f'];
  function hexBand(d){ var a=Math.abs(d), i=a<0.02?-1:a<0.05?0:a<0.08?1:a<0.11?2:3;
    if(i<0) return HEX_MID; return d>0?HEX_POS[i]:HEX_NEG[3-i]; }
  function hexbinSvg(shots){
    var bins={};
    shots.forEach(function(s){
      var k=axial(clampx(fxf(s.x)), clampy(fyf(s.y)));
      var b=bins[k]||(bins[k]={att:0,mk:0,three:0});
      b.att++; if(s.made)b.mk++; if(s.sv===3)b.three++;
    });
    var maxAtt=0; for(var k in bins) if(bins[k].att>maxAtt) maxAtt=bins[k].att;
    var keys=Object.keys(bins);
    // draw low-volume first, biggest last, so the paint blob and
    // real high-volume cells sit on top of the continuous background
    keys.sort(function(a,b){return bins[a].att-bins[b].att;});
    var K=6, g='', idx=0;                                 // K = shrinkage prior strength
    keys.forEach(function(k){
      var b=bins[k];
      var a=k.split(','), q=+a[0], r=+a[1];
      var c=hexCenter(k), cx=px(c[0]), cy=py(c[1]);
      var isThree=b.three>b.att/2;
      var dh=Math.sqrt((c[0]-HOOP_X)*(c[0]-HOOP_X)+(c[1]-HOOP_Y)*(c[1]-HOOP_Y));
      var base=d1FG(dh,isThree);
      // COLOR: pool the cell with its six neighbors (half weight) so the map reads
      // as a smooth field, then shrink toward the local D-1 baseline so thin-sample
      // cells settle near neutral instead of screaming 0% or 100%.
      var pAtt=b.att, pMk=b.mk;
      HXN.forEach(function(d){ var nb=bins[(q+d[0])+','+(r+d[1])]; if(nb){ pAtt+=nb.att*0.5; pMk+=nb.mk*0.5; } });
      var diff=(pMk + K*base)/(pAtt + K) - base;
      var zc=isThree?'sc-zt':(dh<=4?'sc-zr':'sc-zm');
      // SIZE = SHOT VOLUME (the whole point of the hexbin): radius spans a WIDE range so
      // high-volume zones read as big cells and thin zones as small ones. sqrt keeps it
      // perceptually fair (area ∝ attempts). Was 0.90–1.16 (a ~29% span — every hex looked
      // identical, so the size legend was a lie); now 0.48–1.18 (radius >2× → area >5×).
      var rp=Math.min(px(HS)*1.18, px(HS)*(0.48+0.82*Math.sqrt(b.att/maxAtt)));
      // tooltip carries the RAW numbers (pipe-delimited; wire() builds the card)
      var rawFg=b.mk/b.att, rawDiff=rawFg-base;
      var tip=(rawFg*100).toFixed(1)+'|'+distLabel(dh,isThree)+'|'+b.mk+'/'+b.att+'|'+(base*100).toFixed(1)+'|'+(rawDiff>=0?'+':'')+(rawDiff*100).toFixed(1)+'|'+(rawDiff>=0?'1':'0');
      g+='<path class="sc-mark sc-hex '+zc+'" data-tip="'+tip+'" style="animation-delay:'+Math.min(idx*7,700)+'ms" d="'+hexPath(cx,cy,rp)+'" fill="'+hexBand(diff)+'" stroke="var(--sc-floor)" stroke-width="1.2"/>';
      idx++;
    });
    return g;
  }
  // compact 2PT / 3PT / All / eFG summary shown beneath the hexbin (matches how the
  // pro charts caption their maps)
  function hexSummary(shots){
    var threes=shots.filter(function(s){return s.sv===3;});
    var thm=threes.filter(function(s){return s.made;}).length, thN=threes.length;
    var twoN=shots.length-thN, twom=shots.filter(function(s){return s.made&&s.sv!==3;}).length;
    var made=twom+thm, N=shots.length;
    var efg=N?Math.round((made+0.5*thm)/N*100):0;
    function ln(l,mk,at){ return '<span><b>'+l+'</b> '+mk+'/'+at+' · '+(at?Math.round(mk/at*100):0)+'%</span>'; }
    return '<div class="sc-hexsum">'+ln('2PT',twom,twoN)+ln('3PT',thm,thN)+ln('All',made,N)+'<span class="sc-hxefg"><b>eFG</b> '+efg+'%</span></div>';
  }

  // ── heat colormap (on-brand purple ramp: dark -> accent -> light) ──
  var INF=[[8,5,16],[34,16,64],[64,28,124],[104,46,178],[139,63,224],[176,116,236],[214,180,248]];
  // yellow -> orange -> red (the familiar heat look), interpolated
  var HEAT=[[255,222,89],[255,180,48],[251,120,32],[228,58,32],[168,18,28]];
  function heatRamp(v){ v=v<0?0:v>1?1:v; var n=HEAT.length-1,x=v*n,i=Math.floor(x),f=x-i,a=HEAT[i],b=HEAT[Math.min(n,i+1)];
    return [a[0]+(b[0]-a[0])*f|0, a[1]+(b[1]-a[1])*f|0, a[2]+(b[2]-a[2])*f|0]; }
  function inferno(v){ v=v<0?0:v>1?1:v; var n=INF.length-1,x=v*n,i=Math.floor(x),f=x-i,a=INF[i],b=INF[Math.min(n,i+1)];
    return [a[0]+(b[0]-a[0])*f|0, a[1]+(b[1]-a[1])*f|0, a[2]+(b[2]-a[2])*f|0]; }

  // separable box blur on a float grid (smooths the density -> KDE look)
  function blur(g,w,h,rad){
    var t=new Float32Array(g.length),k,x,y,s,n;
    for(y=0;y<h;y++)for(x=0;x<w;x++){ s=0;n=0; for(k=-rad;k<=rad;k++){var xx=x+k; if(xx>=0&&xx<w){s+=g[y*w+xx];n++;}} t[y*w+x]=s/n; }
    for(y=0;y<h;y++)for(x=0;x<w;x++){ s=0;n=0; for(k=-rad;k<=rad;k++){var yy=y+k; if(yy>=0&&yy<h){s+=t[yy*w+x];n++;}} g[y*w+x]=s/n; }
  }
  var HEAT_BANDS=['#fdeadb','#fcd3b6','#f9b68a','#f6975d','#f07a35','#e25d14'];
  function drawHeat(el, shots){
    var cv=el.querySelector('.sc-heat'); if(!cv||!cv.getContext) return;
    cv.width=W; cv.height=H; var ctx=cv.getContext('2d');
    var GW=100, GH=Math.round((YMAX-YMIN)*2), G=densityGrid(shots,GW,GH).g;
    // bands are relative to this chart's own busiest spots (98th percentile), so a 150-shot
    // player and a 2,000-shot team both use the full ramp
    var nz=[]; for(var i=0;i<G.length;i++) if(G[i]>0) nz.push(G[i]); nz.sort(function(a,b){return a-b;});
    var mx=(nz.length?nz[Math.floor(nz.length*0.98)]:1)||1;
    var floor=(getComputedStyle(el).getPropertyValue('--sc-floor')||'#fbfbf9').trim(); ctx.fillStyle=floor; ctx.fillRect(0,0,W,H);
    var im=ctx.getImageData(0,0,W,H), p=im.data, TH=[0.16,0.3,0.44,0.58,0.73,0.88], C=HEAT_BANDS.map(hexRgb);
    for(var yy=0;yy<H;yy++){ var gy=yy/(H-1)*(GH-1), y0=Math.floor(gy), y1=Math.min(GH-1,y0+1), fy=gy-y0;
      for(var xx=0;xx<W;xx++){ var gx=xx/(W-1)*(GW-1), x0=Math.floor(gx), x1=Math.min(GW-1,x0+1), fx=gx-x0;
        var v=((G[y0*GW+x0]*(1-fx)+G[y0*GW+x1]*fx)*(1-fy)+(G[y1*GW+x0]*(1-fx)+G[y1*GW+x1]*fx)*fy)/mx, band=-1;
        v=Math.pow(Math.max(0,v),0.6);   // a gentler curve so the arc isn't swamped by the rim
        for(var b=TH.length-1;b>=0;b--) if(v>=TH[b]){ band=b; break; }
        if(band<0) continue; var c=C[band], o=(yy*W+xx)*4; p[o]=c[0]; p[o+1]=c[1]; p[o+2]=c[2]; p[o+3]=255; } }
    ctx.putImageData(im,0,0);
  }


  // ── ZONES (editorial, Sept-Oct 2026 rebuild) ──────────────────────────────────────────
  // Twelve regions fanned out from the rim (the print-style zone chart): restricted area,
  // paint, five midrange slices and five three-point slices split by rays from the hoop at
  // ±22.5° and at the corner break. Shaded by SHARE of attempts (where the shots come from),
  // labelled made-attempts; FG% vs D-I lives in the tooltip and the 2s/3s sheet underneath.
  var ANG_TOP=22.5, ANG_CB=Math.atan2(HOOP_X-CORNER_X, CORNER_Y-HOOP_Y)*180/Math.PI;
  var Z12={
    ra   :{n:'restricted area',     ref:'rim',   lab:[25,8.25]},
    paint:{n:'the paint',           ref:'paint', lab:[25,16.4]},
    mt   :{n:'top of the key (mid)',ref:'midc',  lab:[25,22.7]},
    mwl  :{n:'left wing (mid)',     ref:'midl',  lab:[13.4,18.6]},
    mwr  :{n:'right wing (mid)',    ref:'midr',  lab:[36.6,18.6]},
    mbl  :{n:'left baseline (mid)', ref:'midl',  lab:[11.4,8.6]},
    mbr  :{n:'right baseline (mid)',ref:'midr',  lab:[38.6,8.6]},
    c3l  :{n:'left corner 3',       ref:'c3l',   lab:[1.68,5.7], rot:-90},
    c3r  :{n:'right corner 3',      ref:'c3r',   lab:[48.32,5.7], rot:90},
    w3l  :{n:'left wing 3',         ref:'w3l',   lab:[6.2,27]},
    t3   :{n:'top of the key 3',    ref:'t3',    lab:[25,32.4]},
    w3r  :{n:'right wing 3',        ref:'w3r',   lab:[43.8,27]}
  };
  function zone12(s){
    var x=fxf(s.x), y=fyf(s.y), d=edist(s), dx=x-HOOP_X, dy=y-HOOP_Y;
    var ang=Math.atan2(Math.abs(dx), dy)*180/Math.PI;
    if(s.sv===3){ if(y<=CORNER_Y-0.4) return dx<0?'c3l':'c3r'; return ang<ANG_TOP?'t3':(dx<0?'w3l':'w3r'); }
    if(d<=4) return 'ra';
    if(x>=19&&x<=31&&y<=19) return 'paint';
    if(ang<ANG_TOP) return 'mt';
    if(ang<ANG_CB) return dx<0?'mwl':'mwr';
    return dx<0?'mbl':'mbr';
  }
  // a pie slice from the hoop between two angles (0 = straight out, negative = left), far past the frame
  function wedge(a1,a2){
    var p='M'+px(HOOP_X).toFixed(1)+' '+py(HOOP_Y).toFixed(1);
    for(var i=0;i<=24;i++){ var a=(a1+(a2-a1)*i/24)*Math.PI/180; p+=' L'+px(HOOP_X+70*Math.sin(a)).toFixed(1)+' '+py(HOOP_Y+70*Math.cos(a)).toFixed(1); }
    return p+' Z';
  }
  // the fill ink: the team colour when we have one (lightened on the dark theme when it's a
  // deep navy/black, or it vanishes into the floor), else the house blue
  function darkTheme(){ var t=document.documentElement.getAttribute('data-theme'); if(t) return t==='dark';
    return !!(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches); }
  function inkRgb(col){
    var m=/^#?([0-9a-f]{6})$/i.exec((col||'').trim()), r,g,b;
    if(m){ r=parseInt(m[1].slice(0,2),16); g=parseInt(m[1].slice(2,4),16); b=parseInt(m[1].slice(4,6),16); }
    else if((m=/rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(col||''))){ r=+m[1]; g=+m[2]; b=+m[3]; }
    else { r=31; g=95; b=168; }
    var lum=(0.2126*r+0.7152*g+0.0722*b)/255;
    if(darkTheme()&&lum<0.3){ var f=0.42; r=r+(255-r)*f|0; g=g+(255-g)*f|0; b=b+(255-b)*f|0; }
    if(lum>0.72){ r=r*0.6|0; g=g*0.6|0; b=b*0.6|0; }       // a near-white team colour would wash out
    return [r,g,b];
  }
  function z12Totals(shots){ var Z={}; Object.keys(Z12).forEach(function(k){ Z[k]={m:0,a:0}; });
    shots.forEach(function(s){ var k=zone12(s); Z[k].a++; if(s.made) Z[k].m++; }); return Z; }
  function zones12Svg(shots, ink){
    var Z=z12Totals(shots), N=shots.length||1, maxA=0;
    Object.keys(Z).forEach(function(k){ if(Z[k].a>maxA) maxA=Z[k].a; });
    var id='zz'+(++_zid), g='<defs>', cyCut=py(CORNER_Y-0.4);
    var lane='M '+px(19)+' '+py(19)+' H '+px(31)+' V '+py(0)+' H '+px(19)+' Z';
    g+='<clipPath id="'+id+'in"><path clip-rule="evenodd" d="'+arcPath()+' Z '+lane+'"/></clipPath>';
    g+='<clipPath id="'+id+'out"><path clip-rule="evenodd" d="M 0 0 H '+W+' V '+H+' H 0 Z '+arcPath()+' Z"/></clipPath>';
    g+='<clipPath id="'+id+'hi"><rect x="0" y="0" width="'+W+'" height="'+cyCut+'"/></clipPath>';
    g+='<clipPath id="'+id+'lo"><rect x="0" y="'+cyCut+'" width="'+W+'" height="'+(H-cyCut)+'"/></clipPath></defs>';
    var alphaOf=function(k){ var a=Z[k].a; return a?0.07+0.85*Math.pow(a/maxA,0.8):0; };
    var fill=function(k){ var al=alphaOf(k); return al?'rgba('+ink.join(',')+','+al.toFixed(3)+')':'transparent'; };
    var tip=function(k){ var z=Z[k], av=avgOf(Z12[k].ref);
      return Z12[k].n+' · '+Math.round(z.a/N*100)+'% of shots|'+(z.a?Math.round(z.m/z.a*100):0)+'|'+z.m+'/'+z.a+'|'+Math.round(av*100)+'|'+(z.a?((z.m/z.a-av>=0?'+':'')+Math.round((z.m/z.a-av)*100)):'—'); };
    var reg=function(k,d,clip,clip2){ var el='<path class="sc-zone scz-z" data-zk="'+k+'" data-ztip="'+tip(k)+'" d="'+d+'" fill="'+fill(k)+'"'+(clip2?' clip-path="url(#'+id+clip2+')"':'')+'/>';
      return '<g clip-path="url(#'+id+clip+')">'+el+'</g>'; };
    var CX=CORNER_X, FULL='M 0 0 H '+W+' V '+H+' H 0 Z';
    // threes
    g+=reg('c3l','M 0 '+cyCut+' H '+px(25)+' V '+H+' H 0 Z','out');
    g+=reg('c3r','M '+px(25)+' '+cyCut+' H '+W+' V '+H+' H '+px(25)+' Z','out');
    g+=reg('w3l',wedge(-180,-ANG_TOP),'out','hi');
    g+=reg('t3', wedge(-ANG_TOP,ANG_TOP),'out');
    g+=reg('w3r',wedge(ANG_TOP,180),'out','hi');
    // midrange (inside the arc, outside the lane)
    g+=reg('mt', wedge(-ANG_TOP,ANG_TOP),'in');
    g+=reg('mwl',wedge(-ANG_CB,-ANG_TOP),'in');
    g+=reg('mwr',wedge(ANG_TOP,ANG_CB),'in');
    g+=reg('mbl',wedge(-180,-ANG_CB),'in');
    g+=reg('mbr',wedge(ANG_CB,180),'in');
    // paint = lane minus the restricted-area circle; then the circle itself
    var hx=px(HOOP_X), hy=py(HOOP_Y), rr=px(4);
    var circ='M '+(hx-rr)+' '+hy+' a '+rr+' '+rr+' 0 1 0 '+(2*rr)+' 0 a '+rr+' '+rr+' 0 1 0 '+(-2*rr)+' 0 Z';
    g+='<path class="sc-zone scz-z" data-zk="paint" data-ztip="'+tip('paint')+'" fill-rule="evenodd" d="'+lane+' '+circ+'" fill="'+fill('paint')+'"/>';
    g+='<path class="sc-zone scz-z" data-zk="ra" data-ztip="'+tip('ra')+'" d="'+circ+'" fill="'+fill('ra')+'"/>';
    // the zone seams (thin floor-coloured rays so the slices read as tiles)
    var seam=function(a, r0, r1){ var s=Math.sin(a*Math.PI/180), c=Math.cos(a*Math.PI/180);
      return '<line x1="'+px(HOOP_X+r0*s).toFixed(1)+'" y1="'+py(HOOP_Y+r0*c).toFixed(1)+'" x2="'+px(HOOP_X+r1*s).toFixed(1)+'" y2="'+py(HOOP_Y+r1*c).toFixed(1)+'"/>'; };
    var midR0=(19-HOOP_Y)/Math.cos(ANG_TOP*Math.PI/180);
    g+='<g class="scz-seam">'+
      '<g clip-path="url(#'+id+'out)">'+seam(-ANG_TOP,10,60)+seam(ANG_TOP,10,60)+'<line x1="0" y1="'+cyCut+'" x2="'+px(CX+0.6)+'" y2="'+cyCut+'"/><line x1="'+px(50-CX-0.6)+'" y1="'+cyCut+'" x2="'+W+'" y2="'+cyCut+'"/></g>'+
      '<g clip-path="url(#'+id+'in)">'+seam(-ANG_TOP,midR0,30)+seam(ANG_TOP,midR0,30)+seam(-ANG_CB,4,30)+seam(ANG_CB,4,30)+'</g></g>';
    // labels: made-att, FG% under it (returned separately so they sit above the court lines)
    var tiles=g; g='';
    Object.keys(Z12).forEach(function(k){ var z=Z[k], at=Z12[k].lab, x=px(at[0]), y=py(at[1]);
      var dark=alphaOf(k)>0.5, cls='scz-lab'+(dark?' on':''), big=z.a?(z.m+'–'+z.a):'–';
      if(Z12[k].rot){ g+='<text class="'+cls+' sm" transform="translate('+x.toFixed(1)+' '+y.toFixed(1)+') rotate('+Z12[k].rot+')" text-anchor="middle" dominant-baseline="central">'+big+'</text>'; return; }
      g+='<text class="'+cls+'" x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" text-anchor="middle" dominant-baseline="central">'+big+'</text>';
      if(z.a>=5) g+='<text class="scz-sub'+(dark?' on':'')+'" x="'+x.toFixed(1)+'" y="'+(y+16).toFixed(1)+'" text-anchor="middle" dominant-baseline="central">'+Math.round(z.m/z.a*100)+'%</text>'; });
    return {tiles:tiles, labels:g};
  }
  // ── shot-diet bars: share of FGA by restricted area / paint / midrange / three ──
  var DIET=[['rim','Restricted area'],['paint','Paint'],['mid','Midrange'],['three','Three']];
  function dietOf(shots){ var c={rim:0,paint:0,mid:0,three:0};
    shots.forEach(function(s){ var k=zone10(s); c[k==='rim'||k==='paint'?k:(k.charAt(0)==='m'?'mid':'three')]++; });
    var n=shots.length||1; return {rim:c.rim/n,paint:c.paint/n,mid:c.mid/n,three:c.three/n,n:shots.length}; }
  function dietRef(){ var z=REF; if(!z) return {rim:.26,paint:.23,mid:.115,three:.395};
    var sh=function(k){ return (z[k]&&z[k].share)||0; };
    return {rim:sh('rim'),paint:sh('paint'),mid:sh('midl')+sh('midc')+sh('midr'),three:sh('c3l')+sh('c3r')+sh('w3l')+sh('t3')+sh('w3r')}; }
  function dietRow(label, sub, d, cls){
    var segs=DIET.map(function(b,i){ var v=d[b[0]]||0;
      return '<i class="scz-seg s'+i+'" style="flex:'+Math.max(v,0.0001).toFixed(4)+'" title="'+b[1]+' '+Math.round(v*100)+'%">'+(v>=0.055?Math.round(v*100)+'%':'')+'</i>'; }).join('');
    return '<div class="scz-drow'+(cls?' '+cls:'')+'"><div class="scz-dl"><b>'+label+'</b>'+(sub?'<span>'+sub+'</span>':'')+'</div><div class="scz-dbar">'+segs+'</div></div>'; }
  function dietBlock(shots, opts){
    var me=dietOf(shots), ref=dietRef();
    return '<div class="scz-diet"><div class="scz-cap">Share of field-goal attempts by zone</div>'+
      '<div class="scz-drow scz-dhead"><div class="scz-dl"></div><div class="scz-dbar">'+DIET.map(function(b,i){ return '<i class="scz-seg s'+i+'" style="flex:1"><span class="lf">'+b[1]+'</span><span class="ls">'+(b[0]==='rim'?'Rim':b[0]==='mid'?'Mid':b[1])+'</span></i>'; }).join('')+'</div></div>'+
      dietRow(opts.short||opts.subtitle||'This chart', shots.length.toLocaleString()+' FGA', me)+
      dietRow('D-I average', REF_YEAR?((REF_YEAR-1)+'–'+String(REF_YEAR).slice(2)):'', ref, 'ref')+'</div>'; }
  // ── 2-pointers / 3-pointers split (sheet kit; FG% shaded vs the D-I figure) ──
  function splitTables(shots){
    var Z=zoneTotals(shots), sum=function(ks){ var m=0,a=0; ks.forEach(function(k){ m+=Z[k].m; a+=Z[k].a; }); return [m,a]; };
    var refP=function(ks){ if(!REF){ var t=0,n=0; ks.forEach(function(k){ t+=ZMETA[k].avg; n++; }); return t/n; }
      var m=0,a=0; ks.forEach(function(k){ if(REF[k]){ m+=REF[k].m; a+=REF[k].a; } }); return a?m/a:null; };
    var row=function(lab, ks, tot){ var v=sum(ks), p=v[1]?v[0]/v[1]:null, r=refP(ks), d=(p!=null&&r!=null)?(p-r)*100:null;
      var sh=(v[1]>=8&&d!=null)?(d>=5?' c4':d>=2?' c3':d<=-5?' c0':d<=-2?' c1':''):'';
      return '<tr'+(tot?' class="scz-total"':'')+'><td class="l nm">'+lab+'</td><td>'+v[0]+'–'+v[1]+'</td><td class="strong'+sh+'">'+(p!=null?Math.round(p*100)+'%':'—')+'</td><td class="dim">'+(r!=null?Math.round(r*100)+'%':'')+'</td></tr>'; };
    var th='<thead><tr><th class="l">Zone</th><th>FGM–A</th><th>FG%</th><th>D-I</th></tr></thead>';
    var MID=['midl','midc','midr'], AB=['w3l','t3','w3r'], C3=['c3l','c3r'];
    return '<div class="scz-split">'+
      '<div><div class="scz-cap">2-pointers</div><div class="sheet-wrap sc-sheet"><table class="sheet dense">'+th+'<tbody>'+
        row('Restricted area',['rim'])+row('Paint',['paint'])+row('Midrange',MID)+row('All 2s',['rim','paint'].concat(MID),1)+'</tbody></table></div></div>'+
      '<div><div class="scz-cap">3-pointers</div><div class="sheet-wrap sc-sheet"><table class="sheet dense">'+th+'<tbody>'+
        row('Corner',C3)+row('Above the break',AB)+row('All 3s',C3.concat(AB),1)+'</tbody></table></div></div></div>'; }
  // ── team charts: who shot from where (needs espn_id on the shots + opts.names) ──
  function playerZoneTable(shots, names){
    var P={}; shots.forEach(function(s){ if(s.espn_id==null) return; var id=String(s.espn_id);
      var p=P[id]||(P[id]={id:id,ra:[0,0],paint:[0,0],mid:[0,0],three:[0,0],fg:[0,0]});
      var k=zone10(s), b=k==='rim'?'ra':k==='paint'?'paint':k.charAt(0)==='m'?'mid':'three';
      p[b][1]++; p.fg[1]++; if(s.made){ p[b][0]++; p.fg[0]++; } });
    var L=Object.keys(P).map(function(k){ return P[k]; }).sort(function(a,b){ return b.fg[1]-a.fg[1]; }).slice(0,14);
    if(L.length<2) return '';
    var c=function(v){ return v[1]?(v[0]+'–'+v[1]):'<span class="dim">–</span>'; };
    var nm=function(id){ var n=names&&names[id]; return n?n.replace(/^(\S)\S*\s+/,'$1. '):('#'+id); };
    return '<div class="scz-cap" style="margin-top:16px;">By player</div><div class="sheet-wrap sc-sheet"><table class="sheet dense"><thead><tr><th class="l">Player</th><th>Restricted</th><th>Paint</th><th>Mid</th><th>3PT</th><th>FG</th><th>FG%</th></tr></thead><tbody>'+
      L.map(function(p){ return '<tr><td class="l nm"><a href="player.html?espn='+p.id+'" style="color:inherit;text-decoration:none;">'+nm(p.id)+'</a></td><td>'+c(p.ra)+'</td><td>'+c(p.paint)+'</td><td>'+c(p.mid)+'</td><td>'+c(p.three)+'</td><td class="strong">'+c(p.fg)+'</td><td>'+Math.round(p.fg[0]/p.fg[1]*100)+'%</td></tr>'; }).join('')+
      '</tbody></table></div>'; }
  function zHead(shots, opts){
    var m=0,t3m=0,t3a=0; shots.forEach(function(s){ if(s.made) m++; if(s.sv===3){ t3a++; if(s.made) t3m++; } });
    return '<div class="scz-head"><span class="scz-name">'+(opts.subtitle||'')+'</span><span class="scz-tot"><i>FG</i> '+m+'–'+shots.length+'<i>3PT</i> '+t3m+'–'+t3a+'</span></div>'; }

  // ── WHERE THE SHOTS MOVED: season-vs-season shot-density difference (contour bands) ──
  //    TDC_SHOTCHART.renderShift(el, curShots, baseShots, {name, cur:'2026', base:'2025'})
  var SH_POS=['#fde4d4','#fbc6a4','#f8a577','#f5874a','#ef6a1f'], SH_NEG=['#e3e6ed','#c3c9d7','#9aa4ba','#6c7894','#3a4767'];
  function densityGrid(shots, GW, GH){
    var g=new Float32Array(GW*GH), n=0;
    shots.forEach(function(s){ if(edist(s)>35) return;      // heaves excluded
      var fx=clampx(fxf(s.x)), fy=clampy(fyf(s.y));
      var gx=Math.round(fx/50*(GW-1)), gy=Math.round((YMAX-fy)/(YMAX-YMIN)*(GH-1));
      g[gy*GW+gx]+=1; n++; });
    for(var p=0;p<3;p++) blur(g,GW,GH,3);
    if(n) for(var i=0;i<g.length;i++) g[i]/=n;
    return {g:g,n:n};
  }
  function hexRgb(h){ return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]; }
  function renderShift(el, cur, base, opts){
    opts=opts||{}; if(!el) return;
    cur=(cur||[]).filter(function(s){return s.x!=null&&s.y!=null;}); base=(base||[]).filter(function(s){return s.x!=null&&s.y!=null;});
    if(cur.length<60||base.length<60){ el.innerHTML='<div style="padding:22px;text-align:center;color:var(--text3);font-size:12.5px;">Not enough located shots in one of the two seasons to compare.</div>'; return; }
    var curL=opts.cur||'this season', baseL=opts.base||'last season';
    var dc=dietOf(cur), db=dietOf(base), NM={rim:'at the rim',paint:'in the paint',mid:'from midrange',three:'beyond the arc'};
    var up=[],dn=[]; DIET.forEach(function(b){ var d=dc[b[0]]-db[b[0]]; if(d>=0.02) up.push([b[0],d]); else if(d<=-0.02) dn.push([b[0],d]); });
    up.sort(function(a,b){return b[1]-a[1];}); dn.sort(function(a,b){return a[1]-b[1];});
    var lst=function(a){ var w=a.map(function(x){return '<b>'+NM[x[0]]+'</b>';}); return w.length>1?w.slice(0,-1).join(', ')+' and '+w[w.length-1]:w[0]; };
    var who=opts.name||'This team';
    var lede=(up.length||dn.length)
      ? who+' took '+(up.length?'a bigger share of its attempts '+lst(up):'')+(up.length&&dn.length?' in '+curL+' than in '+baseL+', and a smaller share '+lst(dn):(dn.length?'a smaller share of its attempts '+lst(dn)+' in '+curL+' than in '+baseL:' in '+curL+' than in '+baseL))+'.'
      : who+'’s shot diet barely moved between '+baseL+' and '+curL+'.';
    el.innerHTML='<div class="scz-lede">'+lede+'</div>'+
      '<div class="scz-shleg"><span>Fewer shots in '+curL+'</span><i class="neg"></i><i class="pos"></i><span>More shots in '+curL+'</span></div>'+
      '<div class="sc-court-wrap sc-heat-wrap scz-shwrap"><canvas class="sc-heat"></canvas><svg class="sc-svg sc-heat-court" viewBox="0 0 '+W+' '+H+'">'+court(null,{}).replace(/var\(--sc-floor\)|var\(--sc-inside\)/g,'none')+'</svg></div>'+
      '<div class="scz-diet" style="margin-top:14px;"><div class="scz-cap">Share of field-goal attempts by zone</div>'+
        '<div class="scz-drow scz-dhead"><div class="scz-dl"></div><div class="scz-dbar">'+DIET.map(function(b,i){ return '<i class="scz-seg s'+i+'" style="flex:1"><span class="lf">'+b[1]+'</span><span class="ls">'+(b[0]==='rim'?'Rim':b[0]==='mid'?'Mid':b[1])+'</span></i>'; }).join('')+'</div></div>'+
        dietRow(baseL, base.length.toLocaleString()+' FGA', db, 'ref')+dietRow(curL, cur.length.toLocaleString()+' FGA', dc)+'</div>'+
      '<div class="scz-foot">Orange marks where '+who+' took a <b>larger share of its attempts in '+curL+'</b> than in '+baseL+', navy where it took a <b>smaller share</b>. Heaves (35+ ft) excluded; seasons are labelled by the year they end.</div>';
    var GW=100, GH=Math.round((YMAX-YMIN)*2), A=densityGrid(cur,GW,GH).g, B=densityGrid(base,GW,GH).g;
    var D=new Float32Array(GW*GH), ab=[]; for(var i=0;i<D.length;i++){ D[i]=A[i]-B[i]; if(D[i]) ab.push(Math.abs(D[i])); }
    ab.sort(function(a,b){return a-b;}); var mx=(ab.length?ab[Math.floor(ab.length*0.985)]:1)||1;
    var cv=el.querySelector('.sc-heat'); cv.width=W; cv.height=H; var ctx=cv.getContext('2d');
    var floor=(getComputedStyle(el).getPropertyValue('--sc-floor')||'#fbfbf9').trim(); ctx.fillStyle=floor; ctx.fillRect(0,0,W,H);
    var im=ctx.getImageData(0,0,W,H), p=im.data, TH=[0.14,0.3,0.48,0.66,0.84];
    var POS=SH_POS.map(hexRgb), NEG=SH_NEG.map(hexRgb);
    for(var yy=0;yy<H;yy++){ var gy=yy/(H-1)*(GH-1), y0=Math.floor(gy), y1=Math.min(GH-1,y0+1), fy=gy-y0;
      for(var xx=0;xx<W;xx++){ var gx=xx/(W-1)*(GW-1), x0=Math.floor(gx), x1=Math.min(GW-1,x0+1), fx=gx-x0;
        var v=(D[y0*GW+x0]*(1-fx)+D[y0*GW+x1]*fx)*(1-fy)+(D[y1*GW+x0]*(1-fx)+D[y1*GW+x1]*fx)*fy;
        var t=Math.min(1,Math.abs(v)/mx), band=-1; for(var b=TH.length-1;b>=0;b--) if(t>=TH[b]){ band=b; break; }
        if(band<0) continue; var c=(v>0?POS:NEG)[band], o=(yy*W+xx)*4; p[o]=c[0]; p[o+1]=c[1]; p[o+2]=c[2]; p[o+3]=255; } }
    ctx.putImageData(im,0,0);
  }

  // ── BY DISTANCE: four linked panels (frequency + FG% by foot vs the league and the player's
  //    position; then left side vs right side). League curves: scripts/data/shot_dist_ref.json
  //    (build_shot_dist_ref.py, CBBD located shots by foot, league + Guard/Forward/Center). ──
  var DREF=null, NF=31, D3=22.15;
  var POSN={G:'Guards',F:'Forwards',C:'Centers'};
  try{
    fetch('scripts/data/shot_dist_ref.json?v=1').then(function(r){return r.ok?r.json():null;}).then(function(j){
      if(!j) return; DREF=j;
      Array.prototype.forEach.call(document.querySelectorAll('[data-sc-host]'),function(el){ if(el._shots&&(el._opts.mode||'zones')==='zones') render(el,el._shots,el._opts); });
    }).catch(function(){});
  }catch(e){}
  function posGroup(p){ p=String(p||'').toUpperCase(); if(!p) return null; if(/C/.test(p)&&!/G/.test(p)) return 'C'; if(/G/.test(p)) return 'G'; if(/F/.test(p)) return 'F'; return null; }
  function distRefFor(season){
    if(!DREF||!DREF.seasons) return null; var ys=Object.keys(DREF.seasons).map(Number).sort(function(a,b){return a-b;});
    var y=parseInt(season,10), pick=ys[ys.length-1]; if(y){ pick=ys[0]; ys.forEach(function(v){ if(v<=y) pick=v; }); }
    return DREF.seasons[String(pick)]; }
  function smooth(arr){ return arr.map(function(v,i){ var a=arr[i-1], b=arr[i+1]; if(v==null) return null;
    var s=v*2, w=2; if(a!=null){ s+=a; w++; } if(b!=null){ s+=b; w++; } return s/w; }); }
  function distData(shots, opts){
    var A=[],M=[],La=[],Lm=[],Ra=[],Rm=[]; for(var i=0;i<NF;i++){ A[i]=M[i]=La[i]=Lm[i]=Ra[i]=Rm[i]=0; }
    var n=0;
    shots.forEach(function(s){ var d=edist(s); if(d>35) return; var f=Math.min(NF-1,Math.max(0,Math.round(d))); n++;
      A[f]++; if(s.made) M[f]++;
      var x=fxf(s.x), wl=x<HOOP_X-0.01?1:x>HOOP_X+0.01?0:0.5, wr=1-wl;     // dead-centre shots split half/half
      La[f]+=wl; Ra[f]+=wr; if(s.made){ Lm[f]+=wl; Rm[f]+=wr; } });
    var ref=distRefFor(opts.season||(shots[0]&&shots[0].season_year)), pg=posGroup(opts.pos);
    var share=function(a){ var t=a.reduce(function(x,y){return x+y;},0)||1; return a.map(function(v){ return v/t; }); };
    var fg=function(a,m){ return a.map(function(v,i){ return v?m[i]/v:null; }); };
    var lg=ref&&ref.all, ps=ref&&pg&&ref[pg];
    // the player's FG% curve: pool each foot with its neighbours and shrink toward the league
    // there (8 attempts of prior) so a 1-for-1 foot doesn't spike to 100%
    var lgFg=lg?fg(lg.a,lg.m):null;
    var W5=[0.25,0.6,1,0.6,0.25];
    var pFg=A.map(function(v,i){ var a=0, m=0; for(var k=-2;k<=2;k++){ a+=(A[i+k]||0)*W5[k+2]; m+=(M[i+k]||0)*W5[k+2]; }
      var base=lgFg&&lgFg[i]!=null?lgFg[i]:(a?m/a:0.4); return a>=0.5?(m+8*base)/(a+8):null; });
    pFg=smooth(pFg);
    return {n:n,A:A,M:M,La:La,Ra:Ra,Lm:Lm,Rm:Rm,
      freq:smooth(share(A)), fgp:pFg, lgFreq:lg?share(lg.a):null, lgFg:lgFg, psFreq:ps?share(ps.a):null, psFg:ps?fg(ps.a,ps.m):null,
      pos:pg, who:opts.distWho||'Player'};
  }
  function linePath(vals, X, Y){ var d='', pen=false;
    vals.forEach(function(v,i){ if(v==null){ pen=false; return; } d+=(pen?' L':' M')+X(i).toFixed(1)+' '+Y(v).toFixed(1); pen=true; }); return d; }
  // panel frame: viewBox 600x380, plot box l=70 r=585 t=40 b=320
  var PL=70, PR=585, PT=46, PB=320;
  function axisX(ticks, X, lab){ var g='<line class="sd-axis" x1="'+PL+'" x2="'+PR+'" y1="'+PB+'" y2="'+PB+'"/>';
    ticks.forEach(function(t){ g+='<line class="sd-axis" x1="'+X(t[0])+'" x2="'+X(t[0])+'" y1="'+PB+'" y2="'+(PB+6)+'"/><text class="sd-tk" x="'+X(t[0])+'" y="'+(PB+24)+'" text-anchor="middle">'+t[1]+'</text>'; });
    return g+'<text class="sd-lab" x="'+((PL+PR)/2)+'" y="'+(PB+54)+'" text-anchor="middle">'+lab+'</text>'; }
  function axisY(ticks, Y, lab){ var g='<line class="sd-axis" x1="'+PL+'" x2="'+PL+'" y1="'+PT+'" y2="'+PB+'"/>';
    ticks.forEach(function(t){ g+='<line class="sd-axis" x1="'+(PL-6)+'" x2="'+PL+'" y1="'+Y(t[0])+'" y2="'+Y(t[0])+'"/><text class="sd-tk" x="'+(PL-10)+'" y="'+(Y(t[0])+5)+'" text-anchor="end">'+t[1]+'</text>'; });
    return g+'<text class="sd-lab" transform="translate(18 '+((PT+PB)/2)+') rotate(-90)" text-anchor="middle">'+lab+'</text>'; }
  function hoverCols(horizontal){ var g='';
    for(var f=0;f<NF;f++){
      if(horizontal){ var y0=PB-(f+0.5)*(PB-PT)/30, y1=PB-(f-0.5)*(PB-PT)/30; g+='<rect class="sd-hit" data-f="'+f+'" x="'+PL+'" width="'+(PR-PL)+'" y="'+Math.max(PT,y0)+'" height="'+(Math.min(PB,y1)-Math.max(PT,y0))+'"/>'; }
      else { var x0=PL+(f-0.5)*(PR-PL)/30, x1=PL+(f+0.5)*(PR-PL)/30; g+='<rect class="sd-hit" data-f="'+f+'" y="'+PT+'" height="'+(PB-PT)+'" x="'+Math.max(PL,x0)+'" width="'+(Math.min(PR,x1)-Math.max(PL,x0))+'"/>'; } }
    return g; }
  function lineLegend(D){ var it=[['sd-pl',D.who]]; if(D.lgFreq) it.push(['sd-lg','League']); if(D.psFreq) it.push(['sd-ps',POSN[D.pos]]);
    return it.map(function(x,i){ return '<g transform="translate('+(PL+150+i*125)+' 22)"><line class="'+x[0]+'" x1="0" x2="18" y1="0" y2="0"/><text class="sd-leg" x="24" y="5">'+esc(x[1])+'</text></g>'; }).join(''); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function distLinePanel(D, kind){
    var X=function(f){ return PL+f*(PR-PL)/30; };
    var series=kind==='freq'?[D.freq,D.lgFreq,D.psFreq]:[D.fgp,D.lgFg,D.psFg];
    var top=kind==='freq'?Math.max(0.05,Math.ceil(Math.max.apply(null,series.filter(Boolean).map(function(s){ return Math.max.apply(null,s.map(function(v){return v||0;})); }))*20)/20):1;
    var Y=function(v){ return PB-v/top*(PB-PT); };
    var ys=[]; var step=kind==='freq'?(top>0.1?0.05:0.02):0.2; for(var v=0;v<=top+1e-9;v+=step) ys.push([v,Math.round(v*100)+'%']);
    var g='<svg class="sd-svg" viewBox="0 0 600 380" data-kind="'+kind+'">';
    g+='<line class="sd-3" x1="'+X(D3)+'" x2="'+X(D3)+'" y1="'+PT+'" y2="'+PB+'"/><text class="sd-3t" x="'+(X(D3)+4)+'" y="'+(PT+12)+'">3pt</text>';
    g+=axisY(ys,Y,kind==='freq'?'Frequency %':'Field goal %')+axisX([[0,0],[5,5],[10,10],[15,15],[20,20],[25,25],[30,30]],X,'Distance (ft)');
    if(series[2]) g+='<path class="sd-ps" d="'+linePath(series[2],X,Y)+'"/>';
    if(series[1]) g+='<path class="sd-lg" d="'+linePath(series[1],X,Y)+'"/>';
    g+='<path class="sd-pl" d="'+linePath(series[0],X,Y)+'"/>';
    g+=lineLegend(D);
    g+='<g class="sd-cross" style="display:none"><line x1="0" x2="0" y1="'+PT+'" y2="'+PB+'"/><circle r="5"/></g>';
    g+='<text class="sd-read" x="'+(PL+16)+'" y="'+(PT+28)+'"></text>';
    return g+hoverCols(false)+'</svg>'; }
  function distSidePanel(D, kind){
    var Y=function(f){ return PB-f*(PB-PT)/30; }, mid=(PL+PR)/2, bh=(PB-PT)/30;
    var both=function(i){ var a=D.La[i]+D.Ra[i]; return a?(D.Lm[i]+D.Rm[i])/a:0.4; };
    var L=kind==='freq'?D.La:D.La.map(function(a,i){ return a>=1?D.Lm[i]/a:null; });
    var R=kind==='freq'?D.Ra:D.Ra.map(function(a,i){ return a>=1?D.Rm[i]/a:null; });
    var Ls=D.La.map(function(a,i){ return (D.Lm[i]+4*both(i))/(a+4); }), Rs=D.Ra.map(function(a,i){ return (D.Rm[i]+4*both(i))/(a+4); });
    var mx=kind==='freq'?Math.max(10,Math.ceil(Math.max.apply(null,L.concat(R))/25)*25):1;
    var X=function(v){ return v*(PR-mid)/mx; };
    var g='<svg class="sd-svg" viewBox="0 0 600 380" data-kind="side-'+kind+'">';
    var tl=kind==='freq'?[[-mx,mx],[-mx/2,Math.round(mx/2)],[0,0],[mx/2,Math.round(mx/2)],[mx,mx]]:[[-1,'100%'],[-0.5,'50%'],[0,'0%'],[0.5,'50%'],[1,'100%']];
    g+=axisY([[0,0],[5,5],[10,10],[15,15],[20,20],[25,25],[30,30]],Y,'Distance (ft)');
    g+=axisX(tl.map(function(t){ return [t[0],t[1]]; }),function(v){ return mid+X(v); },kind==='freq'?'Left  ·  # of shots  ·  Right':'Left  ·  Field goal %  ·  Right');
    g+='<line class="sd-3" x1="'+PL+'" x2="'+PR+'" y1="'+Y(D3)+'" y2="'+Y(D3)+'"/><text class="sd-3t" x="'+(PL+4)+'" y="'+(Y(D3)+14)+'">3pt</text>';
    for(var f=0;f<NF;f++){ var y=Y(f)-bh/2, lo=kind==='fg'&&(D.La[f]<3), ro=kind==='fg'&&(D.Ra[f]<3);
      if(L[f]) g+='<rect class="sd-bl'+(lo?' thin':'')+'" x="'+(mid-X(L[f])).toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+X(L[f]).toFixed(1)+'" height="'+bh.toFixed(1)+'"/>';
      if(R[f]) g+='<rect class="sd-br'+(ro?' thin':'')+'" x="'+mid+'" y="'+y.toFixed(1)+'" width="'+X(R[f]).toFixed(1)+'" height="'+bh.toFixed(1)+'"/>'; }
    g+='<line class="sd-axis" x1="'+mid+'" x2="'+mid+'" y1="'+PT+'" y2="'+PB+'"/>';
    // the difference line (right minus left): green where the left side leads, purple where the right does
    var pool=function(arr,i){ var W5=[0.25,0.6,1,0.6,0.25], t=0; for(var k=-2;k<=2;k++) t+=(arr[i+k]||0)*W5[k+2]; return t; };
    var diff=kind==='fg'
      ? D.La.map(function(_,i){ var la=pool(D.La,i), lm=pool(D.Lm,i), ra=pool(D.Ra,i), rm=pool(D.Rm,i), base=(la+ra)?(lm+rm)/(la+ra):0.4;
          return (la>=1.5&&ra>=1.5)?((rm+3*base)/(ra+3))-((lm+3*base)/(la+3)):null; })
      : L.map(function(l,i){ return (R[i]||0)-(l||0); });
    if(kind==='fg') diff=smooth(diff);
    var pts=diff.map(function(v,i){ return v==null?null:[mid+X(Math.max(-mx,Math.min(mx,v))),Y(i)]; });
    var d='', pen=false; pts.forEach(function(p){ if(!p){ pen=false; return; } d+=(pen?' L':' M')+p[0].toFixed(1)+' '+p[1].toFixed(1); pen=true; });
    var cid='sdc'+(++_zid);
    g+='<defs><clipPath id="'+cid+'l"><rect x="0" y="0" width="'+mid+'" height="380"/></clipPath><clipPath id="'+cid+'r"><rect x="'+mid+'" y="0" width="'+(600-mid)+'" height="380"/></clipPath></defs>';
    g+='<path class="sd-dl" d="'+d+'" clip-path="url(#'+cid+'l)"/><path class="sd-dr" d="'+d+'" clip-path="url(#'+cid+'r)"/>';
    g+='<g transform="translate('+(PL+70)+' 22)"><rect class="sd-bl" x="0" y="-8" width="14" height="14"/><text class="sd-leg" x="20" y="5">Left</text>'+
      '<rect class="sd-br" x="80" y="-8" width="14" height="14"/><text class="sd-leg" x="100" y="5">Right</text>'+
      '<line class="sd-dl" x1="170" x2="188" y1="0" y2="0"/><line class="sd-dr" x1="188" x2="206" y1="0" y2="0"/><text class="sd-leg" x="212" y="5">Difference</text></g>';
    g+='<g class="sd-cross" style="display:none"><line x1="'+PL+'" x2="'+PR+'" y1="0" y2="0"/><circle r="5"/></g>';
    g+='<text class="sd-read" x="'+(PL+12)+'" y="'+(PB-96)+'"></text>';
    return g+hoverCols(true)+'</svg>'; }
  function distOverall(D, kind){
    var l=D.La.reduce(function(a,b){return a+b;},0), r=D.Ra.reduce(function(a,b){return a+b;},0);
    var lv, rv; if(kind==='freq'){ var t=(l+r)||1; lv=l/t; rv=r/t; } else { var lm=D.Lm.reduce(function(a,b){return a+b;},0), rm=D.Rm.reduce(function(a,b){return a+b;},0); lv=l?lm/l:0; rv=r?rm/r:0; }
    return '<div class="sd-ov"><span>Overall %</span><i class="l">'+Math.round(lv*100)+'%</i><i class="r">'+Math.round(rv*100)+'%</i></div>'; }
  function distBlock(shots, opts){
    var D=distData(shots,opts); if(D.n<40) return '';
    return '<div class="scz-cap" style="margin-top:22px;">By distance</div><div class="sd-grid" data-sd="1">'+
      '<div class="sd-p"><div class="sd-t">Shot frequency % by distance</div>'+distLinePanel(D,'freq')+'</div>'+
      '<div class="sd-p"><div class="sd-t">Field goal % by distance</div>'+distLinePanel(D,'fg')+'</div>'+
      '<div class="sd-p"><div class="sd-t">Shot frequency: left side vs. right side</div>'+distOverall(D,'freq')+distSidePanel(D,'freq')+'</div>'+
      '<div class="sd-p"><div class="sd-t">Field goal %: left side vs. right side</div>'+distOverall(D,'fg')+distSidePanel(D,'fg')+'</div>'+
      '</div><div class="scz-foot" style="font-size:11px;color:var(--text3);margin-top:6px;">Hover any panel to read one distance across all four. '+(D.lgFreq?'League'+(D.psFreq?' and '+POSN[D.pos].toLowerCase():'')+' lines are every located D-I shot that season. ':'')+'The '+esc(D.who.toLowerCase())+' FG% line is smoothed toward the league at thin distances. Left/right are as drawn on the court above; heaves (35+ ft) excluded.</div>'; }
  function wireDist(el, shots, opts){
    var grid=el.querySelector('[data-sd]'); if(!grid) return; var D=distData(shots,opts);
    var pc=function(v){ return v==null?'—':Math.round(v*100)+'%'; };
    var show=function(f){
      grid.querySelectorAll('.sd-svg').forEach(function(svg){ var k=svg.getAttribute('data-kind'), cr=svg.querySelector('.sd-cross'), rd=svg.querySelector('.sd-read');
        if(f==null){ cr.style.display='none'; rd.innerHTML=''; return; }
        cr.style.display=''; var line=cr.querySelector('line'), dot=cr.querySelector('circle'), lines=[];
        if(k==='freq'||k==='fg'){ var x=PL+f*(PR-PL)/30; line.setAttribute('x1',x); line.setAttribute('x2',x);
          var arr=k==='freq'?D.freq:D.fgp, top=parseFloat(svg.getAttribute('data-top'))||null;
          var lgA=k==='freq'?D.lgFreq:D.lgFg, psA=k==='freq'?D.psFreq:D.psFg;
          var pv=arr[f]; dot.setAttribute('cx',x);
          var path=svg.querySelector('.sd-pl'); dot.setAttribute('cy', pv==null?-99:yAt(svg,pv,k));
          var raw=(k==='fg'&&D.A[f]>=5)?D.M[f]/D.A[f]:pv;
          lines=[['','Distance: '+f+' ft'],['sd-tpl',D.who+': '+pc(raw)+(k==='fg'&&D.A[f]?' ('+D.M[f]+'/'+D.A[f]+')':'')]];
          if(lgA) lines.push(['sd-tlg','League: '+pc(lgA[f])]); if(psA) lines.push(['sd-tps',POSN[D.pos]+': '+pc(psA[f])]);
        } else { var y=PB-f*(PB-PT)/30; line.setAttribute('y1',y); line.setAttribute('y2',y); dot.setAttribute('cy',y);
          var fq=k==='side-freq', l=D.La[f], r=D.Ra[f], lv=fq?l:(l>=1?D.Lm[f]/l:null), rv=fq?r:(r>=1?D.Rm[f]/r:null);
          var mid=(PL+PR)/2, mx=fq?Math.max(10,Math.ceil(Math.max.apply(null,D.La.concat(D.Ra))/25)*25):1, dv=(rv||0)-(lv||0);
          dot.setAttribute('cx', mid+Math.max(-mx,Math.min(mx,dv))*(PR-mid)/mx);
          var fmt=function(v){ return fq?Math.round(v):pc(v); };
          lines=[['','Distance: '+f+' ft'],['sd-tl','Left: '+(lv==null?'—':fmt(lv))],['sd-tr','Right: '+(rv==null?'—':fmt(rv))]];
          if(lv!=null&&rv!=null) lines.push([dv>0?'sd-tr':'sd-tl','Difference: '+(fq?Math.round(Math.abs(dv)):Math.round(Math.abs(dv)*100)+'%')+(dv>0?' right':dv<0?' left':'')]); }
        rd.innerHTML=lines.map(function(t,i){ return '<tspan x="'+rd.getAttribute('x')+'" dy="'+(i?24:0)+'" class="'+t[0]+'">'+esc(t[1])+'</tspan>'; }).join(''); }); };
    function yAt(svg,v,k){ var p=svg.querySelector('.sd-pl'); var top=k==='freq'?(svg._top||(svg._top=topOf(svg))):1; return PB-v/top*(PB-PT); }
    function topOf(svg){ var ts=svg.querySelectorAll('.sd-tk'), mx=0; ts.forEach(function(t){ var v=parseFloat(t.textContent); if(/%/.test(t.textContent)&&v>mx) mx=v; }); return mx/100||1; }
    grid.querySelectorAll('.sd-hit').forEach(function(h){ h.addEventListener('mouseenter',function(){ show(+h.getAttribute('data-f')); }); });
    grid.addEventListener('mouseleave',function(){ show(null); });
    show(3);
  }

  // ── SIGNATURE SPOTS ──
  // The zones that DEFINE this shooter: enough volume to trust (floor = max(10, 5% of
  // attempts)) and clearly above the D-I average there — lit in the one ink on the court, with
  // the soft spots (volume, but clearly below the average) outlined in grey. Everything else
  // stays a bare court with faint shot dots. A ledger under the court carries the numbers.
  function zoneTotals(shots){
    var Z={}; Object.keys(ZMETA).forEach(function(k){ Z[k]={m:0,a:0}; });
    shots.forEach(function(s){ var k=zone10(s); if(!Z[k]) return; Z[k].a++; if(s.made)Z[k].m++; });
    return Z;
  }
  function regionDefs(){
    var R=function(x0,y0,x1,y1){ return [px(x0),py(y1),px(x1)-px(x0),py(y0)-py(y1)]; };
    return [
      ['c3l','out',R(0,YMIN,25,CORNER_Y-0.4)], ['c3r','out',R(25,YMIN,50,CORNER_Y-0.4)],
      ['w3l','out',R(0,CORNER_Y-0.4,19,YMAX)], ['t3','out',R(19,CORNER_Y-0.4,31,YMAX)], ['w3r','out',R(31,CORNER_Y-0.4,50,YMAX)],
      ['midl','in',R(0,YMIN,19,YMAX)], ['midr','in',R(31,YMIN,50,YMAX)], ['midc','in',R(19,19,31,YMAX)],
      ['paint','in',R(19,YMIN,31,19)]
    ];
  }
  var SPOT_LAB={rim:[25,8.6],paint:[25,15.5],midl:[10.5,13],midc:[25,23.5],midr:[39.5,13],c3l:[3.3,9],c3r:[46.7,9],w3l:[8.5,25],t3:[25,31.5],w3r:[41.5,25]};
  function spotsPick(shots, out){
    var Z=zoneTotals(shots), N=shots.length||1;
    var floor=Math.max(10, Math.round(N*0.05));
    var rows=Object.keys(ZMETA).map(function(k){ var z=Z[k]; var p=z.a?z.m/z.a:null;
      return {k:k,n:ZMETA[k].n,a:z.a,m:z.m,share:z.a/N,p:p,avg:avgOf(k),d:p==null?null:p-avgOf(k)}; });
    var q=rows.filter(function(r){ return r.a>=floor; });
    // score = edge weighted by volume, so a +9 at 25% of his shots beats a +12 at 6%
    q.forEach(function(r){ r.score=r.d*Math.sqrt(r.share); });
    var sig=q.filter(function(r){ return r.d>=0.02; }).sort(function(a,b){ return b.score-a.score; }).slice(0,3);
    var soft=q.filter(function(r){ return r.d<=-0.03; }).sort(function(a,b){ return a.score-b.score; }).slice(0,2);
    out.Z=Z; out.floor=floor; out.sig=sig; out.soft=soft; out.rows=rows; out.N=N;
  }
  // who the chart is about: 'he / his' for a player, 'the team' for team / lineup / opponent charts
  function voice(opts){ var t=opts&&(opts.kind==='team'||opts.names);
    return t?{poss:'the team\u2019s',subj:'the team',Subj:'The team',shoots:'shoots',makes:'makes',has:'has'}
            :{poss:'his',subj:'he',Subj:'He',shoots:'shoots',makes:'makes',has:'has'}; }
  function spotsSvg(shots, out){
    spotsPick(shots, out);
    var lit={}; out.sig.forEach(function(r,i){ lit[r.k]={kind:'sig',rank:i}; }); out.soft.forEach(function(r){ lit[r.k]={kind:'soft'}; });
    var id='sp'+(++_zid), g='<defs>';
    g+='<clipPath id="'+id+'in"><path d="'+arcPath()+' Z"/></clipPath>';
    g+='<clipPath id="'+id+'out"><path fill-rule="evenodd" clip-rule="evenodd" d="M 0 0 H '+W+' V '+H+' H 0 Z '+arcPath()+' Z"/></clipPath>';
    g+='<pattern id="'+id+'hatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="var(--sc-soft)" stroke-width="1.6"/></pattern>';
    g+='</defs>';
    var fillFor=function(k){ var L=lit[k]; if(!L) return 'none'; return L.kind==='soft'?'var(--sc-cold)':'var(--sc-hot)'; };
    var opFor=function(k){ var L=lit[k]; if(!L) return 0; return L.kind==='soft'?0.28:(L.rank===0?0.62:L.rank===1?0.48:0.36); };
    var strokeFor=function(k){ var L=lit[k]; return L?(L.kind==='soft'?'var(--sc-cold)':'var(--sc-hot)'):'none'; };
    regionDefs().forEach(function(r){ var b=r[2]; var L=lit[r[0]];
      g+='<rect class="sc-spotz'+(L?' on':'')+'" data-zk="'+r[0]+'" clip-path="url(#'+id+r[1]+')" x="'+b[0]+'" y="'+b[1]+'" width="'+b[2]+'" height="'+b[3]+'" fill="'+fillFor(r[0])+'" fill-opacity="'+opFor(r[0])+'" stroke="'+strokeFor(r[0])+'" stroke-width="2"'+(L&&L.kind==='soft'?' stroke-dasharray="5 4"':'')+'/>'; });
    var Lr=lit.rim;
    g+='<circle class="sc-spotz'+(Lr?' on':'')+'" data-zk="rim" cx="'+px(HOOP_X)+'" cy="'+py(HOOP_Y)+'" r="'+px(4)+'" fill="'+fillFor('rim')+'" fill-opacity="'+opFor('rim')+'" stroke="'+strokeFor('rim')+'" stroke-width="2"'+(Lr&&Lr.kind==='soft'?' stroke-dasharray="5 4"':'')+'/>';
    // (no shot dots: ESPN logs whole-foot coordinates, so on the flat court they stacked into a
    //  dot grid that read as data and buried the hot / cold zones)
    // labels on the lit zones only: FG% · share, and the edge
    out.sig.concat(out.soft).forEach(function(r){ var at=SPOT_LAB[r.k]; if(!at) return;
      var x=px(at[0]), y=py(at[1]), d=Math.round(r.d*100);
      var anc=r.k==='c3l'?'start':r.k==='c3r'?'end':'middle'; if(anc==='start') x=px(1.6); if(anc==='end') x=px(48.4);
      var hot=out.sig.indexOf(r)>=0;
      g+='<text class="sc-sptag '+(hot?'hot':'cold')+'" x="'+x+'" y="'+(y-11)+'" text-anchor="'+anc+'">'+(hot?'HOT':'COLD')+'</text>'+
         '<text class="sc-zlab" x="'+x+'" y="'+(y+7)+'" text-anchor="'+anc+'">'+Math.round(r.p*100)+'%<tspan class="sc-zedge"> '+(d>=0?'+':'\u2212')+Math.abs(d)+'</tspan></text>'; });
    return g;
  }
  // the ledger under the court: signature spots, soft spots — percentile-row language
  function spotsLedger(out, opts){
    if(!out.rows) return ''; var V=voice(opts);
    var maxShare=Math.max.apply(null,out.rows.map(function(r){return r.share;}).concat([0.01]));
    var cap=function(t){ return t.charAt(0).toUpperCase()+t.slice(1); };
    var row=function(r,kind){ var d=Math.round(r.d*100), w=100*r.share/maxShare;
      return '<div class="sc-srow" data-zk="'+r.k+'"><div class="sc-sl">'+cap(r.n)+'</div>'+
        '<div class="sc-strack"><i class="'+kind+'" style="width:'+w.toFixed(1)+'%"></i><span class="sc-ssub">'+Math.round(r.share*100)+'% of '+V.poss+' shots</span></div>'+
        '<div class="sc-sv">'+Math.round(r.p*100)+'%<span class="sc-ssub">D-I avg '+Math.round(r.avg*100)+'%</span></div>'+
        '<div class="sc-sd '+(d>=0?'pos':'neg')+'">'+(d>=0?'+':'\u2212')+Math.abs(d)+'<span class="sc-ssub">'+(d>=0?'better':'worse')+'</span></div></div>'; };
    var h='<div class="sc-ledger">';
    h+='<div class="sc-lsec"><span>Hot spots</span><span class="sc-lcap">'+V.subj+' '+V.shoots+' from here a lot <b>and</b> '+V.makes+' more than the average D-I player from there</span></div>';
    h+='<div class="sc-lhead"><span>Zone</span><span>Share of '+V.poss+' shots from here</span><span>FG%</span><span>vs D-I</span></div>';
    h+=out.sig.length?out.sig.map(function(r){return row(r,'sig');}).join(''):'<div class="sc-lempty">No zone qualifies yet \u2014 needs '+out.floor+'+ attempts from one spot and a make rate above the D-I average there.</div>';
    if(out.soft.length){ h+='<div class="sc-lsec" style="margin-top:6px;"><span>Cold spots</span><span class="sc-lcap">'+V.subj+' '+V.shoots+' from here a lot, but '+V.makes+' less than the average D-I player from there</span></div>'+out.soft.map(function(r){return row(r,'soft');}).join(''); }
    h+='<div class="sc-lfoot">A zone only counts once '+V.subj+' '+V.has+' taken '+out.floor+'+ shots from it. "vs D-I" is '+V.poss+' make rate minus what the average Division-I player makes from that same zone, in percentage points.</div></div>';
    return h;
  }
  function spotsRead(out, opts){
    var s=out.sig||[], w=out.soft||[], V=voice(opts);
    var intro='<div class="sc-explain"><b>What this shows:</b> the zones '+V.subj+' '+V.shoots+' from most, marked <span class="hot">hot</span> where '+V.subj+' '+V.makes+' a higher share than the average D-I player from that spot, and <span class="cold">cold</span> where '+V.subj+' '+V.makes+' fewer. Zones '+V.subj+' rarely '+(V.subj==='he'?'shoots':'shoots')+' from, or where '+V.subj+' '+V.makes+' about the average, stay blank. Each label is the FG% from that zone and the gap to D-I, in points.</div>';
    if(!s.length&&!w.length) return intro;
    var ph=function(r){ return r.n+' <b>'+Math.round(r.p*100)+'%</b> (<b class="'+(r.d>=0?'pos':'neg')+'">'+(r.d>=0?'+':'\u2212')+Math.abs(Math.round(r.d*100))+'</b> vs D-I)'; };
    var t='';
    if(s.length) t+='<span class="hot">Hot</span> from '+s.map(ph).join(s.length>2?', ':' and ')+'.';
    if(w.length) t+=(t?' ':'')+'<span class="cold">Cold</span> from '+w.map(ph).join(' and ')+'.';
    return intro+'<div class="sc-read">'+t+'</div>';
  }
  function spotsCaption(out){
    var s=out.sig||[], w=out.soft||[];
    if(!s.length&&!w.length) return '';
    var phr=function(r){ return '<b>'+r.n+'</b> '+(r.d>=0?'+':'−')+Math.abs(Math.round(r.d*100)); };
    var bits=[]; if(s.length) bits.push('Signature: '+s.map(phr).join(', ')); if(w.length) bits.push('Soft: '+w.map(phr).join(', '));
    return bits.join(' · ');
  }

  function statBox(l,v,s,zone,i){
    return '<div class="sc-z" '+(zone?'data-zone="'+zone+'"':'')+' style="animation-delay:'+(200+i*80)+'ms"><div class="sc-zv">'+v+'</div><div class="sc-zl">'+l+'</div><div class="sc-zs">'+s+'</div></div>';
  }
  function zoneStrip(shots){
    var made=shots.filter(function(s){return s.made;}), z=zones(shots);
    var fgp=Math.round(made.length/shots.length*100);
    var efg=Math.round((made.length+0.5*made.filter(function(s){return s.sv===3;}).length)/shots.length*100);
    var tpr=Math.round(z.three[1]/shots.length*100), rimr=Math.round(z.rim[1]/shots.length*100);
    var dz=function(a,avg){ return a[1]?(pct(a)-Math.round(avg*100)):null; };
    var sub=function(d){ return d==null?'':'<span style="color:'+(d>=2?'var(--green)':d<=-2?'var(--red)':'var(--text3)')+';font-weight:800">'+(d>0?'+':'')+d+'</span>'; };
    return '<div class="sc-zones">'+statBox('FG%',fgp+'%',made.length+'/'+shots.length,null,0)+
      statBox('eFG%',efg+'%','shot quality',null,1)+
      statBox('At rim',pct(z.rim)+'%',z.rim[1]+' att · '+rimr+'% '+(sub(dz(z.rim,0.615))||''),'rim',2)+
      statBox('Mid-range',pct(z.mid)+'%',z.mid[1]+' att '+(sub(dz(z.mid,0.385))||''),'mid',3)+
      statBox('Three',pct(z.three)+'%',z.three[1]+' att · '+tpr+'% '+(sub(dz(z.three,0.34))||''),'three',4)+'</div>';
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
      ' ('+Math.round(pct*100)+'%)</b> \u2014 shot locations were logged for only some '+
      'games this season, so this chart is a partial picture.</div>';
  }

  function render(el, shots, opts){
    opts=opts||{}; if(!el) return;
    shots=(shots||[]).filter(function(s){return s.x!=null&&s.y!=null;});
    el.setAttribute('data-sc-host','1'); el.classList.add('sc-host'); el._shots=shots; el._opts=opts;
    // built-in game picker (opts.games = async fetcher of game rows by id): the host keeps the
    // whole season, the chart draws one game when opts.gameId is set
    var gp=gamePicker(el, shots, opts);
    if(opts.gameId){ var gm=el._gmeta&&el._gmeta[String(opts.gameId)];
      shots=shots.filter(function(s){ return String(s.game_id)===String(opts.gameId); });
      opts=Object.assign({},opts,{subtitle:(opts.subtitle||'')+(gm?' \u00b7 '+gm.lbl:''), short:'This game', expected:null}); }
    useSeason(opts.season||(shots.length&&shots[0].season_year));
    if(!shots.length){
      var exp0=parseFloat(opts.expected);
      el.innerHTML='<div style="padding:34px 24px;text-align:center;color:var(--text3);font-size:13px;line-height:1.6;">'+
        '<b style="color:var(--text2)">No shot-location data for this season.</b><br>'+
        (isFinite(exp0)&&exp0>0?('No coordinates were logged for these games'+
          (opts.subtitle?' ('+opts.subtitle+' took about '+Math.round(exp0)+' shots)':'')+'; located shots go back to 2019-20.'):
          'No coordinates were logged for these games; located shots go back to 2019-20.')+
        '</div>'; return; }
    var mode=opts.mode||'zones';
    var tcol=opts.color||((getComputedStyle(el).getPropertyValue('--tc')||'').trim())||null;
    if(tcol&&/^var\(/.test(tcol)) tcol=null;
    var courtOpts={color:tcol};
    var toggle='<div class="sc-modes">'+
      '<button class="'+(mode==='zones'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'zones\')">Zones</button>'+
      '<button class="'+(mode==='spots'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'spots\')">Hot &amp; cold spots</button>'+
      '<button class="'+(mode==='hex'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'hex\')">Hexbin</button>'+
      '<button class="'+(mode==='heat'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'heat\')">Heat</button>'+
      '<button class="'+(mode==='shots'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'shots\')">All shots</button></div>';
    var head=(opts.title?'<div class="sc-title">'+opts.title+'</div>':'')+(opts.subtitle?zHead(shots,opts):'')+
      '<div class="sc-legend">'+toggle+gp+'<span style="margin-left:auto;color:var(--text3);">'+shots.length+' field-goal attempts</span></div>';
    var body, extra='';
    if(mode==='zones'){
      // the lines go ON TOP of the tiles (court() draws floor + lines; split them)
      var ink=inkRgb(tcol), cg=court(null,courtOpts), cut=cg.indexOf('<g class="sc-lines"'), zz=zones12Svg(shots,ink);
      body='<div class="sc-mk-legend"><span><i class="scz-sw" style="background:rgba('+ink.join(',')+',.18)"></i><i class="scz-sw" style="background:rgba('+ink.join(',')+',.5)"></i><i class="scz-sw" style="background:rgba('+ink.join(',')+',.92)"></i>deeper shade = more of the shots</span>'+
        '<span style="margin-left:auto;color:var(--text3);font-size:10px;">made\u2013attempts \u00b7 FG% \u00b7 hover a zone for D-I</span></div>'+
        '<div class="sc-court-wrap scz-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+cg.slice(0,cut)+zz.tiles+cg.slice(cut)+zz.labels+'</svg><div class="sc-tip"></div></div>';
      extra=dietBlock(shots,opts)+splitTables(shots)+distBlock(shots,opts)+(opts.names?playerZoneTable(shots,opts.names):'');
    } else if(mode==='spots'){
      var so={};
      var sg=spotsSvg(shots,so);
      var V=voice(opts);
      body=spotsRead(so,opts)+
        '<div class="sc-mk-legend"><span><i class="sc-sig"></i>Hot: makes more than the D-I average here</span><span><i class="sc-softsw"></i>Cold: makes fewer</span>'+
        '<span style="margin-left:auto;color:var(--text3);font-size:10px;">label = '+V.poss+' FG% there and the gap to D-I</span></div>'+
        '<div class="sc-court-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+defs()+court(null,courtOpts)+sg+'</svg><div class="sc-tip"></div></div>';
      extra=spotsLedger(so,opts);
    } else if(mode==='hex'){
      var hk=function(c){ return '<b style="background:'+c+'"></b>'; };
      var hc=court(null,courtOpts), hcut=hc.indexOf('<g class="sc-lines"');     // court lines over the hexes
      body='<div class="sc-court-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+defs()+hc.slice(0,hcut)+hexbinSvg(shots)+hc.slice(hcut)+'</svg><div class="sc-tip"></div></div>'+
        '<div class="sc-heat-legend"><span>FG% vs D-I from that spot</span><span style="color:var(--text3)">colder</span><i class="sc-bands">'+HEX_NEG.map(hk).join('')+hk(HEX_MID)+HEX_POS.map(hk).join('')+'</i><span style="color:var(--text3)">hotter</span></div>'+
        '<div class="sc-eff-cap" style="text-align:center;margin-top:5px;">Bigger hexes = more shots from there \u00b7 grey = within 2 points of the D-I average \u00b7 hover a hex for the numbers</div>';
    } else if(mode==='heat'){
      body='<div class="sc-court-wrap sc-heat-wrap"><canvas class="sc-heat"></canvas>'+
        '<svg class="sc-svg sc-heat-court" viewBox="0 0 '+W+' '+H+'">'+court(null,courtOpts).replace(/var\(--sc-floor\)|var\(--sc-inside\)/g,'none').replace(/url\(#scVig\)/g,'none')+'</svg></div>'+
        '<div class="sc-heat-legend"><span>Where '+voice(opts).subj+' '+voice(opts).shoots+' from</span><span style="color:var(--text3)">fewer shots</span><i class="sc-bands">'+HEAT_BANDS.map(function(c){return '<b style="background:'+c+'"></b>';}).join('')+'</i><span style="color:var(--text3)">more shots</span></div>';
    } else {
      var dots=shots.map(function(s,i){
        var cx=px(clampx(fxf(s.x))), cy=py(clampy(fyf(s.y)));
        var zc={rim:'sc-zr',mid:'sc-zm',three:'sc-zt'}[zoneOf(s)];
        var tip=(s.made?'Made':'Missed')+' '+(s.sv===3?'3PT':'2PT')+' · '+Math.round(edist(s))+' ft';
        var dl='style="animation-delay:'+Math.min(i*2,750)+'ms"';
        return s.made
          ? '<circle class="sc-mark sc-dot '+zc+'" data-t="'+tip+'" '+dl+' cx="'+cx+'" cy="'+cy+'" r="3.4" fill="rgb(var(--sc-ink-rgb))" fill-opacity="0.92" stroke="var(--sc-floor)" stroke-width=".8"/>'
          : '<circle class="sc-mark sc-dot '+zc+'" data-t="'+tip+'" '+dl+' cx="'+cx+'" cy="'+cy+'" r="3" fill="var(--sc-floor)" fill-opacity=".55" stroke="rgb(var(--sc-ink-rgb))" stroke-opacity=".75" stroke-width="1.4"/>';
      }).join('');
      body='<div class="sc-mk-legend"><span><i class="sc-made"></i>Made</span><span><i class="sc-miss"></i>Missed</span>'+
        '<span style="margin-left:auto;color:var(--text3);font-size:10px;">filled = made · hollow = missed · hover a shot</span></div>'+
        '<div class="sc-court-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+defs()+court(null,courtOpts)+dots+'</svg><div class="sc-tip"></div></div>';
    }
    el.innerHTML=head+coverageNote(shots,opts)+'<div class="sc-main"><div class="sc-court-col">'+body+'</div></div>'+(opts.compact?'':(mode==='zones'?'':zoneStrip(shots))+extra);
    el.classList.remove('sc-settled');
    if(mode==='heat') drawHeat(el, shots);
    wire(el); if(mode==='zones') wireDist(el,shots,opts);
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
        var t=e.target.closest?e.target.closest('[data-tip],[data-t],[data-ztip]'):null;
        if(!t){ tip.classList.remove('on'); return; }
        var r=wrap.getBoundingClientRect();
        if(t.hasAttribute('data-ztip')){
          var zf=t.getAttribute('data-ztip').split('|');
          tip.innerHTML='<b>'+zf[0].charAt(0).toUpperCase()+zf[0].slice(1)+' · '+zf[1]+'%</b><span class="scq">'+zf[2]+' FG</span><span class="scr">D-I here: '+zf[3]+'%</span><span class="scd" style="color:'+(zf[4].charAt(0)==='-'?'var(--sc-cold)':'var(--sc-hot)')+'">'+zf[4]+' vs D-I avg</span>';
          tip.classList.add('rich');
        } else if(t.hasAttribute('data-tip')){
          var f=t.getAttribute('data-tip').split('|');
          tip.innerHTML='<b>FG% here: '+f[0]+'%</b>'+
            '<span class="scq">'+f[1]+' · '+f[2]+' FG</span>'+
            '<span class="scr">D-I here: '+f[3]+'%</span>'+
            '<span class="scd" style="color:'+(f[5]==='1'?'var(--sc-hot)':'var(--sc-cold)')+'">'+f[4]+'% vs D-I avg</span>';
          tip.classList.add('rich');
        } else {
          tip.textContent=t.getAttribute('data-t'); tip.classList.remove('rich');
        }
        tip.style.left=(e.clientX-r.left)+'px';
        tip.style.top=(e.clientY-r.top-14)+'px';
        tip.classList.add('on');
      });
      wrap.addEventListener('mouseleave',function(){ tip.classList.remove('on'); });
    }
    el.querySelectorAll('.sc-zone[data-zk]').forEach(function(zn){
      var k=zn.getAttribute('data-zk');
      zn.addEventListener('mouseenter',function(){ var row=el.querySelector('tr[data-zk="'+k+'"]'); if(row) row.classList.add('sc-rowhl'); zn.classList.add('sc-zone-hl'); });
      zn.addEventListener('mouseleave',function(){ var row=el.querySelector('tr[data-zk="'+k+'"]'); if(row) row.classList.remove('sc-rowhl'); zn.classList.remove('sc-zone-hl'); });
    });
    el.querySelectorAll('tr[data-zk]').forEach(function(row){
      var k=row.getAttribute('data-zk');
      row.addEventListener('mouseenter',function(){ var zn=el.querySelector('.sc-zone[data-zk="'+k+'"]'); if(zn) zn.classList.add('sc-zone-hl'); });
      row.addEventListener('mouseleave',function(){ var zn=el.querySelector('.sc-zone[data-zk="'+k+'"]'); if(zn) zn.classList.remove('sc-zone-hl'); });
    });
    el.querySelectorAll('.sc-z[data-zone]').forEach(function(card){
      var z=card.getAttribute('data-zone');
      card.addEventListener('mouseenter',function(){ el.classList.add('sc-hl','sc-hl-'+z); });
      card.addEventListener('mouseleave',function(){ el.classList.remove('sc-hl','sc-hl-'+z); });
    });
  }
  function gamePicker(el, all, opts){
    if(!opts.games) return '';
    var ids={}; all.forEach(function(s){ if(s.game_id!=null){ var k=String(s.game_id); (ids[k]=ids[k]||{m:0,a:0,t:{}}); ids[k].a++; if(s.made) ids[k].m++; ids[k].t[s.team_id]=(ids[k].t[s.team_id]||0)+1; } });
    var keys=Object.keys(ids); if(keys.length<2) return '';
    if(!el._gmeta&&!el._gload){ el._gload=true;
      Promise.resolve(opts.games(keys)).then(function(rows){ var M={}, short=function(n){ try{ return (window.tdcShortSchool&&tdcShortSchool(n))||String(n||'').replace(/ \S+$/,''); }catch(e){ return n; } };
        (rows||[]).forEach(function(g){ var b=ids[String(g.id)]; if(!b) return;
          var tid=Object.keys(b.t).sort(function(x,y){ return b.t[y]-b.t[x]; })[0], home=String(g.home_id)===String(tid);
          var us=home?g.home_score:g.away_score, them=home?g.away_score:g.home_score, d=g.date||'';
          var dt=d?new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
          M[String(g.id)]={d:d,lbl:dt+' '+(home||g.neutral?'vs ':'@ ')+short(home?g.away:g.home)+(us!=null&&them!=null?' ('+(us>them?'W':'L')+' '+us+'\u2013'+them+')':'')}; });
        el._gmeta=M; el._gload=false; if(el._shots===all) render(el, all, el._opts); }).catch(function(){ el._gload=false; });
      return ''; }
    var M=el._gmeta||{};
    var list=keys.map(function(k){ return {k:k,d:(M[k]&&M[k].d)||'',lbl:(M[k]&&M[k].lbl)||('Game '+k),m:ids[k].m,a:ids[k].a}; }).sort(function(a,b){ return a.d.localeCompare(b.d); });
    return '<select class="sc-gsel" aria-label="Pick a game" onchange="TDC_SHOTCHART._g(this)"><option value="">All games ('+list.length+')</option>'+
      list.map(function(g){ return '<option value="'+g.k+'"'+(String(opts.gameId)===g.k?' selected':'')+'>'+g.lbl+' \u00b7 '+g.m+'/'+g.a+'</option>'; }).join('')+'</select>';
  }
  function _g(sel){ var host=sel.closest('[data-sc-host]'); if(host&&host._shots) render(host, host._shots, Object.assign({},host._opts,{gameId:sel.value||null})); }
  function _m(btn, mode){ var host=btn.closest('[data-sc-host]'); if(host&&host._shots) render(host, host._shots, Object.assign({},host._opts,{mode:mode})); }

  if(!document.getElementById('sc-styles')){
    var st=document.createElement('style'); st.id='sc-styles';
    st.textContent=
      // theme-aware court palette: dark = navy hardwood-ish floor with white lines; light = pale maple
      ':root{--sc-floor:#fbfbf9;--sc-inside:#fbfbf9;--sc-line:#1f1f22;--sc-board:#3a3a3a;--sc-accent:#A8843C;--sc-made:#1f9d57;--sc-miss:#c74d3f;--sc-hot:#e06a1e;--sc-cold:#2f66c9;}'+
      ':root[data-theme="dark"]{--sc-floor:#101624;--sc-inside:#101624;--sc-line:rgba(232,236,244,.7);--sc-board:#e8e8f0;--sc-accent:#E6D5A8;--sc-made:#5ee89a;--sc-miss:#ff6b5c;--sc-hot:#f5934a;--sc-cold:#6b9cf0;}'+
      '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--sc-floor:#101624;--sc-inside:#101624;--sc-line:rgba(232,236,244,.7);--sc-board:#e8e8f0;--sc-accent:#E6D5A8;--sc-made:#5ee89a;--sc-miss:#ff6b5c;--sc-hot:#f5934a;--sc-cold:#6b9cf0;}}'+
      '.sc-zone{cursor:pointer;transition:filter .15s,stroke-opacity .15s;}'+
      '.sc-zone.sc-zone-hl{filter:brightness(1.25);stroke:var(--sc-accent);stroke-opacity:1;stroke-width:2;}'+
      '.sc-zlab{font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:900;fill:#fff;paint-order:stroke;stroke:rgba(0,0,0,.55);stroke-width:3px;pointer-events:none;}'+
      '.sc-zlab.dim{fill:rgba(255,255,255,.55);}'+
      '.sc-zsub{font-family:Inter,system-ui,sans-serif;font-size:9.5px;font-weight:700;fill:rgba(255,255,255,.85);paint-order:stroke;stroke:rgba(0,0,0,.5);stroke-width:2.4px;pointer-events:none;}'+
      ':root:not([data-theme="dark"]) .sc-zlab{fill:#1a1814;stroke:rgba(255,255,255,.75);} :root:not([data-theme="dark"]) .sc-zsub{fill:#3a342a;stroke:rgba(255,255,255,.7);}'+
      '.sc-sheet{margin-top:10px;max-height:none;} .sc-sheet .sheet{width:100%;} .sc-sheet tr.sc-rowhl td{background:color-mix(in srgb,var(--sc-accent) 18%,transparent)!important;}'+
      '.sc-sheet td.nm{font-weight:800;color:var(--text);} .sc-sheet td.dim{color:var(--text3);} .sc-sheet td.strong{font-weight:800;color:var(--text);}'+
      '@keyframes scPop{from{opacity:0;transform:scale(0);}to{opacity:1;transform:scale(1);}}'+
      '@keyframes scUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}'+
      '@keyframes scFade{from{opacity:0;transform:scale(.97);}to{opacity:1;transform:scale(1);}}'+
      '@keyframes scDraw{from{stroke-dashoffset:1;}to{stroke-dashoffset:0;}}'+
      '.sc-title{font-size:13px;font-weight:700;color:var(--text2);margin-bottom:8px;animation:scUp .4s ease backwards;}'+
      '.sc-legend{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:10px;animation:scUp .4s ease backwards;}'+
      '.sc-modes{display:inline-flex;max-width:100%;overflow-x:auto;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:3px;gap:3px;}'+
      '.sc-modes button{white-space:nowrap;font-size:11.5px;font-weight:700;padding:5px 13px;border:none;border-radius:5px;background:none;color:var(--text3);cursor:pointer;transition:color .15s,background .15s;}'+
      '.sc-modes button:hover{color:var(--text);}'+
      '.sc-gsel{font:600 12px Inter,system-ui,sans-serif;max-width:250px;padding:5px 8px;border:1px solid var(--border2);border-radius:7px;background:var(--bg2);color:var(--text);}'+
      '.sc-modes button.on{background:var(--accent);color:#fff;}'+
      '.sc-mk-legend{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px;}'+
      '.sc-mk-legend span{display:inline-flex;align-items:center;gap:6px;}'+
      '.sc-made{width:11px;height:11px;border-radius:50%;background:rgb(var(--sc-ink-rgb));display:inline-block;}'+
      '.sc-cov{font-size:11.5px;color:var(--text2);background:var(--bg2);border:1px solid var(--border2);'+
        'border-left:2px solid #E0A030;border-radius:0 8px 8px 0;padding:8px 12px;margin-bottom:10px;}'+
      '.sc-cov b{color:var(--text);}'+
      ':root{--sc-ink-rgb:26,42,76;--sc-soft:rgba(120,130,150,.9);} :root[data-theme="dark"]{--sc-ink-rgb:170,192,236;--sc-soft:rgba(190,200,220,.7);} @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--sc-ink-rgb:170,192,236;--sc-soft:rgba(190,200,220,.7);}}'+
      '.sc-sig{width:14px;height:10px;border-radius:2px;background:var(--sc-hot);opacity:.75;display:inline-block;}'+
      '.sc-softsw{width:14px;height:10px;border-radius:2px;border:1.5px dashed var(--sc-cold);background:color-mix(in srgb,var(--sc-cold) 30%,transparent);display:inline-block;box-sizing:border-box;}'+
      '.sc-explain{font-size:13px;line-height:1.55;color:var(--text2);background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:10px 13px;margin:0 0 10px;} .sc-explain b{color:var(--text);}'+
      '.sc-explain .hot,.sc-read .hot{color:var(--sc-hot);font-weight:800;} .sc-explain .cold,.sc-read .cold{color:var(--sc-cold);font-weight:800;}'+
      '.sc-sptag{font:900 10.5px Inter,system-ui,sans-serif;letter-spacing:.14em;paint-order:stroke;stroke:var(--sc-floor);stroke-width:3px;pointer-events:none;} .sc-sptag.hot{fill:var(--sc-hot);} .sc-sptag.cold{fill:var(--sc-cold);}'+
      '.sc-spotz{pointer-events:none;} .sc-spotz.on{animation:scFade .5s ease backwards;}'+
      '.sc-ledger{margin-top:12px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:4px 16px 10px;}'+
      '.sc-lsec{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:2px solid var(--text);padding:12px 0 8px;}'+
      '.sc-lsec span:first-child{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--text);}'+
      '.sc-lcap{font-size:11px;color:var(--text3);}'+
      '.sc-srow{display:grid;grid-template-columns:minmax(120px,170px) 1fr 74px 54px;align-items:start;gap:12px;padding:8px 0 18px;border-bottom:1px solid var(--border);cursor:default;}'+
      '.sc-sl{font-size:12.5px;font-weight:600;color:var(--text);display:flex;flex-direction:column;gap:1px;}'+
      '.sc-ssub{font-size:10.5px;font-weight:500;color:var(--text3);font-variant-numeric:tabular-nums;}'+
      '.sc-strack{position:relative;height:8px;background:var(--bg3);border-radius:4px;}'+
      '.sc-strack i{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:rgb(var(--sc-ink-rgb));}'+
      '.sc-strack i.sig{background:var(--sc-hot);} .sc-strack i.soft{background:var(--sc-cold);opacity:.6;}'+
      '.sc-sv{font-size:13px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;color:var(--text);display:flex;flex-direction:column;gap:1px;} .sc-sv .sc-ssub{text-align:right;}'+
      '.sc-sd{font-size:13px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;display:flex;flex-direction:column;gap:1px;} .sc-sd .sc-ssub{text-align:right;} .sc-sd.pos{color:var(--green);} .sc-sd.neg{color:var(--red);}'+
      '.sc-lhead{display:grid;grid-template-columns:minmax(120px,170px) 1fr 74px 54px;gap:12px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);padding:8px 0 2px;} .sc-lhead span:nth-child(n+3){text-align:right;}'+
      '.sc-strack .sc-ssub{position:absolute;left:0;top:11px;white-space:nowrap;}'+
      '.sc-read{font-size:13.5px;line-height:1.5;color:var(--text);margin:0 0 10px;} .sc-read b{font-weight:700;} .sc-read .pos{color:var(--green);} .sc-read .neg{color:var(--red);}'+
      '.sc-zedge{font-size:11px;font-weight:800;}'+
      '.sc-lempty{font-size:12px;color:var(--text3);padding:10px 0;}'+
      '.sc-lfoot{font-size:11px;color:var(--text3);line-height:1.5;padding:10px 0 2px;}'+
      '.sc-hot{width:11px;height:11px;border-radius:50%;background:var(--sc-hot);display:inline-block;}'+
      '.sc-cold{width:11px;height:11px;border-radius:50%;background:var(--sc-cold);display:inline-block;}'+
      '.sc-spot-off{fill:#ffffff;opacity:.22;} :root:not([data-theme="dark"]) .sc-spot-off{fill:#2a2418;opacity:.18;}'+
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
      '.sc-miss{width:11px;height:11px;border-radius:50%;border:1.6px solid rgb(var(--sc-ink-rgb));box-sizing:border-box;display:inline-block;opacity:.8;}'+
      '.sc-main{display:flex;gap:12px;align-items:stretch;}'+
      '.sc-court-col{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;}'+
      '.sc-court-wrap{position:relative;min-width:0;max-width:760px;margin:0 auto;width:100%;background:var(--sc-floor);border:1px solid var(--border);border-radius:14px;padding:0;overflow:hidden;animation:scFade .5s ease backwards;}'+
      '.sc-court-wrap .sc-svg{border-radius:14px;}'+
      '.sc-svg{width:100%;height:auto;display:block;}'+
      '.sc-cl{stroke-dasharray:1;stroke-dashoffset:0;animation:scDraw 1s ease .1s backwards;}'+
      '.sc-mark{transform-box:fill-box;transform-origin:center;transition:transform .16s cubic-bezier(.34,1.56,.64,1),opacity .2s;animation:scPop .4s cubic-bezier(.34,1.56,.64,1) backwards;cursor:pointer;}'+
      '.sc-mark:hover{transform:scale(1.9);}'+
      '.sc-hex:hover{stroke:var(--accent);stroke-width:1.6;}'+
      '.sc-synth{opacity:.45;pointer-events:none;}'+
      '.sc-host.sc-hl .sc-mark{opacity:.07;}'+
      '.sc-host.sc-hl-rim .sc-zr,.sc-host.sc-hl-mid .sc-zm,.sc-host.sc-hl-three .sc-zt{opacity:1;}'+
      '.sc-tip{position:absolute;pointer-events:none;background:var(--text);color:var(--bg);font-size:11px;font-weight:700;padding:5px 9px;border-radius:7px;transform:translate(-50%,-100%);opacity:0;transition:opacity .12s;white-space:nowrap;z-index:20;box-shadow:0 6px 18px rgba(0,0,0,.3);}'+
      '.sc-tip.on{opacity:1;}'+
      // rich multi-line tooltip for hexes
      '.sc-tip.rich{white-space:normal;text-align:left;max-width:224px;display:flex;flex-direction:column;gap:2px;padding:9px 11px;line-height:1.35;background:var(--bg2);color:var(--text);border:1px solid var(--border2);border-radius:9px;box-shadow:0 12px 32px rgba(0,0,0,.45);}'+
      '.sc-tip.rich b{font-size:12px;font-weight:800;}'+
      '.sc-tip .scq{font-size:10px;color:var(--text3);font-weight:600;}'+
      '.sc-tip .scr{font-size:10.5px;color:var(--text2);font-weight:600;}'+
      '.sc-tip .scd{font-size:11.5px;font-weight:800;margin-top:1px;}'+
      // 2PT/3PT/All/eFG summary under the hexbin
      '.sc-hexsum{display:flex;flex-wrap:wrap;gap:5px 16px;justify-content:center;margin-top:11px;font-size:11.5px;color:var(--text2);font-weight:600;animation:scUp .5s ease .25s backwards;}'+
      '.sc-hexsum b{color:var(--text3);font-weight:800;font-size:9.5px;letter-spacing:.05em;margin-right:3px;}'+
      '.sc-hexsum .sc-hxefg{color:var(--text);}.sc-hexsum .sc-hxefg b{color:var(--accent);}'+
      '.sc-heat{width:100%;height:auto;display:block;border-radius:8px;animation:scFade .8s ease both;}'+
      '.sc-heat-wrap{max-width:760px;margin:0 auto;}'+
      '.sc-heat-court{position:absolute;left:0;top:0;width:100%;}'+
      '.sc-heat-legend{max-width:580px;margin:10px auto 0;display:flex;align-items:center;gap:10px;font-size:11px;font-weight:600;color:var(--text2);justify-content:center;animation:scUp .5s ease .3s backwards;}'+
      '.sc-bands{display:inline-flex;gap:0;border:1px solid var(--border);} .sc-bands b{width:22px;height:11px;display:block;}'+
      '.sc-grad{width:150px;height:10px;border-radius:5px;display:inline-block;border:1px solid var(--border);background:linear-gradient(90deg,rgba(255,222,89,.35),#ffb430,#fb7820,#e43a20,#a8121c);}'+
      '.sc-eff-legend{max-width:520px;margin:11px auto 0;display:flex;flex-direction:column;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--text2);animation:scUp .5s ease .3s backwards;}'+
      '.sc-effbar{display:flex;align-items:center;gap:9px;}'+
      '.sc-effgrad{width:190px;height:11px;border-radius:6px;display:inline-block;border:1px solid var(--border);background:linear-gradient(90deg,rgba(var(--sc-ink-rgb),.10),rgba(var(--sc-ink-rgb),.95));}'+
      '.sc-eff-cap{color:var(--text3);font-weight:600;font-size:10.5px;text-align:center;}'+
      '.sc-eff-cap b{color:var(--text2);font-weight:700;}'+
      '.sc-zones{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg);margin-top:12px;box-shadow:0 1px 3px rgba(0,0,0,.10);}'+
      '.sc-z{text-align:left;border-right:1px solid var(--border);padding:11px 14px;background:transparent;animation:scUp .45s ease backwards;transition:background .15s;min-width:0;}'+
      '.sc-z:last-child{border-right:none;}'+
      '@media(max-width:600px){.sc-zones{grid-template-columns:repeat(2,1fr);}.sc-z{border-bottom:1px solid var(--border);}}'+
      '.sc-z[data-zone]{cursor:pointer;}'+
      '.sc-z[data-zone]:hover{background:color-mix(in srgb,var(--accent) 10%,transparent);}'+
      '.sc-zv{font-family:Inter,system-ui,sans-serif;font-weight:800;font-size:21px;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--text);}'+
      '.sc-zl{font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);margin-top:5px;}'+
      '.sc-zs{font-size:10.5px;color:var(--text3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'+
      // by-distance panels
      ':root{--sd-pl:#d0392b;--sd-lg:#4fb8cc;--sd-ps:#6f6f75;--sd-l:#3f9b3a;--sd-r:#8a5cc7;--sd-lf:rgba(63,155,58,.16);--sd-rf:rgba(138,92,199,.16);}'+
      ':root[data-theme="dark"]{--sd-pl:#ff6a5a;--sd-lg:#5fd0e4;--sd-ps:#a9adb8;--sd-l:#6cc764;--sd-r:#b38ef0;--sd-lf:rgba(108,199,100,.2);--sd-rf:rgba(179,142,240,.2);}'+
      '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--sd-pl:#ff6a5a;--sd-lg:#5fd0e4;--sd-ps:#a9adb8;--sd-l:#6cc764;--sd-r:#b38ef0;--sd-lf:rgba(108,199,100,.2);--sd-rf:rgba(179,142,240,.2);}}'+
      '.sd-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px 28px;} @media(max-width:720px){.sd-grid{grid-template-columns:1fr;}}'+
      '.sd-t{font-size:13px;font-weight:800;color:var(--text);margin-bottom:4px;} .sd-svg{width:100%;height:auto;display:block;overflow:visible;}'+
      '.sd-axis{stroke:var(--text2);stroke-width:1.2;} .sd-tk{font:500 15px Inter,system-ui,sans-serif;fill:var(--text2);font-variant-numeric:tabular-nums;} .sd-lab{font:600 16px Inter,system-ui,sans-serif;fill:var(--text2);}'+
      '.sd-3{stroke:var(--text3);stroke-dasharray:6 5;stroke-width:1.2;} .sd-3t{font:500 11px Inter,system-ui,sans-serif;fill:var(--text3);}'+
      '.sd-pl{fill:none;stroke:var(--sd-pl);stroke-width:3.2;stroke-linejoin:round;} .sd-lg{fill:none;stroke:var(--sd-lg);stroke-width:2;} .sd-ps{fill:none;stroke:var(--sd-ps);stroke-width:2;}'+
      '.sd-leg{font:500 15px Inter,system-ui,sans-serif;fill:var(--text2);}'+
      '.sd-bl{fill:var(--sd-lf);stroke:var(--sd-l);stroke-width:0;} .sd-br{fill:var(--sd-rf);stroke:var(--sd-r);stroke-width:0;} .sd-bl.thin,.sd-br.thin{opacity:.45;} g .sd-bl,g .sd-br{stroke-width:1.5;}'+
      '.sd-dl{fill:none;stroke:var(--sd-l);stroke-width:2.6;} .sd-dr{fill:none;stroke:var(--sd-r);stroke-width:2.6;}'+
      '.sd-cross line{stroke:var(--text3);stroke-width:1.2;} .sd-cross circle{fill:var(--bg,#fff);stroke:var(--text2);stroke-width:2.4;}'+
      '.sd-read{font:500 16px Inter,system-ui,sans-serif;fill:var(--text2);paint-order:stroke;stroke:var(--bg,#fff);stroke-width:4px;pointer-events:none;} .sd-read .sd-tpl{fill:var(--sd-pl);} .sd-read .sd-tlg{fill:var(--sd-lg);} .sd-read .sd-tps{fill:var(--sd-ps);} .sd-read .sd-tl{fill:var(--sd-l);} .sd-read .sd-tr{fill:var(--sd-r);}'+
      '.sd-hit{fill:transparent;cursor:crosshair;}'+
      '.sd-ov{display:flex;align-items:center;gap:0;font-size:13px;color:var(--text2);margin:2px 0 -6px 0;} .sd-ov span{width:110px;font-weight:600;} .sd-ov i{font-style:normal;font-weight:700;padding:3px 8px;min-width:72px;font-variant-numeric:tabular-nums;} .sd-ov i.l{background:var(--sd-lf);color:var(--sd-l);border:1.5px solid var(--sd-l);} .sd-ov i.r{background:var(--sd-rf);color:var(--sd-r);border:1.5px solid var(--sd-r);border-left:0;}'+
      // editorial zone chart + diet bars + shift map
      ':root{--scz-s0:#ececec;--scz-s1:#c8c8c8;--scz-s2:#8e8e8e;--scz-s3:#474747;--scz-t0:#2a2a2a;--scz-t1:#2a2a2a;--scz-t2:#fff;--scz-t3:#fff;}'+
      ':root[data-theme="dark"]{--scz-s0:#262d3b;--scz-s1:#3a4354;--scz-s2:#6c778c;--scz-s3:#c9d0dc;--scz-t0:#e6e9ef;--scz-t1:#e6e9ef;--scz-t2:#fff;--scz-t3:#141a26;}'+
      '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--scz-s0:#262d3b;--scz-s1:#3a4354;--scz-s2:#6c778c;--scz-s3:#c9d0dc;--scz-t0:#e6e9ef;--scz-t1:#e6e9ef;--scz-t2:#fff;--scz-t3:#141a26;}}'+
      '.scz-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:2px solid var(--text);padding:0 0 7px;margin-bottom:10px;}'+
      '.scz-name{font-size:20px;font-weight:800;color:var(--text);letter-spacing:-.01em;}'+
      '.scz-tot{font-size:17px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap;} .scz-tot i{font-style:normal;font-size:10.5px;font-weight:800;letter-spacing:.08em;color:var(--text3);margin:0 6px 0 14px;}'+
      '.scz-wrap{max-width:640px;}'+
      '.scz-z{transition:filter .15s;} .scz-z:hover,.scz-z.sc-zone-hl{filter:brightness(.9) saturate(1.2);stroke:var(--sc-line);stroke-width:1.5;}'+
      '.scz-seam line{stroke:var(--sc-floor);stroke-width:2.2;}'+
      '.scz-lab{font-family:Inter,system-ui,sans-serif;font-size:17px;font-weight:800;fill:var(--text);font-variant-numeric:tabular-nums;pointer-events:none;} .scz-lab.sm{font-size:13px;} .scz-lab{paint-order:stroke;stroke:var(--sc-floor);stroke-width:0;} .scz-lab.on{fill:#fff;}'+
      '.scz-sub{font-family:Inter,system-ui,sans-serif;font-size:11px;font-weight:700;fill:var(--text2);pointer-events:none;} .scz-sub.on{fill:rgba(255,255,255,.85);}'+
      '.scz-sw{width:12px;height:10px;display:inline-block;border-radius:2px;margin-right:-4px;}'+
      '.scz-cap{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text);margin:16px 0 7px;}'+
      '.scz-diet{max-width:760px;margin:0 auto;}'+
      '.scz-drow{display:grid;grid-template-columns:118px 1fr;gap:10px;align-items:center;margin-bottom:6px;}'+
      '.scz-dl b{display:block;font-size:15px;font-weight:800;color:var(--text);line-height:1.1;} .scz-dl span{font-size:11px;color:var(--text3);font-variant-numeric:tabular-nums;}'+
      '.scz-drow.ref .scz-dl b{color:var(--text2);font-size:13px;}'+
      '.scz-dbar{display:flex;gap:3px;height:34px;min-width:0;}'+
      '.scz-seg{font-style:normal;display:flex;align-items:center;padding:0 9px;font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;overflow:hidden;white-space:nowrap;min-width:0;}'+
      '.scz-seg.s0{background:var(--scz-s0);color:var(--scz-t0);} .scz-seg.s1{background:var(--scz-s1);color:var(--scz-t1);} .scz-seg.s2{background:var(--scz-s2);color:var(--scz-t2);} .scz-seg.s3{background:var(--scz-s3);color:var(--scz-t3);}'+
      '.scz-drow.ref .scz-seg{font-size:13px;opacity:.85;height:auto;} .scz-drow.ref .scz-dbar{height:26px;}'+
      '.scz-dhead .scz-dbar{height:24px;} .scz-dhead .scz-seg{font-size:10px;letter-spacing:.08em;text-transform:uppercase;justify-content:center;} .scz-seg .ls{display:none;}'+
      '@media(max-width:600px){.scz-drow{grid-template-columns:78px 1fr;} .scz-seg{font-size:12px;padding:0 5px;} .scz-dhead .scz-seg{font-size:9px;letter-spacing:.04em;} .scz-seg .lf{display:none;} .scz-seg .ls{display:inline;} .scz-name{font-size:16px;} .scz-tot{font-size:14px;}}'+
      '.scz-split{display:grid;grid-template-columns:1fr 1fr;gap:16px;} @media(max-width:600px){.scz-split{grid-template-columns:1fr;gap:0;}}'+
      '.scz-split .sc-sheet{margin-top:0;} .sc-sheet tr.scz-total td{border-top:1.5px solid var(--text3);font-weight:800;}'+
      '.scz-lede{font-size:16px;line-height:1.45;color:var(--text2);margin:0 0 10px;} .scz-lede b{color:var(--text);font-weight:800;}'+
      '.scz-shleg{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--text2);margin-bottom:10px;flex-wrap:wrap;}'+
      '.scz-shleg i{width:110px;height:10px;display:inline-block;} .scz-shleg i.neg{background:linear-gradient(90deg,#3a4767,#9aa4ba,#e3e6ed);} .scz-shleg i.pos{background:linear-gradient(90deg,#fde4d4,#f8a577,#ef6a1f);margin-left:-8px;}'+
      '.scz-shwrap{max-width:640px;} .scz-foot{font-size:11.5px;line-height:1.5;color:var(--text3);margin-top:10px;} .scz-foot b{color:var(--text2);}'+
      '.sc-settled .sc-lead,.sc-settled .sc-ring,.sc-settled .sc-callout,.sc-settled .sc-calsub,.sc-settled .sc-spot-cap,'+
      '.sc-settled .sc-mark,.sc-settled .sc-cl,.sc-settled .sc-z,.sc-settled .sc-court-wrap,.sc-settled .sc-title,.sc-settled .sc-legend,.sc-settled .sc-heat,.sc-settled .sc-heat-legend,.sc-settled .sc-eff-legend{animation:none!important;}';
    document.head.appendChild(st);
  }
  window.TDC_SHOTCHART={render:render,_g:_g,playerZoneTable:playerZoneTable,renderShift:renderShift,_m:_m,zone10:zone10,zone12:zone12,avgOf:avgOf,useSeason:useSeason};
})();
