/* tdc-dossier.js — the Player Dossier renderer, as a shared module.
   Renders the complete coach's file on ONE player into any host element, so it can live
   as an in-page tab on player.html (the Coach's Tier "On this player" group) and still
   power the standalone dossier.html. Sheet-formatted throughout (tdc-sheets.css).

   TDC_DOSSIER.render(host, ctx)
     host  – element to render into
     ctx   – { espn_id, name, position, cls, teamFull, tc,
               last:{ppg,rpg,apg,mpg,fg_pct,tp_pct,ft_pct,tdc_grade},   // last season (roster row)
               pl:{ppg,rpg,apg,mpg,fg_pct,tp_pct,ft_pct,_fresh},        // projected 2026-27 line
               ovr }                                                    // projected OVR
   All CSS is scoped under .tdcd (injected once). Reads via the public anon key; shots
   go through tdcH() when present so the Coach's-Tier entitlement applies. */
window.TDC_DOSSIER = (function(){
  const SB_URL='https://izlqhnxowdhtdofkwrho.supabase.co';
  const KEY='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
  const H={'apikey':KEY,'Authorization':'Bearer '+KEY};
  const SH=()=>(window.tdcH?window.tdcH():H);
  const esc=s=>(''+(s==null?'':s)).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);
  const R=v=>{const n=+v;return isNaN(n)?0:n;};
  const F=(v,d)=>v==null?'—':(+v).toFixed(d==null?1:d);

  let DNA26=null, T=null, SRSRANK=null;
  async function ensureDna(){
    if(DNA26) return;
    let all={}; try{ all=await fetch('scripts/data/team_dna.json',{cache:'no-cache'}).then(r=>r.ok?r.json():{}); }catch(e){}
    DNA26=(all['2026']&&all['2026'].teams)||{};
    const col=k=>Object.values(DNA26).map(t=>t[k]).filter(x=>x!=null).sort((a,b)=>a-b);
    const q=(v,f)=>v.length?v[Math.floor(v.length*f)]:0;
    const tempo=col('tempo'),drtg=col('DRtg'),dtov=col('dTOV'),defg=col('deFG');
    T={tempoFast:q(tempo,2/3),tempoSlow:q(tempo,1/3),drtgElite:q(drtg,1/3),drtgPorous:q(drtg,2/3),havoc:q(dtov,2/3),low:q(dtov,1/3),stingy:q(defg,1/3)};
  }
  async function ensureSrs(){ if(SRSRANK) return; SRSRANK={};
    try{ const ts=await fetch(`${SB_URL}/rest/v1/team_seasons?season_year=eq.2026&srs=not.is.null&select=team,srs&limit=1000`,{headers:H}).then(r=>r.ok?r.json():[]);
      const S={}; (ts||[]).forEach(t=>{S[t.team]=+t.srs;}); Object.keys(S).sort((a,b)=>S[b]-S[a]).forEach((t,i)=>{SRSRANK[t]=i+1;});
    }catch(e){} }
  const ARCH=[
    {key:'elite', nm:'Elite defenses',  desc:'top-third D efficiency', test:d=>d.DRtg!=null&&d.DRtg<=T.drtgElite},
    {key:'porous',nm:'Porous defenses', desc:'bottom-third D',         test:d=>d.DRtg!=null&&d.DRtg>=T.drtgPorous},
    {key:'havoc', nm:'Ball-pressure',   desc:'forces TOs',             test:d=>d.dTOV!=null&&d.dTOV>=T.havoc},
    {key:'stingy',nm:'Stingy shot D',   desc:'contests shots',         test:d=>d.deFG!=null&&d.deFG<=T.stingy},
    {key:'fast',  nm:'Uptempo',         desc:'fast opponents',         test:d=>d.tempo!=null&&d.tempo>=T.tempoFast},
    {key:'grind', nm:'Grind-it-out',    desc:'slow opponents',         test:d=>d.tempo!=null&&d.tempo<=T.tempoSlow},
  ];
  function bAgg(g){ let m=0,fga=0,fgm=0,tpm=0,fta=0,tov=0,pts=0; g.forEach(x=>{m+=R(x.min);fga+=R(x.fga);fgm+=R(x.fgm);tpm+=R(x.tpm);fta+=R(x.fta);tov+=R(x.tov);pts+=R(x.pts);});
    return {n:g.length,min:m,efg:fga?(fgm+0.5*tpm)/fga*100:null,ts:2*(fga+0.44*fta)?pts/(2*(fga+0.44*fta))*100:null,to40:m?tov/m*40:null,pts40:m?pts/m*40:null}; }
  const efgSh=arr=>{ if(!arr.length) return null; let mw=0; arr.forEach(s=>{ if(s.made) mw+=(s.sv===3?1.5:1); }); return mw/arr.length*100; };
  const isClutch=s=> s.period!=null&&s.period>=2&&s.sec_left!=null&&s.sec_left<=300&&s.home_score!=null&&Math.abs(R(s.home_score)-R(s.away_score))<=5;
  const zoneOf=s=> s.sv===3?'three':(s.stype==='layup'||s.stype==='dunk'||s.stype==='tip')?'rim':'mid';
  const confDot=n=> n>=14?['var(--green)','Solid']:n>=7?['var(--amber)','Moderate']:['var(--red)','Thin'];

  function ensureCss(){
    if(document.getElementById('tdcd-css')) return;
    const s=document.createElement('style'); s.id='tdcd-css';
    s.textContent=`
.tdcd{font-family:'Inter',system-ui,sans-serif;}
.tdcd .dh{display:flex;align-items:flex-start;gap:18px;border:1px solid var(--border2);border-radius:14px;background:radial-gradient(120% 130% at 0 0,color-mix(in srgb,var(--tc,var(--accent)) 8%,var(--bg2)),var(--bg2));padding:18px 20px;flex-wrap:wrap;}
.tdcd .dh .ovr{text-align:center;flex-shrink:0;}
.tdcd .dh .ovr .ov{font-family:'Sora','Inter',sans-serif;font-weight:800;font-size:44px;line-height:1;color:var(--tc-readable,var(--accent));}
.tdcd .dh .ovr .ol{font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin-top:3px;}
.tdcd .dh .who{flex:1;min-width:200px;}
.tdcd .dh .who .pn{font-family:'Sora','Inter',sans-serif;font-weight:800;font-size:24px;color:var(--text);}
.tdcd .dh .who .pm{font-size:12.5px;color:var(--text3);font-weight:600;margin:3px 0 10px;}
.tdcd .dh .who .arch{display:inline-block;font-size:11px;font-weight:800;color:var(--tc-readable,var(--accent));background:color-mix(in srgb,var(--tc,var(--accent)) 12%,transparent);padding:4px 11px;border-radius:20px;}
.tdcd .sec-h{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);margin:24px 0 12px;display:flex;align-items:center;gap:10px;}
.tdcd .sec-h .hint{font-weight:600;letter-spacing:0;text-transform:none;color:var(--text3);font-size:11px;}
.tdcd .sec-h::after{content:'';flex:1;height:1px;background:var(--border);}
.tdcd .sheet-wrap{max-height:none;box-shadow:none;}
.tdcd .sheet{width:100%;}
.tdcd .sheet td.v,.tdcd .sheet td.proj{font-weight:800;color:var(--text);}
.tdcd .sheet tr.last td{color:var(--text3);}
.tdcd .idg{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
@media(max-width:640px){.tdcd .idg{grid-template-columns:1fr;}}
.tdcd .idcard{border:1px solid var(--border);border-radius:12px;background:var(--bg2);overflow:hidden;}
.tdcd .idcard .ih{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:12px 15px 9px;}
.tdcd .idcard .inm{font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);}
.tdcd .idcard .isc{font-family:'Sora','Inter',sans-serif;font-weight:800;font-size:19px;}
.tdcd .idcard .isc small{font-size:11px;font-weight:800;margin-left:4px;}
.tdcd .idcard.g .isc{color:var(--green);} .tdcd .idcard.r .isc{color:var(--red);} .tdcd .idcard.a .isc{color:var(--amber);} .tdcd .idcard.n .isc{color:var(--text2);}
.tdcd .idcard .sheet-wrap{margin:0;border-left:none;border-right:none;border-radius:0;border-bottom:none;}
.tdcd .idcard .sheet tbody td{padding:6px 12px;}
.tdcd .sp2{display:grid;grid-template-columns:1fr 84px 84px;gap:0;padding:0;border-top:1px solid var(--border);font-size:12.5px;align-items:stretch;}
.tdcd .sp2 > *{padding:6px 12px;border-right:1px solid var(--border);display:flex;align-items:center;}
.tdcd .sp2 > *:last-child{border-right:none;}
.tdcd .sp2 .spl{color:var(--text);font-weight:650;flex-direction:column;align-items:flex-start;justify-content:center;}
.tdcd .sp2 .spl small{color:var(--text3);font-weight:500;display:block;font-size:10px;}
.tdcd .sp2 .a,.tdcd .sp2 .b{justify-content:flex-end;font-weight:800;font-size:13px;font-variant-numeric:tabular-nums;color:var(--text);}
.tdcd .sp2:nth-child(even):not(.hd) > *{background:color-mix(in srgb,var(--text) 3.5%,transparent);}
.tdcd .sp2.hd{border-top:none;border-bottom:2px solid var(--border2);}
.tdcd .sp2.hd > *{background:var(--bg2);color:var(--text3);font-size:10px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;padding:8px 12px;}
.tdcd .idr{font-size:12px;color:var(--text2);line-height:1.6;padding:11px 15px;border-top:1px solid var(--border);background:color-mix(in srgb,var(--tc,var(--accent)) 4%,var(--bg2));}
.tdcd .idr b{color:var(--text);}
.tdcd .arch-tb{border:1px solid var(--border);border-radius:12px;background:var(--bg2);overflow:hidden;}
.tdcd .arow{display:grid;grid-template-columns:1.4fr 1fr 60px;gap:12px;align-items:center;padding:9px 15px;border-top:1px solid var(--border);}
.tdcd .arow:first-child{border-top:none;}
.tdcd .arow .an{font-size:12.5px;font-weight:700;color:var(--text);}
.tdcd .arow .an small{display:block;font-size:10px;color:var(--text3);font-weight:600;}
.tdcd .arow .abar{height:8px;border-radius:4px;background:var(--bg3);position:relative;overflow:hidden;}
.tdcd .arow .abar .f{position:absolute;top:0;bottom:0;border-radius:4px;}
.tdcd .arow .ats{text-align:right;font-family:'Sora','Inter',sans-serif;font-weight:800;font-size:15px;}
.tdcd .zones{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}
@media(max-width:560px){.tdcd .zones{grid-template-columns:1fr;}}
.tdcd .zc{border:1px solid var(--border);border-radius:12px;background:var(--bg2);padding:13px 15px;}
.tdcd .zc .zn{font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);}
.tdcd .zc .zf{font-family:'Sora','Inter',sans-serif;font-weight:800;font-size:22px;margin-top:3px;color:var(--text);}
.tdcd .zc .zd{font-size:11px;color:var(--text3);margin-top:4px;line-height:1.5;}
.tdcd .note{font-size:11px;color:var(--text3);line-height:1.6;margin-top:22px;max-width:800px;}
.tdcd .conf{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--text3);border:1px solid var(--border);border-radius:20px;padding:3px 10px;margin-left:8px;}
.tdcd .conf .dot{width:7px;height:7px;border-radius:50%;}
.tdcd .muted{font-size:12.5px;color:var(--text3);padding:14px 16px;border:1px dashed var(--border);border-radius:10px;}
.tdcd .loading{padding:26px;text-align:center;color:var(--text3);font-size:13px;}`;
    document.head.appendChild(s);
  }

  async function render(host, ctx){
    ensureCss();
    host.classList.add('tdcd');
    host.innerHTML='<div class="loading">Building the file…</div>';
    const p=ctx.last||{}, pl=ctx.pl||{}, ovr=ctx.ovr, tc=ctx.tc||'var(--accent)', teamFull=ctx.teamFull||'';
    if(!ctx.espn_id){ host.innerHTML='<div class="muted">No game history on file for this player yet.</div>'; return; }
    await ensureDna();
    let log=[], shots=[];
    try{ [log,shots]=await Promise.all([
      fetch(`${SB_URL}/rest/v1/box_scores?espn_id=eq.${ctx.espn_id}&season_year=eq.2026&select=game_id,team,opp,date,min,fga,fgm,tpm,fta,tov,pts,pf&order=date`,{headers:H}).then(r=>r.ok?r.json():[]),
      fetch(`${SB_URL}/rest/v1/shots?espn_id=eq.${ctx.espn_id}&season_year=eq.2026&select=made,sv,stype,period,sec_left,home_score,away_score,ast_name,team_id`,{headers:SH()}).then(r=>r.ok?r.json():[])
    ]); }catch(e){}
    log=(log||[]).filter(g=>R(g.min)>0); shots=shots||[];

    // ── header + projected line ──
    const head=`<div class="dh" style="--tc:${tc}">
      <div class="ovr"><div class="ov">${ovr!=null?ovr:'—'}</div><div class="ol">Proj OVR '27</div></div>
      <div class="who"><div class="pn">${esc(ctx.name)}</div><div class="pm">${esc(ctx.position||'')} · ${esc(ctx.cls||'')} · ${esc(teamFull)}</div>${p.tdc_grade?`<span class="arch">'25-26 grade ${R(p.tdc_grade)}</span>`:''}</div></div>`;
    let projHtml='';
    if(!pl._fresh && R(pl.mpg)>0){
      const dlt=(a,b,dec)=>{ if(a==null||b==null||isNaN(a)||isNaN(b)) return ''; const d=+(a-b).toFixed(dec==null?1:dec); if(!d) return '<span class="dim"> ±0</span>'; return `<span style="color:${d>0?'var(--green)':'var(--red)'};font-size:10.5px;font-weight:700;"> ${d>0?'+':''}${d}</span>`; };
      projHtml=`<div class="sec-h">Projected 2026-27 line <span class="hint">last season → projected</span></div>
        <div class="sheet-wrap"><table class="sheet">
          <thead><tr><th class="l">Per game</th><th>PPG</th><th>RPG</th><th>APG</th><th>MPG</th><th>FG%</th><th>3P%</th><th>FT%</th></tr></thead>
          <tbody>
            <tr><td class="l nm">Projected</td><td class="proj">${F(pl.ppg)}${dlt(pl.ppg,R(p.ppg))}</td><td class="proj">${F(pl.rpg)}${dlt(pl.rpg,R(p.rpg))}</td><td class="proj">${F(pl.apg)}${dlt(pl.apg,R(p.apg))}</td><td class="proj">${F(pl.mpg,0)}${dlt(pl.mpg,R(p.mpg),0)}</td><td class="proj">${F(pl.fg_pct,0)}${dlt(pl.fg_pct,R(p.fg_pct),0)}</td><td class="proj">${F(pl.tp_pct,0)}${dlt(pl.tp_pct,R(p.tp_pct),0)}</td><td class="proj">${F(pl.ft_pct,0)}${dlt(pl.ft_pct,R(p.ft_pct),0)}</td></tr>
            <tr class="last"><td class="l dim">Last year</td><td>${F(p.ppg)}</td><td>${F(p.rpg)}</td><td>${F(p.apg)}</td><td>${F(p.mpg,0)}</td><td>${F(p.fg_pct,0)}</td><td>${F(p.tp_pct,0)}</td><td>${F(p.ft_pct,0)}</td></tr>
          </tbody></table></div>`;
    } else {
      projHtml=`<div class="sec-h">Projected 2026-27 line</div><div class="muted">Incoming freshman / no D-I sample — projection carried by grade (OVR ${ovr!=null?ovr:'—'}); situational splits below need game history.</div>`;
    }

    if(log.length<8){ host.innerHTML=`<div style="--tc:${tc}">${head}${projHtml}<div class="sec-h">Situational profile</div><div class="muted">Only ${log.length} games of 2025-26 history — not enough to break out his situational splits yet.</div></div>`; return; }

    const dnaG=g=>DNA26[g.opp]; const base=bAgg(log);
    const fast=log.filter(g=>{const d=dnaG(g);return d&&d.tempo!=null&&d.tempo>=T.tempoFast;});
    const slow=log.filter(g=>{const d=dnaG(g);return d&&d.tempo!=null&&d.tempo<=T.tempoSlow;});
    const hav=log.filter(g=>{const d=dnaG(g);return d&&d.dTOV!=null&&d.dTOV>=T.havoc;});
    const lowD=log.filter(g=>{const d=dnaG(g);return d&&d.dTOV!=null&&d.dTOV<=T.low;});

    function splitCard(nm, aLab, bLab, rows, score, read){
      const body=rows.map(r=>`<tr><td class="l nm">${r.l}${r.s?`<span class="dim" style="font-weight:500;margin-left:5px;">${r.s}</span>`:''}</td><td class="v">${r.a}</td><td class="v">${r.b}</td></tr>`).join('');
      return `<div class="idcard ${score.cls}"><div class="ih"><div class="inm">${nm}</div><div class="isc">${score.v}<small>${score.lab}</small></div></div>
        <div class="sheet-wrap"><table class="sheet"><thead><tr><th class="l">Split</th><th>${aLab}</th><th>${bLab}</th></tr></thead><tbody>${body}</tbody></table></div>
        <div class="idr">${read}</div></div>`;
    }
    let cards=[];
    if(fast.length>=4&&slow.length>=4){ const Fa=bAgg(fast),Sl=bAgg(slow); const d=Math.round(Fa.efg-Sl.efg),a=Math.abs(d);
      cards.push(splitCard('Pace Sensitivity','Fast','Slow',
        [{l:'eFG%',a:F(Fa.efg,0),b:F(Sl.efg,0)},{l:'Pts',s:'per 40',a:F(Fa.pts40,0),b:F(Sl.pts40,0)},{l:'TO',s:'per 40',a:F(Fa.to40),b:F(Sl.to40)},{l:'Games',a:Fa.n,b:Sl.n}],
        {v:(d>0?'+':'')+d,lab:a<3?'Neutral':a<6?'Mod':'Extreme',cls:a<3?'g':a<6?'a':'r'},
        d<=-6?`His shot needs a controlled game — <b>${a} eFG points</b> lower against uptempo opponents. Speeding him up is a weapon.`:d>=6?`He <b>thrives</b> in a track meet — eFG <b>+${d}</b> against the fastest teams.`:`Tempo barely moves his shot.`));
    }
    if(hav.length>=4&&lowD.length>=4){ const Hv=bAgg(hav),Lo=bAgg(lowD); const d=+(Hv.to40-Lo.to40).toFixed(1);
      cards.push(splitCard('Pressure Vulnerability','Havoc','Low',
        [{l:'TO',s:'per 40',a:F(Hv.to40),b:F(Lo.to40)},{l:'eFG%',a:F(Hv.efg,0),b:F(Lo.efg,0)},{l:'Games',a:Hv.n,b:Lo.n}],
        {v:(d>0?'+':'')+d,lab:d>=2?'High':d>=1?'Mod':d<=-0.5?'Proof':'Low',cls:d>=2?'r':d>=1?'a':'g'},
        d>=1.5?`Ball pressure gets to him — <b>+${d} TO/40</b> against havoc defenses. Full-court press him.`:d<=-0.5?`Unbothered by pressure — protects it just as well against havoc.`:`Handles ball pressure without coughing it up.`));
    }
    const idg=cards.length?`<div class="sec-h">Situational identifiers <span class="hint">his 2025-26 splits — the real numbers</span></div><div class="idg">${cards.join('')}</div>`:'';

    // clutch (needs team shots)
    let clutchHtml='';
    const shClock=shots.filter(s=>s.sec_left!=null), myClutch=shClock.filter(isClutch), myRest=shClock.filter(s=>!isClutch(s));
    if(myClutch.length>=6){
      const tid=(shots.find(s=>s.team_id!=null)||{}).team_id; let tm=[];
      if(tid!=null){ try{ tm=await fetch(`${SB_URL}/rest/v1/shots?team_id=eq.${tid}&season_year=eq.2026&select=sec_left,home_score,away_score,period,made,sv&limit=8000`,{headers:SH()}).then(r=>r.ok?r.json():[]); }catch(e){} }
      const tmC=tm.filter(s=>s.sec_left!=null), tCl=tmC.filter(isClutch), tRe=tmC.filter(s=>!isClutch(s));
      const shCl=tCl.length?myClutch.length/tCl.length*100:null, shRe=tRe.length?myRest.length/tRe.length*100:null;
      const efgCl=efgSh(myClutch),efgRe=efgSh(myRest), uD=(shCl!=null&&shRe!=null)?shCl-shRe:0, eD=(efgCl!=null&&efgRe!=null)?efgCl-efgRe:0;
      const role=uD>=6?(eD>=-4?{lab:'Closer',cls:'g'}:{lab:'Heat-check',cls:'a'}):uD<=-6?{lab:'Defers',cls:'n'}:{lab:'Steady',cls:'n'};
      clutchHtml=`<div class="sec-h">Clutch <span class="hint">last 5:00 · within 5 · ${myClutch.length} shots</span></div>
        <div class="idg"><div class="idcard ${role.cls}"><div class="ih"><div class="inm">Clutch Role</div><div class="isc">${role.lab}</div></div>
          <div class="sp2 hd"><div class="spl"></div><div class="a">Clutch</div><div class="b">Rest</div></div>
          <div class="sp2"><div class="spl">Shot load<small>% of team FGA</small></div><div class="a">${shCl==null?'—':Math.round(shCl)+'%'}</div><div class="b">${shRe==null?'—':Math.round(shRe)+'%'}</div></div>
          <div class="sp2"><div class="spl">eFG%</div><div class="a">${F(efgCl,0)}</div><div class="b">${F(efgRe,0)}</div></div>
          <div class="idr">${role.lab==='Closer'?`Wants the ball late — his share of the team's shots <b>rises ${Math.round(uD)} pts</b> in the clutch and he keeps his efficiency.`:role.lab==='Heat-check'?`Takes over late (<b>+${Math.round(uD)}</b> pts of shot share) but his eFG drops <b>${Math.abs(Math.round(eD))}</b> — the volume is there, the quality slips.`:role.lab==='Defers'?`Steps back in crunch time — shot share drops <b>${Math.abs(Math.round(uD))}</b> pts. Someone else is the closer.`:`His role holds steady late; no clutch surge or fade.`}</div>
        </div></div>`;
    }

    // matchup archetypes
    const buckets=ARCH.map(a=>{const g=log.filter(x=>{const d=dnaG(x);return d&&a.test(d);}); return {a,n:g.length,ts:g.length?bAgg(g).ts:null};}).filter(b=>b.n>=4&&b.ts!=null).sort((x,y)=>y.ts-x.ts);
    let archHtml='';
    if(buckets.length>=2){
      archHtml=`<div class="sec-h">Matchup advantage <span class="hint">TS% by opponent archetype · baseline ${F(base.ts,0)}</span></div><div class="arch-tb">`
        +buckets.map(b=>{ const d=b.ts-base.ts, w=Math.min(Math.abs(d),15)/15*100, pos=d>=0;
          return `<div class="arow"><div class="an">${b.a.nm}<small>${b.a.desc} · ${b.n} gm</small></div>
            <div class="abar"><div class="f" style="${pos?`left:50%;width:${w/2}%;background:var(--green)`:`right:50%;width:${w/2}%;background:var(--red)`}"></div></div>
            <div class="ats" style="color:${pos?'var(--green)':'var(--red)'}">${F(b.ts,0)}</div></div>`; }).join('')+`</div>`;
    }

    // shot zones
    let zoneHtml=''; const zsh=shots.filter(s=>s.stype);
    if(zsh.length>=25){ const Z={rim:{a:0,m:0},mid:{a:0,m:0},three:{a:0,m:0}}; zsh.forEach(s=>{const z=zoneOf(s);Z[z].a++;if(s.made)Z[z].m++;}); const tot=zsh.length;
      const zc=(k,lab)=>{ const z=Z[k],fg=z.a?z.m/z.a*100:0,freq=tot?z.a/tot*100:0; return `<div class="zc"><div class="zn">${lab}</div><div class="zf">${Math.round(freq)}%</div><div class="zd">of his shots · <b style="color:var(--text2)">${Math.round(fg)}%</b> ${k==='three'?'3P':'FG'} · ${z.a} att</div></div>`; };
      zoneHtml=`<div class="sec-h">Where he scores <span class="hint">shot diet · ${tot} shots</span></div><div class="zones">${zc('rim','At the rim')}${zc('mid','Mid-range')}${zc('three','Three')}</div>`;
    }

    // who he does it against: opponent quality / venue / close games
    let splitsHtml=''; await ensureSrs();
    const gids=[...new Set(log.map(g=>g.game_id).filter(Boolean))];
    let gRows=[]; if(gids.length){ try{ gRows=await fetch(`${SB_URL}/rest/v1/games?id=in.(${gids.join(',')})&select=id,home,away,home_score,away_score,neutral,conf_game`,{headers:H}).then(r=>r.ok?r.json():[]); }catch(e){} }
    const gById={}; gRows.forEach(g=>{gById[g.id]=g;});
    const sAgg=gs=>{ if(!gs.length) return null; let pts=0,fgm=0,fga=0,tpm=0; gs.forEach(g=>{pts+=R(g.pts);fgm+=R(g.fgm);fga+=R(g.fga);tpm+=R(g.tpm);}); return {n:gs.length,ppg:pts/gs.length,efg:fga?(fgm+0.5*tpm)/fga*100:null}; };
    const G=log.map(b=>{ const g=gById[b.game_id]; if(!g) return null; const home=g.home===b.team, oppName=home?g.away:g.home;
      const my=home?R(g.home_score):R(g.away_score), opp=home?R(g.away_score):R(g.home_score);
      return {pts:R(b.pts),fgm:R(b.fgm),fga:R(b.fga),tpm:R(b.tpm),venue:g.neutral?'N':(home?'H':'A'),oppRank:(SRSRANK[oppName]!=null?SRSRANK[oppName]:999),close:Math.abs(my-opp)<=5,conf:!!g.conf_game}; }).filter(Boolean);
    if(G.length>=6){
      const q1=G.filter(g=>g.oppRank<=50), q2=G.filter(g=>g.oppRank>50&&g.oppRank<=150), q3=G.filter(g=>g.oppRank>150);
      const srow=(lab,gs)=>{ const a=sAgg(gs); return a?`<div class="sp2"><div class="spl">${lab}</div><div class="a">${F(a.ppg)}</div><div class="b">${a.n}</div></div>`:''; };
      const card=(title,rows)=>rows?`<div class="idcard n"><div class="ih"><div class="inm">${title}</div></div><div class="sp2 hd"><div class="spl"></div><div class="a">PPG</div><div class="b">Gms</div></div>${rows}</div>`:'';
      const qCard=card('By opponent quality', srow('vs Top-50',q1)+srow('vs 51–150',q2)+srow('vs 151+',q3));
      const vCard=card('By venue', srow('Home',G.filter(g=>g.venue==='H'))+srow('Neutral',G.filter(g=>g.venue==='N'))+srow('Road',G.filter(g=>g.venue==='A')));
      const cCard=card('Pressure', srow('Close (≤5)',G.filter(g=>g.close))+srow('Decided by 6+',G.filter(g=>!g.close)));
      const aq=sAgg(q1), aAll=sAgg(G), aClose=sAgg(G.filter(g=>g.close)), aRoad=sAgg(G.filter(g=>g.venue==='A'));
      let reads=[];
      if(aq&&aAll&&aq.n>=3){ const d=aq.ppg-aAll.ppg; reads.push(d>=1.5?`Rises against the best — <b>${F(aq.ppg)}</b> ppg vs Top-50 (${d>=0?'+':''}${F(d)}).`:d<=-2?`Pads against weaker teams — just <b>${F(aq.ppg)}</b> vs Top-50 (${F(d)}).`:`Scores about the same regardless of opponent quality.`); }
      if(aClose&&aAll&&aClose.n>=3){ const d=aClose.ppg-aAll.ppg; if(Math.abs(d)>=2) reads.push(d>=0?`Steps up in close games (<b>${F(aClose.ppg)}</b>).`:`Quiets down in close games (<b>${F(aClose.ppg)}</b>).`); }
      if(aRoad&&aAll&&aRoad.n>=3){ const d=aRoad.ppg-aAll.ppg; if(d<=-2.5) reads.push(`Travels poorly — <b>${F(aRoad.ppg)}</b> on the road.`); }
      splitsHtml=`<div class="sec-h">Who he does it against <span class="hint">2025-26 scoring by quality · venue · pressure</span></div><div class="idg">${qCard}${vCard}${cCard}</div>${reads.length?`<div class="idr" style="margin-top:8px;border-radius:10px;border:1px solid var(--border);">${reads.join(' ')}</div>`:''}`;
    }

    // ── FORM & CONFERENCE PLAY: last-5 / last-10 vs season, and conference vs non-conference ──
    let formHtml='';
    if(log.length>=10){
      const chron=log.slice();   // box is ordered by date asc
      const agg=gs=>{ if(!gs.length) return null; let pts=0,fgm=0,fga=0,tpm=0,tov=0; gs.forEach(g=>{pts+=R(g.pts);fgm+=R(g.fgm);fga+=R(g.fga);tpm+=R(g.tpm);tov+=R(g.tov);}); return {n:gs.length,ppg:pts/gs.length,efg:fga?(fgm+0.5*tpm)/fga*100:null,tov:tov/gs.length}; };
      const L5=agg(chron.slice(-5)), L10=agg(chron.slice(-10)), S=agg(chron);
      const row=(lab,a)=>a?`<tr><td class="l nm">${lab}</td><td>${a.n}</td><td class="v">${F(a.ppg)}</td><td class="v">${F(a.efg,0)}</td><td>${F(a.tov)}</td></tr>`:'';
      const dP=L10.ppg-S.ppg, dE=(L10.efg!=null&&S.efg!=null)?L10.efg-S.efg:0;
      const formRead = dP>=2.5&&dE>=0 ? `Closed the season <b>hot</b> — ${F(L10.ppg)} ppg over his last 10 (+${F(dP)} on his average)${dE>=3?' with better efficiency':''}.`
        : dP<=-2.5 ? `<b>Faded late</b> — ${F(L10.ppg)} ppg over his last 10, ${F(Math.abs(dP))} under his average${dE<=-3?', and his shot went with it':''}.`
        : dE>=4 ? `Steady volume but a <b>hotter shot</b> down the stretch (eFG +${F(dE,0)} over his last 10).`
        : dE<=-4 ? `Volume held but his <b>shot cooled</b> late (eFG ${F(dE,0)} over his last 10).`
        : `Finished about where he lived all year — no late surge or fade.`;
      const cG=G.filter(g=>g.conf), nG=G.filter(g=>!g.conf);
      const cA=sAgg(cG), nA=sAgg(nG);
      const confRows=(cA&&nA&&cA.n>=5&&nA.n>=4)?`<tr><td class="l nm">Conference play</td><td>${cA.n}</td><td class="v">${F(cA.ppg)}</td><td class="v">${F(cA.efg,0)}</td><td class="dim">—</td></tr><tr><td class="l nm">Non-conference</td><td>${nA.n}</td><td class="v">${F(nA.ppg)}</td><td class="v">${F(nA.efg,0)}</td><td class="dim">—</td></tr>`:'';
      const confRead=(cA&&nA&&cA.n>=5&&nA.n>=4)?(()=>{ const d=cA.ppg-nA.ppg, e=(cA.efg!=null&&nA.efg!=null)?cA.efg-nA.efg:0; return d<=-2.5?` Scoring dipped <b>${F(Math.abs(d))} ppg</b> once league play started${e<=-3?' and his eFG fell '+F(Math.abs(e),0):''} — the non-con numbers flatter him.`:d>=2?` He got <b>better</b> in league play (+${F(d)} ppg).`:` League play didn’t change his output.`; })():'';
      formHtml=`<div class="sec-h">Form &amp; conference play <span class="hint">how he finished · league vs non-league</span></div>
        <div class="sheet-wrap"><table class="sheet"><thead><tr><th class="l">Span</th><th>G</th><th>PPG</th><th>eFG%</th><th>TO/g</th></tr></thead><tbody>${row('Last 5',L5)}${row('Last 10',L10)}${row('Season',S)}${confRows}</tbody></table></div>
        <div class="idr" style="border:1px solid var(--border);border-radius:10px;margin-top:8px;">${formRead}${confRead}</div>`;
    }

    // ── AVAILABILITY: foul risk + rotation volatility (Predictive Identifiers) ──
    let availHtml='';
    if(log.length>=10){
      let pf=0,mn=0,four=0,five=0; const mins=log.map(g=>R(g.min));
      log.forEach(g=>{ pf+=R(g.pf); mn+=R(g.min); if(R(g.pf)>=4) four++; if(R(g.pf)>=5) five++; });
      const pf40=mn?pf/mn*40:0, fourPct=four/log.length*100;
      const mMean=mins.reduce((a,b)=>a+b,0)/mins.length, mSd=Math.sqrt(mins.reduce((a,b)=>a+(b-mMean)*(b-mMean),0)/mins.length);
      const mLo=Math.min(...mins), mHi=Math.max(...mins), under20=mins.filter(m=>m<20).length/mins.length*100;
      const foulTag=pf40>=4.5?['High','r']:pf40>=3.5?['Moderate','a']:['Low','g'];
      const volTag=mSd>=8?['Volatile','r']:mSd>=5?['Uneven','a']:['Steady','g'];
      const foulRead=pf40>=4.5?`Foul trouble is a real lever — <b>${F(pf40)} fouls/40</b>, four-plus in <b>${Math.round(fourPct)}%</b> of games${five?` (fouled out ${five}×)`:''}. Attack him early and he sits.`:pf40>=3.5?`Some foul risk — <b>${F(pf40)}/40</b>, four-plus in ${Math.round(fourPct)}% of games. Worth testing him at the rim.`:`Disciplined — <b>${F(pf40)} fouls/40</b>; foul trouble rarely takes him off the floor.`;
      const volRead=mSd>=8?`His minutes swing widely (<b>${F(mMean,0)} ± ${F(mSd,0)}</b>, ${mLo}–${mHi}) — ${Math.round(under20)}% of games under 20 min. The role isn’t fixed; game flow decides it.`:mSd>=5?`Minutes are <b>uneven</b> (${F(mMean,0)} ± ${F(mSd,0)}) — a clear role, but matchups and foul trouble move it.`:`A <b>locked-in role</b> — ${F(mMean,0)} ± ${F(mSd,0)} minutes a night, ${mLo}–${mHi} range.`;
      availHtml=`<div class="sec-h">Availability <span class="hint">foul risk · rotation volatility · ${log.length} g</span></div>
        <div class="idg">
          <div class="idcard ${foulTag[1]}"><div class="ih"><div class="inm">Foul Risk</div><div class="isc">${F(pf40)}<small>PF/40 · ${foulTag[0]}</small></div></div>
            <div class="sheet-wrap"><table class="sheet"><tbody><tr><td class="l nm">Fouls per 40</td><td class="v">${F(pf40)}</td></tr><tr><td class="l nm">Games with 4+ fouls</td><td class="v">${four} <span class="dim">(${Math.round(fourPct)}%)</span></td></tr><tr><td class="l nm">Fouled out</td><td class="v">${five}</td></tr></tbody></table></div>
            <div class="idr">${foulRead}</div></div>
          <div class="idcard ${volTag[1]}"><div class="ih"><div class="inm">Rotation Volatility</div><div class="isc">±${F(mSd,0)}<small>min · ${volTag[0]}</small></div></div>
            <div class="sheet-wrap"><table class="sheet"><tbody><tr><td class="l nm">Minutes per game</td><td class="v">${F(mMean,1)}</td></tr><tr><td class="l nm">Range</td><td class="v">${mLo}–${mHi}</td></tr><tr><td class="l nm">Games under 20 min</td><td class="v">${Math.round(under20)}%</td></tr></tbody></table></div>
            <div class="idr">${volRead}</div></div>
        </div>`;
    }

    // shot creation
    let creationHtml=''; const madeSh=shots.filter(s=>s.made);
    if(madeSh.length>=25){
      const isAst=s=>s.ast_name&&(''+s.ast_name).trim().length>0;
      const ast=madeSh.filter(isAst).length, self=madeSh.length-ast, selfPct=Math.round(self/madeSh.length*100);
      const two=madeSh.filter(s=>s.sv!==3), th=madeSh.filter(s=>s.sv===3);
      const twoAst=two.length?Math.round(two.filter(isAst).length/two.length*100):null, thAst=th.length?Math.round(th.filter(isAst).length/th.length*100):null;
      const label=selfPct>=55?'Shot creator':selfPct>=40?'Balanced':'Setup scorer', cls=selfPct>=55?'g':selfPct>=40?'n':'a';
      creationHtml=`<div class="sec-h">Shot creation <span class="hint">self-created vs assisted · ${madeSh.length} makes</span></div>
        <div class="idg"><div class="idcard ${cls}"><div class="ih"><div class="inm">${label}</div><div class="isc">${selfPct}%<small>self-created</small></div></div>
          <div class="sp2 hd"><div class="spl"></div><div class="a">Makes</div><div class="b">Share</div></div>
          <div class="sp2"><div class="spl">Self-created</div><div class="a">${self}</div><div class="b">${selfPct}%</div></div>
          <div class="sp2"><div class="spl">Assisted</div><div class="a">${ast}</div><div class="b">${100-selfPct}%</div></div>
          ${twoAst!=null?`<div class="sp2"><div class="spl">2-pt makes assisted</div><div class="a">—</div><div class="b">${twoAst}%</div></div>`:''}
          ${thAst!=null?`<div class="sp2"><div class="spl">3-pt makes assisted</div><div class="a">—</div><div class="b">${thAst}%</div></div>`:''}
          <div class="idr">${selfPct>=55?`Creates his own — <b>${selfPct}%</b> of his makes are unassisted; hand him the ball and let him work.`:selfPct<=35?`A finisher — <b>${100-selfPct}%</b> of his makes come off a pass; get him touches in rhythm.`:`Balanced — creates and finishes about equally.`}${twoAst!=null&&twoAst<=35?` Low 2-pt assist rate — he gets to the rim off the bounce.`:''}${thAst!=null&&thAst>=80?` His threes are almost all catch-and-shoot.`:''}</div>
        </div></div>`;
    }

    const [cdot,clab]=confDot(Math.min(fast.length,slow.length,hav.length,lowD.length));
    host.innerHTML=`<div style="--tc:${tc}">${head}${projHtml}${idg}${splitsHtml}${formHtml}${availHtml}${clutchHtml}${archHtml}${zoneHtml}${creationHtml}
      <div class="note">Situational confidence <span class="conf"><span class="dot" style="background:${cdot}"></span>${clab}</span> — based on the smallest split sample. Thin buckets are directional, not definitive. Projected line = the site's forward-looking projection; splits are cut from his own 2025-26 game and shot logs vs the opponent's tempo / forced-turnover rate / defensive archetype (team_dna), and the clutch (last 5:00 within 5).</div></div>`;
    if(window.TDCAnim&&TDCAnim.scan) TDCAnim.scan(host);
  }
  return { render };
})();
