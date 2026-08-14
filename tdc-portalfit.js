/* tdc-portalfit.js — shared Transfer Portal Fit engine (window.TDCPortalFit).
   Given a player + team_needs.json + coach_profiles.json, scores how well the
   player fits each team across four lenses (need / team-success / player-success
   / coaching-fit) + a weighted overall. Used by portal.html and player.html. */
(function(){
  var POS=['PG','SG','SF','PF','C'];
  function n(p,k){ var v=parseFloat(p&&p[k]); return isNaN(v)?0:v; }
  function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
  function s01(x){ return clamp(x,0,1); }
  function htin(h){ var m=/(\d+)\D+(\d+)/.exec(h||''); return m?(+m[1]*12 + +m[2]):0; }

  // Continuous trait profile (mirrors team.html _sqProfile).
  function profile(p){
    var tpa=n(p,'tpa'), tp=n(p,'tp_pct')||n(p,'three_pct'), fg=n(p,'fg_pct'),
        apg=n(p,'apg'), rpg=n(p,'rpg'), blk=n(p,'blk')||n(p,'bpg'), stl=n(p,'stl')||n(p,'spg'),
        ppg=n(p,'ppg'), fga=n(p,'fga')||9, ht=htin(p.height)||78;
    return {
      shooter: s01((tp-31)/11)*s01(tpa/3.5),
      creator: s01((apg-1.6)/4),
      finisher: s01((fg-46)/12)*s01(1-(tpa/Math.max(fga,1))*1.4),
      rimProtect: s01((blk-0.4)/1.5),
      rebounder: s01((rpg-3)/6),
      perimD: s01((stl-0.5)/1.4),
      ballDom: s01((ppg-8)/14)*s01((tpa*0.5+apg+0.4)/8),
      size: s01((ht-72)/12),
      scorer: s01((ppg-6)/16)
    };
  }
  function pos(p){
    var x=(p.position||'').toUpperCase().trim();
    if(x==='PG') return 'PG'; if(x==='SG'||x==='CG') return 'SG';
    if(x==='SF'||x==='GF') return 'SF'; if(x==='PF') return 'PF'; if(x==='C') return 'C';
    if(x==='G') return htin(p.height)<=74?'PG':'SG';
    if(x==='F') return htin(p.height)>=80?'PF':'SF';
    var h=htin(p.height)||78;
    return h<=73?'PG':h<=77?'SG':h<=80?'SF':h<=83?'PF':'C';
  }
  function archetype(p){
    var P=profile(p), g=(p.position||'').toUpperCase(), big=g==='C'||g==='PF';
    if(big){ if(P.shooter>0.42) return 'Stretch Big'; if(P.rimProtect>0.5&&P.finisher>0.35) return 'Two-Way Big';
      if(P.rimProtect>0.52) return 'Rim Protector'; if(P.scorer>0.6&&P.finisher>0.42) return 'Post Scorer';
      if(P.finisher>0.48) return 'Rim Runner'; if(P.rebounder>0.62) return 'Glass Cleaner'; return 'Interior Big'; }
    var guard=g==='PG'||g==='SG'||g==='G';
    if(guard){ if(P.creator>0.62&&P.ballDom>0.48) return 'Lead Guard'; if(P.creator>0.5) return 'Floor General';
      if(P.shooter>0.5&&P.perimD>0.42) return '3&D Guard'; if(P.shooter>0.54) return 'Sharpshooter';
      if(P.scorer>0.62) return 'Scoring Guard'; if(P.perimD>0.55) return 'On-Ball Stopper'; return 'Combo Guard'; }
    if(P.creator>0.5) return 'Point Forward'; if(P.shooter>0.5&&P.perimD>0.42) return '3&D Wing';
    if(P.shooter>0.52) return 'Movement Shooter'; if(P.scorer>0.62) return 'Wing Scorer';
    if(P.perimD>0.55) return 'Wing Stopper'; if(P.finisher>0.5) return 'Slasher'; return 'Connector Wing';
  }

  // How the player fits a coach's system (mirrors team.html _coachPlayerFit).
  function coachFit(prof, player){
    if(!prof||!prof.pctl) return {fit:60, reasons:[]};
    var d=prof.pctl, P=profile(player), D=function(k){ return d[k]!=null?d[k]/100:.5; };
    var s=58, R=[]; function add(x,t){ s+=x; if(Math.abs(x)>=3&&t) R.push({d:Math.round(x),t:t}); }
    var pace=D('poss_pg'), three=D('three_pa_rate'), star=D('top_scorer_share'), ast=D('ast_rate');
    // "big" = plays inside. Position first (resolves "F"/blank by height — Boozer is
    // listed "F"), plus an undersized-post catch: heavy rebounder who doesn't space
    // the floor (e.g. Bonzie Colson at 6'5" played the 5, not a speed wing).
    var _pp=pos(player); var isBig=(_pp==='C'||_pp==='PF')||(P.rebounder>0.6&&P.shooter<0.42);
    // "runner" = how much up-tempo actually helps him. Perimeter athletes gain from
    // pace; back-to-the-basket bigs are neutral-to-better in the half-court, so a big
    // only scores high here as a genuine rim-runner (mobile finisher), never as a
    // skilled post. This stops a slow big reading as a "speed" player a slow tempo wastes.
    var runner = isBig ? s01(P.finisher*0.55 + P.perimD*0.20 - P.size*0.30 + 0.12)
                       : s01(P.perimD*0.5+(1-P.size)*0.6+P.creator*0.3);
    var tempoTxt = isBig
      ? (pace>0.5 ? (runner>0.5?'runs the floor hard in his up-tempo system':'a fast pace can leave this half-court big trailing the play')
                  : (runner>0.5?'his rim-running goes to waste in this walk-it-up tempo':'fits his half-court, play-through-the-post tempo'))
      : (pace>0.5 ? (runner>0.5?'thrives in his up-tempo system':'may struggle to keep his pace')
                  : (runner>0.5?'his tempo underuses this player’s speed':'fits his half-court tempo'));
    add((pace-0.5)*(runner-0.5)*60, tempoTxt);
    add((three-0.5)*(P.shooter-0.45)*72, three>0.5?(P.shooter>0.45?'his shooting fits the spread system':'no shooting hurts the coach’s spacing'):'');
    add((star-0.5)*(P.scorer-0.5)*46, star>0.5?(P.scorer>0.5?'gets featured in the star-centric offense':''):(P.scorer>0.5?'the egalitarian system caps this scorer':'fits the share-the-ball offense'));
    add((ast-0.5)*(P.creator-0.4)*36, (ast>0.5&&P.creator>0.4)?'his passing suits the coach’s ball movement':'');
    R.sort(function(a,b){return Math.abs(b.d)-Math.abs(a.d);});
    return {fit:clamp(Math.round(s),25,98), reasons:R.slice(0,2)};
  }

  // Project the player's individual stat line IF he played at this team. The
  // system doesn't just SCALE his current line — it RESHAPES it. A pass-first PG
  // dropped into a star-centric, alpha-vacant offense becomes a scorer (more
  // points, fewer assists); the same PG in a ball-movement system stays a
  // distributor. So on top of minutes+pace (volume), we apply a score<->pass
  // "tilt" from the coach's system + who's already on the roster.
  function projLine(player, ctx){
    var mpgNow=n(player,'mpg')||26;
    var pmin=function(k){ var v=n(player,k); return mpgNow>0? v/mpgNow : 0; };
    var r1=function(v){ return Math.round(Math.max(0,v)*10)/10; };
    // Projected MINUTES vary by team: the coach's rotation depth (a tight 6-7 man
    // rotation runs starters 37-38; a deep bench ~29) and how firmly he takes the
    // job (a clear upgrade locks heavy minutes; a near-parity incumbent = a
    // timeshare ~28).
    var rot=ctx.rotationSize||9, up=(ctx.upgrade==null?3:ctx.upgrade), mpg;
    if(ctx.role==='Day-1 starter'){
      // rotation depth sets the baseline: avg ~33, deep bench ~29, and only a
      // genuinely tight 6-7 man rotation reaches the mid-30s
      var base=clamp(33-(rot-8)*1.2, 29, 36);
      if(up>=12) base+=2;                  // clear-cut alpha at a needy spot (rare) -> 36-38
      else if(up>=6) base+=0.5;            // firm starter -> low/mid 30s
      else base-=(5-up)*1.6;               // thin margin over the incumbent -> timeshare 27-30
      mpg=clamp(Math.round(base), 27, 38);
    } else if(ctx.role.indexOf('Rotation')>=0){
      mpg=clamp(Math.round(22+up*0.8), 14, 27);
    } else {
      mpg=clamp(Math.round(12+up*0.4), 6, 14);
    }

    // system context, each centered to roughly -1..+1
    var pace=((ctx.coachPace||50)-50)/50;   // + up-tempo -> more possessions
    var star=((ctx.coachStar||50)-50)/50;   // + star-centric -> concentrate scoring
    var mov =((ctx.coachAst ||50)-50)/50;   // + ball-movement -> spread the assists
    var room=((ctx.usageRoom||50)-50)/50;   // + he's the alpha (no one above him)

    var paceMult=1+0.15*pace;
    var role=clamp(1+0.11*room, 0.87, 1.16);        // featured-ness: mild total bump
    // the reshaper: star-centric + alpha room push him to SCORE; ball-movement
    // pushes him to PASS. Points rise / assists fall as tilt goes positive.
    var tilt=clamp(0.44*star + 0.30*room - 0.40*mov, -0.78, 0.82);

    var base=function(k){ return pmin(k)*mpg*paceMult*role; };
    var ppg=base('ppg')*(1+0.44*tilt);
    var apg=base('apg')*(1-0.52*tilt);
    var tp =(n(player,'tp_pct')||n(player,'three_pct'))*(1-0.05*Math.max(0,tilt)); // heavier creation dents efficiency a touch
    return {
      mpg: mpg,
      ppg: r1(Math.min(ppg,28)),
      rpg: r1(pmin('rpg')*mpg*(1+0.05*pace)),
      apg: r1(Math.min(apg,11.5)),
      spg: r1((pmin('stl')||pmin('spg'))*mpg),
      tp_pct: Math.round(tp*10)/10
    };
  }

  var DEF_W={need:0.20, team:0.30, player:0.25, coach:0.25};
  // ── POSITION FLEXIBILITY ──────────────────────────────────────────────────
  // A player isn't locked to his listed spot. From size + skills he can slide to
  // an adjacent position with a penalty; the coach's scheme (small-ball vs plays
  // big) softens or hardens it. Ideal height windows per spot (inches):
  var HT={PG:[72,76], SG:[75,79], SF:[77,81], PF:[79,84], C:[82,92]};
  function htIn(h){ var m=/(\d+)[\-'’](\d+)/.exec(h||''); return m?(+m[1]*12 + +m[2]):0; }
  // how POORLY a player suits a position (0 = great, higher = worse) from height + role skills
  function posSuit(player, tp){
    var P=profile(player), h=htIn(player.height)||78, r=HT[tp];
    var overF=(tp==='PG'||tp==='SG')?1.3:(tp==='SF')?0.7:0.3;        // tall guards penalized; tall bigs are fine
    var htPen = h<r[0] ? (r[0]-h)*1.3 : h>r[1] ? (h-r[1])*overF : 0; // undersized always hurts
    var sk;
    if(tp==='PG') sk=Math.max(0, 3.2-(n(player,'apg')||0))*1.2;                             // must create
    else if(tp==='SG'||tp==='SF') sk=Math.max(0,0.42-P.shooter)*7 + Math.max(0,0.5-P.scorer)*3; // must space/score
    else sk=Math.max(0,0.42-P.rebounder)*7 + Math.max(0,0.45-P.size)*6;                     // must have size
    return htPen+sk;
  }
  // positions he can play = natural (0 penalty) + adjacent spots he isn't badly miscast at
  function positionsFor(player){
    var ORD=['PG','SG','SF','PF','C'], natural=pos(player), ni=ORD.indexOf(natural);
    if(ni<0){ ni=1; natural='SG'; }
    var natSuit=posSuit(player, natural), out=[{pos:natural, pen:0}];
    [ni-1, ni+1].forEach(function(i){ if(i<0||i>4) return;
      var p=ORD[i], pen=-(posSuit(player,p)-natSuit);   // extra unsuitability vs his natural spot
      if(pen>=-9) out.push({pos:p, pen:clamp(pen,-9,0)});
    });
    return out;
  }
  // coach scheme: 0 = plays big (punishes undersized), 100 = small-ball / guard-heavy (hides size)
  function coachSmallBall(prof){
    if(!prof||!prof.pctl) return 50;
    var d=prof.pctl, three=d.three_pa_rate!=null?d.three_pa_rate:50,
        pace=d.poss_pg!=null?d.poss_pg:50, oreb=d.oreb_pg!=null?d.oreb_pg:50;
    var s=three*0.5 + pace*0.2 + (100-oreb)*0.3, a=prof.archetype||'';
    if(/Bigs|Grind/i.test(a)) s-=16;
    if(/Shooter|Motion|Up-Tempo/i.test(a)) s+=12;
    return clamp(s,0,100);
  }

  // Score a player at a team, trying every position he can realistically play and
  // keeping his best-fitting spot. forcePos locks it to one position (reverse-view
  // position filter); returns null if he can't play that spot.
  function scoreTeam(player, team, prof, weights, forcePos){
    var W=weights||DEF_W, pg=parseFloat(player.tdc_grade)||70;
    var elig=positionsFor(player), sb=coachSmallBall(prof), natural=elig[0].pos;
    var cands=forcePos?elig.filter(function(e){return e.pos===forcePos;}):elig;
    if(!cands.length) return null;
    var best=null;
    cands.forEach(function(e){
      var pen=clamp(e.pen*(1-(sb-50)/50*0.5), -12, 0);   // small-ball softens, big hardens
      var s=_scoreAtPos(player, pg, pg+pen, team, prof, e.pos, W, e.pos===natural, pen);
      if(!best || s.overall>best.overall) best=s;
    });
    if(best) best.naturalPos=natural;
    return best;
  }
  function _scoreAtPos(player, pg, eff, team, prof, pp, W, isNatural, posPen){
    var rank=team.rank||120;
    var slotD=(team.pos&&team.pos[pp])||{best:null};
    // No player listed at this exact spot doesn't mean it's empty — an adjacent
    // guard/wing/big slides over (with a small out-of-position penalty). Falling
    // back to a phantom low baseline would fake a huge "upgrade" on loaded teams.
    var posBest=slotD.best, slid=false;
    if(posBest==null){
      var ADJ={PG:['SG'],SG:['PG','SF'],SF:['SG','PF'],PF:['SF','C'],C:['PF']}[pp]||[];
      var b=0; ADJ.forEach(function(a){ var v=team.pos&&team.pos[a]&&team.pos[a].best; if(v!=null) b=Math.max(b,v-4); });
      posBest = b || (rank<=25?72:rank<=60?68:64);   // floor scaled to team quality
      slid=true;
    }
    var upgrade=eff-posBest;                                  // + = his (position-adjusted) grade beats their best there
    // team's overall top talent (alpha) — for usage room
    var topGrade=56; if(team.pos) POS.forEach(function(k){ var b=team.pos[k]&&team.pos[k].best; if(b!=null&&b>topGrade) topGrade=b; });

    // Need = does THIS player improve the spot? Driven by how far he upgrades their best
    // there (a clear upgrade is a real need even if the incumbent is "decent"), plus an extra
    // bump when the incumbent is genuinely weak. The old formula keyed ONLY on incumbent
    // strength, so a player plainly better than a capable starter wrongly read as "not needed."
    var hole=clamp((66-posBest)*2.2, 0, 30);
    var need=clamp(50 + upgrade*3.3 + hole, 8, 100);
    // Team-Success = winning at a good program with a role to grab. Team QUALITY leads
    // (a contender scores highest — the whole point of the lens); the upgrade delta is a
    // modifier, not the driver, so a #300 low-major can't top the board just because you'd
    // upgrade its weak starter. (Old formula was 55 + upgrade*3.2, which the 79-team pool hid.)
    var teamQual=rank<=8?100:rank<=20?90:rank<=40?76:rank<=70?60:rank<=110?46:rank<=170?33:20;
    var teamSuccess=clamp(teamQual*0.62 + clamp(upgrade,-6,15)*2.4, 0, 100);
    // Opportunity scales with how clearly he beats the incumbent — a clear upgrade starts.
    var opp=clamp(52 + upgrade*3.0, 25, 100);
    var pace=(prof&&prof.pctl&&prof.pctl.poss_pg!=null)?prof.pctl.poss_pg:50;
    var alphaGap=topGrade-pg;
    var usageRoom=clamp(100-Math.max(0,alphaGap)*4, 30, 100);
    var playerSuccess=clamp(opp*0.5+pace*0.25+usageRoom*0.25, 0, 100);
    var cf=coachFit(prof, player);
    // Level-realism: a player who is drastically OVERQUALIFIED for a team (his grade far
    // above the team's best returning player) is an unrealistic landing spot — a high-major
    // starter isn't really choosing a #300 program even though it offers max minutes. Damp
    // the Overall by how far he outclasses the roster's ceiling (bounded; full pool still
    // reachable, and dropping ~1 tier is barely touched). Not applied to the sub-scores.
    // scales with BOTH calibers: a high-major starter (high grade) dropping to a #300
    // program is unrealistic and gets damped hard; a fringe player (low grade) legitimately
    // can, so he's barely touched. gradeFac 0 at ~64 → 1 at ~90; teamQual is the program tier.
    var gradeFac=clamp((pg-64)/26, 0, 1);
    // ...but a player evaluated at his OWN team (a committed transfer's landing spot, or a
    // returner) has by definition already chosen that level — never damp the self-fit.
    var sameTeam=player.team&&team.team&&(''+player.team).toLowerCase()===(''+team.team).toLowerCase();
    var realism = sameTeam ? 1 : (1 - (1 - teamQual/100) * gradeFac * 0.55);
    var overall=Math.round((need*W.need + teamSuccess*W.team + playerSuccess*W.player + cf.fit*W.coach) * realism);

    // role/opportunity label
    var role=upgrade>=2?'Day-1 starter':upgrade>-6?'Rotation / pushes for time':'Depth piece';
    var coachStar=(prof&&prof.pctl&&prof.pctl.top_scorer_share!=null)?prof.pctl.top_scorer_share:50;
    var coachAst=(prof&&prof.pctl&&prof.pctl.ast_rate!=null)?prof.pctl.ast_rate:50;
    var rotSize=(prof&&prof.rotation_size!=null)?prof.rotation_size:9;
    var proj=projLine(player, {role:role, coachPace:pace, coachStar:coachStar, coachAst:coachAst,
      usageRoom:usageRoom, rotationSize:rotSize, upgrade:upgrade});
    // one-line why — explain the DOMINANT drivers of the (weighted) overall, so a
    // low fit reads as an actual weakness, not a stray positive. Each factor has a
    // high-side and low-side phrase; we pick by weighted impact vs the midpoint.
    var cap=function(s){ return s?s.charAt(0).toUpperCase()+s.slice(1):s; };
    var cPos=cf.reasons.filter(function(r){return r.d>0;}), cNeg=cf.reasons.filter(function(r){return r.d<0;});
    // why his production upside is capped: the lowest of opportunity / tempo / usage room
    var pLo = (opp<=pace && opp<=usageRoom) ? 'he’d have to beat out a capable starter for the role'
            : (pace<=usageRoom)             ? 'a grind-it-out tempo would cap his counting stats'
            :                                 'an established alpha is ahead of him for touches';
    var facs=[
      {w:W.need, v:need,
        hi:(upgrade>=3?'would be their best '+pp+' (their best now is a '+Math.round(posBest)+')':'fills a thin '+pp+' spot'),
        lo:(upgrade>=-1?'a lateral move at '+pp+' — no real upgrade':'they’re already better at '+pp+(posBest!=null?' ('+Math.round(posBest)+')':''))},
      {w:W.team, v:teamSuccess,
        hi:(rank<=25?'a genuine top-25 contender':rank<=45?'a solid, winning program':'would lift a middling team'),
        lo:(rank>=70?'a rebuilding team (#'+rank+') that won’t contend soon':'limited team upside — not a contender yet')},
      {w:W.player, v:playerSuccess,
        hi:'a clear path to big minutes and touches',
        lo:pLo},
      {w:W.coach, v:cf.fit,
        hi:(cPos[0]&&cPos[0].t)||'fits the coach’s system',
        lo:(cNeg[0]&&cNeg[0].t)||'a stylistic mismatch with the coach’s system'}
    ];
    // only factors that actually carry weight can drive the explanation (so a
    // 0%-weight lens never gets pulled into a contradictory "but" clause)
    var active=facs.filter(function(f){return (f.w||0)>=0.08;});
    active.forEach(function(f){ f.impact=(f.v-50)*f.w; f.phrase=(f.v>=50?f.hi:f.lo); });
    active.sort(function(a,b){return Math.abs(b.impact)-Math.abs(a.impact);});
    var p1=active[0], p2=active[1], why;
    if(!p1){ why='a middling fit'; }
    else if(p2 && Math.abs(p2.impact)>=Math.abs(p1.impact)*0.5){
      if((p1.impact>=0)!==(p2.impact>=0)){                 // one plus, one minus -> contrast
        var posF=p1.impact>=0?p1:p2, negF=p1.impact>=0?p2:p1;
        why=cap(posF.hi)+', but '+negF.lo;
      } else { why=cap(p1.phrase)+'; '+p2.phrase; }        // same sign -> list both
    } else { why=cap(p1.phrase); }                          // one dominant driver
    why=why?(why.charAt(0).toUpperCase()+why.slice(1)+'.'):'';

    return {team:team.team, full:team.full, conf:team.conf, rank:team.rank, rating:team.rating,
      coach:team.coach, coach_slug:team.coach_slug, archetype:team.archetype,
      playerPos:pp, offNatural:!isNatural, posPen:Math.round(posPen*10)/10,
      posBest:Math.round(posBest*10)/10, starter:slotD.starter, slid:slid, upgrade:Math.round(upgrade*10)/10,
      need:Math.round(need), teamSuccess:Math.round(teamSuccess), playerSuccess:Math.round(playerSuccess),
      coachFit:cf.fit, overall:overall, role:role, why:why, proj:proj};
  }

  // Rank all teams for a player. opts: {weights, sortBy, filter:{maxRank,confs,minRating}}
  function rank(player, teams, profsBySlug, opts){
    opts=opts||{}; var W=opts.weights||DEF_W, f=opts.filter||{};
    var rows=teams.map(function(t){ return scoreTeam(player, t, t.coach_slug?profsBySlug[t.coach_slug]:null, W); });
    rows=rows.filter(function(r){
      if(f.maxRank && (r.rank==null || r.rank>f.maxRank)) return false;
      if(f.confs && f.confs.length && f.confs.indexOf(r.conf)<0) return false;
      if(f.minRating!=null && (r.rating==null || r.rating<f.minRating)) return false;
      return true;
    });
    var key=opts.sortBy||'overall';
    rows.sort(function(a,b){ return (b[key]||0)-(a[key]||0) || (b.overall-a.overall); });
    return rows;
  }

  // Reverse view: for ONE team, rank a pool of candidate players by fit.
  function rankTargets(team, prof, players, opts){
    opts=opts||{}; var f=opts.filter||{};
    var rows=players.map(function(pl){
      var s=scoreTeam(pl, team, prof, opts.weights, f.pos||null);   // forcePos -> only players who can play it
      if(!s) return null;
      s.player=pl.name; s.playerTeam=pl.team; s.height=pl.height; s.espn_id=pl.espn_id;
      s.playerGrade=Math.round(parseFloat(pl.tdc_grade)||0); s.playerArch=archetype(pl);
      s.cur={ppg:n(pl,'ppg'), rpg:n(pl,'rpg'), apg:n(pl,'apg'), tp_pct:n(pl,'tp_pct')||n(pl,'three_pct')};
      return s;
    }).filter(Boolean);
    rows=rows.filter(function(r){
      if(f.minGrade && r.playerGrade<f.minGrade) return false;
      if(f.excludeTeam && r.playerTeam===team.team) return false;   // already on this team
      return true;
    });
    var key=opts.sortBy||'overall';
    rows.sort(function(a,b){ return (b[key]||0)-(a[key]||0)||(b.overall-a.overall); });
    return rows;
  }

  window.TDCPortalFit={ profile:profile, archetype:archetype, pos:pos, coachFit:coachFit,
    scoreTeam:scoreTeam, rank:rank, rankTargets:rankTargets, DEFAULT_WEIGHTS:DEF_W };
})();
