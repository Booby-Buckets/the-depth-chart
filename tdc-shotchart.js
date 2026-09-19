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
    g+='<rect x="0" y="0" width="'+W+'" height="'+H+'" fill="url(#scVig)" opacity=".55"/>';
    // lane (paint) tinted with the team colour; the arc interior a hair lighter than the floor
    g+='<path d="'+arcPath()+' Z" fill="var(--sc-inside)"/>';
    g+='<rect x="'+px(19)+'" y="'+py(19)+'" width="'+px(12)+'" height="'+(py(0)-py(19))+'" fill="'+tc+'" opacity=".16"/>';
    g+='<rect '+CL+' x="1.5" y="1.5" width="'+(W-3)+'" height="'+(H-3)+'" fill="none" stroke="'+L+'" stroke-width="2.5"/>';
    g+='<rect '+CL+' x="'+px(19)+'" y="'+py(19)+'" width="'+px(12)+'" height="'+(py(0)-py(19))+'" fill="none" stroke="'+L+'" stroke-width="2"/>';
    g+='<circle '+CL+' cx="'+px(25)+'" cy="'+py(19)+'" r="'+px(6)+'" fill="none" stroke="'+L+'" stroke-width="2"/>';
    g+='<path '+CL+' d="M '+(hx-px(4))+' '+hy+' A '+px(4)+' '+px(4)+' 0 0 1 '+(hx+px(4))+' '+hy+'" fill="none" stroke="'+L+'" stroke-width="1.6"/>';
    g+='<path '+CL+' d="'+arcPath()+'" fill="none" stroke="'+L+'" stroke-width="2.4"/>';
    // backboard + rim
    g+='<line x1="'+(px(25)-px(3))+'" y1="'+py(4)+'" x2="'+(px(25)+px(3))+'" y2="'+py(4)+'" stroke="var(--sc-board)" stroke-width="3.5" stroke-linecap="round"/>';
    g+='<circle cx="'+hx+'" cy="'+hy+'" r="'+px(0.75)+'" fill="none" stroke="#f08a3c" stroke-width="2.6"/>';
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
      return '<tr data-zk="'+r.k+'"><td class="l nm">'+r.n.charAt(0).toUpperCase()+r.n.slice(1)+'</td><td>'+r.a+'</td><td class="dim">'+Math.round(r.a/tot*100)+'%</td><td class="strong">'+Math.round(r.p*100)+'%</td><td class="dim">'+Math.round(r.avg*100)+'%</td><td style="font-weight:800;color:'+(d>=2?'var(--green)':d<=-2?'var(--red)':'var(--text3)')+'">'+(d>0?'+':'')+Math.round(d)+'</td><td class="dim">'+(r.a>=8?Math.round(eff*100)+'%':'—')+'</td></tr>'; }).join('');
    return '<div class="sheet-wrap sc-sheet"><table class="sheet"><thead><tr><th class="l">Zone</th><th>FGA</th><th>Share</th><th>FG%</th><th>D-I'+(REF_YEAR?' \u2019'+String(REF_YEAR).slice(2):'')+'</th><th>Δ</th><th>eFG%</th></tr></thead><tbody>'+tr+'</tbody></table></div>';
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
    var lo=[76,127,214], mid=[150,150,160], hi=[240,138,60];
    function lerp(a,b,f){return [a[0]+(b[0]-a[0])*f|0,a[1]+(b[1]-a[1])*f|0,a[2]+(b[2]-a[2])*f|0];}
    var c = t<0 ? lerp(mid,lo,-t) : lerp(mid,hi,t);
    return 'rgb('+c[0]+','+c[1]+','+c[2]+')';
  }
  // ── hex grid (pointy-top) ── smaller cells than before for a denser, smoother map
  var HS=1.15;                                           // hex size in feet
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

  function hexbinSvg(shots){
    var bins={};
    shots.forEach(function(s){
      var k=axial(clampx(fxf(s.x)), clampy(fyf(s.y)));
      var b=bins[k]||(bins[k]={att:0,mk:0,three:0});
      b.att++; if(s.made)b.mk++; if(s.sv===3)b.three++;
    });
    var maxAtt=0; for(var k in bins) if(bins[k].att>maxAtt) maxAtt=bins[k].att;
    // FILL INTERIOR GAPS: any empty cell that sits inside the shot cloud (>=3 of its
    // six neighbors have shots) gets a synthetic cell so the surface reads as one
    // continuous field instead of a scatter of tallies. Synthetic cells are colored
    // from their neighbors, drawn faintly underneath, and carry no tooltip.
    var real={}; for(var rk in bins) real[rk]=1;
    var synth={};
    for(var bk in real){
      var pa=bk.split(','), pq=+pa[0], pr=+pa[1];
      HXN.forEach(function(d){
        var nk=(pq+d[0])+','+(pr+d[1]); if(real[nk]||synth[nk]) return;
        var na=nk.split(','), nq=+na[0], nr=+na[1], cnt=0;
        HXN.forEach(function(d2){ if(real[(nq+d2[0])+','+(nr+d2[1])]) cnt++; });
        if(cnt>=3) synth[nk]=1;
      });
    }
    for(var sk in synth) if(!bins[sk]) bins[sk]={att:0,mk:0,three:0,synth:true};

    var keys=Object.keys(bins);
    // draw low-volume (incl. synthetic) first, biggest last, so the paint blob and
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
      if(b.synth){
        // interior gap-fill: SMALL + faint (they carry zero volume, so in a volume-sized
        // map they must read as the smallest cells) — a subtle continuity hint, not a
        // full-size tile that would flatten the size signal.
        g+='<path class="sc-mark sc-hex sc-synth '+zc+'" style="animation-delay:'+Math.min(idx*7,700)+'ms" d="'+hexPath(cx,cy,px(HS)*0.50)+'" fill="'+effColor(diff)+'" stroke="rgba(10,8,20,.18)" stroke-width="0.4"/>';
        idx++; return;
      }
      // SIZE = SHOT VOLUME (the whole point of the hexbin): radius spans a WIDE range so
      // high-volume zones read as big cells and thin zones as small ones. sqrt keeps it
      // perceptually fair (area ∝ attempts). Was 0.90–1.16 (a ~29% span — every hex looked
      // identical, so the size legend was a lie); now 0.48–1.18 (radius >2× → area >5×).
      var rp=Math.min(px(HS)*1.18, px(HS)*(0.48+0.82*Math.sqrt(b.att/maxAtt)));
      // tooltip carries the RAW numbers (pipe-delimited; wire() builds the card)
      var rawFg=b.mk/b.att, rawDiff=rawFg-base;
      var tip=(rawFg*100).toFixed(1)+'|'+distLabel(dh,isThree)+'|'+b.mk+'/'+b.att+'|'+(base*100).toFixed(1)+'|'+(rawDiff>=0?'+':'')+(rawDiff*100).toFixed(1)+'|'+(rawDiff>=0?'1':'0');
      g+='<path class="sc-mark sc-hex '+zc+'" data-tip="'+tip+'" style="animation-delay:'+Math.min(idx*7,700)+'ms" d="'+hexPath(cx,cy,rp)+'" fill="'+effColor(diff)+'" stroke="rgba(10,8,20,.28)" stroke-width="0.5"/>';
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
  function spotsSvg(shots, out){
    spotsPick(shots, out);
    var lit={}; out.sig.forEach(function(r,i){ lit[r.k]={kind:'sig',rank:i}; }); out.soft.forEach(function(r){ lit[r.k]={kind:'soft'}; });
    var id='sp'+(++_zid), g='<defs>';
    g+='<clipPath id="'+id+'in"><path d="'+arcPath()+' Z"/></clipPath>';
    g+='<clipPath id="'+id+'out"><path fill-rule="evenodd" clip-rule="evenodd" d="M 0 0 H '+W+' V '+H+' H 0 Z '+arcPath()+' Z"/></clipPath>';
    g+='<pattern id="'+id+'hatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="var(--sc-soft)" stroke-width="1.6"/></pattern>';
    g+='</defs>';
    var fillFor=function(k){ var L=lit[k]; if(!L) return 'none';
      if(L.kind==='soft') return 'url(#'+id+'hatch)';
      return 'rgba(var(--sc-ink-rgb),'+(L.rank===0?0.62:L.rank===1?0.46:0.34)+')'; };
    var strokeFor=function(k){ var L=lit[k]; return L?(L.kind==='soft'?'var(--sc-soft)':'rgb(var(--sc-ink-rgb))'):'none'; };
    regionDefs().forEach(function(r){ var b=r[2]; var L=lit[r[0]];
      g+='<rect class="sc-spotz'+(L?' on':'')+'" data-zk="'+r[0]+'" clip-path="url(#'+id+r[1]+')" x="'+b[0]+'" y="'+b[1]+'" width="'+b[2]+'" height="'+b[3]+'" fill="'+fillFor(r[0])+'" stroke="'+strokeFor(r[0])+'" stroke-width="2"'+(L&&L.kind==='soft'?' stroke-dasharray="5 4"':'')+'/>'; });
    var Lr=lit.rim;
    g+='<circle class="sc-spotz'+(Lr?' on':'')+'" data-zk="rim" cx="'+px(HOOP_X)+'" cy="'+py(HOOP_Y)+'" r="'+px(4)+'" fill="'+fillFor('rim')+'" stroke="'+strokeFor('rim')+'" stroke-width="2"'+(Lr&&Lr.kind==='soft'?' stroke-dasharray="5 4"':'')+'/>';
    // faint shot dots for context (the lit zones read through them)
    shots.forEach(function(s){ var cx=px(clampx(fxf(s.x))), cy=py(clampy(fyf(s.y)));
      g+='<circle class="sc-spot-off" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="2.4"/>'; });
    // labels on the lit zones only: FG% · share, and the edge
    out.sig.concat(out.soft).forEach(function(r){ var at=SPOT_LAB[r.k]; if(!at) return;
      var x=px(at[0]), y=py(at[1]), d=Math.round(r.d*100);
      var anc=r.k==='c3l'?'start':r.k==='c3r'?'end':'middle'; if(anc==='start') x=px(1.6); if(anc==='end') x=px(48.4);
      g+='<text class="sc-zlab" x="'+x+'" y="'+(y+4)+'" text-anchor="'+anc+'">'+Math.round(r.p*100)+'%<tspan class="sc-zedge"> '+(d>=0?'+':'\u2212')+Math.abs(d)+'</tspan></text>'; });
    return g;
  }
  // the ledger under the court: signature spots, soft spots — percentile-row language
  function spotsLedger(out){
    if(!out.rows) return '';
    var maxShare=Math.max.apply(null,out.rows.map(function(r){return r.share;}).concat([0.01]));
    var cap=function(t){ return t.charAt(0).toUpperCase()+t.slice(1); };
    var row=function(r,kind){ var d=Math.round(r.d*100), w=100*r.share/maxShare;
      return '<div class="sc-srow" data-zk="'+r.k+'"><div class="sc-sl">'+cap(r.n)+'</div>'+
        '<div class="sc-strack"><i class="'+kind+'" style="width:'+w.toFixed(1)+'%"></i><span class="sc-ssub">'+Math.round(r.share*100)+'% of his shots</span></div>'+
        '<div class="sc-sv">'+Math.round(r.p*100)+'%<span class="sc-ssub">D-I avg '+Math.round(r.avg*100)+'%</span></div>'+
        '<div class="sc-sd '+(d>=0?'pos':'neg')+'">'+(d>=0?'+':'\u2212')+Math.abs(d)+'<span class="sc-ssub">'+(d>=0?'better':'worse')+'</span></div></div>'; };
    var h='<div class="sc-ledger">';
    h+='<div class="sc-lsec"><span>His spots</span><span class="sc-lcap">shoots from here a lot AND makes more than the D-I average from there</span></div>';
    h+='<div class="sc-lhead"><span>Zone</span><span>How often he shoots from here</span><span>FG%</span><span>vs D-I</span></div>';
    h+=out.sig.length?out.sig.map(function(r){return row(r,'sig');}).join(''):'<div class="sc-lempty">No zone qualifies yet \u2014 needs '+out.floor+'+ attempts from one spot and a make rate above the D-I average there.</div>';
    if(out.soft.length){ h+='<div class="sc-lsec" style="margin-top:6px;"><span>Trouble spots</span><span class="sc-lcap">shoots from here a lot, but makes less than the D-I average from there</span></div>'+out.soft.map(function(r){return row(r,'soft');}).join(''); }
    h+='<div class="sc-lfoot">A zone only counts once he has taken '+out.floor+'+ shots from it. "vs D-I" is his make rate minus what the average Division-I player makes from that same zone.</div></div>';
    return h;
  }
  function spotsRead(out){
    var s=out.sig||[], w=out.soft||[];
    if(!s.length&&!w.length) return '';
    var ph=function(r){ return r.n+' <b>'+Math.round(r.p*100)+'%</b> (<b class="'+(r.d>=0?'pos':'neg')+'">'+(r.d>=0?'+':'\u2212')+Math.abs(Math.round(r.d*100))+'</b> vs D-I)'; };
    var t='';
    if(s.length) t+='Best from '+s.map(ph).join(s.length>2?', ':' and ')+'.';
    if(w.length) t+=(t?' ':'')+'Struggles from '+w.map(ph).join(' and ')+'.';
    return '<div class="sc-read">'+t+'</div>';
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
      '<button class="'+(mode==='spots'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'spots\')">His spots</button>'+
      '<button class="'+(mode==='hex'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'hex\')">Hexbin</button>'+
      '<button class="'+(mode==='heat'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'heat\')">Heat</button>'+
      '<button class="'+(mode==='shots'?'on':'')+'" onclick="TDC_SHOTCHART._m(this,\'shots\')">All shots</button></div>';
    var head=(opts.title?'<div class="sc-title">'+opts.title+'</div>':'')+
      '<div class="sc-legend">'+toggle+'<span style="margin-left:auto;color:var(--text3);">'+shots.length+' field-goal attempts</span></div>';
    var body, extra='';
    if(mode==='zones'){
      body='<div class="sc-mk-legend"><span><i class="sc-hot"></i>Above the D-I average</span><span><i class="sc-cold"></i>Below</span>'+
        '<span style="margin-left:auto;color:var(--text3);font-size:10px;">FG% · made/attempts \u00b7 hover a zone</span></div>'+
        '<div class="sc-court-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+defs()+court(null,courtOpts)+zonesSvg(shots)+'</svg><div class="sc-tip"></div></div>';
      extra=zoneSheet(shots);
    } else if(mode==='spots'){
      var so={};
      var sg=spotsSvg(shots,so);
      body=spotsRead(so)+
        '<div class="sc-mk-legend"><span><i class="sc-sig"></i>Makes more than the D-I average here</span><span><i class="sc-softsw"></i>Makes less</span>'+
        '<span style="margin-left:auto;color:var(--text3);font-size:10px;">label = his FG% and the gap vs D-I</span></div>'+
        '<div class="sc-court-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+defs()+court(null,courtOpts)+sg+'</svg><div class="sc-tip"></div></div>';
      extra=spotsLedger(so);
    } else if(mode==='hex'){
      body='<div class="sc-court-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+defs()+court(null,courtOpts)+hexbinSvg(shots)+'</svg><div class="sc-tip"></div></div>'+
        hexSummary(shots)+
        '<div class="sc-eff-legend">'+
          '<div class="sc-effbar"><span>Weak · −10%</span><i class="sc-effgrad"></i><span>+10% · Strong</span></div>'+
          '<span class="sc-eff-cap">Hex size = shot volume · color = FG% vs Division-1 average · <b>grey = league average</b></span>'+
        '</div>';
    } else if(mode==='heat'){
      body='<div class="sc-court-wrap sc-heat-wrap"><canvas class="sc-heat"></canvas>'+
        '<svg class="sc-svg sc-heat-court" viewBox="0 0 '+W+' '+H+'">'+court(null,{color:'#ffffff'}).replace(/var\(--sc-floor\)|var\(--sc-inside\)/g,'none')+'</svg></div>'+
        '<div class="sc-heat-legend"><span>Shot frequency</span><i class="sc-grad"></i><span style="color:var(--text3)">low → high</span></div>';
    } else {
      var dots=shots.map(function(s,i){
        var cx=px(clampx(fxf(s.x))), cy=py(clampy(fyf(s.y)));
        var zc={rim:'sc-zr',mid:'sc-zm',three:'sc-zt'}[zoneOf(s)];
        var tip=(s.made?'Made':'Missed')+' '+(s.sv===3?'3PT':'2PT')+' · '+Math.round(edist(s))+' ft';
        var dl='style="animation-delay:'+Math.min(i*2,750)+'ms"';
        return s.made
          ? '<circle class="sc-mark sc-dot '+zc+'" data-t="'+tip+'" '+dl+' cx="'+cx+'" cy="'+cy+'" r="3.6" fill="var(--sc-made)" fill-opacity="0.92" stroke="rgba(0,0,0,.25)" stroke-width=".6"/>'
          : '<path class="sc-mark sc-dot '+zc+'" data-t="'+tip+'" '+dl+' d="M '+(cx-3)+' '+(cy-3)+' l 6 6 M '+(cx+3)+' '+(cy-3)+' l -6 6" stroke="var(--sc-miss)" stroke-width="1.8" stroke-opacity="0.85" fill="none"/>';
      }).join('');
      body='<div class="sc-mk-legend"><span><i class="sc-made"></i>Made</span><span><i class="sc-miss"></i>Missed</span>'+
        '<span style="margin-left:auto;color:var(--text3);font-size:10px;">hover a shot · hover a zone card to isolate it</span></div>'+
        '<div class="sc-court-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+defs()+court(null,courtOpts)+dots+'</svg><div class="sc-tip"></div></div>';
    }
    el.innerHTML=head+coverageNote(shots,opts)+'<div class="sc-main"><div class="sc-court-col">'+body+'</div></div>'+zoneStrip(shots)+extra;
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
        var t=e.target.closest?e.target.closest('[data-tip],[data-t],[data-ztip]'):null;
        if(!t){ tip.classList.remove('on'); return; }
        var r=wrap.getBoundingClientRect();
        if(t.hasAttribute('data-ztip')){
          var zf=t.getAttribute('data-ztip').split('|');
          tip.innerHTML='<b>'+zf[0].charAt(0).toUpperCase()+zf[0].slice(1)+' · '+zf[1]+'%</b><span class="scq">'+zf[2]+' FG</span><span class="scr">Division-1 here: '+zf[3]+'%</span><span class="scd" style="color:'+(zf[4].charAt(0)==='-'?'var(--sc-cold)':'var(--sc-hot)')+'">'+zf[4]+' vs D-1 avg</span>';
          tip.classList.add('rich');
        } else if(t.hasAttribute('data-tip')){
          var f=t.getAttribute('data-tip').split('|');
          tip.innerHTML='<b>FG% here: '+f[0]+'%</b>'+
            '<span class="scq">'+f[1]+' · '+f[2]+' FG</span>'+
            '<span class="scr">Division-1 here: '+f[3]+'%</span>'+
            '<span class="scd" style="color:'+(f[5]==='1'?'var(--sc-hot)':'var(--sc-cold)')+'">'+f[4]+'% vs D-1 avg</span>';
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
  function _m(btn, mode){ var host=btn.closest('[data-sc-host]'); if(host&&host._shots) render(host, host._shots, Object.assign({},host._opts,{mode:mode})); }

  if(!document.getElementById('sc-styles')){
    var st=document.createElement('style'); st.id='sc-styles';
    st.textContent=
      // theme-aware court palette: dark = navy hardwood-ish floor with white lines; light = pale maple
      ':root{--sc-floor:#f1e7d3;--sc-inside:#ead9bb;--sc-line:rgba(60,45,25,.62);--sc-board:#3a3a3a;--sc-accent:#A8843C;--sc-made:#1f9d57;--sc-miss:#c74d3f;--sc-hot:#e06a1e;--sc-cold:#2f66c9;}'+
      ':root[data-theme="dark"]{--sc-floor:#121a2b;--sc-inside:#172238;--sc-line:rgba(255,255,255,.55);--sc-board:#e8e8f0;--sc-accent:#E6D5A8;--sc-made:#5ee89a;--sc-miss:#ff6b5c;--sc-hot:#f5934a;--sc-cold:#6b9cf0;}'+
      '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--sc-floor:#121a2b;--sc-inside:#172238;--sc-line:rgba(255,255,255,.55);--sc-board:#e8e8f0;--sc-accent:#E6D5A8;--sc-made:#5ee89a;--sc-miss:#ff6b5c;--sc-hot:#f5934a;--sc-cold:#6b9cf0;}}'+
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
      '.sc-legend{display:flex;align-items:center;gap:14px;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:10px;animation:scUp .4s ease backwards;}'+
      '.sc-modes{display:inline-flex;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:3px;gap:3px;}'+
      '.sc-modes button{font-size:11.5px;font-weight:700;padding:5px 13px;border:none;border-radius:5px;background:none;color:var(--text3);cursor:pointer;transition:color .15s,background .15s;}'+
      '.sc-modes button:hover{color:var(--text);}'+
      '.sc-modes button.on{background:var(--accent);color:#fff;}'+
      '.sc-mk-legend{display:flex;align-items:center;gap:16px;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px;}'+
      '.sc-mk-legend span{display:inline-flex;align-items:center;gap:6px;}'+
      '.sc-made{width:11px;height:11px;border-radius:50%;background:var(--sc-made);display:inline-block;}'+
      '.sc-cov{font-size:11.5px;color:var(--text2);background:var(--bg2);border:1px solid var(--border2);'+
        'border-left:2px solid #E0A030;border-radius:0 8px 8px 0;padding:8px 12px;margin-bottom:10px;}'+
      '.sc-cov b{color:var(--text);}'+
      ':root{--sc-ink-rgb:26,42,76;--sc-soft:rgba(120,130,150,.9);} :root[data-theme="dark"]{--sc-ink-rgb:170,192,236;--sc-soft:rgba(190,200,220,.7);}'+
      '.sc-sig{width:14px;height:10px;border-radius:2px;background:rgba(var(--sc-ink-rgb),.6);display:inline-block;}'+
      '.sc-softsw{width:14px;height:10px;border-radius:2px;border:1.5px dashed var(--sc-soft);display:inline-block;box-sizing:border-box;}'+
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
      '.sc-strack i.soft{background:repeating-linear-gradient(45deg,var(--sc-soft) 0 2px,transparent 2px 5px);}'+
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
      '.sc-miss{width:9px;height:9px;border:1.6px solid var(--sc-miss);display:inline-block;transform:rotate(45deg);}'+
      '.sc-main{display:flex;gap:12px;align-items:stretch;}'+
      '.sc-court-col{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;}'+
      '.sc-court-wrap{position:relative;min-width:0;max-width:760px;margin:0 auto;width:100%;background:var(--sc-floor);border:1px solid var(--border);border-radius:14px;padding:0;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.22);animation:scFade .5s ease backwards;}'+
      '.sc-court-wrap .sc-svg{border-radius:14px;}'+
      '.sc-heat-wrap{background:#07060c;border-color:#1a1626;}'+
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
      '.sc-grad{width:150px;height:10px;border-radius:5px;display:inline-block;background:linear-gradient(90deg,#0a0614,#22104a,#40287c,#6a2eb2,#8b3fe0,#b078ec,#d6b4f8);}'+
      '.sc-eff-legend{max-width:520px;margin:11px auto 0;display:flex;flex-direction:column;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--text2);animation:scUp .5s ease .3s backwards;}'+
      '.sc-effbar{display:flex;align-items:center;gap:9px;}'+
      '.sc-effgrad{width:190px;height:11px;border-radius:6px;display:inline-block;background:linear-gradient(90deg,#4c7fd6,#9696a0,#f08a3c);box-shadow:inset 0 0 0 1px rgba(130,123,156,.25);}'+
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
      '.sc-settled .sc-lead,.sc-settled .sc-ring,.sc-settled .sc-callout,.sc-settled .sc-calsub,.sc-settled .sc-spot-cap,'+
      '.sc-settled .sc-mark,.sc-settled .sc-cl,.sc-settled .sc-z,.sc-settled .sc-court-wrap,.sc-settled .sc-title,.sc-settled .sc-legend,.sc-settled .sc-heat,.sc-settled .sc-heat-legend,.sc-settled .sc-eff-legend{animation:none!important;}';
    document.head.appendChild(st);
  }
  window.TDC_SHOTCHART={render:render,_m:_m,zone10:zone10,avgOf:avgOf,useSeason:useSeason};
})();
