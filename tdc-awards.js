/* Projected awards engine — ONE global, slot-limited selection so every page
   shows the same teams. Each conference gets exactly:
     - 3 All-Conference teams (5 players each)
     - 2 All-Defensive teams (5 each)
     - 2 All-Freshman teams (5 each)
   Nationally: 3 All-America teams (5 each).

   Selection order is a deterministic score (projected BPM via the lag model,
   TDC grade, projected production), so recomputes agree with each other.
   Results are read from the award_projections table when it exists (single
   source of truth); otherwise computed and cached in localStorage for 24h.

   To make selections durable across visitors, create the table once:
     create table if not exists award_projections (
       season int primary key,
       data jsonb not null,
       updated_at timestamptz default now()
     );
     alter table award_projections enable row level security;
     create policy "public read"   on award_projections for select using (true);
     create policy "public insert" on award_projections for insert with check (true);
     create policy "public update" on award_projections for update using (true);
*/
(function(g){
  const SB='https://izlqhnxowdhtdofkwrho.supabase.co';
  const KEY='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
  const H={'apikey':KEY,'Authorization':'Bearer '+KEY};
  const SEASON=2027, LS_KEY='tdc_awards_v5_'+SEASON, TTL=24*3600*1000;

  function cls(yr){ yr=((yr||'')+'').toLowerCase();
    if(yr.includes('fr')) return 'FR';
    if(yr.includes('so')) return 'SO';
    if(yr.includes('jr')) return 'JR';
    return 'SR'; }
  const CLS_BUMP={FR:0.5,SO:0.2,JR:0.1,SR:0};

  async function fetchPaged(url, pageSize){
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

  async function compute(){
    const [teams, players, bb]=await Promise.all([
      fetch(SB+'/rest/v1/teams?select=name,conf,conference&limit=500',{headers:H}).then(r=>r.json()),
      fetchPaged(SB+'/rest/v1/players?name=neq.%E2%80%94&select=name,team,espn_id,position,yr,class_year,tdc_grade,ppg,rpg,apg,stl,blk,mpg,is_injured,hometown&order=id.asc'),
      fetchPaged(SB+'/rest/v1/player_advanced?season_year=eq.2026&espn_id=not.is.null&select=espn_id,ti40&order=espn_id.asc'),
    ]);
    const confOf={}; (teams||[]).forEach(t=>{ confOf[t.name]=t.conf||t.conference||''; });
    const advById={}; (bb||[]).forEach(r=>{ if(r.espn_id!=null&&r.ti40!=null) advById[r.espn_id]={ti40:r.ti40}; });

    const cand=[];
    (players||[]).forEach(p=>{
      const hs=(p.hometown||'').trim().toLowerCase();
      if(!p.name||p.is_injured||hs==='injured'||hs==='out') return;   // out for the season (sheet convention)
      const grade=parseFloat(p.tdc_grade); if(!isFinite(grade)||grade<72) return;
      const conf=confOf[p.team]||'';
      const c=cls(p.yr||p.class_year);
      const adv=p.espn_id!=null?advById[p.espn_id]:null;
      const ti=adv?parseFloat(adv.ti40):NaN;
      // projected impact: owned TI mapped to a BPM-like scale (+class bump); grade proxy w/o box data
      const gi=(grade-77)*0.55-0.6;
      const projBpm=isFinite(ti)?((ti-10)*0.5+(CLS_BUMP[c]||0)):gi;
      const projDbpm=(grade-80)*0.15;   // defense leans on `stocks` (stl+blk) below; no owned dbpm
      const hasStats=(parseFloat(p.ppg)||0)>0;
      const prod=hasStats
        ? (parseFloat(p.ppg)||0)*0.9+(parseFloat(p.rpg)||0)*0.5+(parseFloat(p.apg)||0)*0.7
        : Math.max(0,grade-68)*0.45;                       // freshman estimate
      const stocks=hasStats?((parseFloat(p.stl)||0)+(parseFloat(p.blk)||0)):Math.max(0,grade-75)*0.06;
      // bench returners can't crowd the ballot
      if(hasStats&&(parseFloat(p.mpg)||0)<10&&grade<80) return;
      cand.push({
        name:p.name, team:p.team, conf, pos:p.position||'', yr:p.yr||p.class_year||'', grade,
        isFr:c==='FR',
        score:+(2.0*projBpm+1.1*(grade-75)+0.55*prod).toFixed(2),
        def:+(2.4*projDbpm+1.5*stocks+0.4*(grade-78)).toFixed(2),
        rook:+(grade+0.3*prod).toFixed(2),
      });
    });

    const slim=x=>({name:x.name,team:x.team,conf:x.conf,pos:x.pos,yr:x.yr,grade:x.grade});
    const take=(arr,n)=>arr.slice(0,n).map(slim);
    const teamsOf=(arr,per,count)=>{ const out=[]; for(let i=0;i<count;i++){ const t=take(arr.slice(i*per),per); if(t.length) out.push(t); } return out; };

    const national=[...cand].sort((a,b)=>b.score-a.score);
    const awards={ season:SEASON, generated:new Date().toISOString(),
      allAmerica:teamsOf(national,5,3), conferences:{} };

    const byConf={};
    cand.forEach(x=>{ if(x.conf) (byConf[x.conf]=byConf[x.conf]||[]).push(x); });
    Object.keys(byConf).sort().forEach(cf=>{
      const pool=byConf[cf];
      const all=[...pool].sort((a,b)=>b.score-a.score);
      const dfs=[...pool].sort((a,b)=>b.def-a.def);
      const rks=pool.filter(x=>x.isFr).sort((a,b)=>b.rook-a.rook);
      awards.conferences[cf]={
        allConf:teamsOf(all,5,3),
        defense:teamsOf(dfs,5,2),
        rookies:teamsOf(rks,5,2),
      };
    });
    return awards;
  }

  async function readDb(){
    try{
      const r=await fetch(SB+'/rest/v1/award_projections?season=eq.'+SEASON+'&select=data&limit=1',{headers:H});
      if(!r.ok) return null;
      const rows=await r.json();
      return rows&&rows[0]&&rows[0].data||null;
    }catch(e){ return null; }
  }
  async function writeDb(awards){
    try{
      // Only the OWNER publishes this shared cache (owner JWT passes owner-only RLS).
      var tok = (typeof window!=='undefined' && window.tdcOwnerToken) ? window.tdcOwnerToken() : null;
      if(!tok) return;
      await fetch(SB+'/rest/v1/award_projections?on_conflict=season',{
        method:'POST',
        headers:{...H,'Authorization':'Bearer '+tok,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify({season:SEASON,data:awards,updated_at:new Date().toISOString()}),
      });
    }catch(e){}
  }

  let _mem=null, _loading=null;
  function get(){
    if(_mem) return Promise.resolve(_mem);
    if(_loading) return _loading;
    _loading=(async()=>{
      // 1. shared DB row wins — same selections for every visitor
      const db=await readDb();
      if(db){ _mem=db; return db; }
      // 2. fresh local cache
      try{
        const c=JSON.parse(localStorage.getItem(LS_KEY)||'null');
        if(c&&c.t&&Date.now()-c.t<TTL&&c.awards){ _mem=c.awards; return c.awards; }
      }catch(e){}
      // 3. compute, cache, and offer to the DB (no-op until the table exists)
      const awards=await compute();
      _mem=awards;
      try{ localStorage.setItem(LS_KEY,JSON.stringify({t:Date.now(),awards})); }catch(e){}
      writeDb(awards);
      return awards;
    })();
    return _loading;
  }

  // all award placements for one player: [{award:'All-America', team:1}, ...]
  function lookup(awards, name, team){
    if(!awards) return [];
    const eq=x=>x.name===name&&(!team||x.team===team);
    const hits=[];
    (awards.allAmerica||[]).forEach((t,i)=>{ if(t.some(eq)) hits.push({award:'All-America',team:i+1,conf:null}); });
    Object.keys(awards.conferences||{}).forEach(cf=>{
      const c=awards.conferences[cf];
      (c.allConf||[]).forEach((t,i)=>{ if(t.some(eq)) hits.push({award:'All-Conference',team:i+1,conf:cf}); });
      (c.defense||[]).forEach((t,i)=>{ if(t.some(eq)) hits.push({award:'All-Defense',team:i+1,conf:cf}); });
      (c.rookies||[]).forEach((t,i)=>{ if(t.some(eq)) hits.push({award:'All-Freshman',team:i+1,conf:cf}); });
    });
    return hits;
  }

  // force a recompute + DB overwrite — run from the console after player grades
  // change upstream, so the shared award_projections row reflects the new grades
  async function refresh(){
    const awards=await compute();
    _mem=awards;
    try{ localStorage.setItem(LS_KEY,JSON.stringify({t:Date.now(),awards})); }catch(e){}
    await writeDb(awards);
    return awards;
  }
  g.TDC_AWARDS={get, refresh, lookup, SEASON};
})(window);
