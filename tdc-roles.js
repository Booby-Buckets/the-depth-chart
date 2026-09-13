/* tdc-roles.js — Role & Fit for ONE player, as a shared module.
   Renders a single player's role card (archetype + modifiers, the six style signals,
   year-over-year development path with the projected node, shot profile, game-scoring
   distribution, and "how to attack him") into any host — the in-page Coach's Tier tab on
   player.html. Same logic as roles.html's per-player card, minus the team-wide fit read.

   TDC_ROLES.renderPlayer(host, ctx)
     ctx – { espn_id, name, position, cls, tc, raw:{...roster row}, pj:{projected line}, proj:OVR }
   CSS scoped under .tdcr. Shots go through tdcH() when present (Coach's-Tier entitlement). */
window.TDC_ROLES = (function(){
  const SB_URL='https://izlqhnxowdhtdofkwrho.supabase.co';
  const KEY='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
  const H={'apikey':KEY,'Authorization':'Bearer '+KEY};
  const SH=()=>(window.tdcH?window.tdcH():H);
  const esc=s=>(''+(s==null?'':s)).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);
  const num=v=>{const n=parseFloat(v);return isNaN(n)?0:n;};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lvl=(v,lo,hi)=>clamp((v-lo)/(hi-lo)*100,0,100);
  const F=(v,d)=>v==null||isNaN(v)?'—':(+v).toFixed(d==null?1:d);
  const CLS={FR:'Fr',SO:'So',JR:'Jr',SR:'Sr','GR':'Gr'};

  function signals(a){
    return [
      ['Usage', lvl(num(a.usg_pct),8,32), num(a.usg_pct).toFixed(0)+'%'],
      ['Playmaking', lvl(num(a.ast_pct),4,28), num(a.ast_pct).toFixed(0)+'%'],
      ['Spacing', lvl(num(a.fg3a_per_fga_pct),0.05,0.62), Math.round(num(a.fg3a_per_fga_pct)*100)+'% 3PA'],
      ['Rebounding', lvl(num(a.trb_pct),3,22), num(a.trb_pct).toFixed(0)+'%'],
      ['Rim protection', lvl(num(a.blk_pct),0.2,7), num(a.blk_pct).toFixed(1)+'%'],
      ['Disruption', lvl(num(a.stl_pct),0.6,4), num(a.stl_pct).toFixed(1)+'%'],
    ];
  }
  function archetype(a,pos){
    pos=(pos||'').toUpperCase();
    const usg=num(a.usg_pct),ast=num(a.ast_pct),trb=num(a.trb_pct),blk=num(a.blk_pct),stl=num(a.stl_pct),three=num(a.fg3a_per_fga_pct),ts=num(a.ts_pct);
    const guard=/G/.test(pos)&&!/F/.test(pos), big=(/C|PF/.test(pos))||(blk>=4||trb>=15);
    let label;
    if(big){ label = blk>=4.5&&three<0.28 ? 'Rim-protecting anchor' : three>=0.4 ? 'Stretch big' : ast>=15 ? 'Playmaking big' : trb>=16 ? 'Interior force' : 'Finishing big'; }
    else if(ast>=22 && usg>=23) label='Lead creator';
    else if(ast>=19) label='Pass-first guard';
    else if(usg>=26 && three>=0.4) label='Scoring guard';
    else if(three>=0.5 && usg<20) label='Floor spacer';
    else if(usg>=24) label='Primary scorer';
    else if(three>=0.36 && stl>=1.8) label='3&amp;D wing';
    else if(three>=0.36) label='Movement shooter';
    else if(/F|SF/.test(pos)) label='Slashing wing';
    else label='Complementary guard';
    const mods=[];
    if(stl>=3) mods.push('disruptive defender');
    if(blk>=3&&!big) mods.push('shot-blocking wing');
    if(ts>=0.60&&usg>=15) mods.push('highly efficient');
    else if(ts>0&&ts<0.50&&usg>=18) mods.push('inefficient volume');
    if(three>=0.5) mods.push('high-volume shooter');
    else if(three<0.12&&!big) mods.push('non-shooter');
    if(usg>=29) mods.push('ball-dominant');
    if(trb>=13&&guard) mods.push('rebounds his position well');
    return {label,mods};
  }
  function trendOf(seasons, proj){
    if(!seasons.length) return ['New arrival','b-new'];
    if(seasons.length===1) return ['Emerging','b-new'];
    const first=seasons[0].g, last=seasons[seasons.length-1].g;
    let maxJump=-99; for(let i=1;i<seasons.length;i++) maxJump=Math.max(maxJump,seasons[i].g-seasons[i-1].g);
    const d=last-first;
    if(maxJump>=7) return ['Breakout','b-break'];
    if(d>=8) return ['Ascending','b-asc'];
    if(d>=3) return ['Improving','b-imp'];
    if(d<=-4) return ['Declining','b-decl'];
    return ['Steady','b-steady'];
  }
  const arrHtml=delta=>{ const d=Math.round(delta); const cls=d>=2?'up':d<=-2?'dn':'fl'; const gl=d>=2?'↗':d<=-2?'↘':'→';
    return `<div class="arr"><div class="d ${cls}">${d>0?'+':''}${d}</div><div class="ln ${cls}">${gl}</div></div>`; };
  const nodeHtml=(yr,cls,g,ppg,proj)=>`<div class="node${proj?' proj':''}"><div class="yr">${esc(yr)}${cls?' · '+esc(cls):''}</div><div class="gv">${g}</div>${ppg!=null?`<div class="pp">${(+ppg).toFixed(1)} ppg</div>`:(proj?'<div class="pp">proj</div>':'')}</div>`;
  const R=v=>{const n=+v;return isNaN(n)?0:n;};
  const p40=(g,k)=>{let m=0,v=0;g.forEach(x=>{m+=R(x.min);v+=R(x[k]);});return m?v/m*40:0;};
  function zones(sh){
    let rimA=0,rimM=0,midA=0,midM=0,thrA=0,thrM=0;
    sh.forEach(s=>{ const three=s.sv===3, rim=(s.stype==='layup'||s.stype==='dunk'||s.stype==='tip');
      if(three){ thrA++; if(s.made) thrM++; } else if(rim){ rimA++; if(s.made) rimM++; } else { midA++; if(s.made) midM++; } });
    const tot=rimA+midA+thrA; if(!tot) return null;
    const z=(a,m,mult)=>({a, fg:a?m/a*100:0, efg:a?m*(mult||1)/a*100:0, freq:a/tot*100});
    return {rim:z(rimA,rimM,1), mid:z(midA,midM,1), three:z(thrA,thrM,1.5), total:tot};
  }
  function consistency(bx){
    const pts=bx.map(x=>R(x.pts)); if(pts.length<6) return null;
    const mean=pts.reduce((a,b)=>a+b,0)/pts.length;
    const sd=Math.sqrt(pts.reduce((a,b)=>a+(b-mean)*(b-mean),0)/pts.length);
    const s=[...pts].sort((a,b)=>a-b), q=f=>s[Math.min(s.length-1,Math.floor(s.length*f))];
    return {mean, cv:mean>3?sd/mean:0, floor:q(0.15), ceil:q(0.85)};
  }
  function intel(p, bx, sh, T, dnaByOpp){
    const pos=(p.position||p.position2||'').toUpperCase(), isBig=/[CF]/.test(pos)&&!/G/.test(pos);
    const guard=[], attack=[];
    const Z=zones(sh);
    if(Z&&Z.total>=25){
      const zs=[['at the rim',Z.rim],['from mid-range',Z.mid],['from three',Z.three]];
      guard.push(['Shot diet',`${Math.round(Z.rim.freq)}% rim (${Math.round(Z.rim.fg)}%) · ${Math.round(Z.mid.freq)}% mid (${Math.round(Z.mid.fg)}%) · ${Math.round(Z.three.freq)}% three (${Math.round(Z.three.fg)}%)`]);
      const primary=zs.slice().sort((a,b)=>b[1].freq-a[1].freq)[0];
      if(primary&&primary[1].freq>=45){
        const rd=primary[0]==='at the rim'?'Wall off the paint — make him finish over length.'
               :primary[0]==='from three'?'Run him off the line, no help off him.'
               :'Crowd the pull-up and funnel him into help.';
        guard.push(['Take away his money zone',`${Math.round(primary[1].freq)}% of his shots come ${primary[0]} at ${Math.round(primary[1].fg)}%. ${rd}`]);
      }
      const vol=zs.filter(z=>z[1].freq>=15).sort((a,b)=>a[1].efg-b[1].efg)[0];
      if(vol&&vol[1].efg<=44&&vol!==primary) guard.push(['Force him here',`Just ${Math.round(vol[1].efg)}% eFG ${vol[0]} — steer him into it.`]);
    }
    if(bx.length>=6){
      const hav=bx.filter(x=>{const d=dnaByOpp(x.opp);return d&&d.dTOV!=null&&d.dTOV>=T.havoc;}), low=bx.filter(x=>{const d=dnaByOpp(x.opp);return d&&d.dTOV!=null&&d.dTOV<=T.low;});
      if(hav.length>=4&&low.length>=4){ const dd=p40(hav,'tov')-p40(low,'tov');
        if(dd>=1.5) guard.push(['Pressure-vulnerable',`+${dd.toFixed(1)} turnovers/40 vs ball-pressure defenses — get into him early.`]);
        else if(dd<=-0.6) guard.push(['Handles pressure',`Steady vs havoc (${dd.toFixed(1)} TO/40) — a press won't rattle him.`]);
      }
      const c=consistency(bx);
      if(c){
        if(c.cv>=0.55) guard.push(['Boom-or-bust',`Streaky — floor ${c.floor} / ceiling ${c.ceil} pts (avg ${c.mean.toFixed(1)}). Knock him off rhythm early.`]);
        else if(c.cv<=0.32&&c.mean>=10) guard.push(['Metronome',`Steady ${c.mean.toFixed(1)} a night (floor ${c.floor}/ceiling ${c.ceil}) — no easy nights.`]);
      }
      let fta=0,ftm=0,pf=0,mn=0; bx.forEach(x=>{fta+=R(x.fta);ftm+=R(x.ftm);pf+=R(x.pf);mn+=R(x.min);});
      const ftp=fta?ftm/fta*100:null, pf40=mn?pf/mn*40:0;
      if(ftp!=null&&ftp<=64&&fta>=15) guard.push(['Foul him late',`${Math.round(ftp)}% from the line on ${fta} attempts.`]);
      if(pf40>=4.2) attack.push(['Foul-prone',`${pf40.toFixed(1)} fouls/40 — hunt him in ball screens to get him in trouble.`]);
    }
    const mpg=R(p.mpg), blk40=mpg?R(p.blk)/mpg*40:0, stl40=mpg?R(p.stl)/mpg*40:0;
    if(mpg>=8){
      if(isBig){
        if(blk40>=1.6) attack.push(['Rim protector',`${blk40.toFixed(1)} blocks/40 — attack away from him; finish through, not into, him.`]);
        else if(blk40<=0.5) attack.push(['No rim deterrent',`Only ${blk40.toFixed(1)} blocks/40 for a big — go right at him.`]);
      }
      if(stl40>=2.0) attack.push(['Gambler',`${stl40.toFixed(1)} steals/40 — he jumps lanes; back-cut and attack the gaps.`]);
    }
    return {guard, attack};
  }

  function ensureCss(){
    if(document.getElementById('tdcr-css')) return;
    const s=document.createElement('style'); s.id='tdcr-css';
    s.textContent=`
.tdcr{font-family:'Inter',system-ui,sans-serif;}
.tdcr .rc{border:1px solid var(--border);border-radius:13px;background:var(--bg2);padding:16px 18px;}
.tdcr .rc-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:4px;flex-wrap:wrap;}
.tdcr .rc-head{display:flex;align-items:center;gap:14px;margin-bottom:10px;}
.tdcr .rc-ovr{font-family:'Sora','Inter',sans-serif;font-weight:800;font-size:30px;line-height:1;color:var(--tc-readable,var(--accent));min-width:44px;text-align:center;flex-shrink:0;}
.tdcr .rc-ovr small{display:block;font-family:'Inter',sans-serif;font-size:8px;font-weight:800;letter-spacing:.08em;color:var(--text3);margin-top:2px;}
.tdcr .rc-who{flex:1;min-width:0;}
.tdcr .rc-line{font-size:11.5px;color:var(--text3);font-variant-numeric:tabular-nums;margin-top:3px;}
.tdcr .rc-line b{color:var(--text2);}
.tdcr .rc-nm{font-weight:800;font-size:16px;color:var(--text);}
.tdcr .rc-nm .pos{font-size:10px;font-weight:700;color:var(--tc-readable,var(--accent));margin-left:7px;}
.tdcr .rc-arch{font-family:'Sora','Inter',sans-serif;font-weight:800;font-size:15px;color:var(--tc-readable,var(--accent));}
.tdcr .nohist{font-size:11.5px;color:var(--text3);font-style:italic;}
.tdcr .rc-mods{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}
.tdcr .mod{font-size:10px;font-weight:700;color:var(--text2);background:var(--bg3);border-radius:20px;padding:3px 9px;}
.tdcr .sigs{display:grid;grid-template-columns:repeat(3,1fr);gap:11px 18px;}
@media(max-width:640px){.tdcr .sigs{grid-template-columns:repeat(2,1fr);}}
.tdcr .sig .st{display:flex;justify-content:space-between;font-size:10.5px;font-weight:700;color:var(--text3);margin-bottom:3px;}
.tdcr .sig .st b{color:var(--text2);font-variant-numeric:tabular-nums;}
.tdcr .sig .sbar{height:6px;border-radius:4px;background:var(--bg3);overflow:hidden;}
.tdcr .sig .sf{height:100%;border-radius:4px;background:var(--tc,var(--accent));}
.tdcr .rc-dev{margin-top:13px;padding-top:12px;border-top:1px solid var(--border);}
.tdcr .rc-dev-h{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px;}
.tdcr .rc-dev-l{font-size:9.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);}
.tdcr .tbadge{font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:3px 9px;border-radius:20px;white-space:nowrap;}
.tdcr .b-asc{color:var(--green);background:color-mix(in srgb,var(--green) 15%,transparent);}
.tdcr .b-break{color:var(--green);background:color-mix(in srgb,var(--green) 22%,transparent);}
.tdcr .b-imp{color:var(--green);background:color-mix(in srgb,var(--green) 10%,transparent);}
.tdcr .b-steady{color:var(--text2);background:var(--bg3);}
.tdcr .b-decl{color:var(--red);background:color-mix(in srgb,var(--red) 14%,transparent);}
.tdcr .b-new{color:#c8963e;background:color-mix(in srgb,#c8963e 16%,transparent);}
.tdcr .path{display:flex;align-items:center;gap:2px;flex-wrap:wrap;}
.tdcr .node{text-align:center;min-width:48px;}
.tdcr .node .yr{font-size:8.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);}
.tdcr .node .gv{font-family:'Sora','Inter',sans-serif;font-weight:800;font-size:19px;line-height:1;margin-top:2px;color:var(--text);}
.tdcr .node .pp{font-size:9px;color:var(--text3);margin-top:1px;font-variant-numeric:tabular-nums;}
.tdcr .node.proj .gv{color:var(--tc-readable,var(--accent));}
.tdcr .node.proj{border:1px dashed var(--border2);border-radius:9px;padding:4px 5px;}
.tdcr .arr{display:flex;flex-direction:column;align-items:center;padding:0 1px;min-width:34px;}
.tdcr .arr .d{font-size:10px;font-weight:800;font-variant-numeric:tabular-nums;}
.tdcr .arr .ln{font-size:12px;line-height:1;}
.tdcr .arr .up{color:var(--green);} .tdcr .arr .dn{color:var(--red);} .tdcr .arr .fl{color:var(--text3);}
.tdcr .rc-atk{margin-top:13px;padding-top:12px;border-top:1px solid var(--border);}
.tdcr .ex-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px 22px;}
@media(max-width:640px){.tdcr .ex-cols{grid-template-columns:1fr;}}
.tdcr .ex-h{font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid var(--border);}
.tdcr .ex-h.guard{color:var(--red);} .tdcr .ex-h.attack{color:var(--green);}
.tdcr .ex-row{font-size:11.5px;color:var(--text2);line-height:1.5;margin-bottom:8px;}
.tdcr .ex-row:last-child{margin-bottom:0;}
.tdcr .ex-row b{color:var(--text);font-weight:800;}
.tdcr .muted{font-size:12.5px;color:var(--text3);padding:14px 16px;border:1px dashed var(--border);border-radius:10px;}
.tdcr .loading{padding:26px;text-align:center;color:var(--text3);font-size:13px;}`;
    document.head.appendChild(s);
  }

  async function renderPlayer(host, ctx){
    ensureCss();
    host.classList.add('tdcr');
    host.innerHTML='<div class="loading">Reading his role…</div>';
    const raw=ctx.raw||{}, pj=ctx.pj||null, tc=ctx.tc||'var(--accent)', eid=ctx.espn_id;
    if(!eid){ host.innerHTML='<div class="muted">No D-I track record on file yet — his role reads once he has a season of D-I data.</div>'; return; }

    // advanced (2026), owned career seasons, box + shot logs, and the league's havoc thresholds
    let adv=null, hist=[], box=[], shots=[], DNA=null;
    try{ [adv,hist,box,shots,DNA]=await Promise.all([
      fetch(`${SB_URL}/rest/v1/player_advanced?espn_id=eq.${eid}&season_year=eq.2026&select=espn_id,ti40,ts_pct,usg_pct,ast_pct,tov_pct,orb_pct,drb_pct,trb_pct,stl_pct,blk_pct,min,g&limit=1`,{headers:H}).then(r=>r.ok?r.json():[]).then(a=>a[0]||null),
      (window.TDCOwnedSeasons?TDCOwnedSeasons.byEspn([eid],'asc').catch(()=>[]):Promise.resolve([])),
      fetch(`${SB_URL}/rest/v1/box_scores?espn_id=eq.${eid}&season_year=eq.2026&min=gte.4&select=opp,min,fga,fgm,tpa,tpm,fta,ftm,tov,pts,pf&limit=400`,{headers:H}).then(r=>r.ok?r.json():[]),
      fetch(`${SB_URL}/rest/v1/shots?espn_id=eq.${eid}&season_year=eq.2026&select=made,sv,stype&limit=4000`,{headers:SH()}).then(r=>r.ok?r.json():[]).catch(()=>[]),
      fetch('scripts/data/team_dna.json',{cache:'no-cache'}).then(r=>r.ok?r.json():null).catch(()=>null)
    ]); }catch(e){}
    box=box||[]; shots=shots||[]; hist=hist||[];
    // 3PA rate isn't in player_advanced — derive it from his box log so Spacing / shooter archetypes read
    if(adv){ let fga=0,tpa=0; box.forEach(b=>{fga+=R(b.fga);tpa+=R(b.tpa);}); adv.fg3a_per_fga_pct=fga?tpa/fga:0; }
    const dteams=(DNA&&DNA['2026']&&DNA['2026'].teams)||{};
    const dcol=k=>Object.values(dteams).map(t=>t[k]).filter(x=>x!=null).sort((a,b)=>a-b), qf=(v,f)=>v.length?v[Math.floor(v.length*f)]:0;
    const T={havoc:qf(dcol('dTOV'),2/3),low:qf(dcol('dTOV'),1/3)}, dnaByOpp=o=>dteams[o];

    // owned career grade path (box-adjusted when the rating engine is on the page)
    if(window.TDCRating && TDCRating.ready){ try{ await TDCRating.ready; }catch(e){} }
    const boxGrade=h=>{
      if(!window.TDCRating || !TDCRating.boxAdjust || h.tdc_grade==null) return Math.round(+h.tdc_grade);
      const g=h.per40||{}, n=v=>{const f=parseFloat(v);return isFinite(f)?f:null;}, pct=v=>{const f=parseFloat(v);return isFinite(f)?f*100:null;};
      const line={ position:h.pos, height:h.height, team:h.school, mpg:40, ppg:n(g.pts_per_min), apg:n(g.ast_per_min), tovs:n(g.tov_per_min), stl:n(g.stl_per_min), blk:n(g.blk_per_min), tpa:n(g.fg3a_per_min), fga:n(g.fga_per_min), fta:n(g.fta_per_min), oreb:n(g.orb_per_min), dreb:n(g.drb_per_min), rpg:n(g.trb_per_min), fg_pct:pct(g.fg_pct), tp_pct:pct(g.fg3_pct) };
      try{ const a=TDCRating.boxAdjust(h.tdc_grade,{position:h.pos,height:h.height},line,parseInt(h.season_year)||0); if(a&&a.grade!=null) return Math.round(a.grade); }catch(e){}
      return Math.round(+h.tdc_grade);
    };
    const seasons=hist.filter(h=>h.tdc_grade!=null).map(h=>{ const pg=h.pergame||{}; return {yr:+h.season_year, cls:CLS[(h.class||'').toUpperCase()]||h.class||'', g:boxGrade(h), ppg:(pg.pts_per_g!=null?+pg.pts_per_g:null)}; }).sort((x,y)=>x.yr-y.yr);

    const proj=(ctx.proj!=null&&!isNaN(+ctx.proj))?Math.round(+ctx.proj):((pj&&pj.tdc_grade!=null)?Math.round(+pj.tdc_grade):(raw.tdc_grade!=null?Math.round(+raw.tdc_grade):null));
    const p={name:ctx.name, pos:ctx.position||raw.position||'', mpg:+raw.mpg||0, position:raw.position, position2:raw.position2, blk:raw.blk, stl:raw.stl};
    const hasHist=!!adv;
    const arch=hasHist?archetype(adv,p.pos):null;
    const atk=intel(p, box, shots, T, dnaByOpp);
    const Z=zones(shots), gpts=box.map(x=>R(x.pts)), cons=consistency(box);
    const l=(pj&&(+pj.mpg>0))?pj:raw;

    const sig=s=>`<div class="sig"><div class="st"><span>${s[0]}</span><b>${s[2]}</b></div><div class="sbar"><div class="sf" style="width:${s[1].toFixed(0)}%"></div></div></div>`;
    const zoneColor=efg=>efg>=54?'var(--green)':efg>=46?'var(--tc,var(--accent))':'var(--red)';
    const shotProfileHtml=Z=>{
      if(!Z||Z.total<25) return '';
      const rows=[['Rim',Z.rim],['Mid',Z.mid],['Three',Z.three]].map(([lbl,z])=>
        `<div style="display:flex;align-items:center;gap:8px;margin:5px 0;font-size:10.5px;"><span style="width:38px;color:var(--text3);font-weight:700;">${lbl}</span><div style="flex:1;height:9px;background:var(--bg3);border-radius:5px;overflow:hidden;"><div style="width:${Math.round(z.freq)}%;height:100%;background:${zoneColor(z.efg)};"></div></div><span style="width:82px;text-align:right;color:var(--text2);font-variant-numeric:tabular-nums;">${Math.round(z.freq)}% · ${Math.round(z.fg)}% FG</span></div>`).join('');
      return `<div class="rc-dev"><div class="rc-dev-l" style="margin-bottom:7px;">Shot profile <span style="color:var(--text3);font-weight:600;text-transform:none;letter-spacing:0;">· ${Z.total} FGA · bar = share, color = efficiency</span></div>${rows}</div>`;
    };
    const distHtml=(pts,c)=>{
      if(!pts||pts.length<6) return '';
      const BINS=[[0,4],[5,9],[10,14],[15,19],[20,24],[25,29],[30,99]];
      const cnt=BINS.map(([lo,hi])=>pts.filter(v=>v>=lo&&v<=hi).length), mx=Math.max(1,...cnt);
      const bars=cnt.map((n,i)=>`<div title="${BINS[i][0]}${BINS[i][1]>=99?'+':'-'+BINS[i][1]} pts: ${n} game${n===1?'':'s'}" style="flex:1;height:${Math.max(4,Math.round(n/mx*100))}%;background:var(--tc,var(--accent));opacity:${n?.85:.15};border-radius:2px 2px 0 0;"></div>`).join('');
      const foot=c?`<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3);margin-top:4px;font-variant-numeric:tabular-nums;"><span>floor ${c.floor}</span><span>avg ${c.mean.toFixed(1)}</span><span>ceiling ${c.ceil}</span></div>`:'';
      return `<div class="rc-dev"><div class="rc-dev-l" style="margin-bottom:7px;">Game scoring distribution <span style="color:var(--text3);font-weight:600;text-transform:none;letter-spacing:0;">· ${pts.length} games (0 → 30+ pts)</span></div><div style="display:flex;align-items:flex-end;gap:3px;height:46px;">${bars}</div>${foot}</div>`;
    };

    const lineHtml=`<div class="rc-line"><b>${F(l.ppg)}</b> pts · <b>${F(l.rpg)}</b> reb · <b>${F(l.apg)}</b> ast · ${F(l.mpg,0)} min · ${F(l.fg_pct,0)}/${F(l.tp_pct,0)}/${F(l.ft_pct,0)}</div>`;
    const tag=hasHist?`<div class="rc-arch">${arch.label}</div>`:`<div class="nohist">no D-I track record yet</div>`;
    const head=`<div class="rc-head"><div class="rc-ovr">${proj!=null?proj:'—'}<small>OVR</small></div><div class="rc-who"><div class="rc-top"><div class="rc-nm">${esc(p.name)}<span class="pos">${esc(p.pos||'')}</span></div>${tag}</div>${lineHtml}</div></div>`;
    const body=hasHist?`${arch.mods.length?`<div class="rc-mods">${arch.mods.map(m=>`<span class="mod">${esc(m)}</span>`).join('')}</div>`:''}<div class="sigs">${signals(adv).map(sig).join('')}</div>`:'';
    const [tl,tc2]=trendOf(seasons,proj); let path='';
    seasons.forEach((s,i)=>{ if(i>0) path+=arrHtml(s.g-seasons[i-1].g); path+=nodeHtml("'"+String(s.yr%100).padStart(2,'0'),s.cls,s.g,s.ppg,false); });
    if(proj!=null){ if(seasons.length) path+=arrHtml(proj-seasons[seasons.length-1].g); path+=nodeHtml("'27",'',proj,null,true); }
    const devHtml=path?`<div class="rc-dev"><div class="rc-dev-h"><span class="rc-dev-l">Development</span><span class="tbadge ${tc2}">${tl}</span></div><div class="path">${path}</div></div>`:'';
    const gd=atk.guard||[], at=atk.attack||[];
    const exCol=(kind,arr)=>arr.length?`<div><div class="ex-h ${kind}">${kind==='guard'?'Guard his offense':'Attack his defense'}</div>${arr.map(x=>`<div class="ex-row"><b>${esc(x[0])}</b> — ${esc(x[1])}</div>`).join('')}</div>`:'';
    const atkHtml=(gd.length||at.length)?`<div class="rc-atk"><div class="rc-dev-l" style="margin-bottom:9px;">How to attack him</div><div class="ex-cols">${exCol('guard',gd)}${exCol('attack',at)}</div></div>`:'';
    const profHtml=hasHist?(shotProfileHtml(Z)+distHtml(gpts,cons)):'';
    host.innerHTML=`<div class="rc" style="--tc:${tc}">${head}${body}${devHtml}${profHtml}${atkHtml}</div>`;
    if(window.TDCAnim&&TDCAnim.scan) TDCAnim.scan(host);
  }
  return { renderPlayer };
})();
