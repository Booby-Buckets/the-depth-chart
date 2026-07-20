// bigboard-engine.js — single source of truth for the NBA Draft Big Board.
// Used by draft.html (the board + mock) and player.html (the prospect sticker)
// so a player's rank is identical everywhere.
//
//   TDC_BIGBOARD.compute(players, teamMap, opts)
//     opts: { season:'2526'|'2627', projById:{id->projectedStats}, projReady:bool }
//     returns { prospects:[...sorted, each with .rank/.posRank/.posLabel/._sc], byId:{} }
(function(global){
  var POWER=['ACC','Big Ten','Big 12','SEC','Big East','B1G','BIG TEN','BIG 12'];
  var HIGH=['Mountain West','American','A-10','Atlantic 10','WCC','West Coast','Conference USA','C-USA','Sun Belt','MAC','MWC','AAC'];

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
  function compLevel(team,teamMap){var t=teamMap&&teamMap[team];var c=((t&&(t.conf||t.conference))||'')+'';
    if(POWER.indexOf(c)>=0)return 88; if(HIGH.indexOf(c)>=0)return 60; return 46;}

  function projPlayer(p){
    var yr=((p.class_year||p.yr||'')+'').toLowerCase();
    var mult=yr.indexOf('fr')>=0?1.12:yr.indexOf('so')>=0?1.10:yr.indexOf('jr')>=0?1.05:0.99;
    var bump=yr.indexOf('fr')>=0?1.5:yr.indexOf('so')>=0?1.0:yr.indexOf('jr')>=0?0.5:0;
    var o={};
    ['ppg','rpg','apg','mpg','stl','blk','oreb','dreb','tovs','fgm','fga','tpm','tpa','ftm','fta'].forEach(function(k){o[k]=Math.round(num(p[k])*mult*10)/10;});
    ['fg_pct','tp_pct','ft_pct'].forEach(function(k){o[k]=Math.round((num(p[k])+bump)*10)/10;});
    return o;
  }
  function basisOf(p,season,projById,projReady){
    if(season==='2627'){
      if(projReady && projById[p.id]) return Object.assign({}, p, projById[p.id]);
      return Object.assign({}, p, projPlayer(p));
    }
    return p;
  }

  function buildDist(pool){
    var dist={}, keys=['ppg','rpg','apg','stl','blk','mpg','fg_pct','tp_pct','ft_pct','ts','per36','tovs'];
    keys.forEach(function(k){dist[k]=[];});
    // turnovers, additionally bucketed by position group (G/W/B) — ball security is
    // judged within position so guards (ball-dominant, naturally more TOs) aren't
    // over-taxed vs bigs, which was inflating post players at the top of the board.
    ['G','W','B'].forEach(function(gp){ dist['tovs_'+gp]=[]; });
    pool.forEach(function(pr){
      var s=pr._s;
      dist.ppg.push(num(s.ppg));dist.rpg.push(num(s.rpg));dist.apg.push(num(s.apg));
      dist.stl.push(num(s.stl));dist.blk.push(num(s.blk));dist.mpg.push(num(s.mpg));
      dist.fg_pct.push(num(s.fg_pct));dist.tp_pct.push(num(s.tp_pct));dist.ft_pct.push(num(s.ft_pct));
      dist.ts.push(tsOf(s));dist.per36.push(num(s.mpg)>0?num(s.ppg)*36/num(s.mpg):0);dist.tovs.push(num(s.tovs));
      var _gp=pgrp(pr.position); if(dist['tovs_'+_gp]) dist['tovs_'+_gp].push(num(s.tovs));
    });
    Object.keys(dist).forEach(function(k){dist[k]=dist[k].filter(function(v){return v>0;}).sort(function(a,b){return a-b;});});
    return dist;
  }
  function pctOf(dist,key,val,inv){
    var arr=dist[key];if(!arr||!arr.length)return 0;var v=num(val);if(v<=0)return inv?(arr.length?5:0):0;
    var lo=0,hi=arr.length;while(lo<hi){var m=(lo+hi)>>1;if(arr[m]<v)lo=m+1;else hi=m;}
    var p=Math.round(lo/arr.length*100);return inv?100-p:p;}

  function scoreProspect(p,dist,teamMap,ageOvr){
    var s=p._s, grp=pgrp(p.position), ht=htIn(p.height), ci=classInfo(p);
    var g=parseFloat(p.tdc_grade), hasG=isFinite(g);
    var ppgP=pctOf(dist,'ppg',s.ppg),apgP=pctOf(dist,'apg',s.apg),rpgP=pctOf(dist,'rpg',s.rpg),
        stlP=pctOf(dist,'stl',s.stl),blkP=pctOf(dist,'blk',s.blk),mpgP=pctOf(dist,'mpg',s.mpg),
        fgP=pctOf(dist,'fg_pct',s.fg_pct),tpP=pctOf(dist,'tp_pct',s.tp_pct),ftP=pctOf(dist,'ft_pct',s.ft_pct),
        tsP=pctOf(dist,'ts',tsOf(s)),p36=pctOf(dist,'per36',num(s.mpg)>0?num(s.ppg)*36/num(s.mpg):0);
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
    var shooting=clamp(.6*tpP+.4*ftP);
    var eff=clamp(.65*tsP+.35*fgP);
    var production=clamp(.5*ppgP+.3*mpgP+.2*apgP);
    var ballSec=tovP||40;
    var youth=clamp([95,72,48,26][ci.lvl]-(ci.rs?6:0));
    var expS=clamp([34,58,80,92][ci.lvl]+(ci.rs?4:0));
    var gradeNorm=hasG?clamp((g-58)/41*100):clamp(.6*ppgP+.4*tsP);
    var flashes=clamp(.6*p36+.4*Math.max(blkP,stlP,tpP));
    var noSample=num(s.mpg)<3 && num(s.ppg)<1;
    var trans,ready,pot,draft;
    if(noSample){
      trans=clamp(.46*gradeNorm+.39*sizeScore+.15*youth);
      ready=clamp(.45*expS+.35*gradeNorm+.20*38);
      pot=clamp(.42*youth+.32*gradeNorm+.26*sizeUpside);
      draft=clamp(.55*gradeNorm+.24*youth+.21*sizeScore);
    }else{
      trans=clamp(.34*sizeScore+.26*shooting+.18*defTools+.14*eff+.08*ballSec);
      ready=clamp(.40*production+.22*tsP+.24*expS+.14*(.5*ftP+.5*ballSec));
      pot=clamp(.30*youth+.30*(.62*sizeUpside+.38*defTools)+.22*gradeNorm+.18*flashes);
      draft=clamp(.42*gradeNorm+.18*ppgP+.22*trans+.12*compLevel(p.team,teamMap)+.06*sizeScore);
    }
    var lensScore=clamp(.36*trans+.30*pot+.20*ready+.14*draft);
    // DRAFT AGE CURVE: NBA drafts on runway, so value slides with age. An elite
    // young player stays top-of-board while an equally good 23-24yo caps out
    // mid-board (they can still rise, just not to the top). When a real age is
    // known, derive the class boost from it (class year may be Unk. or misleading).
    var age=ageEst(p,ageOvr);
    var hasAgeOvr=!!(ageOvr && ageOvr[(p.name||'').trim()]!=null);
    var effLvl=hasAgeOvr?(age<=19?0:age<=20?1:age<=21?2:3):ci.lvl;
    var classBoost=[6,3,0,-3][effLvl];   // redshirt age already handled via ageEst → agePen
    var agePen=Math.max(0,age-21)*1.05;   // 22→1.0, 23→2.1, 24→3.2 (older good players land mid-board, not buried)
    var blended=.55*gradeNorm+.45*lensScore+classBoost-agePen;
    return {trans:trans,ready:ready,pot:pot,draft:draft,overall:clamp(blended),blended:blended,grp:grp,sizeScore:sizeScore,gradeNorm:gradeNorm,noSample:noSample,age:age};
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
    pool.forEach(function(p){p._s=basisOf(p,season,projById,projReady);});
    var dist=buildDist(pool);
    pool.forEach(function(p){p._sc=scoreProspect(p,dist,teamMap,ageOvr);});
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

  global.TDC_BIGBOARD={compute:compute, pgrp:pgrp, posLabel:posLabel, classKey:classKey};
})(typeof window!=='undefined'?window:this);
