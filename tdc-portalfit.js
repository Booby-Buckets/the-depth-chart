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
    var runner=s01(P.perimD*0.5+(1-P.size)*0.6+P.creator*0.3);
    add((pace-0.5)*(runner-0.5)*60, pace>0.5?(runner>0.5?'thrives in his up-tempo system':'may struggle to keep his pace'):(runner>0.5?'his tempo underuses this player’s speed':'fits his half-court tempo'));
    add((three-0.5)*(P.shooter-0.45)*72, three>0.5?(P.shooter>0.45?'his shooting fits the spread system':'no shooting hurts the coach’s spacing'):'');
    add((star-0.5)*(P.scorer-0.5)*46, star>0.5?(P.scorer>0.5?'gets featured in the star-centric offense':''):(P.scorer>0.5?'the egalitarian system caps this scorer':'fits the share-the-ball offense'));
    add((ast-0.5)*(P.creator-0.4)*36, (ast>0.5&&P.creator>0.4)?'his passing suits the coach’s ball movement':'');
    R.sort(function(a,b){return Math.abs(b.d)-Math.abs(a.d);});
    return {fit:clamp(Math.round(s),25,98), reasons:R.slice(0,2)};
  }

  // Project the player's individual stat line IF he played at this team — scale
  // his current per-minute production to the minutes/role he'd get, then nudge by
  // the coach's pace (more possessions) and how featured he'd be (usage room).
  function projLine(player, ctx){
    var mpgNow=n(player,'mpg')||26;
    var per=function(k){ var v=n(player,k)||n(player,ctx.alt&&ctx.alt[k])||0; return mpgNow>0? v/mpgNow : 0; };
    var mpg = ctx.role==='Day-1 starter'?31 : (ctx.role.indexOf('Rotation')>=0?22:12);
    var paceMult = 1 + (ctx.coachPace-50)/100*0.12;
    var usageMult = clamp(0.85 + (ctx.usageRoom-50)/100*0.30 + (ctx.coachStar-50)/100*0.18, 0.8, 1.3);
    var r1=function(v){ return Math.round(v*10)/10; };
    var pmin=function(k){ var v=n(player,k); return mpgNow>0?v/mpgNow:0; };
    return {
      mpg: mpg,
      ppg: r1(pmin('ppg')*mpg*usageMult*paceMult),
      rpg: r1(pmin('rpg')*mpg),
      apg: r1(pmin('apg')*mpg*paceMult),
      spg: r1((pmin('stl')||pmin('spg'))*mpg),
      tp_pct: Math.round((n(player,'tp_pct')||n(player,'three_pct'))*10)/10
    };
  }

  var DEF_W={need:0.20, team:0.30, player:0.25, coach:0.25};
  // Score one player against one team (team = a team_needs entry; prof = its coach profile or null).
  function scoreTeam(player, team, prof, weights){
    var W=weights||DEF_W;
    var pg=parseFloat(player.tdc_grade)||70;
    var pp=pos(player);
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
    var upgrade=pg-posBest;                                   // + = he's better than their current best
    // team's overall top talent (alpha) — for usage room
    var topGrade=56; if(team.pos) POS.forEach(function(k){ var b=team.pos[k]&&team.pos[k].best; if(b!=null&&b>topGrade) topGrade=b; });

    var need=clamp(100-Math.max(0,posBest-58)*2.4, 8, 100);
    var contender=upgrade>0?(rank<=25?10:rank<=50?4:0):0;
    var teamSuccess=clamp(55+upgrade*3.2+contender, 0, 100);
    var opp=clamp(100-Math.max(0,posBest-58)*2.3, 25, 100);
    var pace=(prof&&prof.pctl&&prof.pctl.poss_pg!=null)?prof.pctl.poss_pg:50;
    var alphaGap=topGrade-pg;
    var usageRoom=clamp(100-Math.max(0,alphaGap)*4, 30, 100);
    var playerSuccess=clamp(opp*0.5+pace*0.25+usageRoom*0.25, 0, 100);
    var cf=coachFit(prof, player);
    var overall=Math.round(need*W.need + teamSuccess*W.team + playerSuccess*W.player + cf.fit*W.coach);

    // role/opportunity label
    var role=upgrade>=2?'Day-1 starter':upgrade>-6?'Rotation / pushes for time':'Depth piece';
    var coachStar=(prof&&prof.pctl&&prof.pctl.top_scorer_share!=null)?prof.pctl.top_scorer_share:50;
    var proj=projLine(player, {role:role, coachPace:pace, coachStar:coachStar, usageRoom:usageRoom});
    // one-line why (top contributing factors)
    var bits=[];
    if(upgrade>=3&&rank<=40) bits.push('upgrades a top-'+(rank<=25?'25':'40')+' team at a needy '+pp);
    else if(upgrade>=3) bits.push('clear upgrade at '+pp);
    else if(need>=70) bits.push('fills a thin '+pp+' spot');
    if(cf.reasons[0]) bits.push(cf.reasons[0].t);
    if(playerSuccess>=72 && bits.length<2) bits.push('room to produce (minutes + usage)');
    var why=bits.slice(0,2).join('; ');
    why=why?(why.charAt(0).toUpperCase()+why.slice(1)+'.'):'';

    return {team:team.team, full:team.full, conf:team.conf, rank:team.rank, rating:team.rating,
      coach:team.coach, coach_slug:team.coach_slug, archetype:team.archetype,
      playerPos:pp, posBest:Math.round(posBest*10)/10, starter:slotD.starter, slid:slid, upgrade:Math.round(upgrade*10)/10,
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
      var s=scoreTeam(pl, team, prof, opts.weights);
      s.player=pl.name; s.playerTeam=pl.team; s.height=pl.height; s.espn_id=pl.espn_id;
      s.playerGrade=Math.round(parseFloat(pl.tdc_grade)||0); s.playerArch=archetype(pl);
      return s;
    });
    rows=rows.filter(function(r){
      if(f.pos && r.playerPos!==f.pos) return false;
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
