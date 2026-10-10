/* tdc-nilchart.js — "What every roster is worth": every program's roster as a team logo, stacked by its
   open-market NIL value (height = value; logos in the same value band sit side by side — the "does your roster
   cost $8M or $50M?" layout). Used by team.html (NIL tab) and moneyball.html (Programs tab).

   TDC_NILCHART.league(host, items, opts)
     items: [{team, val, conf, label?}]   team = the short name team.html?team= and the logo resolver use
     opts:  { me, myVal, myConf, tcol, fmt(v)->'$1.2M',
              mode: 'conf'|'hm'|'all'  (default: hm for a high-major `me`, else conf; 'hm' when no `me`),
              modes: ['conf','hm','all'] (which toggles to offer),
              title, lede(pool, rank) -> html, foot,
              ring(item) -> css colour | null   (e.g. green/red by value),
              legend: html under the chart,
              onPick(item) -> handled? (clicking a logo; return true to stop the team.html link) }
*/
(function(){
  var HM={'ACC':1,'B10':1,'BIG-12':1,'SEC':1,'Big-East':1,'Big Ten':1,'Big 12':1,'Big East':1};
  var CONF_NAME={'B10':'Big Ten','BIG-12':'Big 12','Big-East':'Big East','PAC-12':'Pac-12','A10':'Atlantic 10','AAC':'American','AEC':'America East',
    'CUSA':'Conference USA','MWC':'Mountain West','UAC':'United Athletic','WCC':'West Coast','MVC':'Missouri Valley'};
  function esc(t){ return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function logo(t){ try{ var c=window.tdcTeamColor&&tdcTeamColor(t); return (c&&c.logo)||''; }catch(e){ return ''; } }
  function dfmt(m){ return m>=1?('$'+(+m).toFixed(1)+'M'):('$'+Math.round(m*1000)+'K'); }

  function league(host, board, opts){
    if(!host||!board||board.length<4) return;
    opts=opts||{};
    var me=opts.me||null, myConf=opts.myConf||'', fmt=opts.fmt||dfmt, tcol=opts.tcol||'var(--text)';
    var modes=opts.modes||(me?['conf','hm','all']:['hm','all']);
    var mode=opts.mode||(me?(HM[myConf]?'hm':'conf'):'hm');
    var pool=board.filter(function(x){ return mode==='all'?true:mode==='hm'?!!HM[x.conf]:x.conf===myConf; });
    if(me && opts.myVal!=null && !pool.some(function(x){ return x.team===me; })) pool=pool.concat([{team:me,val:opts.myVal,conf:myConf}]);
    pool=pool.filter(function(x){ return x.val>0; }).slice().sort(function(a,b){ return b.val-a.val; });
    if(pool.length<2){ host.innerHTML=''; return; }
    var W=Math.max(320,host.clientWidth||900), left=58, right=150, iw=W-left-right;
    var L=pool.length>120?20:pool.length>60?28:34, gap=4;
    // all of D-I bunches ~250 rosters between $1M and $5M: a log scale spreads that band out
    var F=mode==='all'?function(v){ return Math.log(Math.max(v,0.05)); }:function(v){ return v; };
    var vmax=F(pool[0].val), vmin=F(pool[pool.length-1].val);
    var H=pool.length>120?640:Math.max(220,Math.min(560,pool.length*12+170));
    var rows, dv, bins;
    for(var tries=0;tries<8;tries++){   // shrink the logos until the busiest value band fits the width
      rows=Math.max(4,Math.floor(H/(L+gap))); dv=(vmax-vmin)/rows||1;
      bins={}; pool.forEach(function(x){ var r=Math.min(rows-1,Math.floor((vmax-F(x.val))/dv)); (bins[r]=bins[r]||[]).push(x); });
      var widest=Math.max.apply(null,Object.keys(bins).map(function(k){ return bins[k].length; }));
      if(widest*(L+gap)<=iw||L<=14) break; L-=3;
    }
    var rowH=L+gap, chartH=rows*rowH+L, Yv=function(v){ return 8+(vmax-F(v))/dv*rowH; };
    var rv=pool[0].val, rl=pool[pool.length-1].val, span=rv-rl, step=span>40?10:span>20?5:span>8?2:span>3?1:0.5, ax='', ticks=[];
    if(mode==='all'){ [0.25,0.5,1,2,5,10,20,40].forEach(function(t){ if(t>=rl&&t<=rv) ticks.push(t); }); }
    else for(var t0=Math.ceil(rl/step)*step; t0<=rv; t0+=step) ticks.push(t0);
    ticks.forEach(function(v){ var y=Yv(v)+L/2;
      ax+='<div class="nlc-grid" style="top:'+y.toFixed(1)+'px;right:'+(right-30)+'px"></div><div class="nlc-ax" style="top:'+(y-8).toFixed(1)+'px">'+fmt(v)+'</div>'; });
    var marks='', meXY=null, topXY=null, botXY=null, idx=0, IT=[];
    Object.keys(bins).forEach(function(k){ var r=+k;
      bins[k].forEach(function(x,i){ var X=left+i*rowH, Y=8+r*rowH, lg=logo(x.team), isMe=x.team===me, rc=opts.ring?opts.ring(x):null;
        if(isMe) meXY=[X,Y,x]; if(x===pool[0]) topXY=[X,Y,x]; if(x===pool[pool.length-1]) botXY=[X,Y,x];
        IT.push(x);
        marks+='<a class="nlc-dot'+(isMe?' me':'')+(rc?' rg':'')+'" data-i="'+(idx++)+'" href="team.html?team='+encodeURIComponent(x.team)+'" title="'+esc(x.label||x.team)+' · '+fmt(x.val)+'" style="left:'+X+'px;top:'+Y+'px;width:'+L+'px;height:'+L+'px;'+(isMe?'--ring:'+tcol+';':rc?'--ring:'+rc+';':'')+'">'+
          (lg?'<img src="'+esc(lg)+'" alt="" decoding="async">':'<span>'+esc(String(x.team).slice(0,3))+'</span>')+'</a>'; }); });
    var call=function(xy,cls){ if(!xy) return ''; var x=xy[2], y=xy[1]+L/2, x0=xy[0]+L+3;
      return '<div class="nlc-lead '+cls+'" style="left:'+x0+'px;top:'+y.toFixed(1)+'px;width:'+Math.max(10,W-right-x0+12)+'px"></div>'+
        '<div class="nlc-call '+cls+'" style="left:'+(W-right+16)+'px;top:'+(y-17).toFixed(1)+'px"><b>'+esc(x.label||x.team)+'</b><span>'+fmt(x.val)+'</span></div>'; };
    var rank=me?pool.findIndex(function(x){ return x.team===me; })+1:0;
    var label={conf:(CONF_NAME[myConf]||myConf||'Conference'),hm:(opts.hmLabel||'High-majors'),all:'All D-I'};
    var seg=modes.length>1?'<div class="nlc-seg">'+modes.map(function(m){ return '<button type="button" class="'+(m===mode?'on':'')+'" data-m="'+m+'">'+esc(label[m])+'</button>'; }).join('')+'</div>':'';
    var lede=opts.lede?opts.lede(pool,rank,mode):(me?('<b>'+esc(me)+'</b> is <b>#'+rank+' of '+pool.length+'</b> '+(mode==='conf'?'in the '+esc(label.conf):mode==='hm'?'among high-major rosters':'in Division I')+' at <b>'+fmt(opts.myVal)+'</b>.'):
      ('<b>'+pool.length+' rosters</b>, from '+esc(pool[0].label||pool[0].team)+' ('+fmt(pool[0].val)+') to '+esc(pool[pool.length-1].label||pool[pool.length-1].team)+' ('+fmt(pool[pool.length-1].val)+').'));
    host.innerHTML=(opts.title===false?'':'<div class="nlc-title">'+esc(opts.title||'What every roster is worth')+'</div>')+
      '<div class="nlc-top"><div class="nlc-lede">'+lede+'</div>'+seg+'</div>'+
      '<div class="nlc" style="height:'+(chartH+12)+'px">'+ax+marks+
        call(topXY!==meXY?topXY:null,'top')+(meXY?call(meXY,'me'):'')+call(botXY!==meXY&&pool.length>2?botXY:null,'bot')+'</div>'+
      (opts.legend||'')+
      '<div class="nlc-foot">'+(opts.foot||'Each logo is a roster, placed by its open-market NIL worth (every player priced on last season, career and upside). Logos in the same band are side by side.')+
        (mode==='all'?' The scale is compressed at the top so the crowded middle of D-I spreads out.':'')+'</div>';
    host.querySelectorAll('.nlc-seg button').forEach(function(b){ b.onclick=function(){ league(host,board,Object.assign({},opts,{mode:b.getAttribute('data-m')})); }; });
    if(opts.onPick) host.querySelectorAll('.nlc-dot').forEach(function(a){ a.addEventListener('click',function(e){ var x=IT[+a.getAttribute('data-i')]; if(x&&opts.onPick(x)){ e.preventDefault(); } }); });
  }

  if(!document.getElementById('nlc-styles')){
    var st=document.createElement('style'); st.id='nlc-styles';
    st.textContent=
      '.nlc-title{font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text);margin:28px 0 10px;}'+
      '.nlc-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;}'+
      '.nlc-lede{font-size:14px;color:var(--text2);} .nlc-lede b{color:var(--text);}'+
      '.nlc-seg{display:inline-flex;gap:3px;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:3px;}'+
      '.nlc-seg button{font:700 12px Inter,system-ui,sans-serif;border:0;background:none;color:var(--text3);padding:5px 11px;border-radius:5px;cursor:pointer;white-space:nowrap;}'+
      '.nlc-seg button.on{background:var(--text);color:var(--bg);}'+
      '.nlc{position:relative;width:100%;}'+
      '.nlc-grid{position:absolute;left:58px;height:1px;background:var(--border);}'+
      '.nlc-ax{position:absolute;left:0;width:50px;text-align:right;font-size:12px;font-weight:600;color:var(--text3);font-variant-numeric:tabular-nums;}'+
      '.nlc-dot{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--bg);border:1px solid var(--border2);box-shadow:0 1px 2px rgba(0,0,0,.08);overflow:hidden;transition:transform .12s;z-index:2;}'+
      '.nlc-dot:hover{transform:scale(1.35);z-index:5;}'+
      '.nlc-dot img{width:78%;height:78%;object-fit:contain;} .nlc-dot span{font-size:9px;font-weight:800;color:var(--text3);}'+
      '.nlc-dot.rg{border:2px solid var(--ring);}'+
      '.nlc-dot.me{border:2.5px solid var(--ring);box-shadow:0 0 0 3px color-mix(in srgb,var(--ring) 25%,transparent);z-index:4;}'+
      '.nlc-lead{position:absolute;height:1px;background:var(--text3);z-index:1;} .nlc-lead.me{background:var(--text);height:1.5px;}'+
      '.nlc-call{position:absolute;font-size:13px;line-height:1.25;white-space:nowrap;} .nlc-call b{display:block;font-weight:800;color:var(--text);} .nlc-call span{color:var(--text3);font-variant-numeric:tabular-nums;}'+
      '.nlc-call.me b{font-size:14px;}'+
      '.nlc-key{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--text2);margin-top:8px;} .nlc-key i{display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid;margin-right:6px;vertical-align:-2px;}'+
      '.nlc-foot{font-size:11.5px;color:var(--text3);margin-top:8px;line-height:1.5;}';
    document.head.appendChild(st);
  }
  window.TDC_NILCHART={league:league, HM:HM, CONF_NAME:CONF_NAME};
})();
