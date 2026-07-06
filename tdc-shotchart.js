/* tdc-shotchart.js — half-court shot chart renderer (player or team).
   TDC_SHOTCHART.render(el, shots, opts)
     shots: [{x,y,made,sv,dist}]  (ESPN coords: x 0-50 width, y feet from baseline)
     opts:  {title, subtitle}
   Draws a stylized half-court SVG, plots made/missed shots, and a zone-FG% strip. */
(function(){
  var FT=10;                              // px per foot
  var HOOP_X=25, HOOP_Y=5.25;             // hoop center in feet
  var W=50*FT, H=42*FT;                   // show 0-42 ft of the half court
  function px(fx){return fx*FT;}
  function py(fy){return H-fy*FT;}        // baseline at the bottom, y grows up
  function edist(s){                       // effective distance from hoop (ft)
    if(s.dist!=null && s.dist>=0) return s.dist;
    var dx=(s.x||0)-HOOP_X, dy=(s.y||0)-HOOP_Y; return Math.sqrt(dx*dx+dy*dy);
  }
  function court(){
    var hx=px(HOOP_X), hy=py(HOOP_Y), c='#0000', line='rgba(130,123,156,.55)';
    var g='';
    // outer + baseline
    g+='<rect x="1" y="1" width="'+(W-2)+'" height="'+(H-2)+'" fill="none" stroke="'+line+'" stroke-width="2"/>';
    // paint (12ft wide, 19ft to FT line)
    g+='<rect x="'+px(19)+'" y="'+py(19)+'" width="'+px(12)+'" height="'+(py(0)-py(19))+'" fill="none" stroke="'+line+'" stroke-width="1.5"/>';
    // FT circle
    g+='<circle cx="'+px(25)+'" cy="'+py(19)+'" r="'+px(6)+'" fill="none" stroke="'+line+'" stroke-width="1.5"/>';
    // restricted arc (4ft)
    g+='<path d="M '+(hx-px(4))+' '+hy+' A '+px(4)+' '+px(4)+' 0 0 0 '+(hx+px(4))+' '+hy+'" fill="none" stroke="'+line+'" stroke-width="1.5"/>';
    // backboard + rim
    g+='<line x1="'+(px(25)-px(3))+'" y1="'+py(4)+'" x2="'+(px(25)+px(3))+'" y2="'+py(4)+'" stroke="'+line+'" stroke-width="2"/>';
    g+='<circle cx="'+hx+'" cy="'+hy+'" r="'+px(0.75)+'" fill="none" stroke="var(--accent)" stroke-width="2"/>';
    // 3pt line: corners at 21.65ft from center, arc r=22.15 from hoop
    var cornerX=250-216.5, cornerYtop=hy-46.8;   // precomputed for FT=10
    g+='<path d="M '+cornerX+' '+py(0)+' L '+cornerX+' '+cornerYtop+
        ' A 221.5 221.5 0 0 1 '+(500-cornerX)+' '+cornerYtop+' L '+(500-cornerX)+' '+py(0)+'" fill="none" stroke="'+line+'" stroke-width="1.5"/>';
    return g;
  }
  function zones(shots){
    var z={rim:[0,0],mid:[0,0],three:[0,0]};
    shots.forEach(function(s){
      var k = s.sv===3 ? 'three' : (edist(s)<=4 ? 'rim' : 'mid');
      z[k][1]++; if(s.made) z[k][0]++;
    });
    return z;
  }
  function pct(a){ return a[1] ? Math.round(a[0]/a[1]*100) : 0; }

  function render(el, shots, opts){
    opts=opts||{};
    if(!el) return;
    shots=(shots||[]).filter(function(s){return s.x!=null&&s.y!=null;});
    if(!shots.length){ el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3);font-size:13px;">No shot-location data'+(opts.subtitle?' for '+opts.subtitle:'')+' yet.</div>'; return; }
    var made=shots.filter(function(s){return s.made;});
    var dots=shots.map(function(s){
      var cx=px(Math.max(0,Math.min(50,s.x))), cy=py(Math.max(-2,s.y));
      return s.made
        ? '<circle cx="'+cx+'" cy="'+cy+'" r="3.4" fill="#1f9d57" fill-opacity="0.85"/>'
        : '<path d="M '+(cx-3)+' '+(cy-3)+' l 6 6 M '+(cx+3)+' '+(cy-3)+' l -6 6" stroke="#cf5a4e" stroke-width="1.6" stroke-opacity="0.8"/>';
    }).join('');
    var z=zones(shots);
    var fgp=Math.round(made.length/shots.length*100);
    var efg=Math.round((made.length+0.5*made.filter(function(s){return s.sv===3;}).length)/shots.length*100);
    var strip=
      '<div class="sc-zones">'+
        stat('FG%', fgp+'%', made.length+'/'+shots.length)+
        stat('eFG%', efg+'%', 'shot quality')+
        stat('At Rim', pct(z.rim)+'%', z.rim[1]+' att')+
        stat('Mid', pct(z.mid)+'%', z.mid[1]+' att')+
        stat('Three', pct(z.three)+'%', z.three[1]+' att')+
      '</div>';
    el.innerHTML=
      (opts.title?'<div class="sc-title">'+opts.title+'</div>':'')+
      '<div class="sc-legend"><span><i class="sc-made"></i>Made</span><span><i class="sc-miss"></i>Missed</span>'+
        '<span style="margin-left:auto;color:var(--text3);">'+shots.length+' field-goal attempts</span></div>'+
      '<div class="sc-court-wrap"><svg class="sc-svg" viewBox="0 0 '+W+' '+H+'">'+court()+dots+'</svg></div>'+
      strip;
  }
  function stat(l,v,s){ return '<div class="sc-z"><div class="sc-zv">'+v+'</div><div class="sc-zl">'+l+'</div><div class="sc-zs">'+s+'</div></div>'; }

  // inject styles once
  if(!document.getElementById('sc-styles')){
    var st=document.createElement('style'); st.id='sc-styles';
    st.textContent='.sc-title{font-size:13px;font-weight:700;color:var(--text2);margin-bottom:8px;}'+
      '.sc-legend{display:flex;align-items:center;gap:16px;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px;}'+
      '.sc-legend span{display:inline-flex;align-items:center;gap:6px;}'+
      '.sc-legend i{width:11px;height:11px;border-radius:50%;display:inline-block;}'+
      '.sc-made{background:#1f9d57;} .sc-miss{background:none;border:1.6px solid #cf5a4e;border-radius:0!important;transform:rotate(45deg);width:9px!important;height:9px!important;}'+
      '.sc-court-wrap{max-width:420px;margin:0 auto;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:8px;}'+
      '.sc-svg{width:100%;height:auto;display:block;}'+
      '.sc-zones{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:14px;max-width:440px;margin-left:auto;margin-right:auto;}'+
      '.sc-z{text-align:center;border:1px solid var(--border);border-radius:9px;padding:9px 4px;background:var(--bg2);}'+
      '.sc-zv{font-family:\'Playfair Display\',serif;font-weight:800;font-size:18px;}'+
      '.sc-zl{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);margin-top:2px;}'+
      '.sc-zs{font-size:9px;color:var(--text3);margin-top:1px;}';
    document.head.appendChild(st);
  }
  window.TDC_SHOTCHART={render:render};
})();
