/* tdc-moneyball.js — NIL value vs on-court impact ("Moneyball") for the Customize tab.
   TDC_MONEYBALL.render(host, {nilData, teamName, posByName, lineup})
     nilData  = nil-data.json (per-team players w/ impact + value$M + team spend)
     lineup   = [{name, mpg}] current custom rotation (optional, for Team Report/compare)
   Value metric: surplus = impact − (cost$ ÷ market-rate) = impact points you get
   ABOVE what you pay for. Positive = bargain, negative = overpay. Four modes:
   Value Board · Team Report · Find Value (budget) · Value Lineup. */
(function(){
  var RATE=0.263, POS=['PG','SG','SF','PF','C'];
  function money(m){ return m>=1?('$'+(+m).toFixed(1)+'M'):('$'+Math.round(m*1000)+'K'); }
  function sgn(n,d){ return (n>=0?'+':'')+(+n).toFixed(d==null?1:d); }
  function surColor(s){ return s>=2?'#1f9d57':s>=0?'#7cae86':s>=-2?'#cf8a5a':'#cf5a4e'; }
  function esc(s){ return (s||'').replace(/"/g,'&quot;'); }
  function plink(p){ return 'player.html?name='+encodeURIComponent(p.name); }

  var ND=null, POSBY={}, TEAM=null, LINEUP=[], POOL=[], HOST=null, MODE='board', FPOS='all', FBUD=3;

  function buildPool(){
    RATE=ND.market_rate_per_pt||RATE;
    POOL=[];
    Object.keys(ND.teams||{}).forEach(function(tn){
      (ND.teams[tn].players||[]).forEach(function(p){
        if(!(p.value>0)||p.impact==null||p.walkon) return;
        POOL.push({name:p.name, team:tn, impact:p.impact, value:p.value, mpg:p.mpg||0,
          pos:(POSBY[p.name]||'').toUpperCase(),
          surplus:p.impact-(p.value/RATE), vps:p.impact/p.value});
      });
    });
  }

  function render(host, opts){
    HOST=host||HOST; if(!HOST) return;
    if(opts){ ND=opts.nilData||ND; TEAM=opts.teamName||TEAM; POSBY=opts.posByName||POSBY; LINEUP=opts.lineup||LINEUP; }
    if(!ND){ HOST.innerHTML='<div class="mb-empty">NIL data unavailable.</div>'; return; }
    if(!POOL.length) buildPool();
    var tabs=[['board','Value Board'],['team','Team Report'],['find','Find Value'],['lineup','Value Lineup']];
    var head='<div class="mb-tabs">'+tabs.map(function(t){return '<button class="'+(MODE===t[0]?'on':'')+'" onclick="TDC_MONEYBALL._m(\''+t[0]+'\')">'+t[1]+'</button>';}).join('')+'</div>';
    var body = MODE==='board'?boardView(): MODE==='team'?teamView(): MODE==='find'?findView(): lineupView();
    HOST.innerHTML=head+'<div class="mb-body">'+body+'</div>';
    if(MODE==='board') wireScatter();
  }
  function _m(m){ MODE=m; render(); }
  function _setPos(v){ FPOS=v; render(); }
  function _setBud(v){ FBUD=+v; render(); }

  // ── 1) VALUE BOARD — scatter + best/worst value leaderboards ──────────
  function boardView(){
    var pool=POOL.filter(function(p){return p.mpg>=10 && (FPOS==='all'||p.pos===FPOS);});
    var W=760,H=380,pl=52,pr=18,pt=16,pb=40, iw=W-pl-pr, ih=H-pt-pb;
    var maxV=Math.max.apply(0,pool.map(p=>p.value))||6, maxI=Math.max.apply(0,pool.map(p=>p.impact))||18, minI=Math.min.apply(0,pool.map(p=>p.impact),0);
    function X(v){return pl+iw*v/maxV;} function Y(i){return pt+ih*(1-(i-minI)/(maxI-minI));}
    var g='';
    // market-rate line: impact = value / RATE  (fair value)
    g+='<line x1="'+X(0)+'" y1="'+Y(0)+'" x2="'+X(maxV)+'" y2="'+Y(Math.min(maxI,maxV/RATE))+'" stroke="var(--tc,#8B3FE0)" stroke-dasharray="5 4" stroke-width="1.5" opacity=".7"/>';
    g+='<text x="'+(X(maxV)-4)+'" y="'+(Y(Math.min(maxI,maxV/RATE))-6)+'" text-anchor="end" font-size="9.5" fill="var(--tc,#8B3FE0)" opacity=".8">fair value</text>';
    // gridlines
    for(var v=1;v<=maxV;v++){ g+='<line x1="'+X(v)+'" y1="'+pt+'" x2="'+X(v)+'" y2="'+(H-pb)+'" stroke="var(--border)" opacity=".5"/><text x="'+X(v)+'" y="'+(H-pb+14)+'" text-anchor="middle" font-size="9" fill="var(--text3)">$'+v+'M</text>'; }
    for(var i=Math.ceil(minI/5)*5;i<=maxI;i+=5){ g+='<line x1="'+pl+'" y1="'+Y(i)+'" x2="'+(W-pr)+'" y2="'+Y(i)+'" stroke="var(--border)" opacity=".4"/><text x="'+(pl-7)+'" y="'+(Y(i)+3)+'" text-anchor="end" font-size="9" fill="var(--text3)">'+i+'</text>'; }
    pool.forEach(function(p){
      var tip=p.name+' · '+p.team+' — '+p.impact.toFixed(1)+' impact for '+money(p.value)+' ('+sgn(p.surplus)+' surplus)';
      g+='<circle class="mb-dot" data-t="'+esc(tip)+'" cx="'+X(p.value).toFixed(1)+'" cy="'+Y(p.impact).toFixed(1)+'" r="'+(3+Math.min(4,p.mpg/12)).toFixed(1)+'" fill="'+surColor(p.surplus)+'" fill-opacity=".72" stroke="#fff" stroke-width=".6"/>';
    });
    var scatter='<div class="mb-scatterwrap"><svg viewBox="0 0 '+W+' '+H+'" class="mb-svg">'+g+'</svg><div class="mb-tip"></div>'+
      '<div class="mb-axis-y">ON-COURT IMPACT →</div><div class="mb-axis-x">NIL COST →</div></div>';
    var best=pool.filter(p=>p.impact>=4).slice().sort((a,b)=>b.surplus-a.surplus).slice(0,10);
    var worst=pool.filter(p=>p.value>=1).slice().sort((a,b)=>a.surplus-b.surplus).slice(0,10);
    return '<div class="mb-note">Each dot is a player: <b>cost</b> across, <b>impact</b> up. Above the line = more production than you pay for (a <b style="color:#1f9d57">bargain</b>); below = <b style="color:#cf5a4e">overpay</b>. Dot size = minutes.</div>'+
      posFilter()+scatter+
      '<div class="mb-cols"><div class="mb-lb"><h4>Best Value <span>most impact above cost</span></h4>'+best.map(valRow).join('')+'</div>'+
      '<div class="mb-lb"><h4>Overpays <span>paid well above production</span></h4>'+worst.map(valRow).join('')+'</div></div>';
  }
  function valRow(p,i){
    return '<a class="mb-row" href="'+plink(p)+'"><span class="mb-rk">'+(i+1)+'</span>'+
      '<span class="mb-nm"><div class="n">'+p.name+'</div><div class="s">'+p.team+(p.pos?' · '+p.pos:'')+'</div></span>'+
      '<span class="mb-v"><span class="imp">'+p.impact.toFixed(1)+'</span><span class="cost">'+money(p.value)+'</span>'+
      '<span class="sur" style="background:'+surColor(p.surplus)+'">'+sgn(p.surplus)+'</span></span></a>';
  }
  function posFilter(){
    return '<div class="mb-posf">'+['all'].concat(POS).map(function(p){return '<button class="'+(FPOS===p?'on':'')+'" onclick="TDC_MONEYBALL._pos(\''+p+'\')">'+(p==='all'?'All':p)+'</button>';}).join('')+'</div>';
  }

  // ── 2) TEAM REPORT — how well this team spends ────────────────────────
  function teamView(){
    var t=ND.teams&&ND.teams[TEAM];
    if(!t) return '<div class="mb-empty">No NIL spend data for '+(TEAM||'this team')+'.</div>';
    var lg=leagueRates(); var pctile=Math.round(100*lg.filter(r=>r>=t.implied_rate).length/lg.length);
    var verdict=t.verdict==='deal'?['Efficient spender','#1f9d57']:t.verdict==='overpay'?['Overspending','#cf5a4e']:['Market rate','var(--text2)'];
    var stat=(n,l,c)=>'<div class="mb-stat"><div class="n"'+(c?' style="color:'+c+'"':'')+'>'+n+'</div><div class="l">'+l+'</div></div>';
    var players=(t.players||[]).filter(p=>!p.walkon&&p.value>0).map(function(p){
      var sur=p.impact-(p.value/RATE);
      return {name:p.name, impact:p.impact, value:p.value, surplus:sur, pos:(POSBY[p.name]||'').toUpperCase()};
    }).sort((a,b)=>b.surplus-a.surplus);
    var surTot=players.reduce((s,p)=>s+p.surplus,0);
    return '<div class="mb-stats">'+
      stat(money(t.budget),'NIL Budget')+stat(money(t.value),'Roster Value')+stat(t.production.toFixed(1),'Total Impact')+
      stat('$'+(t.implied_rate*1000).toFixed(0)+'K','Per Impact Pt', t.implied_rate<=RATE?'#1f9d57':'#cf5a4e')+
      stat(pctile+'%ile','Spend Efficiency')+stat(verdict[0],'Verdict',verdict[1])+'</div>'+
      '<div class="mb-note">League pays <b>$'+(RATE*1000).toFixed(0)+'K</b> per impact point on average. '+(TEAM||'This team')+' pays <b style="color:'+(t.implied_rate<=RATE?'#1f9d57':'#cf5a4e')+'">$'+(t.implied_rate*1000).toFixed(0)+'K</b> — '+
      (t.implied_rate<=RATE?'a bargain roster, more production than the price tag.':'above market, paying a premium for its production.')+' Team surplus: <b style="color:'+surColor(surTot)+'">'+sgn(surTot)+' impact</b> vs a market-rate roster.</div>'+
      '<div class="mb-lb wide"><h4>Roster — Value per Player <span>impact vs what they cost</span></h4>'+players.map(valRow).join('')+'</div>';
  }
  function leagueRates(){ return Object.values(ND.teams).map(t=>t.implied_rate).filter(r=>r>0); }

  // ── 3) FIND VALUE — best players available under a budget ─────────────
  function findView(){
    var avail=POOL.filter(function(p){ return p.team!==TEAM && p.value<=FBUD && p.impact>=3 && (FPOS==='all'||p.pos===FPOS); })
      .sort((a,b)=>b.surplus-a.surplus).slice(0,14);
    return '<div class="mb-note">The best-value players you could add for a set price — most <b>impact above cost</b>, excluding '+(TEAM||'your')+' current roster.</div>'+
      '<div class="mb-controls"><label>Max price <b>'+money(FBUD)+'</b><input type="range" min="0.25" max="6" step="0.25" value="'+FBUD+'" oninput="TDC_MONEYBALL._bud(this.value)"></label>'+posFilter()+'</div>'+
      '<div class="mb-lb wide"><h4>Best Value Available <span>≤ '+money(FBUD)+(FPOS!=='all'?' · '+FPOS:'')+'</span></h4>'+
      (avail.length?avail.map(valRow).join(''):'<div class="mb-empty">No players match — raise the price or change position.</div>')+'</div>';
  }

  // ── 4) VALUE LINEUP — best impact-per-$ five under a total budget ─────
  function lineupView(){
    var cap=FBUD*5;  // reuse the slider as per-slot budget → total cap
    var pick={}, spent=0, imp=0;
    POS.forEach(function(pos){
      var cand=POOL.filter(p=>p.pos===pos&&p.value<=FBUD*1.6&&p.impact>=2).sort((a,b)=>b.surplus-a.surplus)[0];
      if(cand){ pick[pos]=cand; spent+=cand.value; imp+=cand.impact; }
    });
    var actual=ND.teams&&ND.teams[TEAM];
    var rows=POS.map(function(pos){
      var p=pick[pos];
      return '<div class="mb-lrow"><span class="mb-lpos">'+pos+'</span>'+(p?
        '<a class="mb-nm" href="'+plink(p)+'"><div class="n">'+p.name+'</div><div class="s">'+p.team+'</div></a>'+
        '<span class="mb-v"><span class="imp">'+p.impact.toFixed(1)+'</span><span class="cost">'+money(p.value)+'</span><span class="sur" style="background:'+surColor(p.surplus)+'">'+sgn(p.surplus)+'</span></span>'
        :'<span class="mb-nm"><div class="s">— none under cap —</div></span><span></span>')+'</div>';
    }).join('');
    return '<div class="mb-note">A five built purely on <b>value</b> — the highest impact-above-cost player at each spot within your per-slot budget. This is the Moneyball ideal: max production, minimum spend.</div>'+
      '<div class="mb-controls"><label>Budget / slot <b>'+money(FBUD)+'</b><input type="range" min="0.25" max="4" step="0.25" value="'+FBUD+'" oninput="TDC_MONEYBALL._bud(this.value)"></label></div>'+
      '<div class="mb-lineup">'+rows+'</div>'+
      '<div class="mb-stats" style="margin-top:14px;">'+
      '<div class="mb-stat"><div class="n">'+imp.toFixed(1)+'</div><div class="l">Total Impact</div></div>'+
      '<div class="mb-stat"><div class="n">'+money(spent)+'</div><div class="l">Total Cost</div></div>'+
      (actual?'<div class="mb-stat"><div class="n">'+actual.production.toFixed(1)+'</div><div class="l">'+(TEAM||'Team')+' Actual Impact</div></div>'+
        '<div class="mb-stat"><div class="n">'+money(actual.value)+'</div><div class="l">'+(TEAM||'Team')+' Actual Cost</div></div>':'')+'</div>';
  }

  function wireScatter(){
    var wrap=HOST.querySelector('.mb-scatterwrap'); if(!wrap) return; var tip=wrap.querySelector('.mb-tip');
    wrap.addEventListener('mousemove',function(e){ var el=e.target.closest?e.target.closest('[data-t]'):null;
      if(!el){tip.classList.remove('on');return;} var r=wrap.getBoundingClientRect();
      tip.textContent=el.getAttribute('data-t'); tip.style.left=(e.clientX-r.left)+'px'; tip.style.top=(e.clientY-r.top-12)+'px'; tip.classList.add('on'); });
    wrap.addEventListener('mouseleave',function(){tip.classList.remove('on');});
  }

  if(!document.getElementById('mb-styles')){
    var st=document.createElement('style'); st.id='mb-styles';
    st.textContent=
      '.mb-tabs{display:flex;gap:4px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:4px;margin-bottom:14px;flex-wrap:wrap;}'+
      '.mb-tabs button{flex:1;min-width:90px;font-size:12px;font-weight:700;padding:8px 10px;border:none;border-radius:7px;background:none;color:var(--text3);cursor:pointer;transition:.15s;}'+
      '.mb-tabs button.on{background:var(--tc,#8B3FE0);color:#fff;}'+
      '.mb-note{font-size:12.5px;line-height:1.6;color:var(--text2);margin-bottom:14px;}'+
      '.mb-posf{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;}'+
      '.mb-posf button{font-size:11px;font-weight:700;padding:5px 12px;border-radius:16px;border:1px solid var(--border2,var(--border));background:var(--bg2);color:var(--text2);cursor:pointer;}'+
      '.mb-posf button.on{background:var(--tc,#8B3FE0);color:#fff;border-color:var(--tc,#8B3FE0);}'+
      '.mb-scatterwrap{position:relative;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:14px 14px 8px;margin-bottom:18px;}'+
      '.mb-svg{width:100%;height:auto;display:block;overflow:visible;}'+
      '.mb-dot{cursor:pointer;transition:r .1s;}.mb-dot:hover{stroke:var(--tc,#8B3FE0);stroke-width:1.5;}'+
      '.mb-tip{position:absolute;pointer-events:none;background:var(--text);color:var(--bg);font-size:11px;font-weight:600;padding:5px 9px;border-radius:7px;transform:translate(-50%,-100%);opacity:0;transition:.12s;white-space:nowrap;z-index:20;box-shadow:0 6px 18px rgba(0,0,0,.3);}'+
      '.mb-tip.on{opacity:1;}'+
      '.mb-axis-x{text-align:center;font-size:9px;font-weight:800;letter-spacing:.1em;color:var(--text3);margin-top:2px;}'+
      '.mb-axis-y{position:absolute;left:-2px;top:50%;transform:rotate(-90deg);transform-origin:left;font-size:9px;font-weight:800;letter-spacing:.1em;color:var(--text3);}'+
      '.mb-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;}'+
      '.mb-lb{border:1px solid var(--border);border-radius:12px;background:var(--bg2);overflow:hidden;}'+
      '.mb-lb.wide{margin-top:4px;}'+
      '.mb-lb h4{font-size:12px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:var(--tc,#8B3FE0);padding:13px 15px 3px;}'+
      '.mb-lb h4 span{font-weight:600;letter-spacing:0;text-transform:none;color:var(--text3);font-size:10.5px;margin-left:6px;}'+
      '.mb-row{display:flex;align-items:center;gap:11px;padding:8px 15px;border-top:1px solid var(--border);}'+
      '.mb-row:hover{background:var(--bg3,rgba(128,128,128,.06));}'+
      '.mb-rk{font-family:\'Playfair Display\',serif;font-weight:800;font-size:13px;color:var(--text3);width:16px;text-align:center;flex-shrink:0;}'+
      '.mb-nm{flex:1;min-width:0;} .mb-nm .n{font-size:13px;font-weight:700;line-height:1.15;} .mb-nm .s{font-size:10.5px;color:var(--text3);}'+
      '.mb-v{display:flex;align-items:center;gap:9px;flex-shrink:0;font-variant-numeric:tabular-nums;}'+
      '.mb-v .imp{font-family:\'Playfair Display\',serif;font-weight:800;font-size:15px;}'+
      '.mb-v .cost{font-size:11.5px;font-weight:600;color:var(--text2);min-width:46px;text-align:right;}'+
      '.mb-v .sur{font-size:11px;font-weight:800;color:#fff;padding:2px 7px;border-radius:6px;min-width:34px;text-align:center;}'+
      '.mb-stats{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:14px;}'+
      '.mb-stat .n{font-family:\'Playfair Display\',serif;font-weight:800;font-size:22px;}'+
      '.mb-stat .l{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);}'+
      '.mb-controls{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:12px;}'+
      '.mb-controls label{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);}'+
      '.mb-controls input[type=range]{width:200px;accent-color:var(--tc,#8B3FE0);}'+
      '.mb-lineup{border:1px solid var(--border);border-radius:12px;background:var(--bg2);overflow:hidden;}'+
      '.mb-lrow{display:flex;align-items:center;gap:12px;padding:10px 15px;border-top:1px solid var(--border);}'+
      '.mb-lrow:first-child{border-top:none;}'+
      '.mb-lpos{font-size:11px;font-weight:800;color:var(--tc,#8B3FE0);width:30px;flex-shrink:0;}'+
      '.mb-empty{padding:26px;text-align:center;color:var(--text3);font-size:12.5px;}'+
      '@media(max-width:640px){.mb-cols{grid-template-columns:1fr;}}';
    document.head.appendChild(st);
  }
  window.TDC_MONEYBALL={render:render,_m:_m,_pos:_setPos,_bud:_setBud};
})();
