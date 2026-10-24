/* tdc-teamshotprofile.js — the Team Shot Profile (scripts/data/team_shot_profile/<y>.json, build_team_shot_profile.py).
   TDC_TEAMSHOTPROFILE.load(season) -> season file (cached) with per-metric ranks added
   TDC_TEAMSHOTPROFILE.META        -> column labels, groups, which direction is "good"
   TDC_TEAMSHOTPROFILE.renderTeam(host, {teamId, season})  -> one team's offense + defense strip, with its own
        season picker and the "vs average opponent" / raw switch (team page, Shots › Shot Profile)
   TDC_TEAMSHOTPROFILE.renderAll(host, {season, conf, link}) -> every team for one stat group, offense or
        defense, sortable (shot-quality.html "Team profiles" view)
   Needs tdc-sheets.css. Logos come from ESPN by team id.
   Every number exists raw and adjusted for schedule ("vs an average opponent"); ranks are 1 = best for the
   stats with a better direction, 1 = most for the style stats (shares, volume, range), which are not coloured. */
(function(){
  const BASE='scripts/data/team_shot_profile/', V='?v=1';
  // key, short label, long label, decimals, good direction on OFFENSE (+1 higher is better, 0 = style, no colour)
  const M=[
    ['eff','Pts/100','Points per 100 possessions',1,1],
    ['ftr','FTA/100','Free-throw attempts per 100 possessions',1,1],
    ['ft','FT%','Free-throw %',1,1],
    ['fga','FGA/100','Field-goal attempts per 100 possessions',1,1],
    ['fg','FG%','Field-goal %',1,1],
    ['rim','Rim/100','Attempts at the rim (layups, dunks, tips, 4 ft and in) per 100 possessions',1,0],
    ['rimp','Rim%','Make % at the rim',1,1],
    ['mid','Mid/100','Other two-point attempts (jumpers, floaters, hooks) per 100 possessions',1,0],
    ['midp','Mid%','Make % on other twos',1,1],
    ['tpa','3PA/100','Three-point attempts per 100 possessions',1,0],
    ['tp','3P%','Three-point %',1,1],
    ['rimS','Rim share','Share of shots at the rim',1,0],
    ['midS','Mid share','Share of shots that are other twos',1,0],
    ['tS','3 share','Share of shots that are threes',1,0],
    ['range','Range','Average shot distance: 1 = every shot at the rim, 2 = every shot a two-point jumper, 3 = all threes',2,0],
    ['orb','OReb%','First-chance misses rebounded by the shooting team',1,1],
    ['scp','2nd pts/100','Second-chance points per 100 possessions',1,1],
    ['ppo','Pts/OReb','Points scored per offensive rebound',2,1],
    ['pto','TO pts/100','Points per 100 possessions on trips that started with a turnover',1,1],
    ['tov','TO trips','Share of possessions that started with a turnover',1,1],
    ['tr','Fast trips','Share of possessions with a shot, free-throw trip or turnover inside 10 seconds',1,0],
    ['trp','Fast PPP','Points per fast (0-10 second) possession',2,1],
    ['q','Quality','Shot quality vs D-I: points per shot the looks should score (free-throw trips count)',3,1],
    ['m','Making','Shot-making: points per shot above what the looks should score, adjusted for schedule and sample size',3,1],
    ['self','Self-made','Share of made field goals that were unassisted',1,0],
    ['pull','Pull-ups','Share of shots that are pull-ups (tagged from 2025-26)',1,0],
  ];
  const GROUPS=[
    ['Scoring',['eff','fga','ftr','ft','fg']],
    ['At the rim',['rim','rimp']],
    ['Other twos',['mid','midp']],
    ['Threes',['tpa','tp']],
    ['Shot mix',['rimS','midS','tS','range']],
    ['Second chances',['orb','scp','ppo']],
    ['Turnovers & pace',['tov','pto','tr','trp']],
    ['Quality',['q','m','self','pull']],
  ];
  const META={M,GROUPS,byKey:Object.fromEntries(M.map(m=>[m[0],m]))};
  const FILES={};
  const get=u=>fetch(u).then(r=>r.ok?r.json():null).catch(()=>null);
  function load(y){
    return FILES[y]||(FILES[y]=get(BASE+y+'.json'+V).then(D=>{ if(!D) return null;
      const ci=Object.fromEntries(D.cols.map((c,i)=>[c,i]));
      D.ci=ci; D.byId={};
      D.teams.forEach(t=>{ D.byId[t[0]]=t; t.rk={off:[[],[]],def:[[],[]]}; });
      // ranks per side × raw/adj × metric; 1 = best (good direction), or 1 = most for style stats
      ['off','def'].forEach((side,si)=>[0,1].forEach(a=>D.cols.forEach((c,i)=>{
        const m=META.byKey[c]; if(!m) return; const dir=m[4]===0?1:(side==='off'?m[4]:-m[4]);
        const vs=D.teams.map(t=>({t,v:t[4+si][a][i]})).filter(o=>o.v!=null).sort((x,y)=>dir*(y.v-x.v));
        vs.forEach((o,k)=>{ o.t.rk[side][a][i]=k+1; }); D['n_'+side+a+'_'+i]=vs.length;
      })));
      return D; }));
  }
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const ord=n=>{ const s=['th','st','nd','rd'], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
  // colour bucket from rank: only for stats with a better direction
  const cls=(m,rk,n)=>{ if(!rk||!m||m[4]===0) return ''; const p=1-(rk-1)/Math.max(1,n-1); return p>=.8?'c4':p>=.6?'c3':p>=.4?'c2':p>=.2?'c1':'c0'; };
  const fmt=(m,v)=>v==null?'—':(m[0]==='q'||m[0]==='m'?(v>=0?'+':'')+v.toFixed(3):v.toFixed(m[3]));
  const sh=t=>{ try{ return (window.TDCTeamName&&TDCTeamName.short)?TDCTeamName.short(t):t; }catch(e){ return t; } };
  const logo=id=>`https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
  const sl=y=>(y-1)+'–'+String(y).slice(2);
  const SI={off:0,def:1}, OFF_ONLY={self:1,pull:1};
  // adjusted value where one exists (q/m are already adjusted; self/pull are style), else raw
  const val=(D,t,side,k,a)=>{ const i=D.ci[k], r=t[4+SI[side]]; return (a&&r[1][i]!=null)?r[1][i]:r[0][i]; };
  const rkOf=(D,t,side,k,a)=>{ const i=D.ci[k], use=(a&&t[4+SI[side]][1][i]!=null)?1:0; return [t.rk[side][use][i], D['n_'+side+use+'_'+i]]; };
  let IDX=null; const seasons=()=>IDX||(IDX=get(BASE+'index.json'+V).then(I=>(I&&I.seasons)||[2026]));
  let CSSDONE=false;
  function css(){ if(CSSDONE) return; CSSDONE=true; const st=document.createElement('style'); st.textContent=
    '.tsp-ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 10px}'+
    '.tsp-ctl select{font:600 13px Inter,system-ui,sans-serif;padding:6px 8px;border:1px solid var(--border2,#C6C0B2);border-radius:7px;background:var(--bg2,#F1EFEA);color:var(--text,#1A1814)}'+
    '.tsp-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--border);border-radius:9px;background:var(--bg2)}.tsp-seg button{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;padding:6px 12px;border:0;border-radius:7px;background:none;color:var(--text3);cursor:pointer}.tsp-seg button.on{background:var(--accent);color:var(--accent-on,#221c08)}'+
    '.tsp .sheet th.g{text-align:center;border-bottom:1px solid var(--border2,#C6C0B2)}.tsp .sheet th[title],.tsp .sheet td[title]{cursor:help}'+
    '.tsp .sheet td.rk{font-size:11px;color:var(--text2,#4A463C);font-variant-numeric:tabular-nums}'+
    '.tsp .sheet td.side{font-weight:800;text-transform:uppercase;font-size:11px;letter-spacing:.08em}.tsp .sheet td.sub{color:var(--text3,#8A867A);font-size:11px;font-weight:700;text-transform:none;letter-spacing:0}'+
    '.tsp .sheet td .lgi{width:16px;height:16px;object-fit:contain;vertical-align:-3px;margin-right:6px}.tsp .sheet td a{color:inherit;text-decoration:none;font-weight:700}.tsp .sheet td a:hover{text-decoration:underline}'+
    '@media(max-width:640px){.tsp .tsp-cf{display:none}}.tsp .sheet th[data-k]{cursor:pointer}.tsp-key{font-size:12px;color:var(--text3,#8A867A);margin-top:8px}';
    document.head.appendChild(st); }
  const segH=(id,opts,on)=>`<div class="tsp-seg" data-seg="${id}">${opts.map(o=>`<button data-v="${o[0]}"${String(o[0])===String(on)?' class="on"':''}>${o[1]}</button>`).join('')}</div>`;
  const wireSeg=(host,id,fn)=>host.querySelectorAll(`[data-seg="${id}"] button`).forEach(b=>b.onclick=()=>fn(b.getAttribute('data-v')));

  // ---------- Option A: one team, offense + defense strip
  async function renderTeam(host, o){
    if(!host) return; css(); o=o||{};
    const st=host.__tsp||(host.__tsp={season:o.season||null, a:1});
    const ys=await seasons(); if(!st.season) st.season=ys[0];
    const D=await load(st.season), tid=String(o.teamId||'');
    const t=D&&D.byId[tid];
    const ctl=`<div class="tsp-ctl"><select data-k="season">${ys.map(y=>`<option value="${y}"${y===st.season?' selected':''}>${sl(y)}</option>`).join('')}</select>${segH('adj',[[1,'vs average opponent'],[0,'Raw']],st.a)}</div>`;
    if(!t){ host.innerHTML=`<div class="tsp">${ctl}<div style="padding:24px;text-align:center;color:var(--text3,#8A867A);font-size:13px">No D-I play-by-play profile for this team in ${sl(st.season)}.</div></div>`; wire(); return; }
    const keys=GROUPS.flatMap(g=>g[1]);
    let h=`<div class="sheet-wrap"><table class="sheet dense freeze"><thead><tr><th class="l"></th>${GROUPS.map(g=>`<th class="g" colspan="${g[1].length}">${g[0]}</th>`).join('')}</tr><tr><th class="l">${sl(st.season)}</th>${keys.map(k=>`<th title="${esc(META.byKey[k][2])}">${META.byKey[k][1]}</th>`).join('')}</tr></thead><tbody>`;
    ['off','def'].forEach(side=>{
      h+=`<tr><td class="l side">${side==='off'?'Offense':'Defense'}</td>${keys.map(k=>`<td>${side==='def'&&OFF_ONLY[k]?'—':fmt(META.byKey[k],val(D,t,side,k,st.a))}</td>`).join('')}</tr>`;
      h+=`<tr><td class="l sub">D-I rank</td>${keys.map(k=>{ if(side==='def'&&OFF_ONLY[k]) return '<td class="rk">—</td>'; const [r,n]=rkOf(D,t,side,k,st.a); return `<td class="rk ${cls(META.byKey[k],r,n)}">${r?ord(r):'—'}</td>`; }).join('')}</tr>`;
    });
    h+=`<tr><td class="l sub">D-I average</td>${keys.map(k=>`<td class="rk">${fmt(META.byKey[k],D.league.off[D.ci[k]])}</td>`).join('')}</tr>`;
    host.innerHTML=`<div class="tsp">${ctl}${h}</tbody></table></div><div class="tsp-key">${st.a?'Adjusted for schedule: each number as it would be against an average D-I opponent.':'Raw: against the schedule actually played.'} Ranks: 1st = best; volume, shot-mix and pace stats are style (1st = most) and not coloured. Hover a heading for its definition.</div></div>`;
    wire();
    function wire(){ const s=host.querySelector('select[data-k="season"]'); if(s) s.onchange=()=>{ st.season=+s.value; renderTeam(host,o); };
      wireSeg(host,'adj',v=>{ st.a=+v; renderTeam(host,o); }); }
  }

  // ---------- Option C: every team, one stat group
  async function renderAll(host, o){
    if(!host) return; css(); o=o||{};
    const st=host.__tsp||(host.__tsp={side:'off',grp:GROUPS[0][0],a:1,sort:null,asc:false});
    const D=await load(o.season);
    if(!D){ host.innerHTML='<div class="empty">No team profiles for this season.</div>'; return; }
    const g=GROUPS.find(x=>x[0]===st.grp)[1].filter(k=>!(st.side==='def'&&OFF_ONLY[k]));
    const key=g.includes(st.sort)?st.sort:g[0];
    const teams=D.teams.filter(t=>!o.conf||t[2]===o.conf);
    const rows=teams.slice().sort((x,y)=>{ const [rx]=rkOf(D,x,st.side,key,st.a), [ry]=rkOf(D,y,st.side,key,st.a); return ((rx||9999)-(ry||9999))*(st.asc?-1:1); });
    const ctl=`<div class="tsp-ctl">${segH('side',[['off','Offense'],['def','Defense']],st.side)}<select data-k="grp">${GROUPS.map(x=>`<option${x[0]===st.grp?' selected':''}>${x[0]}</option>`).join('')}</select>${segH('adj',[[1,'vs average opponent'],[0,'Raw']],st.a)}</div>`;
    const link=t=>o.link?o.link(t):`team.html?team=${encodeURIComponent(t[1])}&tab=shotprof`;
    let h=`<div class="sheet-wrap"><table class="sheet dense freeze"><thead><tr><th class="l">Team</th><th class="l tsp-cf">Conf</th>${g.map(k=>`<th data-k="${k}" title="${esc(META.byKey[k][2])}">${META.byKey[k][1]}${k===key?(st.asc?' ▲':' ▼'):''}</th><th>Rk</th>`).join('')}</tr></thead><tbody>`;
    h+=rows.map(t=>`<tr><td class="l"><img class="lgi" src="${logo(t[0])}" alt="" loading="lazy"><a href="${link(t)}">${esc(sh(t[1]))}</a></td><td class="l tsp-cf">${esc(t[2])}</td>${g.map(k=>{ const [r,n]=rkOf(D,t,st.side,k,st.a); return `<td>${fmt(META.byKey[k],val(D,t,st.side,k,st.a))}</td><td class="rk ${cls(META.byKey[k],r,n)}">${r||'—'}</td>`; }).join('')}</tr>`).join('');
    host.innerHTML=`<div class="tsp">${ctl}${h}</tbody></table></div><div class="tsp-key">${teams.length} teams · ${sl(D.season)} · ${st.a?'adjusted for schedule':'raw'} · ranks among all D-I · click a heading to sort, a team for its full profile.</div></div>`;
    host.querySelector('select[data-k="grp"]').onchange=e=>{ st.grp=e.target.value; st.sort=null; st.asc=false; renderAll(host,o); };
    wireSeg(host,'side',v=>{ st.side=v; renderAll(host,o); }); wireSeg(host,'adj',v=>{ st.a=+v; renderAll(host,o); });
    host.querySelectorAll('th[data-k]').forEach(th=>th.onclick=()=>{ const k=th.getAttribute('data-k'); if(k===key) st.asc=!st.asc; else { st.sort=k; st.asc=false; } renderAll(host,o); });
  }
  window.TDC_TEAMSHOTPROFILE={META,load,seasons,renderTeam,renderAll,cls,fmt,ord,esc};
})();
