/* Predictive team ratings + game lines, built from PROJECTED rosters.

   Rating pipeline (2026-27):
     1. Every rostered player gets a projected BPM: last season's bbref BPM
        through the measured lag model (0.635 + 0.785·bpm) with a class bump,
        or a grade proxy when no bbref row exists (freshmen, no-stat players).
        Players marked out for the season are excluded.
     2. Projected minutes: returners keep last season's MPG (transfers ×0.95),
        freshmen get grade-based estimates; each roster normalizes to 200.
     3. Roster rating = 11.75 + 2.355 × minutes-weighted projected BPM — the
        BPM→SRS mapping calibrated on 2024-25 AND 2025-26 actuals
        (r = 0.97, rmse ≈ 2.0 pts both years, scripts/calibrate_ratings.py),
        so ratings live on the SRS/point-spread scale.
     4. Final rating blends a program anchor: 0.90·roster + 0.10·(0.70·SRS'26)
        (coaching/system carryover, regressed). Teams without rosters carry
        0.70·SRS'26 and are flagged.
     5. All-Play % (Haslametrics-inspired): the chance of beating a random D1
        team, averaged over the whole field, Φ(margin/11).

   Lines: margin = ratingA − ratingB ± 3.2 home court; win prob = Φ(margin/11);
   projected score splits a projected total by the margin.

   Persistence like the awards engine: reads predictive_ratings when the table
   exists (single source of truth), else computes + caches in localStorage.
     create table if not exists predictive_ratings (
       season int primary key, data jsonb not null,
       updated_at timestamptz default now());
     alter table predictive_ratings enable row level security;
     create policy "public read"   on predictive_ratings for select using (true);
     create policy "public insert" on predictive_ratings for insert with check (true);
     create policy "public update" on predictive_ratings for update using (true);
*/
(function(g){
  const SB='https://izlqhnxowdhtdofkwrho.supabase.co';
  const KEY='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
  const H={'apikey':KEY,'Authorization':'Bearer '+KEY};
  const SEASON=2027, LS_KEY='tdc_ratings_v6_'+SEASON, TTL=24*3600*1000;
  const CAL_A=11.75, CAL_B=2.355;          // calibrated BPM→SRS (see header)
  const BLEND_ROSTER=0.90, ANCHOR=0.70;    // roster weight; prior-SRS regression
  const CARRY=0.70;                        // rosterless teams: regressed SRS'26 carryover
  const HOME_ADV=3.2, SIGMA=11;

  function phi(x){ const t=1/(1+0.2316419*Math.abs(x)), d=0.3989423*Math.exp(-x*x/2);
    const p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
    return x>0?1-p:p; }
  function cls(yr){ yr=((yr||'')+'').toLowerCase();
    return yr.includes('fr')?'FR':yr.includes('so')?'SO':yr.includes('jr')?'JR':'SR'; }
  const CLS_BUMP={FR:0.5,SO:0.2,JR:0.1,SR:0};

  async function fetchPaged(url,pageSize){
    const out=[]; let off=0; pageSize=pageSize||1000;
    while(true){
      const r=await fetch(url,{headers:{...H,'Range-Unit':'items','Range':off+'-'+(off+pageSize-1)}});
      if(!r.ok) break;
      const batch=await r.json();
      if(!Array.isArray(batch)||!batch.length) break;
      out.push(...batch);
      if(batch.length<pageSize) break;
      off+=pageSize;
    }
    return out;
  }
  // short roster name ("Duke") → full team_seasons name ("Duke Blue Devils").
  // Word-prefix candidates disambiguated by CONFERENCE first — "Illinois"
  // matches both the Fighting Illini and Illinois State, and only the league
  // tells them apart — then fewest words / shortest.
  const CONF_FRAG={'B10':'Big Ten','SEC':'Southeastern','ACC':'Atlantic Coast','BIG-12':'Big 12','Big-East':'Big East'};
  function matchFull(short, tsRows, confCode){
    let cands=tsRows.filter(t=>t.team===short||t.team.indexOf(short+' ')===0);
    if(!cands.length&&short.indexOf('-')>=0){   // "NC-State" → "NC State Wolfpack"
      const sp=short.replace(/-/g,' ');
      cands=tsRows.filter(t=>t.team===sp||t.team.indexOf(sp+' ')===0);
    }
    if(!cands.length) return null;
    const frag=CONF_FRAG[confCode];
    if(frag){
      const inConf=cands.filter(t=>(t.conference||'').indexOf(frag)>=0);
      if(inConf.length) cands=inConf;
    }
    const nopar=cands.filter(t=>t.team.indexOf('(')<0);
    const pool=(short.indexOf('(')<0&&nopar.length)?nopar:cands;
    return pool.sort((a,b)=>(a.team.split(/\s+/).length-b.team.split(/\s+/).length)||(a.team.length-b.team.length))[0].team;
  }

  async function compute(){
    const [teams, players, bb, ts]=await Promise.all([
      fetch(SB+'/rest/v1/teams?select=name,conf,conference&limit=500',{headers:H}).then(r=>r.json()),
      fetchPaged(SB+'/rest/v1/players?name=neq.%E2%80%94&select=name,team,espn_id,yr,class_year,tdc_grade,mpg,ppg,is_injured,hometown&order=id.asc'),
      fetchPaged(SB+'/rest/v1/bbref_seasons?season_year=eq.2026&espn_id=not.is.null&select=espn_id,advanced&order=bbref_id.asc'),
      fetch(SB+'/rest/v1/team_seasons?season_year=eq.2026&select=team,conference,srs,tier&limit=1000',{headers:H}).then(r=>r.json()),
    ]);
    const confOf={}; (teams||[]).forEach(t=>{ confOf[t.name]=t.conf||t.conference||''; });
    const advById={}; (bb||[]).forEach(r=>{ if(r.espn_id!=null&&r.advanced) advById[r.espn_id]=r.advanced; });
    const tsRows=(ts||[]);
    const srsOf={}; (ts||[]).forEach(t=>{ if(t.srs!=null) srsOf[t.team]=parseFloat(t.srs); });

    // group rostered players by team
    const byTeam={};
    (players||[]).forEach(p=>{
      const hs=(p.hometown||'').trim().toLowerCase();
      if(!p.name||p.is_injured||hs==='injured'||hs==='out') return;
      (byTeam[p.team]=byTeam[p.team]||[]).push(p);
    });

    const rows=[];
    Object.keys(byTeam).forEach(short=>{
      const roster=byTeam[short];
      let entries=roster.map(p=>{
        const grade=parseFloat(p.tdc_grade)||70;
        const c=cls(p.yr||p.class_year);
        const adv=p.espn_id!=null?advById[p.espn_id]:null;
        const bpm=adv?parseFloat(adv.bpm):NaN;
        const projBpm=isFinite(bpm)?(0.635+0.785*bpm+(CLS_BUMP[c]||0)):((grade-77)*0.55-0.6);
        const isTr=!!(p.hometown&&(''+p.hometown).trim());
        const hasStats=(parseFloat(p.ppg)||0)>0;
        const min=hasStats?Math.max(4,(parseFloat(p.mpg)||8)*(isTr?0.95:1))
                          :(grade>=92?26:grade>=88?22:grade>=82?15:grade>=78?10:6);
        return {projBpm,min};
      });
      // rotation reality: 200 minutes, best players first — cap at 9 rotation spots
      entries.sort((a,b)=>b.projBpm-a.projBpm);
      entries=entries.slice(0,11);
      const minSum=entries.reduce((s,e)=>s+e.min,0)||1;
      const mw=entries.reduce((s,e)=>s+e.projBpm*(e.min/minSum),0);
      const rosterRating=CAL_A+CAL_B*mw;
      const full=matchFull(short, tsRows, confOf[short])||short;
      const prior=srsOf[full];
      const rating=(prior!=null)?(BLEND_ROSTER*rosterRating+(1-BLEND_ROSTER)*(ANCHOR*prior))
                                :rosterRating;
      rows.push({team:short, full, conf:confOf[short]||'', rating:+rating.toFixed(2),
        roster:+rosterRating.toFixed(2), prior:prior!=null?+prior.toFixed(1):null, projected:true});
    });
    // non-rostered D1 teams: regressed carryover of last season's SRS
    const covered=new Set(rows.map(r=>r.full));
    (ts||[]).forEach(t=>{
      // no conference = not a D1 program (e.g. Centenary, in team_seasons only
      // because a D1 opponent's result created a row) — keep them out of the field
      if(covered.has(t.team)||t.srs==null||!t.conference) return;
      rows.push({team:t.team, full:t.team, conf:t.conference||'', rating:+(CARRY*parseFloat(t.srs)).toFixed(2),
        roster:null, prior:+parseFloat(t.srs).toFixed(1), projected:false});
    });
    rows.sort((a,b)=>b.rating-a.rating);
    // All-Play %: average win probability against the whole field
    rows.forEach(r=>{ let s=0; rows.forEach(o=>{ if(o!==r) s+=phi((r.rating-o.rating)/SIGMA); });
      r.allPlay=+(s/(rows.length-1)*100).toFixed(1); });
    rows.forEach((r,i)=>r.rank=i+1);
    return {season:SEASON, generated:new Date().toISOString(),
      model:{calA:CAL_A,calB:CAL_B,blendRoster:BLEND_ROSTER,anchor:ANCHOR,homeAdv:HOME_ADV,sigma:SIGMA},
      teams:rows};
  }

  async function readDb(){
    try{
      const r=await fetch(SB+'/rest/v1/predictive_ratings?season=eq.'+SEASON+'&select=data&limit=1',{headers:H});
      if(!r.ok) return null;
      const rows=await r.json();
      return rows&&rows[0]&&rows[0].data||null;
    }catch(e){ return null; }
  }
  async function writeDb(data){
    try{
      await fetch(SB+'/rest/v1/predictive_ratings?on_conflict=season',{
        method:'POST',
        headers:{...H,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify({season:SEASON,data,updated_at:new Date().toISOString()}),
      });
    }catch(e){}
  }

  let _mem=null,_loading=null;
  function get(){
    if(_mem) return Promise.resolve(_mem);
    if(_loading) return _loading;
    _loading=(async()=>{
      const db=await readDb();
      if(db){ _mem=db; return db; }
      try{
        const c=JSON.parse(localStorage.getItem(LS_KEY)||'null');
        if(c&&c.t&&Date.now()-c.t<TTL&&c.data){ _mem=c.data; return c.data; }
      }catch(e){}
      const data=await compute();
      _mem=data;
      try{ localStorage.setItem(LS_KEY,JSON.stringify({t:Date.now(),data})); }catch(e){}
      writeDb(data);
      return data;
    })();
    return _loading;
  }

  // game line between two rating rows. venue: 'neutral' | 'home' (A hosts) | 'away'
  function lineFor(a,b,venue,totals){
    const hc=venue==='home'?HOME_ADV:venue==='away'?-HOME_ADV:0;
    const margin=a.rating-b.rating+hc;
    const pA=phi(margin/SIGMA);
    const total=(totals&&isFinite(totals))?totals:145.5;   // league-ish default
    return { margin:+margin.toFixed(1), probA:+(pA*100).toFixed(1), probB:+((1-pA)*100).toFixed(1),
      scoreA:Math.round(total/2+margin/2), scoreB:Math.round(total/2-margin/2),
      spread:(margin>=0?`${a.team} -${margin.toFixed(1)}`:`${b.team} -${(-margin).toFixed(1)}`) };
  }

  g.TDC_RATINGS={get, lineFor, phi, SEASON, HOME_ADV, SIGMA};
})(window);
