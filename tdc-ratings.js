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
  const SEASON=2027, LS_KEY='tdc_ratings_v14_'+SEASON, TTL=24*3600*1000;
  // in-season form: once 2026-27 games are played, each team's rating drifts
  // toward how it's ACTUALLY performing vs our own lines. surprise = actual
  // margin - expected margin; form = sum(surprise)/(n + FORM_PRIOR) capped at
  // ±FORM_CAP — a hot team gains up to +3, a cold one loses up to -3, and it
  // takes a sustained run (not two lucky games) to move much.
  const FORM_PRIOR=10, FORM_CAP=3;
  const CAL_A=11.75, CAL_B=2.355;          // calibrated BPM→SRS (see header)
  const BLEND_ROSTER=0.90, ANCHOR=0.70;    // roster weight; prior-SRS regression
  const CARRY=0.70;                        // rosterless teams: regressed SRS'26 carryover
  // Coach effect. rosterRating is pure TALENT (a BPM→SRS mapping), so it cannot see
  // coaching at all, and the only coach signal in the blend was the program's own
  // last-season SRS — which carries the DEPARTED staff's results and knows nothing
  // about the hire. COACH_LIFT is the coach's career mean srs_lift (actual SRS minus
  // what his roster's talent predicted), shrunk by how many seasons back it and capped
  // so a 2-year sample can't swing a projection. Applied only to rostered teams:
  // carryover teams are rated off their own actual SRS, which already embeds coaching.
  const COACH_W=0.60, COACH_K=5, COACH_CAP=3.0;
  // Shot-making de-luck (Shot Genome). A returner's BPM is partly propped up by
  // shooting ABOVE the quality of his looks (his eFG − his Look Quality). Shot-making
  // over-expectation is only ~half repeatable, so we shave the transient part off his
  // projected BPM before the lag model runs: a hot shooter regresses, a cold one who
  // generated good looks gets a bump. Bounded so it can never dominate real talent.
  const SHOT_K=0.10;        // each eFG-pt over shot quality ≈ 0.10 BPM of value
  const SHOT_REGRESS=0.55;  // fraction of shot-making-over-expectation that's transient
  const SHOT_CAP=1.2;       // max BPM shaved/added per player
  const SHOT_MINFGA=120;    // need a real shot sample
  // home court measured from our 20yr game history, controlled for opponent
  // strength (scripts/calibrate_hca.py): a baseline curve by opponent rating
  // (~+3.7 vs decent visitors, larger vs weak ones) + a shrunk per-venue
  // offset (r.hcaOff). HOME_ADV is only the no-data fallback.
  const HOME_ADV=3.7, SIGMA=11;
  let _hcaCurve=null;                      // {base:[[srs,edge],...], capMin}
  function baseHca(oppRating){
    if(!_hcaCurve||!_hcaCurve.base||!_hcaCurve.base.length) return HOME_ADV;
    const pts=_hcaCurve.base;
    const x=Math.max(_hcaCurve.capMin!=null?_hcaCurve.capMin:-10, Math.min(pts[pts.length-1][0], oppRating));
    if(x<=pts[0][0]) return pts[0][1];
    for(let i=1;i<pts.length;i++){
      if(x<=pts[i][0]){
        const [x0,y0]=pts[i-1],[x1,y1]=pts[i];
        return y0+(y1-y0)*(x-x0)/(x1-x0);
      }
    }
    return pts[pts.length-1][1];
  }

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

  // nudge ratings by how each team is performing vs our own expectations.
  // games: [{home, away, home_score, away_score, neutral}] (finals only).
  // mutates rows: r.form (±FORM_CAP), r.formGp, and folds form into r.rating.
  function applyForm(rows, games){
    const byFull={}; rows.forEach(r=>{ byFull[r.full]=r; });
    const acc={};
    (games||[]).forEach(g=>{
      const h=byFull[g.home], a=byFull[g.away];
      if(!h||!a||g.home_score==null||g.away_score==null) return;
      const hc=g.neutral?0:baseHca(a.rating)+(h.hcaOff||0);
      const surprise=(g.home_score-g.away_score)-(h.rating-a.rating+hc);
      (acc[g.home]=acc[g.home]||{s:0,n:0}); acc[g.home].s+=surprise; acc[g.home].n++;
      (acc[g.away]=acc[g.away]||{s:0,n:0}); acc[g.away].s-=surprise; acc[g.away].n++;
    });
    rows.forEach(r=>{
      const f=acc[r.full];
      r.formGp=f?f.n:0;
      r.form=f?+Math.max(-FORM_CAP,Math.min(FORM_CAP,f.s/(f.n+FORM_PRIOR))).toFixed(2):0;
      if(r.form) r.rating=+(r.rating+r.form).toFixed(2);
    });
  }

  // Owner's freshman projection overrides {byEspn/byNameTeam: {bpm, min}}, applied
  // during a rebuild() so a freshman's PROJECTED STATS (not his OVR) move the
  // canonical projected rankings — same stat-derived currency as returners.
  let _ovr=null;
  async function compute(){
    const [teams, players, bb, ts, hcaData, coachData, sgData]=await Promise.all([
      fetch(SB+'/rest/v1/teams?select=name,conf,conference,head_coach,coach&limit=500',{headers:H}).then(r=>r.json()),
      fetchPaged(SB+'/rest/v1/players?name=neq.%E2%80%94&select=name,team,espn_id,yr,class_year,tdc_grade,mpg,ppg,is_injured,hometown&order=id.asc'),
      fetchPaged(SB+'/rest/v1/bbref_seasons?season_year=eq.2026&espn_id=not.is.null&select=espn_id,advanced&order=bbref_id.asc'),
      fetch(SB+'/rest/v1/team_seasons?season_year=eq.2026&select=team,conference,srs,tier&limit=1000',{headers:H}).then(r=>r.json()),
      fetch('scripts/data/team_hca.json').then(r=>r.ok?r.json():null).catch(()=>null),
      fetch('data/coach-careers.json').then(r=>r.ok?r.json():null).catch(()=>null),
      fetch('scripts/data/shot_genome_players.json').then(r=>r.ok?r.json():null).catch(()=>null),
    ]);
    const hcaOf=(hcaData&&hcaData.teams)||{};
    const confOf={}; (teams||[]).forEach(t=>{ confOf[t.name]=t.conf||t.conference||''; });
    // teams.head_coach is maintained from the roster sheet, so it reflects offseason
    // hires the Sports-Reference scrape hasn't seen yet — that's the whole point here.
    const cn=s=>(''+(s||'')).toLowerCase().replace(/[.'`]/g,'').replace(/\s+/g,' ').trim();
    const liftByCoach={};
    Object.keys(coachData||{}).forEach(k=>{ const c=coachData[k];
      if(c&&c.n&&c.lf!=null) liftByCoach[cn(c.n)]={lf:+c.lf, n:+c.ln||0}; });
    const coachAdjOf={};
    (teams||[]).forEach(t=>{
      const rec=liftByCoach[cn(t.head_coach||t.coach)];
      if(!rec||!rec.n) return;
      const shrunk=rec.lf*(rec.n/(rec.n+COACH_K));          // 3 seasons counts ~3/8
      coachAdjOf[t.name]=+Math.max(-COACH_CAP,Math.min(COACH_CAP,COACH_W*shrunk)).toFixed(2);
    });
    const advById={}; (bb||[]).forEach(r=>{ if(r.espn_id!=null&&r.advanced) advById[r.espn_id]=r.advanced; });
    // Shot Genome per-player: eFG over Look Quality = shot-making luck (in eFG pts)
    const sgByEspn={}; ((sgData&&sgData.players)||[]).forEach(p=>{
      if(p.espn_id!=null && p.lq!=null && p.efg!=null && (p.fga||0)>=SHOT_MINFGA)
        sgByEspn[p.espn_id]={luck:p.efg-p.lq, fga:p.fga}; });
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
        let bpm=adv?parseFloat(adv.bpm):NaN;
        // de-luck: shave the transient part of shooting-over-shot-quality off BPM
        // before the lag model. Follows the player, so only returners carry it.
        let luckEfg=0, deluck=0;
        const sg=p.espn_id!=null?sgByEspn[p.espn_id]:null;
        if(isFinite(bpm) && sg){
          luckEfg=sg.luck;
          deluck=Math.max(-SHOT_CAP, Math.min(SHOT_CAP, SHOT_REGRESS*SHOT_K*luckEfg));
          bpm=bpm-deluck;
        }
        let projBpm=isFinite(bpm)?(0.635+0.785*bpm+(CLS_BUMP[c]||0)):((grade-77)*0.55-0.6);
        const isTr=!!(p.hometown&&(''+p.hometown).trim());
        const hasStats=(parseFloat(p.ppg)||0)>0;
        let min=hasStats?Math.max(4,(parseFloat(p.mpg)||8)*(isTr?0.95:1))
                          :(grade>=92?26:grade>=88?22:grade>=82?15:grade>=78?10:6);
        // Owner's freshman projection: value him by his PROJECTED STATS (a BPM
        // computed from the projected box score) and projected minutes — the same
        // currency as returners — rather than the grade/OVR fallback.
        if(_ovr){ const ov=(p.espn_id!=null&&_ovr.byEspn&&_ovr.byEspn[p.espn_id])?_ovr.byEspn[p.espn_id]
                    :(_ovr.byNameTeam&&_ovr.byNameTeam[((p.team||'')+'|'+(p.name||'')).toLowerCase()]);
          if(ov){ if(ov.bpm!=null&&!isNaN(+ov.bpm)) projBpm=+ov.bpm;
                  if(ov.min!=null&&!isNaN(+ov.min)) min=Math.max(4,+ov.min); } }
        return {projBpm,min,luckEfg,hasSg:!!sg};
      });
      // rotation reality: 200 minutes, best players first — cap at 9 rotation spots
      entries.sort((a,b)=>b.projBpm-a.projBpm);
      entries=entries.slice(0,11);
      const minSum=entries.reduce((s,e)=>s+e.min,0)||1;
      const mw=entries.reduce((s,e)=>s+e.projBpm*(e.min/minSum),0);
      const rosterRating=CAL_A+CAL_B*mw;
      // team shot luck: minutes-weighted eFG-over-quality of the rotation's returners
      const sgEnt=entries.filter(e=>e.hasSg); const sgMin=sgEnt.reduce((s,e)=>s+e.min,0);
      const shotLuck=sgMin?+(sgEnt.reduce((s,e)=>s+e.luckEfg*e.min,0)/sgMin).toFixed(1):null;
      const full=matchFull(short, tsRows, confOf[short])||short;
      const prior=srsOf[full];
      const cAdj=coachAdjOf[short]||0;
      const rating=((prior!=null)?(BLEND_ROSTER*rosterRating+(1-BLEND_ROSTER)*(ANCHOR*prior))
                                 :rosterRating) + cAdj;
      rows.push({team:short, full, conf:confOf[short]||'', rating:+rating.toFixed(2), coachAdj:cAdj,
        roster:+rosterRating.toFixed(2), prior:prior!=null?+prior.toFixed(1):null, projected:true,
        shotLuck:shotLuck, hcaOff:hcaOf[full]!=null?hcaOf[full]:0});
    });
    // non-rostered D1 teams: regressed carryover of last season's SRS
    const covered=new Set(rows.map(r=>r.full));
    (ts||[]).forEach(t=>{
      // no conference = not a D1 program (e.g. Centenary, in team_seasons only
      // because a D1 opponent's result created a row) — keep them out of the field
      if(covered.has(t.team)||t.srs==null||!t.conference) return;
      rows.push({team:t.team, full:t.team, conf:t.conference||'', rating:+(CARRY*parseFloat(t.srs)).toFixed(2),
        roster:null, prior:+parseFloat(t.srs).toFixed(1), projected:false,
        hcaOff:hcaOf[t.team]!=null?hcaOf[t.team]:0});
    });
    // in-season form adjustment from this season's played games (no-op until
    // 2026-27 results exist)
    const played=await fetchPaged(SB+'/rest/v1/games?season_year=eq.'+SEASON+'&status=eq.STATUS_FINAL&select=home,away,home_score,away_score,neutral&order=id.asc');
    applyForm(rows, played||[]);
    rows.sort((a,b)=>b.rating-a.rating);
    // All-Play %: average win probability against the whole field
    rows.forEach(r=>{ let s=0; rows.forEach(o=>{ if(o!==r) s+=phi((r.rating-o.rating)/SIGMA); });
      r.allPlay=+(s/(rows.length-1)*100).toFixed(1); });
    rows.forEach((r,i)=>r.rank=i+1);
    return {season:SEASON, generated:new Date().toISOString(),
      model:{calA:CAL_A,calB:CAL_B,blendRoster:BLEND_ROSTER,anchor:ANCHOR,homeAdv:HOME_ADV,sigma:SIGMA,
        coachW:COACH_W,coachK:COACH_K,coachCap:COACH_CAP,shotK:SHOT_K,shotRegress:SHOT_REGRESS,shotCap:SHOT_CAP,
        hcaBase:hcaData?{base:hcaData.base,capMin:hcaData.capMin}:null},
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
      // Only the OWNER publishes this shared cache (their JWT passes owner-only RLS).
      // Everyone else reads it — no anon writes. Pairs with the RLS lockdown.
      var tok = (typeof window!=='undefined' && window.tdcOwnerToken) ? window.tdcOwnerToken() : null;
      if(!tok) return;
      await fetch(SB+'/rest/v1/predictive_ratings?on_conflict=season',{
        method:'POST',
        headers:{...H,'Authorization':'Bearer '+tok,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify({season:SEASON,data,updated_at:new Date().toISOString()}),
      });
    }catch(e){}
  }

  let _mem=null,_loading=null;
  function get(){
    if(_mem) return Promise.resolve(_mem);
    if(_loading) return _loading;
    const adopt=data=>{ if(data&&data.model&&data.model.hcaBase) _hcaCurve=data.model.hcaBase; _mem=data; return data; };
    _loading=(async()=>{
      const db=await readDb();
      if(db) return adopt(db);
      try{
        const c=JSON.parse(localStorage.getItem(LS_KEY)||'null');
        if(c&&c.t&&Date.now()-c.t<TTL&&c.data) return adopt(c.data);
      }catch(e){}
      const data=await compute();
      adopt(data);
      try{ localStorage.setItem(LS_KEY,JSON.stringify({t:Date.now(),data})); }catch(e){}
      writeDb(data);
      return data;
    })();
    return _loading;
  }

  // Recompute the projected ratings with freshman projection overrides applied and
  // republish them as the shared source of truth (predictive_ratings). Called by
  // the freshman editor on save so a freshman's PROJECTED STATS move the rankings.
  // overrides = { byEspn:{[espn_id]:{bpm,min}}, byNameTeam:{['team|name']:{bpm,min}} }.
  async function rebuild(overrides){
    _ovr=overrides||null;
    let data;
    try{ data=await compute(); } finally { _ovr=null; }
    _mem=data;
    try{ localStorage.setItem(LS_KEY,JSON.stringify({t:Date.now(),data})); }catch(e){}
    await writeDb(data);
    return data;
  }

  // game line between two rating rows. venue: 'neutral' | 'home' (A hosts) | 'away'
  // home edge = opponent-strength baseline (bigger vs weak visitors) + the
  // HOST venue's own measured offset
  function lineFor(a,b,venue,totals){
    const hc=venue==='home'?  baseHca(b.rating)+(a.hcaOff||0)
            :venue==='away'?-(baseHca(a.rating)+(b.hcaOff||0)):0;
    const margin=a.rating-b.rating+hc;
    const pA=phi(margin/SIGMA);
    const total=(totals&&isFinite(totals))?totals:145.5;   // league-ish default
    return { margin:+margin.toFixed(1), probA:+(pA*100).toFixed(1), probB:+((1-pA)*100).toFixed(1),
      scoreA:Math.round(total/2+margin/2), scoreB:Math.round(total/2-margin/2),
      spread:(margin>=0?`${a.team} -${margin.toFixed(1)}`:`${b.team} -${(-margin).toFixed(1)}`) };
  }

  g.TDC_RATINGS={get, rebuild, lineFor, phi, applyForm, baseHca, SEASON, HOME_ADV, SIGMA};
})(window);
