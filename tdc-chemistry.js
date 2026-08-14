/* tdc-chemistry.js — shared lineup-chemistry engine + renderer.
   TDCChem.render(el, rosterRows, opts) draws a "Lineup Identity" panel (OVR,
   synergy, trait bars, edge/gap, coach + key duos) next to a half-court with the
   5 starters positioned by play-style and connected by synergy lines. Pure logic
   on top of TDCPortalFit.profile/archetype, so it matches the team page's read.
   TDCChem.renderMatchup(el, rowsA, rowsB, opts) draws a team-vs-team matchup card.
   Also exposes pairSynergy / lineupAnalysis / assignStarters / matchup for reuse. */
(function(global){
  function prof(p){ try{ return (global.TDCPortalFit&&TDCPortalFit.profile)?TDCPortalFit.profile(p):{}; }catch(e){ return {}; } }
  function arch(p){ try{ return (global.TDCPortalFit&&TDCPortalFit.archetype)?TDCPortalFit.archetype(p):''; }catch(e){ return ''; } }
  function num(p,k){ var n=parseFloat(p&&p[k]); return isNaN(n)?0:n; }
  function synCol(v){ return v>=63?'#5ab875':v>=52?'#d4a24a':'#e07070'; }
  function ovrCol(g){ g=parseFloat(g); if(isNaN(g))return 'var(--text3)'; if(g>=88)return '#5ab875'; if(g>=80)return 'var(--accent)'; if(g>=72)return 'var(--text)'; return 'var(--text2)'; }
  // The OVR shown everywhere (badges, cards, Lineup OVR) = the PROJECTED overall — the same
  // number as the player card and the rest of the site — not the raw tdc_grade. Using raw for
  // the Lineup OVR while the badges showed projected is why the panel read ~4 pts too low.
  function dispGrade(p){
    if(!p) return NaN;
    if(p._projGrade!=null && !isNaN(parseFloat(p._projGrade))) return Math.round(parseFloat(p._projGrade));
    try{ if(global.TDCProjGrade && TDCProjGrade.gradeSolo && parseFloat(p.mpg)>0){ var g=TDCProjGrade.gradeSolo(p); if(g!=null && !isNaN(g)) return Math.round(g); } }catch(e){}
    var r=parseFloat(p.tdc_grade); return isNaN(r)?NaN:Math.round(r);
  }
  function firstLast(n){ var p=(n||'').trim().split(/\s+/); return p.length>1?(p[0][0]+'. '+p[p.length-1]):(n||''); }

  // synergy between two players (0-99), + the reasons behind it
  function pairSynergy(a,b){
    var A=prof(a), B=prof(b), aA=arch(a), aB=arch(b), g=function(o,k){return +(o[k]||0);};
    var s=55, R=[]; var add=function(d,t){ s+=d; if(Math.abs(d)>=2) R.push({d:Math.round(d),t:t}); };
    var shootMax=Math.max(g(A,'shooter'),g(B,'shooter'));
    var iA=g(A,'finisher')*g(A,'size'), iB=g(B,'finisher')*g(B,'size'), interior=Math.max(iA,iB);
    var shArch=g(A,'shooter')>=g(B,'shooter')?aA:aB, inArch=iA>=iB?aA:aB;
    add(18*shootMax*Math.max(interior,0.4), shArch+' spacing opens driving lanes for the '+inArch);
    add(7*Math.min(g(A,'shooter'),g(B,'shooter')), 'Two floor-spacers ('+aA+' & '+aB+') stretch the D');
    if(shootMax<0.28 && interior>0.5){ var clog=(iA>=iB)?aB:aA; add(-13, clog+' gives no spacing next to the '+inArch); }
    var creator=Math.max(g(A,'creator'),g(B,'creator'));
    var crArch=g(A,'creator')>=g(B,'creator')?aA:aB, tgArch=g(A,'creator')>=g(B,'creator')?aB:aA;
    var tgt=(g(A,'creator')>g(B,'creator'))?(g(B,'finisher')*0.6+g(B,'shooter')*0.6+g(B,'scorer')*0.3):(g(A,'finisher')*0.6+g(A,'shooter')*0.6+g(A,'scorer')*0.3);
    add(16*creator*Math.min(1,tgt), crArch+' creates open looks for the '+tgArch);
    if(g(A,'creator')>0.6 && g(B,'creator')>0.6) add(-9, aA+' & '+aB+' both need the ball in their hands');
    else if(g(A,'ballDom')>0.7 && g(B,'ballDom')>0.7) add(-7, 'Overlapping ball-dominance — '+aA+' & '+aB);
    var rimArch=g(A,'rimProtect')>=g(B,'rimProtect')?aA:aB, perArch=g(A,'rimProtect')>=g(B,'rimProtect')?aB:aA;
    add(13*Math.max(g(A,'rimProtect')*g(B,'perimD'), g(B,'rimProtect')*g(A,'perimD')), rimArch+' anchors behind the '+perArch+' on defense');
    add(5*Math.min(g(A,'perimD')+g(B,'perimD'),2)/2, 'Both hound the ball on the perimeter');
    if(g(A,'rimProtect')<0.2 && g(B,'rimProtect')<0.2) add(-5, 'Neither the '+aA+' nor '+aB+' protects the rim');
    if(g(A,'size')>0.6 && g(B,'size')>0.6 && g(A,'shooter')<0.3 && g(B,'shooter')<0.3) add(-10, aA+' + '+aB+' — two non-shooting bigs clog the paint');
    var keys=['shooter','creator','finisher','rimProtect','rebounder','perimD'], sim=0;
    keys.forEach(function(k){ sim+=1-Math.abs(g(A,k)-g(B,k)); }); sim/=keys.length;
    if(sim>0.76) add(-13*(sim-0.74), aA===aB?('Two '+aA+'s — redundant roles'):(aA+' & '+aB+' overlap — redundant'));
    R.sort(function(x,y){return Math.abs(y.d)-Math.abs(x.d);});
    return { score:Math.max(22,Math.min(99,Math.round(s))), reasons:R, archA:aA, archB:aB };
  }

  // whole-lineup identity from the 5 starters
  function lineupAnalysis(starters){
    var ps=starters.filter(function(s){return s.p;}).map(function(s){return s.p;});
    if(ps.length<2) return null;
    var sum=0,cnt=0,pairs=[];
    for(var i=0;i<ps.length;i++) for(var j=i+1;j<ps.length;j++){
      var sc=pairSynergy(ps[i],ps[j]).score; sum+=sc; cnt++;
      pairs.push({a:ps[i],b:ps[j],score:sc});
    }
    var overall=Math.round(sum/cnt);
    pairs.sort(function(x,y){return y.score-x.score;});
    var best=pairs[0], worst=pairs[pairs.length-1];
    var S=function(k){ return ps.reduce(function(t,p){return t+num(p,k);},0); };
    var nz=function(v,lo,hi){ return Math.max(3,Math.min(100,Math.round((v-lo)/(hi-lo)*100))); };
    var spacers=ps.filter(function(p){ return num(p,'tp_pct')>=32 && num(p,'tpa')>=1.5; }).length;
    var elite=ps.filter(function(p){ return num(p,'tp_pct')>=37 && num(p,'tpa')>=3; }).length;
    var blks=ps.map(function(p){return num(p,'blk');}).sort(function(a,b){return b-a;});
    var anchor=blks[0]||0, second=blks[1]||0;
    var dims={ Scoring:nz(S('ppg'),38,78), Spacing:nz(spacers*19+elite*9,8,78),
      Playmaking:nz(S('apg'),7,19), Rebounding:nz(S('rpg'),15,38),
      'Perimeter D':nz(S('stl'),2,7), 'Rim Protect':nz(anchor*22+second*11+S('blk')*2,10,68) };
    var grades=ps.map(dispGrade).filter(function(g){return !isNaN(g);});
    var rating=grades.length?Math.round(grades.reduce(function(a,b){return a+b;},0)/grades.length):null;
    return {overall:overall,dims:dims,rating:rating,shooters:spacers,count:ps.length,best:best,worst:worst,starters:ps};
  }

  // pick a starting five from a roster and slot them PG..C by position
  function assignStarters(rows){
    var R=(rows||[]).filter(function(p){return p&&(num(p,'mpg')>=1)&&p.name;});
    R.sort(function(a,b){return num(b,'mpg')-num(a,'mpg');});
    var top=R.slice(0,5);
    var ord={PG:0,G:0,SG:1,CG:1,SF:2,F:2,PF:3,C:4};
    var po=function(p){ var pos=((p.position||'')+'').toUpperCase().split(/[\/, ]/)[0]; return ord[pos]!=null?ord[pos]:2; };
    top.sort(function(a,b){return po(a)-po(b) || num(b,'mpg')-num(a,'mpg');});
    var slots=['PG','SG','SF','PF','C'];
    return top.map(function(p,i){ return {pos:slots[i]||'SF', p:p}; });
  }

  // natural half-court set (basket at top): C at the rim, PF the left block, SG/SF
  // on the wings, PG up top with the ball. x,y are 0-100 percentages.
  var COURT_XY={ C:{x:62,y:27}, PF:{x:33,y:33}, SF:{x:19,y:56}, SG:{x:81,y:56}, PG:{x:50,y:76} };
  function courtPos(p,pos){
    var b=COURT_XY[pos]||{x:50,y:50}; if(!p) return b;
    var P=prof(p), isBig=(pos==='C'||pos==='PF'), x=b.x, y=b.y, sh=+P.shooter||0;
    // only stretch bigs drift out toward a wing; everyone else keeps their natural spot
    if(isBig && sh>0.42){ y += (sh-0.42)*20; x += (x<50?-1:1)*(sh-0.42)*10; }
    return { x:Math.max(15,Math.min(85,Math.round(x*10)/10)), y:Math.max(17,Math.min(82,Math.round(y*10)/10)) };
  }
  function initials(n){ var p=(n||'').trim().split(/\s+/); return ((p[0]||'')[0]||'')+((p[p.length-1]||'')[0]||''); }
  function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }

  function panelHtml(an, opts, best){
    opts=opts||{};
    if(!an) return '<div class="chm-panel"><div class="chm-h">Lineup Identity</div><div style="color:var(--text3);font-size:12px;">Not enough roster data.</div></div>';
    var dimBar=function(kv){ var k=kv[0],v=kv[1]; return '<div class="chm-dim"><div class="chm-dim-top"><span>'+k+'</span><b>'+v+'</b></div><div class="chm-dim-bar"><span style="width:'+v+'%;background:'+(v>=70?'#5ab875':v>=45?'var(--accent)':'var(--text3)')+';"></span></div></div>'; };
    var ents=Object.keys(an.dims).map(function(k){return [k,an.dims[k]];});
    var top=ents.slice().sort(function(a,b){return b[1]-a[1];})[0], low=ents.slice().sort(function(a,b){return a[1]-b[1];})[0];
    var word=an.overall>=74?'Elite fit':an.overall>=64?'Complementary':an.overall>=54?'Workable':'Redundant';
    var duo='';
    if(an.best&&an.worst){
      duo='<div class="chm-duos">'
        +'<div class="chm-duo"><span class="chm-duo-l" style="color:#5ab875;">Best duo</span><span class="chm-duo-n">'+esc(firstLast(an.best.a.name))+' &amp; '+esc(firstLast(an.best.b.name))+'</span><span class="chm-duo-s" style="color:#5ab875;">'+an.best.score+'</span></div>'
        +'<div class="chm-duo"><span class="chm-duo-l" style="color:#e07070;">Weak link</span><span class="chm-duo-n">'+esc(firstLast(an.worst.a.name))+' &amp; '+esc(firstLast(an.worst.b.name))+'</span><span class="chm-duo-s" style="color:#e07070;">'+an.worst.score+'</span></div>'
        +'</div>';
    }
    var bl='';
    if(best){
      var curNames={}; (an.starters||[]).forEach(function(p){curNames[p.name]=1;});
      var bestSet={}; best.five.forEach(function(p){bestSet[p.name]=1;});
      var adds=best.five.filter(function(p){return !curNames[p.name];});
      var drops=(an.starters||[]).filter(function(p){return !bestSet[p.name];});
      var note = adds.length===0
        ? 'The starting five is already the best fit on the roster.'
        : adds.map(function(p,i){ return 'Sub in <b style="color:#5ab875;">'+esc(firstLast(p.name))+'</b>'+(drops[i]?' for '+esc(firstLast(drops[i].name)):'')+''; }).join('; ')+'.';
      bl='<div class="chm-best"><div class="chm-best-h">Optimal Five <span class="chm-best-tag">syn '+best.syn+' · ovr '+best.rating+'</span></div>'
        +'<div class="chm-best-note">'+note+'</div></div>';
    }
    return '<div class="chm-panel"><div class="chm-h">Lineup Identity</div>'
      +'<div class="chm-rr"><div class="chm-rc"><div class="chm-big" style="color:'+ovrCol(an.rating)+'">'+(an.rating||'—')+'</div><div class="chm-lbl">Lineup OVR</div></div>'
      +'<div class="chm-rc"><div class="chm-big" style="color:'+synCol(an.overall)+'">'+an.overall+'</div><div class="chm-lbl">Synergy</div></div></div>'
      +'<div class="chm-word" style="color:'+synCol(an.overall)+'">'+word+'</div>'
      +'<div class="chm-dims">'+ents.map(dimBar).join('')+'</div>'
      +'<div class="chm-note"><b style="color:#5ab875;">Edge:</b> '+top[0]+' &nbsp; <b style="color:#e07070;">Gap:</b> '+low[0]+'</div>'
      +'<div class="chm-note" style="color:var(--text3);">'+an.shooters+' of '+an.count+' starters space the floor.</div>'
      +duo+bl+'</div>';
  }

  function courtHtml(starters, opts){
    opts=opts||{};
    var pts=starters.filter(function(s){return s.p;}).map(function(s){ var xy=courtPos(s.p,s.pos); return {pos:s.pos, p:s.p, x:xy.x, y:xy.y}; });
    var line='rgba(255,255,255,.13)';
    // synergy lines — nodes & lines share a 0-100 space so they align. Strong pairs
    // read green, weak red (dashed); middling pairs fade so the web stays clean.
    var lines='';
    for(var i=0;i<pts.length;i++) for(var j=i+1;j<pts.length;j++){
      var syn=pairSynergy(pts[i].p, pts[j].p).score, str=Math.min(1,Math.abs(syn-55)/26);
      var strong=syn>=60, weak=syn<=50;
      var col=strong?'#5ab875':weak?'#e07070':'rgba(150,170,200,.45)';
      var op=(strong||weak)?(0.26+str*0.44):0.09;
      var w=(strong||weak)?(0.5+str*1.0):0.35;
      lines+='<line x1="'+pts[i].x+'" y1="'+pts[i].y+'" x2="'+pts[j].x+'" y2="'+pts[j].y+'" stroke="'+col+'" stroke-width="'+w.toFixed(2)+'" stroke-opacity="'+op.toFixed(2)+'" stroke-linecap="round"'+(weak?' stroke-dasharray="2 1.8"':'')+'/>';
    }
    var showPhoto=(global.tdcShowPhotos&&global.tdcShowPhotos());
    var nodes=pts.map(function(pt){
      var _gv=dispGrade(pt.p), g=isNaN(_gv)?'':_gv, photo=(showPhoto&&pt.p.espn_id)?('https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/'+pt.p.espn_id+'.png'):'';
      // with a photo, show ONLY the headshot (no initials bleeding through the cutout)
      var inner=photo?'<img src="'+photo+'" alt="" loading="lazy" onerror="this.parentNode.classList.add(\'noimg\');this.remove();">':'<span class="chm-init">'+esc(initials(pt.p.name))+'</span>';
      return '<div class="chm-node" style="left:'+pt.x+'%;top:'+pt.y+'%;">'
        +'<div class="chm-ava'+(photo?'':' noimg')+'">'+inner+'<span class="chm-pos">'+pt.pos+'</span></div>'
        +'<div class="chm-nm">'+esc(pt.p.name)+'</div>'
        +'<div class="chm-ovr" style="color:'+ovrCol(g)+'">'+(g||'—')+'</div></div>';
    }).join('');
    return '<div class="chm-court">'
      +'<svg class="chm-court-bg" viewBox="0 0 120 80" preserveAspectRatio="none">'
      +'<rect x="1" y="1" width="118" height="78" fill="none" stroke="'+line+'" stroke-width=".4"/>'
      +'<rect x="48" y="1" width="24" height="30" fill="none" stroke="'+line+'" stroke-width=".4"/>'
      +'<circle cx="60" cy="31" r="8" fill="none" stroke="'+line+'" stroke-width=".4"/>'
      +'<line x1="53" y1="4.5" x2="67" y2="4.5" stroke="'+line+'" stroke-width=".7"/>'
      +'<path d="M14,1 L14,12 A46,33 0 0 0 106,12 L106,1" fill="none" stroke="'+line+'" stroke-width=".4"/>'
      +'</svg>'
      +'<svg class="chm-lines" viewBox="0 0 100 100" preserveAspectRatio="none">'+lines+'</svg>'
      +nodes+'</div>';
  }
  // roster players who aren't in the starting five, by minutes
  function benchOf(rows, starters){
    var startSet={}; starters.forEach(function(s){ if(s.p) startSet[s.p.name]=1; });
    return (rows||[]).filter(function(p){ return p&&p.name&&!startSet[p.name]&&num(p,'mpg')>=1; })
      .sort(function(a,b){return num(b,'mpg')-num(a,'mpg');}).slice(0,6);
  }
  function benchHtml(bench, opts){
    if(!bench||!bench.length) return '';
    var showPhoto=(global.tdcShowPhotos&&global.tdcShowPhotos());
    var chips=bench.map(function(p){
      var _gv=dispGrade(p), g=isNaN(_gv)?'':_gv, photo=(showPhoto&&p.espn_id)?('https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/'+p.espn_id+'.png'):'';
      var pos=((p.position||'')+'').toUpperCase().split(/[\/, ]/)[0]||'';
      return '<div class="chm-bench-chip"><div class="chm-bava'+(photo?'':' noimg')+'">'+(photo?'<img src="'+photo+'" alt="" loading="lazy" onerror="this.parentNode.classList.add(\'noimg\');this.remove();">':'<span>'+esc(initials(p.name))+'</span>')+'</div>'
        +'<div class="chm-bc-txt"><div class="chm-bc-nm">'+esc(firstLast(p.name))+'</div><div class="chm-bc-sub">'+pos+(pos?' · ':'')+num(p,'mpg').toFixed(0)+' mpg</div></div>'
        +'<div class="chm-bc-ovr" style="color:'+ovrCol(g)+'">'+(g||'—')+'</div></div>';
    }).join('');
    return '<div class="chm-bench"><div class="chm-bench-h">Bench</div><div class="chm-bench-row">'+chips+'</div></div>';
  }
  function coachHtml(coach){
    if(!coach||!coach.name) return '';
    return '<div class="chm-coachbar"><div class="chm-coachbar-l">Head Coach</div>'
      +'<div class="chm-coachbar-n">'+esc(coach.name)+'</div>'
      +(coach.archetype?'<div class="chm-coachbar-a">'+esc(coach.archetype)+(coach.pace?' &middot; '+Math.round(coach.pace)+' poss/gm':'')+'</div>':'')
      +'</div>';
  }
  // the highest-value five the roster can field — talent + fit, from the top rotation
  function bestLineup(rows){
    var R=(rows||[]).filter(function(p){ return p&&num(p,'mpg')>=1&&p.name&&!isNaN(parseFloat(p.tdc_grade)); });
    if(R.length<5) return null;
    R.sort(function(a,b){return num(b,'mpg')-num(a,'mpg');});
    var pool=R.slice(0,9), best=null;
    var pick=function(arr,k,start,cur,cb){ if(cur.length===k){cb(cur);return;} for(var i=start;i<arr.length;i++){cur.push(arr[i]);pick(arr,k,i+1,cur,cb);cur.pop();} };
    pick(pool,5,0,[],function(five){
      var sum=0,cnt=0; for(var i=0;i<5;i++)for(var j=i+1;j<5;j++){sum+=pairSynergy(five[i],five[j]).score;cnt++;}
      var syn=sum/cnt, rating=five.reduce(function(t,p){var gg=dispGrade(p);return t+(isNaN(gg)?0:gg);},0)/5, score=rating*0.6+syn*0.4;
      if(!best||score>best.score) best={five:five.slice(),syn:Math.round(syn),rating:Math.round(rating),score:score};
    });
    return best;
  }

  // ── team-vs-team matchup factor ──────────────────────────────────────────────
  function matchup(anA, anB){
    if(!anA||!anB) return null;
    var dims=Object.keys(anA.dims);
    var rows=dims.map(function(k){
      var a=anA.dims[k], b=anB.dims[k], diff=a-b;
      return {k:k, a:a, b:b, diff:diff, edge:Math.abs(diff)<8?0:(diff>0?'A':'B'), mag:Math.abs(diff)};
    });
    var winsA=rows.filter(function(r){return r.edge==='A';}).length;
    var winsB=rows.filter(function(r){return r.edge==='B';}).length;
    // matchup power = talent (rating) + fit (synergy) + how many battles you win
    var powerA=(anA.rating||70)*0.62 + anA.overall*0.28 + winsA*2.0;
    var powerB=(anB.rating||70)*0.62 + anB.overall*0.28 + winsB*2.0;
    var spread=Math.round((powerA-powerB)*1.15*10)/10;   // projected points, lineup-only read
    var favA=spread>=0;
    // 0-100 tug-of-war: team A's share of the bar (>50 when A is stronger)
    var factor=Math.round(50+Math.max(-38,Math.min(38, spread*2.1)));
    var edges=rows.slice().sort(function(x,y){return y.mag-x.mag;}).filter(function(r){return r.edge;}).slice(0,4);
    var verdict;
    var m=Math.abs(spread);
    if(m<1.5) verdict='Coin-flip matchup';
    else if(m<5) verdict='Slight edge';
    else if(m<10) verdict='Clear edge';
    else verdict='Mismatch';
    return {rows:rows, winsA:winsA, winsB:winsB, spread:spread, favA:favA, factor:factor, edges:edges, verdict:verdict, powerA:powerA, powerB:powerB};
  }

  function matchupHtml(mu, anA, anB, o, sA, sB){
    if(!mu) return '<div style="color:var(--text3);font-size:12px;padding:8px;">Not enough data for a matchup read.</div>';
    var nA=o.nameA||'Team A', nB=o.nameB||'Team B', cA=o.colorA||'var(--accent)', cB=o.colorB||'#e0864a';
    var favName=mu.favA?nA:nB, favCol=mu.favA?cA:cB, spread=Math.abs(mu.spread);
    var aShare=mu.factor;   // factor is team A's share of the tug-of-war (higher when A is stronger)
    // per-dimension diverging bars
    var dimRow=function(r){
      var aw=r.a, bw=r.b, tot=Math.max(1,aw+bw);
      var ap=Math.round(aw/tot*100), bp=100-ap;
      var aWin=r.edge==='A', bWin=r.edge==='B';
      return '<div class="mu-dim">'
        +'<div class="mu-dim-v" style="text-align:right;color:'+(aWin?cA:'var(--text3)')+';font-weight:'+(aWin?800:600)+';">'+aw+'</div>'
        +'<div class="mu-dim-mid">'
          +'<div class="mu-dim-lbl">'+r.k+'</div>'
          +'<div class="mu-bar"><span class="mu-bar-a" style="width:'+(ap/2)+'%;background:'+cA+';opacity:'+(aWin?1:.5)+';"></span><span class="mu-bar-b" style="width:'+(bp/2)+'%;background:'+cB+';opacity:'+(bWin?1:.5)+';"></span></div>'
        +'</div>'
        +'<div class="mu-dim-v" style="color:'+(bWin?cB:'var(--text3)')+';font-weight:'+(bWin?800:600)+';">'+bw+'</div>'
        +'</div>';
    };
    var edgeSent=function(r){
      var team=r.edge==='A'?nA:nB, col=r.edge==='A'?cA:cB, phr={
        Scoring:'puts more points on the floor', Spacing:'stretches the defense far wider',
        Playmaking:'controls the game with better playmaking', Rebounding:'owns the glass',
        'Perimeter D':'is far tougher on the perimeter', 'Rim Protect':'walls off the rim'
      }[r.k]||('wins '+r.k);
      return '<div class="mu-edge"><span class="mu-edge-dot" style="background:'+col+';"></span><b style="color:'+col+';">'+esc(team)+'</b> '+phr+' <span class="mu-edge-gap">(+'+r.mag+')</span></div>';
    };
    return '<div class="mu-card">'
      +'<div class="mu-head">'
        +'<div class="mu-team" style="text-align:right;"><div class="mu-team-n" style="color:'+cA+';">'+esc(nA)+'</div><div class="mu-team-s">OVR '+(anA.rating||'—')+' &middot; Syn '+anA.overall+'</div></div>'
        +'<div class="mu-vs">VS</div>'
        +'<div class="mu-team"><div class="mu-team-n" style="color:'+cB+';">'+esc(nB)+'</div><div class="mu-team-s">OVR '+(anB.rating||'—')+' &middot; Syn '+anB.overall+'</div></div>'
      +'</div>'
      +'<div class="mu-factor"><span class="mu-fill-a" style="width:'+aShare+'%;background:'+cA+';"></span><span class="mu-fill-b" style="width:'+(100-aShare)+'%;background:'+cB+';"></span>'
        +'<span class="mu-fav" style="left:'+(mu.favA?'8px':'auto')+';right:'+(mu.favA?'auto':'8px')+';">'+aShare+' / '+(100-aShare)+'</span></div>'
      +'<div class="mu-verdict"><b style="color:'+favCol+';">'+esc(favName)+'</b> '+mu.verdict.toLowerCase()+' &mdash; projected <b>'+(spread>0?spread.toFixed(1):'0.0')+'</b> pts. Wins <b>'+(mu.favA?mu.winsA:mu.winsB)+'</b> of 6 lineup battles.</div>'
      +'<div class="mu-dims">'+mu.rows.map(dimRow).join('')+'</div>'
      +positionSection(sA,sB,nA,nB,cA,cB)
      +'<div class="mu-edges-h">Key mismatches</div>'
      +'<div class="mu-edges">'+(mu.edges.length?mu.edges.map(edgeSent).join(''):'<div class="mu-edge" style="color:var(--text3);">Evenly matched across the board.</div>')+'</div>'
      +'</div>';
  }
  function positionSection(sA, sB, nA, nB, cA, cB){
    if(!sA||!sB) return '';
    var pm=positionMatchup(sA,sB);
    var rows=pm.map(function(r){
      var aWin=r.edge==='A', bWin=r.edge==='B';
      var an=r.a?firstLast(r.a.name):'—', bn=r.b?firstLast(r.b.name):'—';
      return '<div class="mu-pos">'
        +'<div class="mu-pos-side'+(aWin?' win':'')+'" style="text-align:right;">'
          +'<span class="mu-pos-nm">'+esc(an)+'</span>'
          +'<span class="mu-pos-g" style="color:'+(aWin?cA:'var(--text3)')+'">'+(r.ga||'—')+'</span></div>'
        +'<div class="mu-pos-l">'+r.pos+'</div>'
        +'<div class="mu-pos-side'+(bWin?' win':'')+'">'
          +'<span class="mu-pos-g" style="color:'+(bWin?cB:'var(--text3)')+'">'+(r.gb||'—')+'</span>'
          +'<span class="mu-pos-nm">'+esc(bn)+'</span></div>'
        +'</div>';
    }).join('');
    var aw=pm.filter(function(r){return r.edge==='A';}).length, bw=pm.filter(function(r){return r.edge==='B';}).length;
    var note = aw>bw?('<b style="color:'+cA+';">'+esc(nA)+'</b> wins '+aw+' of 5 individual matchups.')
      : bw>aw?('<b style="color:'+cB+';">'+esc(nB)+'</b> wins '+bw+' of 5 individual matchups.')
      : 'The five spots split evenly ('+aw+'–'+bw+').';
    return '<div class="mu-pos-h">Position Matchups</div><div class="mu-pos-wrap">'+rows+'</div><div class="mu-pos-note">'+note+'</div>';
  }

  // signature original-TDC metrics strip (Look Quality / SM+ / Creation / Net eff)
  function statsHtml(s){
    if(!s) return '';
    var tile=function(lbl,val,pct,fmt){ if(val==null||isNaN(val)) return '';
      var bar=pct!=null?'<div class="chm-st-bar"><span style="width:'+Math.max(2,Math.min(100,Math.round(pct)))+'%;background:'+(pct>=66?'#5ab875':pct>=40?'var(--accent)':'var(--text3)')+';"></span></div>':'';
      return '<div class="chm-st"><div class="chm-st-v">'+fmt(val)+'</div><div class="chm-st-l">'+lbl+'</div>'+bar+(pct!=null?'<div class="chm-st-p">'+Math.round(pct)+'th pctile</div>':'')+'</div>';
    };
    var body=[ tile('Look Quality',s.lq,s.lqPct,function(v){return v.toFixed(1)+'%';}),
      tile('Shot-Making',s.sm,s.smPct,function(v){return (v>0?'+':'')+v.toFixed(1);}),
      tile('Creation',s.cr,s.crPct,function(v){return v.toFixed(1);}),
      tile('Net Eff',s.net,null,function(v){return (v>0?'+':'')+v.toFixed(1);}) ].filter(Boolean).join('');
    if(!body) return '';
    return '<div class="chm-stats"><div class="chm-stats-h">Signature Metrics <span>· original TDC stats, 2025-26</span></div><div class="chm-stats-row">'+body+'</div></div>';
  }
  // position-by-position read for a team-vs-team matchup
  function positionMatchup(sA, sB){
    var byPos=function(s,pos){ for(var i=0;i<s.length;i++) if(s[i].pos===pos&&s[i].p) return s[i].p; return null; };
    return ['PG','SG','SF','PF','C'].map(function(pos){
      var a=byPos(sA,pos), b=byPos(sB,pos);
      var ga=a?(parseFloat(a.tdc_grade)||0):0, gb=b?(parseFloat(b.tdc_grade)||0):0, diff=ga-gb;
      return {pos:pos, a:a, b:b, ga:ga, gb:gb, diff:diff, edge:Math.abs(diff)<2?0:(diff>0?'A':'B'), mag:Math.abs(diff)};
    });
  }

  function css(){
    if(document.getElementById('chm-css')) return;
    var st=document.createElement('style'); st.id='chm-css';
    st.textContent=
      ".chm-wrap{display:grid;grid-template-columns:230px 1fr;gap:20px;align-items:start;background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:18px;}"
      +"@media(max-width:720px){.chm-wrap{grid-template-columns:1fr;}}"
      +".chm-panel{background:rgba(0,0,0,.14);border:1px solid var(--border);border-radius:14px;padding:16px;}"
      +".chm-h{font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:12px;}"
      +".chm-rr{display:grid;grid-template-columns:1fr 1fr;gap:10px;}"
      +".chm-rc{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:10px 6px;text-align:center;}"
      +".chm-big{font-family:'Playfair Display',serif;font-weight:800;font-size:30px;line-height:1;}"
      +".chm-lbl{font-size:8.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-top:4px;}"
      +".chm-word{text-align:center;font-size:14px;font-weight:800;margin:11px 0 13px;}"
      +".chm-dim{margin-bottom:8px;}"
      +".chm-dim-top{display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:3px;}.chm-dim-top b{color:var(--text);}"
      +".chm-dim-bar{height:5px;border-radius:3px;background:var(--bg3,rgba(128,128,128,.2));overflow:hidden;}.chm-dim-bar span{display:block;height:100%;border-radius:3px;}"
      +".chm-note{font-size:11px;color:var(--text2);margin-top:9px;}"
      +".chm-duos{margin-top:12px;padding-top:11px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:7px;}"
      +".chm-duo{display:flex;align-items:center;gap:7px;font-size:11px;}"
      +".chm-duo-l{font-weight:800;font-size:8.5px;letter-spacing:.06em;text-transform:uppercase;flex:0 0 52px;}"
      +".chm-duo-n{color:var(--text2);flex:1;line-height:1.15;}"
      +".chm-duo-s{font-family:'Playfair Display',serif;font-weight:800;font-size:14px;}"
      +".chm-coach{margin-top:12px;padding-top:11px;border-top:1px solid var(--border);}"
      +".chm-coach-l{font-size:8.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);}"
      +".chm-coach-n{font-size:13px;font-weight:800;color:var(--text);margin-top:2px;}"
      +".chm-coach-a{font-size:10.5px;color:var(--accent);font-weight:600;margin-top:1px;}"
      +".chm-court{position:relative;width:100%;aspect-ratio:3/2;border-radius:14px;overflow:hidden;border:1px solid var(--border);background:radial-gradient(120% 90% at 50% 0%,#14203a 0%,#0c1424 55%,#090e1a 100%);}"
      +".chm-lines,.chm-court-bg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}.chm-court-bg{opacity:.9;}"
      +".chm-main{min-width:0;}"
      +".chm-node{position:absolute;transform:translate(-50%,-50%);text-align:center;width:118px;z-index:2;}"
      +".chm-ava{width:64px;height:64px;border-radius:50%;margin:0 auto;background:linear-gradient(160deg,#1c2b46,#0e1626);border:2px solid var(--border2);display:flex;align-items:center;justify-content:center;position:relative;box-shadow:0 4px 14px rgba(0,0,0,.55);}"
      +".chm-ava.noimg{background:linear-gradient(160deg,#25355400,#141d30);background:linear-gradient(160deg,#243350,#141d30);}"
      +".chm-ava img{width:100%;height:100%;object-fit:cover;object-position:top center;border-radius:50%;}"
      +".chm-init{font-size:20px;font-weight:800;color:var(--text2);}"
      +".chm-pos{position:absolute;bottom:-4px;right:-2px;font-size:8.5px;font-weight:800;color:#fff;background:rgba(8,12,22,.92);border:1px solid var(--border2);border-radius:6px;padding:1px 5px;}"
      +".chm-nm{font-size:11.5px;font-weight:700;color:var(--text);margin-top:7px;line-height:1.15;text-shadow:0 1px 4px rgba(0,0,0,.9);}"
      +".chm-ovr{font-family:'Playfair Display',serif;font-weight:800;font-size:15px;line-height:1;margin-top:1px;text-shadow:0 1px 3px rgba(0,0,0,.85);}"
      // best-lineup insight (panel)
      +".chm-best{margin-top:12px;padding-top:11px;border-top:1px solid var(--border);}"
      +".chm-best-h{font-size:8.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px;}"
      +".chm-best-tag{font-family:'Playfair Display',serif;font-size:11px;font-weight:700;color:var(--text2);letter-spacing:0;text-transform:none;}"
      +".chm-best-note{font-size:11px;color:var(--text2);line-height:1.4;}"
      // coach bar under the court
      +".chm-coachbar{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:12px;padding:11px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;}"
      +".chm-coachbar-l{font-size:8.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);}"
      +".chm-coachbar-n{font-size:14px;font-weight:800;color:var(--text);}"
      +".chm-coachbar-a{font-size:11px;color:var(--accent);font-weight:600;}"
      // bench strip
      +".chm-bench{margin-top:14px;}"
      +".chm-bench-h{font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;}"
      +".chm-bench-row{display:flex;flex-wrap:wrap;gap:8px;}"
      +".chm-bench-chip{display:flex;align-items:center;gap:8px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:5px 11px 5px 5px;}"
      +".chm-bava{width:32px;height:32px;border-radius:50%;overflow:hidden;background:var(--bg3,rgba(128,128,128,.2));border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;flex:0 0 auto;}"
      +".chm-bava img{width:100%;height:100%;object-fit:cover;object-position:top center;}"
      +".chm-bava span{font-size:11px;font-weight:800;color:var(--text3);}"
      +".chm-bc-nm{font-size:12px;font-weight:700;color:var(--text);line-height:1.1;}"
      +".chm-bc-sub{font-size:9.5px;color:var(--text3);font-weight:600;margin-top:1px;}"
      +".chm-bc-ovr{font-family:'Playfair Display',serif;font-weight:800;font-size:15px;margin-left:2px;}"
      // signature-metrics strip
      +".chm-stats{margin-top:14px;}"
      +".chm-stats-h{font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;}"
      +".chm-stats-h span{font-weight:600;letter-spacing:.02em;text-transform:none;opacity:.6;}"
      +".chm-stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}"
      +"@media(max-width:520px){.chm-stats-row{grid-template-columns:repeat(2,1fr);}}"
      +".chm-st{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:9px 10px;}"
      +".chm-st-v{font-family:'Playfair Display',serif;font-weight:800;font-size:18px;line-height:1;}"
      +".chm-st-l{font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);margin-top:3px;}"
      +".chm-st-bar{height:4px;border-radius:2px;background:var(--bg3,rgba(128,128,128,.2));overflow:hidden;margin-top:6px;}.chm-st-bar span{display:block;height:100%;border-radius:2px;}"
      +".chm-st-p{font-size:8.5px;color:var(--text3);font-weight:600;margin-top:3px;}"
      // position matchups (matchup card)
      +".mu-pos-h{font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin:4px 0 8px;}"
      +".mu-pos-wrap{display:flex;flex-direction:column;gap:5px;margin-bottom:9px;}"
      +".mu-pos{display:grid;grid-template-columns:1fr 34px 1fr;align-items:center;gap:8px;}"
      +".mu-pos-side{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text3);}"
      +".mu-pos-side:last-child{justify-content:flex-start;}.mu-pos-side:first-child{justify-content:flex-end;}"
      +".mu-pos-side.win{color:var(--text);}"
      +".mu-pos-nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}"
      +".mu-pos-g{font-family:'Playfair Display',serif;font-weight:800;font-size:14px;flex:0 0 auto;}"
      +".mu-pos-l{font-size:9.5px;font-weight:800;letter-spacing:.04em;color:var(--text3);text-align:center;background:var(--bg3,rgba(128,128,128,.18));border-radius:5px;padding:2px 0;}"
      +".mu-pos-note{font-size:11.5px;color:var(--text2);text-align:center;margin-bottom:14px;}"
      // matchup card
      +".mu-card{background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:18px 20px;}"
      +".mu-head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;margin-bottom:14px;}"
      +".mu-team-n{font-size:16px;font-weight:800;line-height:1.1;}"
      +".mu-team-s{font-size:10.5px;color:var(--text3);font-weight:600;margin-top:2px;}"
      +".mu-vs{font-family:'Playfair Display',serif;font-weight:800;font-size:15px;color:var(--text3);}"
      +".mu-factor{position:relative;height:22px;border-radius:11px;overflow:hidden;display:flex;margin-bottom:12px;background:var(--bg3,rgba(128,128,128,.2));}"
      +".mu-fill-a,.mu-fill-b{height:100%;}.mu-fill-a{border-radius:11px 0 0 11px;}.mu-fill-b{border-radius:0 11px 11px 0;opacity:.85;}"
      +".mu-fav{position:absolute;top:50%;transform:translateY(-50%);font-size:11px;font-weight:800;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.6);}"
      +".mu-verdict{font-size:12.5px;color:var(--text2);text-align:center;margin-bottom:16px;line-height:1.4;}"
      +".mu-dims{display:flex;flex-direction:column;gap:9px;margin-bottom:16px;}"
      +".mu-dim{display:grid;grid-template-columns:34px 1fr 34px;align-items:center;gap:8px;}"
      +".mu-dim-v{font-size:13px;}"
      +".mu-dim-mid{}"
      +".mu-dim-lbl{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);text-align:center;margin-bottom:3px;}"
      +".mu-bar{display:flex;justify-content:center;height:6px;}"
      +".mu-bar-a{height:100%;border-radius:3px 0 0 3px;align-self:stretch;}.mu-bar-b{height:100%;border-radius:0 3px 3px 0;}"
      +".mu-edges-h{font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:8px;}"
      +".mu-edges{display:flex;flex-direction:column;gap:6px;}"
      +".mu-edge{font-size:12px;color:var(--text2);display:flex;align-items:center;gap:7px;line-height:1.35;}"
      +".mu-edge-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;}"
      +".mu-edge-gap{color:var(--text3);font-size:11px;}";
    document.head.appendChild(st);
  }

  function render(el, rows, opts){
    if(!el) return null;
    css(); opts=opts||{};
    var starters=assignStarters(rows);
    var an=lineupAnalysis(starters);
    if(!an){ el.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px;">Not enough roster data for a chemistry read.</div>'; return null; }
    var bench=benchOf(rows, starters), best=bestLineup(rows);
    var main='<div class="chm-main">'+courtHtml(starters,opts)+statsHtml(opts.stats)+coachHtml(opts.coach)+benchHtml(bench,opts)+'</div>';
    el.innerHTML='<div class="chm-wrap">'+panelHtml(an,opts,best)+main+'</div>';
    return an;
  }

  // renderMatchup(el, rowsA, rowsB, {nameA,nameB,colorA,colorB}) → team-vs-team card
  function renderMatchup(el, rowsA, rowsB, opts){
    if(!el) return null;
    css(); opts=opts||{};
    var sA=assignStarters(rowsA), sB=assignStarters(rowsB);
    var anA=lineupAnalysis(sA), anB=lineupAnalysis(sB);
    if(!anA||!anB){ el.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px;">Not enough roster data on both sides for a matchup.</div>'; return null; }
    var mu=matchup(anA,anB);
    el.innerHTML=matchupHtml(mu,anA,anB,opts,sA,sB);
    return mu;
  }

  global.TDCChem={ pairSynergy:pairSynergy, lineupAnalysis:lineupAnalysis, assignStarters:assignStarters, courtPos:courtPos, synCol:synCol, ovrCol:ovrCol, panelHtml:panelHtml, courtHtml:courtHtml, matchup:matchup, matchupHtml:matchupHtml, render:render, renderMatchup:renderMatchup };
})(typeof window!=='undefined'?window:this);
