/* Predictive team ratings + game lines, built from PROJECTED rosters.

   Rating pipeline (2026-27):
     1. Every rostered player gets a projected BPM: last season's bbref BPM
        through the measured lag model (0.635 + 0.785·bpm) with a class bump,
        or a grade proxy when no bbref row exists (freshmen, no-stat players).
        Players marked out for the season are excluded.
     2. Projected minutes come from the SAME depth-chart-calibrated model as the
        team/player pages (TDCProjGrade.gradeRoster) — each player weighted by his
        projected ROLE (the coach's chart), not last season's MPG or a top-N-by-BPM
        re-sort, so a benched transfer stops counting as a starter.
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
  const SEASON=2027, LS_KEY='tdc_ratings_v17_'+SEASON, TTL=24*3600*1000;
  // in-season form: once 2026-27 games are played, each team's rating drifts
  // toward how it's ACTUALLY performing vs our own lines. surprise = actual
  // margin - expected margin; form = sum(surprise)/(n + FORM_PRIOR) capped at
  // ±FORM_CAP — a hot team gains up to +3, a cold one loses up to -3, and it
  // takes a sustained run (not two lucky games) to move much.
  const FORM_PRIOR=10, FORM_CAP=3;
  const CAL_A=-0.3, CAL_B=4.16;            // BPM→SRS (recal 2026-08: was 11.75/2.355 — intercept too high + slope too shallow bunched 24 teams ≥20.3; now ~6, matching historical spread; avg-BPM roster → ~0)
  // OWNED BPM. Each returner enters the projection on the Box Plus/Minus scale.
  // A regression of bbref BPM onto OUR OWN box-derived rates (player_advanced) PLUS the
  // player's team quality — his 2026 team's owned Power Rating (team_seasons.srs). That
  // team term is the same "team adjustment" real BPM uses (a player's rating is tied to
  // how good his team actually was), and it's what lifts this fit from r~0.79 (box-only,
  // which left star-driven teams like UConn 26 spots low) to r~0.95 vs real BPM. Result is
  // de-attenuated to real-BPM spread so the CAL_A/CAL_B mapping stays valid. REPLACES the
  // old `ti40 -> BPM` shortcut (r~0.36) that compressed the star tier and scrambled ranks.
  // No Sports-Reference read: trained offline, only these static constants ship, and srs is
  // our own metric. Rebuild / re-derive: scripts/build_bpm_model.py (prints these verbatim).
  const BPM_B0=-5.17252, BPM_MU=-0.5627, BPM_K=1.0590, BPM_SRS=0.31069;
  const BPM_FEATS=['ts_pct','efg_pct','tp_pct','ft_pct','pts40','reb40','ast40','usg_pct','ast_pct','tov_pct','orb_pct','drb_pct','stl_pct','blk_pct','ti40'];
  const BPM_COEF=[0.32314,1.29670,2.03894,0.99409,0.21218,0.13564,-2.82989,-0.39381,0.64736,-0.07035,-0.13910,0.02546,0.42890,0.09517,0.47585];
  function estBpm(r, teamSrs){   // player_advanced row + his team's owned Power Rating -> owned BPM
    if(!r) return NaN;
    let s=BPM_B0 + BPM_SRS*(isFinite(teamSrs)?teamSrs:0);
    for(let i=0;i<BPM_FEATS.length;i++){
      const v=parseFloat(r[BPM_FEATS[i]]);
      if(!isFinite(v)) return NaN;
      s+=BPM_COEF[i]*v;
    }
    return BPM_MU+(s-BPM_MU)*BPM_K;
  }
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
  // Continuity. A high share of returning minutes tends to over-perform raw talent
  // (chemistry/system familiarity) — a standard early-season signal. Small bounded
  // nudge on the final rating, centered on a typical returning-minutes share.
  const CONT_BASE=35, CONT_K=0.03, CONT_CAP=1.5;
  // Scoring-engine scarcity. Owned BPM rewards efficient LOW-usage players (its usg
  // coefficient is negative), so a rotation of efficient role players with no primary
  // bucket-getter can over-rate (e.g. Saint Louis: everyone efficient, nobody >~18 pts/40).
  // Penalize teams whose best real-load scorer falls below a per-40 threshold — but WAIVE it
  // in proportion to elite PLAYMAKING (a distributor engine) or elite DEFENSE, so a pass-first
  // PG team (Michigan State, top ast% ~53) or a defense-led team (Arizona) isn't punished for
  // lacking a volume scorer. leadPts40 = best pts/40 among rotation regulars using ≥SCE_USG%;
  // carve = max(playmaking ramp on top ast%, defense ramp on minutes-weighted stl%+blk%).
  // All tunable; set SCE_K=0 to disable. Calibrated on 2026-27 rosters (see the ratings notes).
  // Calibrated on the 2026-27 field (projected-minutes rotations): TARGET=19 pts/40 only bites
  // teams with a genuinely weak lead scorer (SLU 18.4) and spares borderline ones (Arizona 19.1);
  // cap 2.0 keeps it a nudge, not a hammer. AST/DEF carve ramps set to the real distribution so
  // only elite distributors (MSU 53) / elite steal-block defenses (>~4.5) get waived.
  const SCE_TARGET=19.0, SCE_K=0.45, SCE_CAP=2.0;   // pen = K·max(0, TARGET − leadPts40), capped
  const SCE_MINMIN=18, SCE_USG=20;                  // "rotation regular" proj. minutes; real-load usage
  const SCE_AST_LO=25, SCE_AST_HI=42;               // playmaking carve-out ramp (top ast%)
  const SCE_DEF_LO=3.8, SCE_DEF_HI=6.0;             // defense carve-out ramp (mw stl%+blk%)
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
    const [teams, players, bb, ts, hcaData, coachData, sgData, contData, levelData]=await Promise.all([
      fetch(SB+'/rest/v1/teams?select=name,conf,conference,head_coach,coach&limit=500',{headers:H}).then(r=>r.json()),
      fetchPaged(SB+'/rest/v1/players?name=neq.%E2%80%94&select=name,team,espn_id,yr,class_year,tdc_grade,mpg,ppg,rpg,depth_order,is_injured,hometown&order=id.asc'),
      fetchPaged(SB+'/rest/v1/player_advanced?season_year=eq.2026&espn_id=not.is.null&select=espn_id,team,ts_pct,efg_pct,tp_pct,ft_pct,pts40,reb40,ast40,usg_pct,ast_pct,tov_pct,orb_pct,drb_pct,stl_pct,blk_pct,ti40&order=espn_id.asc'),
      fetch(SB+'/rest/v1/team_seasons?season_year=eq.2026&select=team,conference,srs,tier&limit=1000',{headers:H}).then(r=>r.json()),
      fetch('scripts/data/team_hca.json').then(r=>r.ok?r.json():null).catch(()=>null),
      fetch('data/coach-careers.json').then(r=>r.ok?r.json():null).catch(()=>null),
      fetch('scripts/data/shot_genome_players.json').then(r=>r.ok?r.json():null).catch(()=>null),
      fetch('data/continuity.json').then(r=>r.ok?r.json():null).catch(()=>null),
      fetch('scripts/data/level_adj.json').then(r=>r.ok?r.json():null).catch(()=>null),
    ]);
    const hcaOf=(hcaData&&hcaData.teams)||{};
    const confOf={}; (teams||[]).forEach(t=>{ confOf[t.name]=t.conf||t.conference||''; });
    // LEVEL-OF-COMPETITION regression, applied at the SOURCE (per player, on projected BPM)
    // rather than as a flat team tax. A mid-major's production is earned against a weaker
    // schedule, so its top teams' projected rosters run too high (Saint Louis, Utah State kept
    // landing top-15). Discount each rotation player's positive projected BPM by how far his
    // LEAGUE sits below the HIGH-MAJOR line — so the tax targets the inflated top-of-conference
    // rosters (scaled by the value each player brings) and leaves modest mid-major teams alone.
    // Above the high-major line (top 7 leagues: Big 12…Pac-12) the gap is 0 → power teams untouched.
    const CONF_STR=(levelData&&levelData.conf_strength)||{}, TEAM_CONF=(levelData&&levelData.team_conf)||{};
    const LEVEL_HM=19.5, LEVEL_BPM_K=0.05, LEVEL_BPM_MAX=0.45;   // high-major line; per-SRS-gap haircut; cap
    // proven-elite exception: a mid-major whose OWN schedule-adjusted prior clears this line has
    // earned its level (SRS already adjusts for schedule) — taper its discount toward FLOOR so an
    // outlier like Gonzaga isn't treated as a typical mid-major; the rest of its league keeps full.
    const LEVEL_PROVEN_HM=17.0, LEVEL_PROVEN_SPAN=5.0, LEVEL_PROVEN_FLOOR=0.3;
    // coach lift runs through the SAME strength-of-competition logic: a positive lift earned
    // against a weak schedule is tapered so a mid-major coach can't out-bonus a proven
    // high-major one (Dutcher/Jacobson were sitting above Izzo). Stronger coefficient than the
    // roster because the anomaly is starker; the proven-elite taper still spares Few.
    const COACH_LEVEL_K=0.20, COACH_LEVEL_MAX=0.55;
    // hand regression on a coach's lift when his career overachievement carries real
    // uncertainty into a NEW program (we have no reliable first-year-at-a-new-school signal):
    const COACH_LIFT_MULT={ 'ben jacobson': 0.55 };   // just moved Northern Iowa -> Utah State
    function levelGapFor(full){
      const cf=TEAM_CONF[full]; const str=(cf!=null)?CONF_STR[cf]:null;
      return (str==null)?0:Math.max(0, LEVEL_HM-str);
    }
    // teams.head_coach is maintained from the roster sheet, so it reflects offseason
    // hires the Sports-Reference scrape hasn't seen yet — that's the whole point here.
    const cn=s=>(''+(s||'')).toLowerCase().replace(/[.'`]/g,'').replace(/\s+/g,' ').trim();
    // first-initial+last key so a sheet hire's nickname (Mike) still matches the career
    // record (Michael) when the last name is unique — mirrors the projection/coach-panel bridge.
    const _il=s=>{ const p=(''+(s||'')).toLowerCase().replace(/[^a-z ]/g,' ').split(/\s+/).filter(Boolean); return p.length>=2?(p[0][0]+'|'+p[p.length-1]):null; };
    const liftByCoach={}, liftByIL={};
    Object.keys(coachData||{}).forEach(k=>{ const c=coachData[k];
      if(c&&c.n&&c.lf!=null){ const rec={lf:+c.lf, n:+c.ln||0}; liftByCoach[cn(c.n)]=rec;
        const il=_il(c.n); if(il){ (liftByIL[il]=liftByIL[il]||[]).push(rec); } } });
    const coachAdjOf={};
    (teams||[]).forEach(t=>{
      let rec=liftByCoach[cn(t.head_coach||t.coach)];
      if(!rec){ const il=_il(t.head_coach||t.coach), a=il&&liftByIL[il]; if(a&&a.length===1) rec=a[0]; }
      if(!rec||!rec.n) return;
      const shrunk=rec.lf*(rec.n/(rec.n+COACH_K));          // 3 seasons counts ~3/8
      let cadj=COACH_W*shrunk;
      const mult=COACH_LIFT_MULT[cn(t.head_coach||t.coach)]; if(mult!=null) cadj*=mult;   // new-program uncertainty
      coachAdjOf[t.name]=+Math.max(-COACH_CAP,Math.min(COACH_CAP,cadj)).toFixed(2);
    });
    // Shot Genome per-player: eFG over Look Quality = shot-making luck (in eFG pts)
    const sgByEspn={}; ((sgData&&sgData.players)||[]).forEach(p=>{
      if(p.espn_id!=null && p.lq!=null && p.efg!=null && (p.fga||0)>=SHOT_MINFGA)
        sgByEspn[p.espn_id]={luck:p.efg-p.lq, fga:p.fga}; });
    const tsRows=(ts||[]);
    const srsOf={}; (ts||[]).forEach(t=>{ if(t.srs!=null) srsOf[t.team]=parseFloat(t.srs); });
    // Owned BPM per returner. Needs his 2026 team's owned Power Rating (srs) as the
    // team-adjustment term — player_advanced.team matches team_seasons.team exactly.
    // bpm  = owned BPM incl. his 2025-26 team's SRS context; bpm0 = context-neutral
    // (SRS=0) so a TRANSFER doesn't carry his old team's quality to his new school.
    const advById={}; (bb||[]).forEach(r=>{ if(r.espn_id!=null){ const b=estBpm(r, srsOf[r.team]); if(isFinite(b)) advById[r.espn_id]={bpm:b, bpm0:estBpm(r,0), team:r.team,
      usg:parseFloat(r.usg_pct), pts40:parseFloat(r.pts40), ast:parseFloat(r.ast_pct), stl:parseFloat(r.stl_pct), blk:parseFloat(r.blk_pct)}; } });

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
      // new team's own Power Rating (2025-26 SRS) — the level this roster projects INTO.
      // Used both for the program-anchor blend below and the transfer level-of-comp discount.
      const full=matchFull(short, tsRows, confOf[short])||short;
      const prior=srsOf[full];
      const newSrs=isFinite(prior)?prior:0;
      // this team's strength-of-competition haircut on projected BPM (0 for high-major leagues),
      // tapered down for a proven-elite mid-major whose own prior clears the proven line (Gonzaga)
      let levelDisc=Math.min(LEVEL_BPM_MAX, LEVEL_BPM_K*levelGapFor(full));
      if(levelDisc>0 && isFinite(prior) && prior>LEVEL_PROVEN_HM)
        levelDisc*=Math.max(LEVEL_PROVEN_FLOOR, 1-(prior-LEVEL_PROVEN_HM)/LEVEL_PROVEN_SPAN);
      // PROJECTED minutes from the depth-chart-calibrated model (same one team/player
      // pages use), so the rating weights each player by his projected ROLE, not last
      // season's minutes — a benched transfer stops counting as a starter. Falls back to
      // last-season mpg if the module isn't loaded.
      let projMin=null;
      if(window.TDCProjGrade && TDCProjGrade.gradeRoster){
        try{ const gr=TDCProjGrade.gradeRoster(roster); projMin=roster.map((p,i)=>(gr[i]&&isFinite(gr[i].min))?gr[i].min:null); }catch(e){}
      }
      let entries=roster.map((p,i)=>{
        const grade=parseFloat(p.tdc_grade)||70;
        const c=cls(p.yr||p.class_year);
        const adv=p.espn_id!=null?advById[p.espn_id]:null;
        // TRANSFER: his 2025-26 team differs from his 2026-27 program, so the team-defense/
        // quality credit baked into his BPM doesn't fully follow him — keep his own
        // production + only HALF the team-context boost (blend toward the context-neutral bpm0).
        const isXfer = !!(adv && adv.team && !String(adv.team).toLowerCase().startsWith(String(short).toLowerCase()));
        let bpm=adv?adv.bpm:NaN;   // OWNED BPM (regression on our box rates; see estBpm)
        if(isXfer && adv && isFinite(adv.bpm0)) bpm=0.5*bpm+0.5*adv.bpm0;
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
        // LEVEL-OF-COMPETITION discount: production earned against a weaker schedule doesn't
        // fully translate when a transfer steps UP a level. Regress projected BPM by the size
        // of the jump from his old team's Power Rating to his new team's (capped; no boost for
        // stepping down). Keeps mid-major transfers from projecting like high-major starters.
        if(isXfer && isFinite(projBpm) && projBpm>0){
          // Regress a transfer's PRODUCTION toward the mean by the size of the jump up a level
          // — multiplicative so it scales with how much value he's projected to bring (a
          // mid-major STAR sheds a lot, a modest role player barely moves and never goes
          // negative). Only positive projections; no penalty for stepping down.
          const oldSrs=(adv && adv.team && isFinite(srsOf[adv.team]))?srsOf[adv.team]:0;
          const srsJump=newSrs-oldSrs;
          // ALSO weigh the LEAGUE-level jump: a low-major star moving to a REBUILDING high-major
          // has a small team-SRS gap (e.g. Winthrop 1.2 -> Notre Dame 6.7 = +5.5, only 11%) that
          // badly understates the step up in competition (Big South -> ACC). Use whichever jump
          // is larger, on the same conf-strength scale as levelDisc, so the tax reflects the real
          // level change regardless of how good his new team happened to be last year.
          const _oc=(adv && adv.team)?TEAM_CONF[adv.team]:null, _nc=TEAM_CONF[full];
          const confJump=(_oc!=null && _nc!=null && CONF_STR[_oc]!=null && CONF_STR[_nc]!=null)
                         ? (CONF_STR[_nc]-CONF_STR[_oc]) : 0;
          const jump=Math.max(srsJump, confJump);
          if(jump>0) projBpm*=(1-Math.min(0.5, jump*0.02));
        }
        // STRENGTH-OF-COMPETITION regression (all rotation players on a sub-high-major team):
        // scale positive projected BPM down by the league's distance below the high-major line,
        // so a top mid-major's inflated roster regresses toward reality. Never flips a sign.
        if(isFinite(projBpm) && projBpm>0 && levelDisc>0) projBpm*=(1-levelDisc);
        const isTr=!!(p.hometown&&(''+p.hometown).trim());
        const hasStats=(parseFloat(p.ppg)||0)>0;
        let min=(projMin&&projMin[i]!=null)?projMin[i]
                 :(hasStats?Math.max(4,(parseFloat(p.mpg)||8)*(isTr?0.95:1))
                          :(grade>=92?26:grade>=88?22:grade>=82?15:grade>=78?10:6));
        // a transfer's role at a new school is uncertain — cap his projected minutes bump
        if(isXfer && isFinite(min)){ const lm=parseFloat(p.mpg); if(isFinite(lm)) min=Math.min(min, lm+10); }
        // Owner's freshman projection: value him by his PROJECTED STATS (a BPM
        // computed from the projected box score) and projected minutes — the same
        // currency as returners — rather than the grade/OVR fallback.
        if(_ovr){ const ov=(p.espn_id!=null&&_ovr.byEspn&&_ovr.byEspn[p.espn_id])?_ovr.byEspn[p.espn_id]
                    :(_ovr.byNameTeam&&_ovr.byNameTeam[((p.team||'')+'|'+(p.name||'')).toLowerCase()]);
          if(ov){ if(ov.bpm!=null&&!isNaN(+ov.bpm)) projBpm=+ov.bpm;
                  if(ov.min!=null&&!isNaN(+ov.min)) min=Math.max(4,+ov.min); } }
        return {projBpm,min,luckEfg,hasSg:!!sg,
          usg:adv?adv.usg:NaN, pts40:adv?adv.pts40:NaN, ast:adv?adv.ast:NaN, stl:adv?adv.stl:NaN, blk:adv?adv.blk:NaN};
      });
      // Rotation is now defined by the PROJECTED minutes (the depth chart), not a
      // top-11-by-BPM re-sort — so a high-BPM player the coach benches is weighted by his
      // real projected role. Deep bench self-weights to ~0; keep the projected rotation.
      const rot=entries.filter(e=>e.min>=3);
      const minSum=rot.reduce((s,e)=>s+e.min,0)||1;
      const mw=rot.reduce((s,e)=>s+e.projBpm*(e.min/minSum),0);
      const rosterRating=CAL_A+CAL_B*mw;
      // team shot luck: minutes-weighted eFG-over-quality of the rotation's returners
      const sgEnt=rot.filter(e=>e.hasSg); const sgMin=sgEnt.reduce((s,e)=>s+e.min,0);
      const shotLuck=sgMin?+(sgEnt.reduce((s,e)=>s+e.luckEfg*e.min,0)/sgMin).toFixed(1):null;
      let cAdj=coachAdjOf[short]||0;
      // taper a POSITIVE coach lift by the program's strength-of-competition (same proven-elite
      // relief as the roster) — a mid-major coach's overachievement doesn't fully translate.
      if(cAdj>0){
        let cd=Math.min(COACH_LEVEL_MAX, COACH_LEVEL_K*levelGapFor(full));
        if(cd>0 && isFinite(prior) && prior>LEVEL_PROVEN_HM)
          cd*=Math.max(LEVEL_PROVEN_FLOOR, 1-(prior-LEVEL_PROVEN_HM)/LEVEL_PROVEN_SPAN);
        if(cd>0) cAdj=+(cAdj*(1-cd)).toFixed(2);
      }
      const cont=(contData&&contData[short])?contData[short].continuity:null;
      const contAdj=cont!=null?+Math.max(-CONT_CAP,Math.min(CONT_CAP,CONT_K*(cont-CONT_BASE))).toFixed(2):0;
      // Scoring-engine scarcity penalty (see constants). Uses the projected rotation regulars.
      let scePen=0;
      const reg=rot.filter(e=>e.min>=SCE_MINMIN);
      if(reg.length && SCE_K>0){
        const loads=reg.filter(e=>isFinite(e.usg)&&e.usg>=SCE_USG&&isFinite(e.pts40)).map(e=>e.pts40);
        if(loads.length){
          const lead=Math.max.apply(null,loads);
          const raw=Math.min(SCE_CAP, SCE_K*Math.max(0, SCE_TARGET-lead));
          if(raw>0){
            const cl=x=>Math.max(0,Math.min(1,x));
            const topAst=Math.max.apply(null, reg.map(e=>isFinite(e.ast)?e.ast:0));
            const dmin=reg.reduce((s,e)=>s+e.min,0)||1;
            const mwDef=reg.reduce((s,e)=>s+((isFinite(e.stl)?e.stl:0)+(isFinite(e.blk)?e.blk:0))*e.min,0)/dmin;
            const carve=Math.max(cl((topAst-SCE_AST_LO)/(SCE_AST_HI-SCE_AST_LO)), cl((mwDef-SCE_DEF_LO)/(SCE_DEF_HI-SCE_DEF_LO)));
            scePen=+(raw*(1-carve)).toFixed(2);
          }
        }
      }
      // (strength-of-competition now regresses the roster BPM per-player above, so no flat team tax)
      const rating=(((prior!=null)?(BLEND_ROSTER*rosterRating+(1-BLEND_ROSTER)*(ANCHOR*prior))
                                 :rosterRating) + cAdj + contAdj) - scePen;
      rows.push({team:short, full, conf:confOf[short]||'', rating:+rating.toFixed(2), coachAdj:cAdj,
        contAdj:contAdj, continuity:cont,
        roster:+rosterRating.toFixed(2), prior:prior!=null?+prior.toFixed(1):null, projected:true,
        scePen:scePen||0, levelDisc:+levelDisc.toFixed(3), shotLuck:shotLuck, hcaOff:hcaOf[full]!=null?hcaOf[full]:0});
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
        coachW:COACH_W,coachK:COACH_K,coachCap:COACH_CAP,shotK:SHOT_K,shotRegress:SHOT_REGRESS,shotCap:SHOT_CAP,contBase:CONT_BASE,contK:CONT_K,contCap:CONT_CAP,
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
    const _sn=window.tdcShortSchool||(x=>x);   // trim carry-team mascots when the map is loaded
    return { margin:+margin.toFixed(1), probA:+(pA*100).toFixed(1), probB:+((1-pA)*100).toFixed(1),
      scoreA:Math.round(total/2+margin/2), scoreB:Math.round(total/2-margin/2),
      spread:(margin>=0?`${_sn(a.team)} -${margin.toFixed(1)}`:`${_sn(b.team)} -${(-margin).toFixed(1)}`) };
  }

  g.TDC_RATINGS={get, rebuild, lineFor, phi, applyForm, baseHca, SEASON, HOME_ADV, SIGMA};
})(window);
