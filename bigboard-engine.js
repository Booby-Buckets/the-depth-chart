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
    pool.forEach(function(pr){
      var s=pr._s;
      dist.ppg.push(num(s.ppg));dist.rpg.push(num(s.rpg));dist.apg.push(num(s.apg));
      dist.stl.push(num(s.stl));dist.blk.push(num(s.blk));dist.mpg.push(num(s.mpg));
      dist.fg_pct.push(num(s.fg_pct));dist.tp_pct.push(num(s.tp_pct));dist.ft_pct.push(num(s.ft_pct));
      dist.ts.push(tsOf(s));dist.per36.push(num(s.mpg)>0?num(s.ppg)*36/num(s.mpg):0);dist.tovs.push(num(s.tovs));
    });
    Object.keys(dist).forEach(function(k){dist[k]=dist[k].filter(function(v){return v>0;}).sort(function(a,b){return a-b;});});
    return dist;
  }
  function pctOf(dist,key,val,inv){
    var arr=dist[key];if(!arr||!arr.length)return 0;var v=num(val);if(v<=0)return inv?(arr.length?5:0):0;
    var lo=0,hi=arr.length;while(lo<hi){var m=(lo+hi)>>1;if(arr[m]<v)lo=m+1;else hi=m;}
    var p=Math.round(lo/arr.length*100);return inv?100-p:p;}

  function scoreProspect(p,dist,teamMap){
    var s=p._s, grp=pgrp(p.position), ht=htIn(p.height), ci=classInfo(p);
    var g=parseFloat(p.tdc_grade), hasG=isFinite(g);
    var ppgP=pctOf(dist,'ppg',s.ppg),apgP=pctOf(dist,'apg',s.apg),rpgP=pctOf(dist,'rpg',s.rpg),
        stlP=pctOf(dist,'stl',s.stl),blkP=pctOf(dist,'blk',s.blk),mpgP=pctOf(dist,'mpg',s.mpg),
        fgP=pctOf(dist,'fg_pct',s.fg_pct),tpP=pctOf(dist,'tp_pct',s.tp_pct),ftP=pctOf(dist,'ft_pct',s.ft_pct),
        tsP=pctOf(dist,'ts',tsOf(s)),p36=pctOf(dist,'per36',num(s.mpg)>0?num(s.ppg)*36/num(s.mpg):0),
        tovP=pctOf(dist,'tovs',s.tovs,true);
    var posBase={G:74,W:78,B:81}[grp];
    var sizeScore=ht>0?clamp(50+(ht-posBase)*6.5):44;
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
      trans=clamp(.50*gradeNorm+.35*sizeScore+.15*youth);
      ready=clamp(.45*expS+.35*gradeNorm+.20*38);
      pot=clamp(.46*youth+.34*gradeNorm+.20*sizeScore);
      draft=clamp(.58*gradeNorm+.26*youth+.16*sizeScore);
    }else{
      trans=clamp(.30*sizeScore+.28*shooting+.18*defTools+.16*eff+.08*ballSec);
      ready=clamp(.40*production+.22*tsP+.24*expS+.14*(.5*ftP+.5*ballSec));
      pot=clamp(.34*youth+.26*(.55*sizeScore+.45*defTools)+.22*gradeNorm+.18*flashes);
      draft=clamp(.45*gradeNorm+.20*ppgP+.20*trans+.15*compLevel(p.team,teamMap));
    }
    var lensScore=clamp(.36*trans+.30*pot+.20*ready+.14*draft);
    var classBoost=[7,3,0,-4][ci.lvl]-(ci.rs?2.5:0);
    var blended=.55*gradeNorm+.45*lensScore+classBoost;
    return {trans:trans,ready:ready,pot:pot,draft:draft,overall:clamp(blended),blended:blended,grp:grp,sizeScore:sizeScore,gradeNorm:gradeNorm,noSample:noSample};
  }
  function eligible(p){
    var g=parseFloat(p.tdc_grade);
    var hasStats=num(p.mpg)>=8 && p.ppg!=null;
    return isFinite(g)||hasStats;
  }

  function compute(players,teamMap,opts){
    opts=opts||{};
    var season=opts.season||'2526', projById=opts.projById||{}, projReady=!!opts.projReady;
    var pool=(players||[]).filter(eligible);
    pool.forEach(function(p){p._s=basisOf(p,season,projById,projReady);});
    var dist=buildDist(pool);
    pool.forEach(function(p){p._sc=scoreProspect(p,dist,teamMap);});
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
