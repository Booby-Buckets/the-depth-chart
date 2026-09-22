// bigboard-engine.js — single source of truth for the NBA Draft Big Board.
// Used by draft.html (the board + mock) and player.html (the prospect sticker)
// so a player's rank is identical everywhere.
//
//   TDC_BIGBOARD.compute(players, teamMap, opts)
//     opts: { season:'2526'|'2627', projById:{id->projectedStats}, projReady:bool }
//     returns { prospects:[...sorted, each with .rank/.posRank/.posLabel/._sc], byId:{} }
(function(global){
  // Conference strength. The teams table spells these 'B10' / 'BIG-12' / 'Big-East' / 'PAC-12',
  // which the old POWER/HIGH lists did not contain — every Big Ten, Big 12 and Big East prospect
  // was being scored at low-major level while ACC and SEC got the power bonus.
  var CONF_LVL={'ACC':88,'SEC':88,'B10':88,'B1G':88,'BIG-10':88,'BIG TEN':88,'BIG-12':88,'BIG 12':88,
    'BIG-EAST':84,'BIG EAST':84,'PAC-12':70,'PAC 12':70,'PAC-10':70,
    'AAC':62,'AMERICAN':62,'A10':62,'A-10':62,'ATLANTIC 10':62,
    'MWC':58,'MOUNTAIN WEST':58,'WCC':58,'WEST COAST':58,
    'C-USA':46,'CONFERENCE USA':46,'SUN BELT':46,'MAC':46,'IVY':44};

  function num(v){var x=parseFloat(v);return isNaN(x)?0:x;}
  function htIn(h){if(!h)return 0;var m=(''+h).match(/(\d+)\s*[-']\s*(\d+)/);return m?(+m[1])*12+(+m[2]):0;}
  function pgrp(pos){pos=((pos||'')+'').toUpperCase().split(/[\/,\s]/)[0];
    if(pos==='PG'||pos==='SG'||pos==='G'||pos==='CG')return 'G';
    if(pos==='SF'||pos==='F')return 'W';
    if(pos==='PF'||pos==='C')return 'B'; return 'W';}
  function posLabel(pos){pos=((pos||'')+'').toUpperCase().split(/[\/,\s]/)[0];
    if(pos==='PG'||pos==='G')return 'PG';
    if(pos==='SG'||pos==='CG')return 'SG';
    if(pos==='SF'||pos==='F')return 'SF';
    if(pos==='PF')return 'PF';
    if(pos==='C')return 'C'; return pos||'—';}
  function classInfo(p){var y=((p.class_year||p.yr||'')+'').toLowerCase();
    var rs=y.indexOf('r-')>=0||y.indexOf('rs')>=0;
    var lvl=y.indexOf('fr')>=0?0:y.indexOf('so')>=0?1:y.indexOf('jr')>=0?2:(y.indexOf('sr')>=0||y.indexOf('gr')>=0)?3:1;
    return {lvl:lvl,rs:rs};}
  // estimated age (override wins) — class year + redshirt as a proxy when no
  // birthdate; 'Unk.' defaults to a junior-ish 21.
  function ageEst(p,ageOvr){
    if(ageOvr && ageOvr[(p.name||'').trim()]!=null) return +ageOvr[(p.name||'').trim()];
    var y=((p.class_year||p.yr||'')+'').toLowerCase();
    var rs=y.indexOf('r-')>=0||y.indexOf('rs')>=0;
    var base=y.indexOf('fr')>=0?19:y.indexOf('so')>=0?20:y.indexOf('jr')>=0?21:y.indexOf('gr')>=0?23:y.indexOf('sr')>=0?22:21;
    return base+(rs?1:0);
  }
  // a returning pro (G-League / NBA / overseas pro) has used his draft eligibility
  function isReturningPro(p){ return /g-?league|\bnba\b|professional/.test(((p.hometown||'')+'').toLowerCase()); }
  // out for the season (injury) — won't play, so won't be drafted this cycle;
  // he returns to the pool next season. Same flags the projection engine uses.
  function isOutForSeason(p){
    if(p.is_injured===true) return true;
    var h=((p.hometown||'')+'').toLowerCase().trim();
    return h==='injured'||h==='out';
  }
  function classKey(p){var y=((p.class_year||p.yr||'')+'').toLowerCase();
    return y.indexOf('fr')>=0?'fr':y.indexOf('so')>=0?'so':y.indexOf('jr')>=0?'jr':(y.indexOf('sr')>=0||y.indexOf('gr')>=0)?'sr':'';}
  function clamp(x){return Math.round(Math.max(0,Math.min(100,x)));}
  function tsOf(s){var fga=num(s.fga),fta=num(s.fta),pts=num(s.ppg);var d=2*(fga+0.44*fta);return d>0?pts/d*100:0;}
  // usage % — the share of his team's possessions he finishes on the floor. An explicit value
  // (the freshman editor sets one) wins; otherwise estimate it from his shot and turnover volume.
  function usgOf(s){
    var u=num(s.usg)||num(s.usg_pct)||num(s.usage_pct)||num(s.proj_usg);
    if(u>0) return u;
    var mpg=num(s.mpg); if(mpg<=0) return 0;
    var poss=num(s.fga)+0.44*num(s.fta)+num(s.tovs);
    return 100*poss/Math.max(1,(mpg/40)*68);
  }
  function confLevel(team,teamMap){var t=teamMap&&teamMap[team];
    var c=(((t&&(t.conf||t.conference))||'')+'').toUpperCase().trim();
    return CONF_LVL[c]!=null?CONF_LVL[c]:50;}
  // Team strength, from the site's own ranking. A conference label alone treats the 77th-best
  // team in the country like Duke because they share a league — and the leading scorer on a bad
  // high-major puts his numbers up against a softer slate, with weaker teammates drawing the
  // defence, which is exactly the profile NBA teams write off as empty stats.
  function teamStrength(team,teamMap,nTeams){var t=teamMap&&teamMap[team];
    var r=t?parseFloat(t.tdc_rank_num):NaN;
    if(!isFinite(r)||r<=0) return 55;
    return clamp(100-(r-1)/Math.max(1,(nTeams||115)-1)*78);}   // #1 -> 100, last -> 22
  function compLevel(team,teamMap,nTeams){
    return clamp(0.55*confLevel(team,teamMap)+0.45*teamStrength(team,teamMap,nTeams));}

  function projPlayer(p){
    var yr=((p.class_year||p.yr||'')+'').toLowerCase();
    var mult=yr.indexOf('fr')>=0?1.12:yr.indexOf('so')>=0?1.10:yr.indexOf('jr')>=0?1.05:0.99;
    var bump=yr.indexOf('fr')>=0?1.5:yr.indexOf('so')>=0?1.0:yr.indexOf('jr')>=0?0.5:0;
    var o={};
    ['ppg','rpg','apg','mpg','stl','blk','oreb','dreb','tovs','fgm','fga','tpm','tpa','ftm','fta'].forEach(function(k){o[k]=Math.round(num(p[k])*mult*10)/10;});
    ['fg_pct','tp_pct','ft_pct'].forEach(function(k){o[k]=Math.round((num(p[k])+bump)*10)/10;});
    return o;
  }
  // A player with no college stats (a freshman) has no line to percentile-rank him on, so the
  // board used to fall back to a grade+size-only score — which meant the owner's freshman
  // projection (minutes, usage, playstyle) never reached the Big Board at all. Take his projected
  // line from the freshman editor instead, so editing a projection moves his rank.
  function freshLine(p){
    try{
      if(typeof window==='undefined' || !window.TDCFresh || !window.TDCFresh.line) return null;
      var prof=window.TDCFresh.profileFor?window.TDCFresh.profileFor(p):null;
      var L=window.TDCFresh.line(p, prof);
      return (L && num(L.mpg)>0) ? L : null;
    }catch(e){ return null; }
  }
  function hasNoStats(p){ return !(num(p.mpg)>=3 || num(p.ppg)>0); }
  function basisOf(p,season,projById,projReady){
    if(season==='2627'||season==='2728'){
      if(hasNoStats(p)){ var fl=freshLine(p); if(fl) return Object.assign({}, p, fl); }
      if(projReady && projById[p.id]) return Object.assign({}, p, projById[p.id]);
      return Object.assign({}, p, projPlayer(p));
    }
    return p;
  }

  function buildDist(pool){
    var dist={}, keys=['ppg','rpg','apg','stl','blk','mpg','fg_pct','tp_pct','ft_pct','ts','per36','tovs','usg'];
    keys.forEach(function(k){dist[k]=[];});
    // turnovers, additionally bucketed by position group (G/W/B) — ball security is
    // judged within position so guards (ball-dominant, naturally more TOs) aren't
    // over-taxed vs bigs, which was inflating post players at the top of the board.
    ['G','W','B'].forEach(function(gp){ dist['tovs_'+gp]=[];
      // athletic markers are ranked WITHIN the position group — fixed absolute anchors made
      // two of the three components saturate at 100 for any high-usage guard
      dist['ftr_'+gp]=[]; dist['orb_'+gp]=[]; dist['stk_'+gp]=[]; });
    pool.forEach(function(pr){
      var s=pr._s;
      dist.ppg.push(num(s.ppg));dist.rpg.push(num(s.rpg));dist.apg.push(num(s.apg));
      dist.stl.push(num(s.stl));dist.blk.push(num(s.blk));dist.mpg.push(num(s.mpg));
      dist.fg_pct.push(num(s.fg_pct));dist.tp_pct.push(num(s.tp_pct));dist.ft_pct.push(num(s.ft_pct));
      dist.ts.push(tsOf(s));dist.per36.push(num(s.mpg)>0?num(s.ppg)*36/num(s.mpg):0);dist.tovs.push(num(s.tovs));
      dist.usg.push(usgOf(s));
      var _gp=pgrp(pr.position); if(dist['tovs_'+_gp]) dist['tovs_'+_gp].push(num(s.tovs));
      if(dist['ftr_'+_gp] && num(s.mpg)>=8){ var _mm=Math.max(1,num(s.mpg));
        dist['ftr_'+_gp].push(num(s.fga)>0?num(s.fta)/num(s.fga):0);
        dist['orb_'+_gp].push(num(s.oreb)*36/_mm);
        dist['stk_'+_gp].push((num(s.stl)+num(s.blk))*36/_mm); }
    });
    Object.keys(dist).forEach(function(k){dist[k]=dist[k].filter(function(v){return v>0;}).sort(function(a,b){return a-b;});});
    return dist;
  }
  function pctOf(dist,key,val,inv){
    var arr=dist[key];if(!arr||!arr.length)return 0;var v=num(val);if(v<=0)return inv?(arr.length?5:0):0;
    var lo=0,hi=arr.length;while(lo<hi){var m=(lo+hi)>>1;if(arr[m]<v)lo=m+1;else hi=m;}
    var p=Math.round(lo/arr.length*100);return inv?100-p:p;}

  function scoreProspect(p,dist,teamMap,ageOvr,nTeams){
    var s=p._s, grp=pgrp(p.position), ht=htIn(p.height), ci=classInfo(p);
    var age=ageEst(p,ageOvr);   // needed by youth/size-upside below, not just the final curve
    // Grade anchor: use the canonical v5 projected grade (level-adjusted + dev),
    // stamped by compute() for the projected season, so the board's grade term
    // matches the OVR shown everywhere else on the site. Falls back to the raw
    // scouting grade for historical seasons.
    var g=isFinite(p._projGrade)?p._projGrade:parseFloat(p.tdc_grade), hasG=isFinite(g);
    var ppgP=pctOf(dist,'ppg',s.ppg),apgP=pctOf(dist,'apg',s.apg),rpgP=pctOf(dist,'rpg',s.rpg),
        stlP=pctOf(dist,'stl',s.stl),blkP=pctOf(dist,'blk',s.blk),mpgP=pctOf(dist,'mpg',s.mpg),
        fgP=pctOf(dist,'fg_pct',s.fg_pct),tpP=pctOf(dist,'tp_pct',s.tp_pct),ftP=pctOf(dist,'ft_pct',s.ft_pct),
        tsP=pctOf(dist,'ts',tsOf(s)),p36=pctOf(dist,'per36',num(s.mpg)>0?num(s.ppg)*36/num(s.mpg):0),
        usgP=pctOf(dist,'usg',usgOf(s));
    // ball security judged within position group (falls back to the whole pool when a
    // group is thin), blended 65/35 toward position so it's a light nudge, not a swing.
    var _tovG=dist['tovs_'+grp];
    var tovP=(_tovG&&_tovG.length>=25)
      ? Math.round(0.65*pctOf(dist,'tovs_'+grp,s.tovs,true)+0.35*pctOf(dist,'tovs',s.tovs,true))
      : pctOf(dist,'tovs',s.tovs,true);
    // height judged against the SPECIFIC position's NBA norm, not a coarse G/W/B
    // base — a 6'6" PG is a rare, valuable archetype; a 6'8" center is undersized.
    var pl0=posLabel(p.position);
    var norm=({PG:74,SG:77,SF:79,PF:81,C:83}[pl0])||({G:75,W:79,B:82}[grp])||78;
    var htDev=ht>0?ht-norm:0;
    // asymmetric: tall-for-position is a real draft premium; undersized is a bigger
    // translatability red flag (docked harder). Length + youth = extra upside equity.
    var sizeScore=ht>0?clamp(58+(htDev>=0?htDev*7.5:htDev*9)):44;
    var sizeUpside=ht>0?clamp(52+htDev*6.5+(ci.lvl<=1?9:ci.lvl===2?4:0)):44;
    var dW=grp==='G'?{s:.72,b:.28}:grp==='B'?{s:.30,b:.70}:{s:.5,b:.5};
    var defTools=clamp(dW.s*stlP+dW.b*blkP);
    // ATHLETICISM / PHYSICAL TOOLS — the board had none, so a ground-bound shooter and a
    // explosive wing with the same numbers looked identical, and the polished older player won.
    // There is no combine data, so this is the box-score fingerprint of an athlete: how often he
    // gets to the line (rim pressure), offensive rebounds (second jumps), and blocks + steals
    // (length and quickness), all per minute and judged against his own position group.
    var _m=Math.max(1,num(s.mpg));
    var ftr=num(s.fga)>0?num(s.fta)/num(s.fga):0;                       // free-throw rate = drives, not jumpers
    var orb36=num(s.oreb)*36/_m, stk36=(num(s.stl)+num(s.blk))*36/_m;
    // Each marker is RANKED WITHIN THE POSITION GROUP and only lightly anchored to an absolute
    // bar. Pure absolute anchors saturated: a high-usage guard who lives at the line maxed the
    // free-throw term AND the offensive-rebound term and read as a 96 athlete on a jump-shot-less
    // 14-point season. FT rate is the most usage-contaminated marker, so it carries the least;
    // steals + blocks per minute, which a player cannot pad by being allowed to shoot, the most.
    function mix(key,val,absD){return 0.70*pctOf(dist,key,val)+0.30*clamp(val/absD*100);}
    var ftrN=mix('ftr_'+grp,ftr,grp==='B'?0.52:grp==='W'?0.46:0.55),
        orbN=mix('orb_'+grp,orb36,grp==='B'?4.4:grp==='W'?2.8:1.9),
        stkN=mix('stk_'+grp,stk36,grp==='B'?4.0:grp==='W'?3.0:3.0);
    var athl=clamp(.28*ftrN+.32*orbN+.40*stkN);
    // SHOOTING, VOLUME-GATED. A jump shot only counts if he takes them: a 6-2 guard attempting
    // one three a game has no NBA shot whatever the percentage, and 40% on half an attempt is
    // noise. The percentage is faded toward a floor until the volume makes it credible, and
    // the volume itself is scored, because NBA teams buy range they can count on.
    var tpa36=num(s.tpa)*36/_m;
    var credD=grp==='B'?2.0:3.0, volD=grp==='B'?4.0:6.0, shFloor=grp==='B'?42:28;
    var cred=Math.min(1,tpa36/credD), tpVol=clamp(tpa36/volD*100);
    var tpAdj=tpP*cred+shFloor*(1-cred);
    var shooting=grp==='B' ? clamp(.42*tpAdj+.14*tpVol+.44*ftP)
                           : clamp(.52*tpAdj+.22*tpVol+.26*ftP);
    var eff=clamp(.65*tsP+.35*fgP);
    var lvl=compLevel(p.team,teamMap,nTeams);
    // ROLE SIZE: usage — the share of the offence he finishes — separates a 12-point scorer who
    // carries his team from a 12-point scorer riding four better players, and it is the single
    // biggest lever on a freshman's projection. It sits inside production and nudges the draft
    // lens, where NBA boards reward on-ball creation.
    var production=clamp(.34*ppgP+.19*mpgP+.14*apgP+.15*usgP+.18*tsP);
    // EMPTY CALORIES. Volume is only worth what it is scored at. When a player's share of the
    // offence runs well ahead of his efficiency he is scoring because he is the one allowed to
    // shoot, not because he is good at it — the single profile NBA scouts discount hardest.
    var emptyCal=clamp((usgP-tsP)-12);
    var ballSec=tovP||40;
    // youth/experience from AGE too (a 21-year-old redshirt sophomore is not a young prospect)
    var youth=clamp(100-Math.max(0,(age-18.5))*15);      // 19→93, 20→78, 21→63, 22→48, 23→33
    var expS=clamp([34,58,80,92][ci.lvl]+(ci.rs?4:0));
    var gradeNorm=hasG?clamp((g-58)/41*100):clamp(.6*ppgP+.4*tsP);
    var flashes=clamp(.6*p36+.4*Math.max(blkP,stlP,tpP));
    // with the freshman editor's line in hand, a freshman is scored on the SAME model as everyone
    // else; noSample now only catches a player with no line from any source
    var noSample=num(s.mpg)<3 && num(s.ppg)<1;
    var trans,ready,pot,draft;
    if(noSample){
      trans=clamp(.46*gradeNorm+.39*sizeScore+.15*youth);
      ready=clamp(.45*expS+.35*gradeNorm+.20*38);
      pot=clamp(.42*youth+.32*gradeNorm+.26*sizeUpside);
      draft=clamp(.55*gradeNorm+.24*youth+.21*sizeScore);
    }else{
      var vers=versatile(p,defTools);
      // self-creation: the share of his makes he generated himself (Shot Genome). Missing for a
      // player with no located shots — fall back to his usage, which is the same idea, coarser.
      var sc=selfCreate(p); var scN=(sc!=null)?clamp(sc/70*100):clamp(usgP);
      // trajectory: grade change year over year, ±6 points of grade maps to the full range
      var tj=trajOf(p); var tjN=(tj!=null)?clamp(50+tj*8):50;
      trans=clamp(.22*sizeScore+.22*athl+.18*shooting+.12*defTools+.08*vers+.12*eff+.06*ballSec);
      // readiness is a claim about college production, so it is worth what the competition was
      ready=clamp(.32*production+.18*tsP+.20*expS+.10*(.5*ftP+.5*ballSec)+.06*scN+.14*lvl);
      pot=clamp(.24*youth+.22*athl+.18*(.62*sizeUpside+.38*defTools)+.14*tjN+.12*scN+.10*gradeNorm);
      draft=clamp(.32*gradeNorm+.11*ppgP+.07*usgP+.09*scN+.19*trans+.17*lvl+.05*sizeScore);
    }
    // Draft-board weighting: the NBA drafts on UPSIDE + TRANSLATABLE TOOLS, not college
    // readiness/production, so potential and translatability lead and readiness is a minor
    // term (a productive senior shouldn't out-rank a toolsy young wing the way a college
    // performance board would). Rebuilt from .36/.30/.20/.14 (trans/pot/ready/draft).
    // Upside and translatable tools lead; college readiness is the smallest term, as on a real board
    var lensScore=clamp(.35*pot+.33*trans+.22*draft+.10*ready);
    // DRAFT AGE CURVE: NBA drafts on runway, so value slides with age. An elite
    // young player stays top-of-board while an equally good 23-24yo caps out
    // mid-board (they can still rise, just not to the top). When a real age is
    // known, derive the class boost from it (class year may be Unk. or misleading).
    // AGE, not the class label, drives the runway premium. Reading it off the class let a
    // 21-year-old redshirt sophomore collect a sophomore's boost (+4) and pay no age penalty,
    // which is how a polished 6-7 shooter finished ahead of every freshman. An NBA board fades a
    // prospect from 20 onward; a redshirt year counts against you, it does not reset the clock.
    var effLvl=age<=19?0:age<=20?1:age<=21?2:3;
    var classBoost=[9,4,-2,-6][effLvl];
    var agePen=Math.max(0,age-19.5)*1.8;   // 20→0.9, 21→2.7, 22→4.5, 23→6.3 (with the class term,
                                           // a 23-year-old carries about -12, which is a late-second
                                           // round fade, not off the board)
    // Production/grade anchors it but no longer DOMINATES — the scouting lenses (upside/
    // tools/translatability) carry the board, matching how NBA teams actually rank. Was .55/.45.
    // College value is an anchor, not the board. A grade rewards exactly the polished older
    // player an NBA team would pass on, so it carries less than the scouting lenses now.
    // OPPORTUNITY. A projected line of three minutes a night is not evidence of anything: the
    // percentile ranks still reward the rates, and the empty-calorie check cannot fire because
    // there is no volume to check — which floated deep-bench freshmen into the top 100. What the
    // college season says about a player is faded out below a real rotation role.
    var oppPen=(1-Math.min(1,num(s.mpg)/12))*9;
    var blended=.34*gradeNorm+.66*lensScore+classBoost-agePen-(noSample?0:emptyCal*0.08)-oppPen;
    return {trans:trans,ready:ready,pot:pot,draft:draft,overall:clamp(blended),blended:blended,grp:grp,sizeScore:sizeScore,gradeNorm:gradeNorm,noSample:noSample,age:age,
            athl:(typeof athl!=='undefined'?athl:null),shoot:(typeof shooting!=='undefined'?shooting:null),
            lvl:(typeof lvl!=='undefined'?lvl:null),empty:(noSample?0:emptyCal),opp:Math.round(oppPen*10)/10};
  }
  function eligible(p,ineligible){
    if(ineligible && ineligible[(p.name||'').trim()]) return false;   // manual ineligible list
    if(isReturningPro(p)) return false;                               // ex-pro, eligibility used
    if(isOutForSeason(p)) return false;                               // injured — out this season
    var g=parseFloat(p.tdc_grade);
    var hasStats=num(p.mpg)>=8 && p.ppg!=null;
    return isFinite(g)||hasStats;
  }

  function compute(players,teamMap,opts){
    opts=opts||{};
    var season=opts.season||'2526', projById=opts.projById||{}, projReady=!!opts.projReady;
    var ov=opts.overrides||{}, ineligible={}, ageOvr=ov.age||{};
    (ov.ineligible||[]).forEach(function(n){ ineligible[(''+n).trim()]=1; });
    var pool=(players||[]).filter(function(p){return eligible(p,ineligible);});
    // 2028 draft class: current seniors/grads will have exhausted eligibility, so the
    // pool is the RETURNING underclassmen (Fr/So/Jr now) — a way-too-early watch board
    // of the players who'll still be around. The steep youth premium in the scoring floats
    // the young high-upside prospects to the top, which is what a 2028 board should be.
    if(season==='2728'){
      pool=pool.filter(function(p){ return classKey(p)!=='sr'; });
    }
    // Stamp the canonical v5 projected grade for the forward-looking boards so the grade
    // anchor matches the OVR shown on player/team/index pages.
    if((season==='2627'||season==='2728') && window.TDCProjGrade && typeof window.TDCProjGrade.gradeSolo==='function'){
      pool.forEach(function(p){ var gv=window.TDCProjGrade.gradeSolo(p); if(isFinite(gv)) p._projGrade=gv; });
    }
    pool.forEach(function(p){p._s=basisOf(p,season,projById,projReady);});
    var dist=buildDist(pool);
    var _nT=Object.keys(teamMap||{}).length||115;
    pool.forEach(function(p){p._sc=scoreProspect(p,dist,teamMap,ageOvr,_nT);});
    pool.sort(function(a,b){return b._sc.blended-a._sc.blended || (parseFloat(b.tdc_grade)||0)-(parseFloat(a.tdc_grade)||0);});
    var hi=pool.length?pool[0]._sc.blended:100;
    var loIdx=Math.min(pool.length-1,59);
    var lo=pool.length?pool[loIdx]._sc.blended:0;
    var gain=(hi>lo)?(93-68)/(hi-lo):1;
    var posCount={}, byId={};
    pool.forEach(function(p,i){
      p._sc.overall=clamp(68+(p._sc.blended-lo)*gain);
      p.rank=i+1;
      var pl=posLabel(p.position); p.posLabel=pl;
      posCount[pl]=(posCount[pl]||0)+1; p.posRank=posCount[pl];
      byId[p.id]=p;
    });
    return {prospects:pool, byId:byId};
  }

  // ── INTANGIBLES the NBA actually weighs, from data we own ────────────────────────────────
  // TRAJECTORY — "is he getting better?" is one of the biggest inputs on a real board, and the
  // site already grades every player-season. Year-over-year grade change, from
  // stat_overall_history.json (loaded lazily by tdc-projgrade).
  function trajOf(p){
    try{
      if(!global.TDCProjGrade || !global.TDCProjGrade.statMaps || p.espn_id==null) return null;
      var H=(global.TDCProjGrade.statMaps()||{}).hist; if(!H) return null;
      var yrs=Object.keys(H).map(Number).sort(function(a,b){return b-a;});
      var got=[];
      for(var i=0;i<yrs.length && got.length<2;i++){
        var v=H[yrs[i]] && H[yrs[i]][''+p.espn_id];
        if(v!=null && isFinite(v)) got.push(+v);
      }
      return got.length===2 ? (got[0]-got[1]) : null;   // latest minus the season before it
    }catch(e){ return null; }
  }
  // SELF-CREATION — the NBA pays for players who generate their own shot. Shot Genome's
  // self-created share of makes (build_shot_genome.py), by espn_id.
  var _sgP=null, _sgBy=null;
  function loadGenome(){
    if(_sgP) return _sgP;
    _sgP=(typeof fetch==='function')
      ? fetch('scripts/data/shot_genome_players.json').then(function(r){ return r.ok?r.json():null; })
          .then(function(j){ _sgBy={}; ((j&&j.players)||[]).forEach(function(x){ if(x&&x.espn_id!=null) _sgBy[''+x.espn_id]=x; }); return _sgBy; })
          .catch(function(){ _sgBy={}; return _sgBy; })
      : Promise.resolve({});
    return _sgP;
  }
  function selfCreate(p){ var r=(_sgBy&&p.espn_id!=null)?_sgBy[''+p.espn_id]:null; return (r&&r.selfPct!=null)?num(r.selfPct):null; }
  // POSITIONAL VERSATILITY — a listed second position plus real two-way activity is the
  // "can he guard more than one spot" bet teams make on wings.
  function versatile(p,defToolsPct){
    var two=!!(p.position2 && (''+p.position2).trim());
    return clamp((two?58:38) + (defToolsPct-50)*0.5);
  }

  // A low-minute player's per-game stats can be nonsense (a 4-minute reserve reading 8 rebounds),
  // which used to warp the board's percentiles on one page and not the other. Sanitising lives
  // here now, so every caller starts from the same pool.
  var STAT_CAPS={ppg:1.4,rpg:0.75,apg:0.6,stl:0.28,blk:0.30,tovs:0.45,oreb:0.45,dreb:0.55};
  function sane(p){
    var mpg=num(p&&p.mpg); if(mpg<=0||mpg>=8) return p;
    var out=null;
    for(var k in STAT_CAPS){ var v=parseFloat(p[k]);
      if(!isNaN(v) && v>mpg*STAT_CAPS[k]){ if(!out) out=Object.assign({},p); out[k]=Math.round(mpg*STAT_CAPS[k]*10)/10; } }
    return out||p;
  }

  // ── ONE projection pass for the board ────────────────────────────────────────────────────
  // draft.html and player.html each used to build their own projById with their own roster
  // sorting and their own readiness checks, so the same player could rank #27 on the board and
  // #40 on his page. Both now call this: wait for the owner's freshman projections and the grade
  // module, then project every roster with the canonical engine.
  function buildProjById(players, teamMap){
    // THE projected line for the board is the site's canonical one — the same
    // stat_overall_projected row the player page, the team page and the rankings use, keyed by
    // espn_id — with the owner's freshman editor line for players who have never played.
    //
    // It used to run the LIVE projection engine (buildTeamProjections) over every roster, which
    // reads ambient page state (prefetched advanced rows, a swapped coach, injuries). That made
    // the board depend on which page you were on: the same player ranked #28 on the Big Board and
    // #31 on his own page. Reading the published line makes the board deterministic.
    var out={};
    var ready=[];
    try{ if(global.TDCFresh&&global.TDCFresh.load) ready.push(global.TDCFresh.load()); }catch(e){}
    try{ if(global.TDCProjGrade&&global.TDCProjGrade.ready) ready.push(global.TDCProjGrade.ready); }catch(e){}
    return Promise.all(ready).catch(function(){}).then(function(){
      var rowOf=(global.TDCProjGrade&&global.TDCProjGrade.projRowOf)?global.TDCProjGrade.projRowOf:null;
      var KEYS=['ppg','rpg','apg','mpg','stl','blk','tovs','oreb','dreb','fg_pct','tp_pct','ft_pct','fga','fgm','tpa','tpm','fta','ftm'];
      (players||[]).forEach(function(p){
        if(!p||p.id==null) return;
        var r=(rowOf&&p.espn_id!=null)?rowOf(p.espn_id):null;
        if(r && num(r.mpg)>0){
          var o={}; KEYS.forEach(function(k){ if(r[k]!=null) o[k]=r[k]; });
          o.usg=(r.proj_usg!=null?r.proj_usg:r.usg); out[p.id]=o; return;
        }
        if(hasNoStats(p)){ var fl=freshLine(p); if(fl) out[p.id]=fl; }
      });
      return out;
    });
  }

  // THE entry point: sanitise, project, apply the manual overrides, compute. Both the Big Board
  // page and the player page's rank call this, so a player's rank is the same number everywhere.
  var _ovP=null;
  function overrides(){
    if(_ovP) return _ovP;
    _ovP=(typeof fetch==='function')
      ? fetch('draft-overrides.json').then(function(r){ return r.ok?r.json():{}; }).catch(function(){ return {}; })
      : Promise.resolve({});
    return _ovP;
  }
  function board(players, teamMap, opts){
    opts=opts||{};
    var pool=(players||[]).map(sane);
    var projP=opts.projById?Promise.resolve(opts.projById):buildProjById(pool, teamMap);
    return Promise.all([projP, opts.overrides?Promise.resolve(opts.overrides):overrides(), loadGenome(),
      (global.TDCProjGrade&&global.TDCProjGrade.loadHist)?global.TDCProjGrade.loadHist():null]).then(function(r){
      var proj=r[0]||{}, ov=r[1]||{}, ready=Object.keys(proj).length>0;
      return compute(pool, teamMap, {season:opts.season||(ready?'2627':'2526'), projById:proj, projReady:ready, overrides:ov});
    });
  }

  global.TDC_BIGBOARD={board:board, compute:compute, buildProjById:buildProjById, sane:sane, overrides:overrides, pgrp:pgrp, posLabel:posLabel, classKey:classKey};
})(typeof window!=='undefined'?window:this);
