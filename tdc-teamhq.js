/* tdc-teamhq.js — the team page's Overview tab (Nov 2026, owner: Team HQ was confusing, two home pages for one team).
   Program HQ's Today view moved here unchanged: up next, the starting five, the bench, how the roster was built, team
   grades, standings, news and every tool set to this team; past seasons show the final game, recap, roster and leaders.
     TDC_TEAMHQ.show(host, {team, season})   team = short or full name; returns false for a program not in the ratings
   The band, the season picker and the schedule live on the team page itself. */
(function(){
var POOL=[], MY=null, HQ_SEASON=2027, PAST={}, HOST=null, _poolP=null, REALD=null;
var SB='https://izlqhnxowdhtdofkwrho.supabase.co', KEY='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye', H={apikey:KEY,Authorization:'Bearer '+KEY};
function byId(x){ return document.getElementById(x); }
function esc(s){ return (''+(s==null?'':s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function fmtR(r){ return r==null?'—':(r>0?'+':'')+(+r).toFixed(1); }
function recStr(w,l){ return (w==null?0:w)+'–'+(l==null?0:l); }
function seasonLabel(y){ return (+y===2027)?'2026-27 · Projected':((y-1)+'-'+(''+y).slice(2)); }
function logoFor(full){ try{ var c=window.tdcTeamColor&&tdcTeamColor(full); if(c&&c.logo) return c.logo; }catch(e){} return null; }
function tab(id){ return "if(window.tdcTeamTab){tdcTeamTab('"+id+"');return false;}"; }
function barCol(v){ return v==null?'var(--txt3)':(v>=80?'var(--green)':v>=64?'var(--tc)':v>=50?'var(--amber)':'var(--red)'); }
function ord(n){ var v=n%100; if(v>=11&&v<=13) return n+'th'; switch(n%10){case 1:return n+'st';case 2:return n+'nd';case 3:return n+'rd';default:return n+'th';} }
function wrapStand(rowsHtml,total,head){ return '<div class="sheet-wrap st-scroll"><table class="sheet dense"><thead><tr>'+head+'</tr></thead><tbody>'+rowsHtml+'</tbody></table></div>'+(total>9?'<div class="st-more">scroll for all '+total+' teams</div>':''); }
function standRow(i,me,name,cells){ var lg=logoFor(name); return '<tr'+(me?' class="me"':'')+'><td class="rk">'+(i+1)+'</td><td class="l nm">'+(lg?'<img src="'+lg+'" alt="" onerror="this.style.visibility=\'hidden\'">':'')+esc(name)+'</td>'+cells+'</tr>'; }
function fitStand(){ var c=byId('hxStandings').querySelector('.st-scroll'); if(!c) return; if(window.tdcSheetHeat) tdcSheetHeat(c.querySelector('table')); var me=c.querySelector('tr.me'); if(me){ c.scrollTop=Math.max(0, me.offsetTop - c.clientHeight/2 + me.offsetHeight/2); } }

var LAUNCH=[
  ['🏆','conference.html','Conference','standings · tournament bracket · all-conference'],
  ['🔍','team-report.html','Team Report','identity · shots · possessions · rotation','coach'],
  ['⚔️','matchup.html','Matchup','head-to-head projected game plan','coach'],
  ['💰','moneyball.html','Moneyball','roster value in Wins Added','pro'],
  ['🧠','roles.html','Personnel Book','role & fit · how to use each man','coach'],
  ['📈','dossier.html','Player Dossier','projected line + full splits','coach'],
  ['🔁','lineups.html','Lineup Recommender','best-fit five-man units','coach'],
  ['🎯','bet/','TDC Bet','lines, props & edges vs the books',''],
  ['📅','predict.html','Projected Ratings','rating + game-by-game odds','pro'],
  ['🌱','roster-dev.html','Development','year-over-year trajectory','coach'],
  ['💵','nil.html','NIL Value','market values across the roster'],
  ['📰','fan.html','Fan Site','stories by fans · team forum'],
];
function rowOf(full){ full=(full||'').toLowerCase().trim(); return POOL.filter(function(t){ return (t.full||'').toLowerCase().trim()===full || (t.team||'').toLowerCase().trim()===full; })[0]||null; }

// Nov 2026 rework (owner: "total rework on the overview", disliked the starting-five cards): two columns, every section
// the same header and a sheet. Main = up next + ONE rotation table (starters by spot, bench in order, who's out, where
// each man came from and his OVR change); side = team grades, standings, news. Tools stay as a link list at the bottom.
var SKELETON=
  '<div id="hxToday" class="ov-grid"><div class="ov-main">'+
    '<div class="hq-sec"><h2 id="hxNextLbl">Up next</h2><span class="sub" id="hxNextSub"></span></div><div id="hxGame"></div>'+
    '<div id="hxRecapBlk"><div class="hq-sec"><h2 id="hxOutlookLbl">Season recap</h2></div><div id="hxOutlook"></div></div>'+
    '<div id="hxFiveBlk"><div class="hq-sec"><h2>Rotation</h2><span class="sub" id="hxFiveSub"></span></div><div id="hxFive"></div></div>'+
    '<div id="hxPastBlk">'+
      '<div class="hq-sec"><h2 id="hxLeadLbl">Roster</h2><span class="sub" id="hxLeadSub"></span></div><div id="hxLeaders"></div>'+
      '<div class="hq-sec"><h2 id="hxShotLbl">Team leaders</h2><span class="sub" id="hxShotSub"></span></div><div id="hxShot"></div>'+
    '</div>'+
  '</div><div class="ov-side">'+
    '<div class="hq-sec"><h2 id="hxAnaLbl">Team grades</h2><span class="sub" id="hxAnaSub">D-I percentile</span></div><div id="hxAnalytics"></div>'+
    '<div class="hq-sec"><h2 id="hxStandLbl">Standings</h2><span class="sub" id="hxStandSub"></span></div><div id="hxStandings"></div>'+
    '<div id="hxMediaCard"><div class="hq-sec"><h2>News</h2><span class="sub">latest on the roster</span></div><div id="hxMedia"></div></div>'+
  '</div></div>'+
  '<div class="hq-sec" id="cmd"><h2 id="hxCmdLbl">Every tool, set to your team</h2><span class="sub" id="hxTeamLbl"></span></div>'+
  '<div class="launch" id="hqLaunch"></div><div class="note" id="hqNote"></div>';

function renderSeason(){
  var row=rowOf(MY); if(!row) return;
  var q=encodeURIComponent(row.full), sq=(+HQ_SEASON===2027?'':'&season='+HQ_SEASON);
  var past=+HQ_SEASON<2027;
  byId('hxCmdLbl').textContent=past?'Explore this season':'Every tool, set to your team';
  byId('hqNote').textContent=past?'':'Locked tools open with a preview and an upgrade prompt if you’re not subscribed.';
  byId('hqLaunch').innerHTML=(past?LAUNCH_PAST:LAUNCH).map(function(t){
    var href=typeof t[1]==='function'?t[1](row):(t[1]+'?team='+q+sq);
    return '<a class="tool" href="'+href+'"'+(t[5]?' onclick="'+t[5]+'"':'')+'><span class="ic">'+t[0]+'</span><span style="min-width:0"><span class="tn">'+esc(t[2])+'</span><span class="td">'+t[3]+'</span></span>'+(t[4]?'<span class="lk">'+t[4].toUpperCase()+'</span>':'')+'</a>';
  }).join('');
  byId('hxTeamLbl').textContent=past?(row.full+', '+seasonLabel(HQ_SEASON)):row.full;
  var mediaCard=byId('hxMediaCard');
  byId('hxLeadSub').textContent=seasonLabel(HQ_SEASON); byId('hxShotSub').textContent=seasonLabel(HQ_SEASON);
  byId('hxFiveBlk').style.display=past?'none':''; byId('hxPastBlk').style.display=past?'':'none'; byId('hxRecapBlk').style.display=past?'':'none';
  byId('hxNextLbl').textContent=past?'Final game':'Up next'; byId('hxNextSub').textContent=past?seasonLabel(HQ_SEASON):'win chance · our line · projected score';
  if(past) pastRoster(row,HQ_SEASON); else loadRoster(row);
  if(+HQ_SEASON===2027){
    mediaCard.style.display='';
    analyticsProj(row); projStandings(row); projGame(row); loadBuzz(row);
  } else {
    mediaCard.style.display='none';
    byId('hxAnalytics').innerHTML='<div class="hx-empty">Loading…</div>';
    loadPast(HQ_SEASON).then(function(P){
      var tr=P.byFull[(row.full||'').toLowerCase().trim()];
      analyticsPast(P,tr); seasonRecap(P,tr,row); pastStandings(P,tr,row); lastGame(row.full,HQ_SEASON);
    });
  }
  if(window.TDCAnim&&TDCAnim.scan&&HOST) TDCAnim.scan(HOST);
}

// ── projected ──
var _projRecsP=null;
function projRecs(){ if(!_projRecsP){ _projRecsP=(window.TDCSched?TDCSched.projectAll():Promise.resolve({})).catch(function(){ return {}; }); } return _projRecsP; }
function analyticsProj(row){
  var el=byId('hxAnalytics'); byId('hxAnaLbl').textContent='Team grades'; byId('hxAnaSub').textContent='2026-27 projected · D-I percentile';
  el.innerHTML='<div class="hx-empty">Computing…</div>';
  // v = bar width (percentile 0-99); disp = the number shown (defaults to v); tip = hover explainer
  function mrow(l,v,tip,disp){ var d=(disp!=null?disp:(v==null?'—':v)); return '<div class="mrow"'+(tip?' title="'+tip.replace(/"/g,'&quot;')+'"':'')+'><span class="ml">'+l+'</span><div class="bar"><i style="width:'+(v==null?0:v)+'%;background:'+barCol(v)+'"></i></div><span class="mv" style="color:'+barCol(v)+'">'+d+'</span></div>'; }
  // Column chart (owner, Sept 2026: "more like a graph, not just bars"): each metric is a column on
  // the 0-100 D-I percentile scale, with gridlines, a dashed D-I average at 50 and the value on top.
  // Sheet (owner, Sept 2026: "make it look like a Google Sheet"): one row per metric in the site's
  // sheet style — the projected value, where it ranks, and the D-I percentile shaded red→green.
  var _effP=null;
  function effFor(r){
    if(!_effP) _effP=fetch('scripts/data/team_eff.json?v=15').then(function(x){return x.ok?x.json():null;}).then(function(j){ return (j&&j['2027'])||{}; }).catch(function(){ return {}; });
    return _effP.then(function(E){
      var mine=E[r.full]||null, arr=Object.keys(E).map(function(k){ return E[k]; });
      var rk=function(key,dir){ if(!mine||mine[key]==null) return null; return 1+arr.filter(function(x){ return x[key]!=null && (dir>0?x[key]>mine[key]:x[key]<mine[key]); }).length; };
      return {e:mine, n:arr.length, oRk:rk('o',1), dRk:rk('d',-1)};
    });
  }
  function heat(p){ return p==null?'':(p>=80?'c4':p>=60?'c3':p>=40?'c2':p>=20?'c1':'c0'); }
  function sheet(rows){
    return '<div class="sheet-wrap"><table class="sheet dense ta-sheet"><thead><tr><th class="l">Grade</th><th title="The 2026-27 projection">Projected</th><th class="hq-hide-ph" title="Rank (Overall/Power among all D-I; Offense/Defense among projected rosters)">Rank</th><th class="l" title="D-I percentile — 50 is average, 90 means better than 90% of teams">D-I percentile</th></tr></thead><tbody>'+
      rows.map(function(r){ return '<tr title="'+r.tip.replace(/"/g,'&quot;')+'"><td class="l nm">'+r.l+'</td><td class="big">'+r.v+'</td><td class="dim hq-hide-ph">'+(r.rk||'—')+'</td><td class="l"><span class="hq-bar g"><i style="width:'+(r.p||0)+'%"></i></span><b class="hq-pv '+heat(r.p)+'">'+(r.p==null?'—':r.p)+'</b></td></tr>'; }).join('')+
      '</tbody></table></div>';
  }
  if(window.TDCTeamGrades){
    Promise.all([TDCTeamGrades.compute(row), effFor(row)]).then(function(res){
      var g=res[0], E=res[1];
      var pct=function(rk,n){ return (rk&&n)?Math.max(1,Math.min(99,Math.round(100*(1-(rk-1)/n)))):null; };
      var pO=pct(E.oRk,E.n), pD=pct(E.dRk,E.n);
      el.innerHTML=g?sheet([
        {l:'Overall', v:(row.rank?'#'+row.rank:'—'), rk:(row.rank?'of 365':null), p:g.overall, tip:'Overall: where the projected team ranks among all D-I teams; the percentile says how many teams it projects better than.'},
        {l:'Power', v:(g.powerRating!=null?fmtR(g.powerRating):'—'), rk:(row.rank?'#'+row.rank:null), p:g.power, tip:'Power rating: projected points per game better or worse than an average D-I team, schedule-adjusted.'},
        {l:'Offense', v:(E.e&&E.e.o!=null?E.e.o.toFixed(1):'—'), rk:(E.oRk?'#'+E.oRk+' of '+E.n:null), p:(pO!=null?pO:g.offense), tip:'Offense: projected points per 100 possessions (ORtg). Higher is better.'},
        {l:'Defense', v:(E.e&&E.e.d!=null?E.e.d.toFixed(1):'—'), rk:(E.dRk?'#'+E.dRk+' of '+E.n:null), p:(pD!=null?pD:g.defense), tip:'Defense: projected points allowed per 100 possessions (DRtg). Lower is better.'}
      ]):'<div class="hx-empty">No analytics on file.</div>';
    }).catch(function(){ el.innerHTML='<div class="hx-empty">Could not compute analytics.</div>'; });
  } else el.innerHTML='<div class="hx-empty">No analytics on file.</div>';
}
function projStandings(row){
  byId('hxStandLbl').textContent=(row.conf||'Conference')+' Standings';
  byId('hxStandSub').innerHTML='2026-27 projected &middot; <a class="hx-more" href="conference.html?team='+encodeURIComponent(row.full||row.team)+'">Full standings &amp; tournament &rarr;</a>';
  var mine=POOL.filter(function(t){return t.conf===row.conf;}).sort(function(a,b){return (a.rank||999)-(b.rank||999);});
  var el=byId('hxStandings');
  if(!mine.length){ el.innerHTML='<div class="hx-empty">No conference on file.</div>'; return; }
  var paint=function(recs){
    recs=recs||{};
    var withRec=mine.filter(function(t){ var p=recs[t.full]; return p&&p.confN>=8; }).length;
    var list=mine.slice();
    if(withRec) list.sort(function(a,b){ var pa=recs[a.full],pb=recs[b.full]; var wa=pa&&pa.confN>=8?pa.cw/pa.confN:-1, wb=pb&&pb.confN>=8?pb.cw/pb.confN:-1; return (wb-wa)||((+b.rating||0)-(+a.rating||0)); });
    var rows=list.map(function(t,i){ var p=recs[t.full];
      return standRow(i,t.full===row.full,t.full,
        withRec?'<td>'+(p&&p.confN>=8?recStr(p.cw,p.cl):'—')+'</td><td class="dim">'+(p&&p.n>=20?recStr(p.w,p.l):'')+'</td>':'<td>'+fmtR(t.rating)+'</td>'); }).join('');
    el.innerHTML=wrapStand(rows,mine.length,'<th class="rk">#</th><th class="l">Team</th>'+(withRec?'<th title="projected conference record">Conf</th><th title="projected overall record">Overall</th>':'<th data-heat="1" title="projected Power Rating">Rating</th>')); fitStand();
    byId('hxStandSub').textContent=withRec?'2026-27 projected record':'2026-27 projected';
  };
  paint(null);
  projRecs().then(function(recs){ if(MY===row.full&&+HQ_SEASON===2027) paint(recs); });
}
function seasonRecap(P,tr,row){
  var el=byId('hxOutlook'); byId('hxOutlookLbl').textContent='Season Recap — '+seasonLabel(HQ_SEASON);
  if(!tr){ el.innerHTML='<p class="otxt">No '+seasonLabel(HQ_SEASON)+' season on file for this program.</p>'; return; }
  var conf=tr.conference;
  var mine=P.rows.filter(function(r){return r.conference===conf;}).sort(function(a,b){ var ac=(a.conf_wins||0)-(a.conf_losses||0), bc=(b.conf_wins||0)-(b.conf_losses||0); return bc-ac || ((b.srs||-99)-(a.srs||-99)); });
  var pos=mine.findIndex(function(r){return r.team===tr.team;})+1;
  var tags='<span class="otag hot">'+recStr(tr.wins,tr.losses)+' overall</span>';
  if(pos) tags+='<span class="otag">'+ord(pos)+' in '+esc(conf||'conf')+'</span>';
  if(tr.ncaa_seed) tags+='<span class="otag good">#'+tr.ncaa_seed+' seed</span>';
  if(tr.ncaa_result) tags+='<span class="otag">'+esc(tr.ncaa_result)+'</span>';
  var sent='<b>'+esc(row.full)+'</b> went <b>'+recStr(tr.wins,tr.losses)+'</b>'+(tr.conf_wins!=null?(' ('+recStr(tr.conf_wins,tr.conf_losses)+' '+esc(conf||'')+')'):'')+(pos?(', finishing '+ord(pos)+' in the league'):'')+(tr.ncaa_result?(', and '+ncaaPhrase(tr.ncaa_result)):'')+'. Power rating: <b>'+fmtR(tr.srs)+'</b>.';
  el.innerHTML='<div class="otags">'+tags+'</div><p class="otxt">'+sent+'</p>';
}
function projGame(row){
  // A: the next six games as a sheet (date, opponent, win chance, our line, projected score), the scout /
  // matchup buttons under it
  var el=byId('hxGame'), q=encodeURIComponent(row.full);
  var btns=function(opp){ return '<div class="ov-links">'+(opp?'<a href="team.html?team='+encodeURIComponent(opp)+'&tab=scout">Scout '+esc(opp)+'</a>':'')+'<a href="matchup.html?a='+q+(opp?'&b='+encodeURIComponent(opp):'')+'">Matchup</a><a href="team.html?team='+q+'&tab=schedule" onclick="'+tab('schedule')+'">Full schedule</a></div>'; };
  el.innerHTML='<div class="hx-empty">Loading the schedule…</div>';
  var notYet=function(){ el.innerHTML='<div class="hx-empty">The 2026-27 schedule isn’t out yet. Your next games and their scouting reports land here once it drops.</div>'+btns(); };
  if(!window.TDCSched) return notYet();
  TDCSched.project(row.full).then(function(R){
    if(MY!==row.full||+HQ_SEASON!==2027) return;
    var G=(R&&R.rows||[]).filter(function(g){ return !g.final; }).slice(0,6); if(!G.length) return notYet();
    var heat=function(p){ return p>=80?'c4':p>=60?'c3':p>=45?'c2':p>=30?'c1':'c0'; };
    var day=function(d){ var t=new Date(d+'T12:00:00'); return '<span class="hq-hide-ph">'+t.toLocaleDateString('en-US',{weekday:'short'})+', </span>'+t.toLocaleDateString('en-US',{month:'short',day:'numeric'}); };
    el.innerHTML='<div class="sheet-wrap"><table class="sheet dense hq-next" data-fit-keep><thead><tr><th class="l">Date</th><th class="l">Opponent</th><th class="hq-hide-ph" title="opponent\'s projected national rank">Opp rank</th><th title="our chance to win">Win</th><th title="our projected line">Line</th><th class="hq-hide-ph" title="projected score">Score</th></tr></thead><tbody>'+
      G.map(function(g){ var o=(g.opp&&g.opp.team)||g.oppName||g.label||'TBD', lg=g.oppName?logoFor(g.oppName):null, pc=Math.round(g.p*100);
        return '<tr><td class="l">'+day(g.g.date)+'</td><td class="l nm">'+(lg?'<img class="hq-lg" src="'+lg+'" alt="">':'')+'<span>'+(g.venue==='A'?'at ':'vs ')+esc(o)+(g.venue==='N'?' <span class="dim">· neutral</span>':'')+(g.event?' <span class="dim hq-hide-ph">· '+esc(g.event)+'</span>':'')+'</span></td>'+
          '<td class="dim hq-hide-ph">'+(g.opp&&g.opp.rank?'#'+g.opp.rank:'—')+'</td><td class="'+heat(pc)+'"><b>'+pc+'%</b></td><td>'+(g.margin==null?'—':(g.margin>0?'−':'+')+Math.abs(g.margin).toFixed(1))+'</td><td class="dim hq-hide-ph">'+g.scoreMe+'–'+g.scoreOpp+'</td></tr>'; }).join('')+
      '</tbody></table></div>'+btns(G[0].oppName||'');
  }).catch(notYet);
}

// ── past ──
function loadPast(year){
  if(PAST[year]) return Promise.resolve(PAST[year]);
  return fetch(SB+'/rest/v1/team_seasons?season_year=eq.'+year+'&select=team,conference,wins,losses,conf_wins,conf_losses,srs,ncaa_seed,ncaa_result',{headers:H})
    .then(function(r){return r.ok?r.json():[];})
    .then(function(rows){ var byFull={}; rows.forEach(function(r){ byFull[(r.team||'').toLowerCase().trim()]=r; }); PAST[year]={rows:rows,byFull:byFull}; return PAST[year]; })
    .catch(function(){ PAST[year]={rows:[],byFull:{}}; return PAST[year]; });
}
function analyticsPast(P,tr){
  var el=byId('hxAnalytics'); byId('hxAnaLbl').textContent='Season grades'; byId('hxAnaSub').textContent=seasonLabel(HQ_SEASON);
  if(!tr){ el.innerHTML='<div class="hx-empty">No season data on file.</div>'; return; }
  var ranked=P.rows.filter(function(r){return r.srs!=null;}).sort(function(a,b){return b.srs-a.srs;});
  var pr=ranked.findIndex(function(r){return r.team===tr.team;})+1;
  var post=tr.ncaa_result?esc(tr.ncaa_result):(tr.ncaa_seed?('#'+tr.ncaa_seed+' seed'):'—');
  function tile(v,l){ return '<div class="stile"><div class="sv">'+v+'</div><div class="sl">'+l+'</div></div>'; }
  el.innerHTML='<div class="stat3">'+tile(fmtR(tr.srs),'Power')+tile(pr?('#'+pr):'—','Natl Rank')+tile(post,'Postseason')+'</div>';
}
function pastStandings(P,tr,row){
  var conf=tr&&tr.conference, el=byId('hxStandings');
  byId('hxStandLbl').textContent=(conf||'Conference')+' Standings';
  byId('hxStandSub').textContent=seasonLabel(HQ_SEASON);
  if(!conf){ el.innerHTML='<div class="hx-empty">No standings for this program in '+seasonLabel(HQ_SEASON)+'.</div>'; return; }
  var mine=P.rows.filter(function(r){return r.conference===conf;}).sort(function(a,b){ var ac=(a.conf_wins||0)-(a.conf_losses||0), bc=(b.conf_wins||0)-(b.conf_losses||0); return bc-ac || ((b.srs||-99)-(a.srs||-99)); });
  var rows=mine.map(function(t,i){ var me=(t.team===(tr&&tr.team));
    return standRow(i,me,t.team,'<td>'+(t.conf_wins!=null?recStr(t.conf_wins,t.conf_losses):'—')+'</td><td class="dim">'+recStr(t.wins,t.losses)+'</td>'); }).join('');
  el.innerHTML=wrapStand(rows,mine.length,'<th class="rk">#</th><th class="l">Team</th><th>Conf</th><th>Overall</th>'); fitStand();
}
function lastGame(full,year){
  var LBL=+year<2027?'Final Game':'Last Game';
  var el=byId('hxGame'); el.innerHTML='<div class="hx-lab">'+LBL+'</div><div class="hx-empty">Loading…</div>';
  var q=encodeURIComponent(full);
  fetch(SB+'/rest/v1/games?season_year=eq.'+year+'&or=(home.eq.'+q+',away.eq.'+q+')&status=eq.STATUS_FINAL&select=id,date,home,away,home_score,away_score,neutral&order=date.desc&limit=1',{headers:H})
    .then(function(r){return r.ok?r.json():[];})
    .then(function(g){ return window.TDC_OT?TDC_OT.ready().then(function(){ return g; }):g; })
    .then(function(g){
      if(!g||!g.length){ el.innerHTML='<div class="hx-lab">'+LBL+'</div><div class="hx-empty">No games on file for '+esc(full)+' in '+seasonLabel(year)+'.</div>'; return; }
      var m=g[0], home=(m.home===full), opp=home?m.away:m.home, us=home?m.home_score:m.away_score, them=home?m.away_score:m.home_score, win=us>them, lg=logoFor(opp);
      el.innerHTML='<div class="hx-lab">'+LBL+' <span class="sub">'+m.date+'</span></div>'+
        '<div class="ng-match">'+(lg?'<img class="ng-logo" src="'+lg+'" alt="">':'')+'<div><div class="ng-vs">'+(m.neutral?'vs':(home?'vs':'at'))+'</div><div class="ng-opp">'+esc(opp)+'</div><div class="ng-res"><span class="'+(win?'w':'l')+'">'+(win?'W':'L')+' '+us+'–'+them+(window.TDC_OT?TDC_OT.chip(m.id):'')+'</span></div></div></div>'+
        '<a class="ng-report" href="game.html?id='+m.id+'">Full game report →</a>';
    }).catch(function(){ el.innerHTML='<div class="hx-lab">'+LBL+'</div><div class="hx-empty">Could not load games.</div>'; });
}

// ── season archive ──
var LAUNCH_PAST=[
  ['📊',function(r){ return 'team.html?team='+encodeURIComponent(r.full)+'&season='+HQ_SEASON+'&tab=depth'; },'Depth chart','that season’s roster · stats','',tab('depth')],
  ['📅',function(r){ return 'team.html?team='+encodeURIComponent(r.full)+'&season='+HQ_SEASON+'&tab=schedule'; },'Schedule','every game and result','',tab('schedule')],
  ['🏆',function(r){ var tr=PAST[HQ_SEASON]&&PAST[HQ_SEASON].byFull[(r.full||'').toLowerCase().trim()]; return 'conference.html?conf='+encodeURIComponent((tr&&tr.conference)||'')+'&season='+HQ_SEASON+'&team='+encodeURIComponent(r.full); },'Conference','standings · tournament · all-conference'],
  ['🗂️',function(){ return 'tournaments.html?season='+HQ_SEASON; },'Postseason','that year’s NCAA tournament'],
];
function ncaaPhrase(r){
  return ({'Champion':'won the national championship','Runner-Up':'reached the national championship game',
    'Round of 64':'lost in the NCAA Round of 64','Round of 32':'lost in the NCAA Round of 32'}[r]) || ('reached the '+esc(r));
}
function boxRoster(full,yr){
  var out=[], page=function(off){
    return fetch(SB+'/rest/v1/box_scores?season_year=eq.'+yr+'&team=eq.'+encodeURIComponent(full)+'&select=game_id,player,espn_id,min,pts,reb,ast,tpm,stl,blk&order=game_id.asc,player.asc&limit=1000&offset='+off,{headers:H})
      .then(function(r){return r.ok?r.json():[];}).then(function(rows){ out=out.concat(rows||[]); return (rows||[]).length===1000?page(off+1000):out; });
  };
  return page(0).then(function(rows){
    var P={};
    rows.forEach(function(b){ var k=b.espn_id!=null?'e'+b.espn_id:'n'+b.player; var p=P[k]||(P[k]={espn_id:b.espn_id,name:b.player,gp:0,min:0,pts:0,reb:0,ast:0,tpm:0,stl:0,blk:0});
      if(!(b.min>0)) return; p.gp++; ['min','pts','reb','ast','tpm','stl','blk'].forEach(function(x){ p[x]+=(+b[x]||0); }); });
    return Object.keys(P).map(function(k){ var p=P[k], g=p.gp||1;
      return {espn_id:p.espn_id,name:p.name,gp:p.gp,mpg:p.min/g,ppg:p.pts/g,rpg:p.reb/g,apg:p.ast/g,tpm:p.tpm/g,stl:p.stl/g,blk:p.blk/g}; })
      .filter(function(p){ return p.gp>0; }).sort(function(a,b){ return b.mpg-a.mpg; });
  }).catch(function(){ return []; });
}
function pastRoster(row,yr){
  var le=byId('hxLeaders'), se=byId('hxShot');
  le.innerHTML='<div class="hx-empty">Loading roster…</div>'; se.innerHTML='<div class="hx-empty">Loading…</div>';
  var stale=function(){ return MY!==row.full||+HQ_SEASON!==yr; };
  Promise.all([
    fetch(SB+'/rest/v1/player_history?season_year=eq.'+yr+'&team=eq.'+encodeURIComponent(row.team||row.full)+'&select=espn_id,name,position,yr,gp,mpg,ppg,rpg,apg,tpm,stl,blk&order=mpg.desc.nullslast',{headers:H}).then(function(r){return r.ok?r.json():[];})
      .then(function(ph){ return (ph||[]).length>=5 ? ph : boxRoster(row.full,yr).then(function(bx){ return bx.length>(ph||[]).length?bx:ph; }); }),
    (window.TDCProjGrade&&TDCProjGrade.loadHist?Promise.resolve(TDCProjGrade.loadHist()).catch(function(){}):Promise.resolve())
  ]).then(function(res){
    if(stale()) return;
    var ps=(res[0]||[]).filter(function(p){ return (p.gp||0)>0; });
    if(!ps.length){ le.innerHTML='<div class="hx-empty">No '+seasonLabel(yr)+' roster on file.</div>'; se.innerHTML='<div class="hx-empty">—</div>'; return; }
    var H_=(window.TDCProjGrade&&TDCProjGrade.statMaps)?(TDCProjGrade.statMaps().hist||{})[''+yr]||{}:{};
    ps.forEach(function(p){ p.ov=(p.espn_id!=null&&H_[String(p.espn_id)]!=null)?H_[String(p.espn_id)]:null; });
    var f1=function(v){ return v==null?'—':(+v).toFixed(1); };
    var link=function(p){ return p.espn_id?'<a href="player.html?espn='+p.espn_id+'">'+esc(p.name)+'</a>':esc(p.name); };
    var hasOv=ps.some(function(p){return p.ov!=null;});
    var hasYr=ps.some(function(p){return p.yr;}), hasPos=ps.some(function(p){return p.position;});
    var list=ps.slice(0,12);
    le.innerHTML='<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Player</th>'+(hasYr?'<th class="c">Yr</th>':'')+(hasPos?'<th class="c">Pos</th>':'')+'<th data-heat="1">MPG</th><th data-heat="1">PPG</th><th data-heat="1">RPG</th><th data-heat="1">APG</th>'+(hasOv?'<th data-heat="1">OVR</th>':'')+'</tr></thead><tbody>'+
      list.map(function(p){ return '<tr><td class="l nm">'+link(p)+'</td>'+(hasYr?'<td class="c dim">'+esc(p.yr||'')+'</td>':'')+(hasPos?'<td class="c dim">'+esc(p.position||'')+'</td>':'')+'<td>'+f1(p.mpg)+'</td><td class="strong">'+f1(p.ppg)+'</td><td>'+f1(p.rpg)+'</td><td>'+f1(p.apg)+'</td>'+(hasOv?'<td class="big">'+(p.ov==null?'—':p.ov)+'</td>':'')+'</tr>'; }).join('')+
      '</tbody></table></div>';
    if(window.tdcSheetHeat) tdcSheetHeat(le.querySelector('table'));
    // team leaders: per-game leaders among players with real minutes
    var reg=ps.filter(function(p){ return (p.mpg||0)>=10 && (p.gp||0)>=8; }); if(!reg.length) reg=ps;
    var lead=function(k,lab){ var b=reg.slice().sort(function(a,c){ return (c[k]||0)-(a[k]||0); })[0]; return b&&b[k]!=null?'<tr><td class="l dim">'+lab+'</td><td class="l nm">'+link(b)+'</td><td class="strong">'+f1(b[k])+'</td></tr>':''; };
    var top=hasOv?ps.filter(function(p){return p.ov!=null;}).sort(function(a,c){return c.ov-a.ov;})[0]:null;
    se.innerHTML='<div class="sheet-wrap"><table class="sheet dense"><tbody>'+
      (top?'<tr><td class="l dim">Best player</td><td class="l nm">'+link(top)+'</td><td class="strong">'+top.ov+' OVR</td></tr>':'')+
      lead('ppg','Points')+lead('rpg','Rebounds')+lead('apg','Assists')+lead('tpm','3-pointers')+lead('stl','Steals')+lead('blk','Blocks')+
      '</tbody></table></div>';
  }).catch(function(){ if(!stale()){ le.innerHTML='<div class="hx-empty">Could not load the roster.</div>'; se.innerHTML=''; } });
}
function seatFive(list,RD){
  var SL=['PG','SG','SF','PF','C'], IDX={PG:0,SG:1,SF:2,PF:3,C:4};
  var rsls=function(x){ x=(''+(x||'')).toUpperCase().trim();
    if(x==='PG')return ['PG']; if(x==='SG')return ['SG']; if(x==='G'||x==='CG')return ['PG','SG'];
    if(x==='SF')return ['SF']; if(x==='GF')return ['SG','SF']; if(x==='F')return ['SF','PF'];
    if(x==='PF')return ['PF']; if(x==='C')return ['C']; return []; };
  var oop=function(p,sl){ var L=rsls(p.position).concat(rsls(p.position2)); if(!L.length) return 0; return Math.min.apply(null,L.map(function(s){ return Math.abs(IDX[s]-IDX[sl]); })); };
  var cost=function(x,sl){ var d=oop(x.p,sl); return d*d+((''+(x.p.position||'')).toUpperCase()===sl?0:0.25); };
  var arrange=function(five){ var best=null, bestC=1e9, a=five.slice();
    var perm=function(k){ if(k===a.length){ var c=a.reduce(function(t,x,i){ return t+cost(x,SL[i]); },0); if(c<bestC){ bestC=c; best=a.slice(); } return; }
      for(var i=k;i<a.length;i++){ var t=a[k]; a[k]=a[i]; a[i]=t; perm(k+1); t=a[k]; a[k]=a[i]; a[i]=t; } };
    perm(0); return { five:best||five, c:bestC }; };
  var dOf=function(x){ var d=parseFloat(x.p.depth_order); return isFinite(d)?d:999; };
  var ord=list.slice().sort(function(a,b){ return dOf(a)-dOf(b); });
  // REAL GAMES (same rule as the Depth Chart tab): once a team has played, the five are its most frequent starters,
  // recent games counting more; injured players were already taken out, so the next man up starts
  if(RD&&ord.length>=5&&ord.some(function(x){ return RD.of(x.p); })){
    var rd=ord.slice().sort(function(a,b){ var x=RD.of(a.p)||{w:0,min:0}, y=RD.of(b.p)||{w:0,min:0}; return y.w-x.w||y.min-x.min||dOf(a)-dOf(b); });
    return arrange(rd.slice(0,5)).five.map(function(x,i){ x.slot=SL[i]; return x; });
  }
  if(ord.length<=5){ var r0=ord.length===5?arrange(ord).five:ord; return r0.map(function(x,i){ x.slot=ord.length===5?SL[i]:null; return x; }); }
  var kept=ord.filter(function(x){ return dOf(x)<=5; }), bench=ord.filter(function(x){ return dOf(x)>5; }), open=5-kept.length, SKIP=0.6, five;
  if(open<=0) five=arrange(ord.slice(0,5)).five;
  else if(bench.length>=open){
    var pool=bench.slice(0,open+2), bestF=null, bestT=1e9;
    var pick=function(start,chosen){ if(chosen.length===open){ var r=arrange(kept.concat(chosen)), skip=chosen.reduce(function(t,x){ return t+pool.indexOf(x); },0)-(open*(open-1))/2;
        var tot=r.c+SKIP*skip; if(tot<bestT){ bestT=tot; bestF=r.five; } return; }
      for(var i=start;i<pool.length;i++) pick(i+1,chosen.concat([pool[i]])); };
    pick(0,[]); five=bestF;
  } else five=arrange(ord.slice(0,5)).five;
  return five.map(function(x,i){ x.slot=SL[i]; return x; });
}
function loadRoster(row){
  var fe=byId('hxFive');
  fe.innerHTML='<div class="hx-empty">Loading the rotation…</div>';
  var short=row.team||row.full, q=encodeURIComponent(row.full);
  fetch(SB+'/rest/v1/players?team=eq.'+encodeURIComponent(short)+'&select=*&order=depth_order.asc.nullslast',{headers:H})
    .then(function(r){return r.ok?r.json():[];})
    .then(function(ps){
      if(+HQ_SEASON<2027) return;   // switched to an archive season while this loaded
      ps=(ps||[]).filter(function(p){ return p&&p.name; });
      var go=function(){
        var f1=function(v){ var n=parseFloat(v); return isFinite(n)?n.toFixed(1):'—'; };
        var link=function(p){ return p.espn_id?'<a href="player.html?espn='+p.espn_id+'">'+esc(p.name)+'</a>':esc(p.name); };
        var out=function(p){ try{ return !!(window.TDCInjury&&TDCInjury.isOut&&TDCInjury.isOut(p)); }catch(e){ return false; } };
        var arr=ps.map(function(p){
          var ov=window.TDCProjGrade?TDCProjGrade.gradeSolo(p):(parseFloat(p.tdc_grade)||null);
          // last year on the SAME scale (the statistical overall): gradeSolo on a 2026-tagged copy
          var last=null; if(window.TDCProjGrade&&p.espn_id){ var dr={}; for(var kk in p) dr[kk]=p[kk]; dr.season_year=2026; var lv=TDCProjGrade.gradeSolo(dr); if(lv!=null&&isFinite(lv)) last=lv; }
          var L=(window.TDCProjGrade&&TDCProjGrade.lineOf)?TDCProjGrade.lineOf(p):null;
          return {p:p,ov:(ov!=null&&isFinite(ov))?Math.round(ov):null,last:last!=null?Math.round(last):null,L:L||{},mpg:L&&L.mpg!=null?+L.mpg:null,out:out(p)};
        });
        if(!arr.length){ fe.innerHTML='<div class="hx-empty">No roster on file for this program yet.</div>'; return; }
        var healthy=arr.filter(function(x){ return !x.out; });
        var RD=REALD, five=seatFive(healthy,RD), inFive=five.map(function(x){ return x.p; });
        var bench=healthy.filter(function(x){ return inFive.indexOf(x.p)<0; }).filter(function(x){ return x.mpg==null||x.mpg>=0.5||(RD&&RD.of(x.p)); }), hurt=arr.filter(function(x){ return x.out; });
        // bench: who actually plays first once games are in, like the Depth Chart tab
        if(RD&&bench.some(function(x){ return RD.of(x.p); })) bench.sort(function(a,b){ var x=RD.of(a.p), y=RD.of(b.p); return ((y&&y.min)||0)-((x&&x.min)||0); });
        var hc=function(o){ return o==null?'':o>=85?'c4':o>=80?'c3':o>=75?'c2':o>=70?'c1':'c0'; };
        var ids=arr.map(function(x){ return x.p.espn_id; }).filter(function(e){ return e!=null; });
        var paint=function(H_){
          var same=function(t){ t=(t||'').toLowerCase().trim(); var a=(row.team||'').toLowerCase().trim(), b=(row.full||'').toLowerCase().trim(); return t&&(t===a||t===b||b.indexOf(t+' ')===0); };
          var how=function(x){ if(!H_) return ['',''];
            var h=x.p.espn_id!=null?H_[x.p.espn_id]:null, y=(x.p.yr||x.p.class_year||'').toString();
            if(!h) return /fr/i.test(y)&&!/r-?fr|rs/i.test(y)?['Freshman','fr']:['Newcomer','nw'];
            return same(h.team)?['Returner','rt']:['From '+(window.tdcTeamName?tdcTeamName(h.team):h.team),'tr']; };
          var n={rt:0,tr:0,fr:0,nw:0};
          var line=function(x,role,cls){ var p=x.p, L=x.L, w=how(x), d=(x.last!=null&&x.ov!=null)?x.ov-x.last:null, yr=p.yr||p.class_year||'';
            if(w[1]) n[w[1]]++;
            var listed=(p.position||'').toUpperCase(), tip=x.slot&&listed&&listed!==x.slot?' title="Listed '+esc(listed)+'"':'';
            return '<tr'+(cls?' class="'+cls+'"':'')+'><td class="l ov-role"'+tip+'>'+role+'</td>'+
              '<td class="l nm">'+link(p)+(cls==='hq-out'&&window.TDCInjury&&TDCInjury.badgeHTML?' '+TDCInjury.badgeHTML(p):'')+'<span class="ov-sub">'+[esc(yr),w[0]?'<span class="ov-path '+w[1]+'">'+esc(w[0])+'</span>':''].filter(Boolean).join(' · ')+'</span></td>'+
              '<td class="'+hc(x.ov)+' ov-ovr"><b>'+(x.ov==null?'—':x.ov)+'</b></td>'+
              '<td class="ov-d hq-hide-ph">'+(d?'<span class="'+(d>0?'up':'dn')+'">'+(d>0?'+':'−')+Math.abs(d)+'</span>':'<span class="dim">'+(x.last==null?'new':'0')+'</span>')+'</td>'+
              (cls==='hq-out'?'<td class="l dim" colspan="4">out</td>':
              '<td class="l ov-min"><span class="hq-bar"><i style="width:'+Math.min(100,(x.mpg||0)/40*100)+'%"></i></span>'+f1(x.mpg)+'</td><td class="strong">'+f1(L.ppg)+'</td><td>'+f1(L.rpg)+'</td><td class="hq-hide-ph">'+f1(L.apg)+'</td>')+'</tr>'; };
          var grp=function(t){ return '<tr class="ov-grp"><td colspan="8">'+t+'</td></tr>'; };
          var body=grp('Starters')+five.map(function(x){ return line(x,esc(x.slot||x.p.position||'')); }).join('')+
            (bench.length?grp('Bench')+bench.map(function(x,i){ return line(x,ord(i+6)); }).join(''):'')+
            (hurt.length?grp('Out')+hurt.map(function(x){ return line(x,'—','hq-out'); }).join(''):'');
          fe.innerHTML='<div class="sheet-wrap"><table class="sheet dense ov-rot" data-fit-keep><thead><tr><th class="l">Spot</th><th class="l">Player</th><th title="projected 2026-27 overall">OVR</th><th class="hq-hide-ph" title="change from last season\'s overall">+/−</th><th class="l" title="projected minutes per game">Min</th><th>Pts</th><th>Reb</th><th class="hq-hide-ph">Ast</th></tr></thead><tbody>'+body+'</tbody></table></div>';
          var built=H_?[n.rt?n.rt+' returning':'',n.tr?n.tr+' transfer'+(n.tr===1?'':'s'):'',n.fr?n.fr+' freshm'+(n.fr===1?'an':'en'):'',n.nw?n.nw+' newcomer'+(n.nw===1?'':'s'):''].filter(Boolean).join(' · '):'';
          var fs=byId('hxFiveSub'); if(fs) fs.textContent=[RD?'starters = most used in '+RD.R.games+(RD.R.games===1?' game':' games'):'starters from the depth chart','projected per game',built].filter(Boolean).join(' · ');
        };
        paint(null);
        if(!ids.length) return paint({});
        fetch(SB+'/rest/v1/player_history?espn_id=in.('+ids.join(',')+')&season_year=in.(2025,2026)&mpg=gt.0&select=espn_id,team,season_year&order=season_year.desc',{headers:H})
          .then(function(r){return r.ok?r.json():[];}).then(function(rows){ var m={}; (rows||[]).forEach(function(h){ if(!m[h.espn_id]) m[h.espn_id]=h; }); if(+HQ_SEASON===2027&&MY===row.full) paint(m); })
          .catch(function(){ paint({}); });
      };
      // the owner's freshman profiles + injury report first, so a recruit's OVR and who is out match the team page
      var _boot=function(){ var r=(window.TDCProjGrade&&TDCProjGrade.ready)||Promise.resolve(); var inj=(window.TDCInjury&&TDCInjury.load)?Promise.resolve(TDCInjury.load()).catch(function(){}):Promise.resolve();
        var rd=REAL_FN?Promise.resolve(REAL_FN()).then(function(v){ if(v&&v.R&&+HQ_SEASON===2027) REALD=v; }).catch(function(){}):Promise.resolve();
        Promise.all([r,inj,rd]).then(go).catch(go); };
      if(window.TDCFresh&&TDCFresh.load){ TDCFresh.load().then(_boot).catch(_boot); } else { _boot(); }
    }).catch(function(){ fe.innerHTML='<div class="hx-empty">Could not load the roster.</div>'; });
}

// ── media / buzz ──
var NEWS=null;
function loadNews(){ if(NEWS!==null) return Promise.resolve(NEWS); return fetch('scripts/data/player_news.json').then(function(r){return r.ok?r.json():null;}).then(function(j){ NEWS=(j&&j.players)||{}; return NEWS; }).catch(function(){ NEWS={}; return NEWS; }); }
function loadBuzz(row){
  var el=byId('hxMedia'); el.innerHTML='<div class="hx-empty">Loading headlines…</div>';
  var short=row.team||row.full, lg=logoFor(row.full);
  Promise.all([
    fetch(SB+'/rest/v1/players?team=eq.'+encodeURIComponent(short)+'&select=name,espn_id&espn_id=not.is.null',{headers:H}).then(function(r){return r.ok?r.json():[];}).catch(function(){return [];}),
    loadNews()
  ]).then(function(rr){
    var players=rr[0], news=rr[1]||{}, items=[];
    players.forEach(function(p){ var n=news[''+p.espn_id]; if(n&&n.items) n.items.forEach(function(it){ items.push({t:it.title,u:it.url,src:it.source,date:it.date,who:p.name}); }); });
    var seen={}; items=items.filter(function(x){ if(!x.t||seen[x.t]) return false; seen[x.t]=1; return true; });
    items.sort(function(a,b){ return (new Date(b.date)||0)-(new Date(a.date)||0); });
    items=items.slice(0,4);
    if(!items.length){ el.innerHTML='<div class="hx-empty">No recent headlines on file for this roster yet — buzz refreshes as news breaks on your players.</div>'; return; }
    el.innerHTML=items.map(function(x){
      return '<a class="media" href="'+esc(x.u)+'" target="_blank" rel="noopener"><div class="mth">'+(lg?'<img src="'+lg+'" alt="">':'')+'</div><div><div class="mt">'+esc(x.t)+'</div><div class="mm"><b>'+esc(x.who)+'</b> · '+esc(x.src||'')+'</div></div></a>';
    }).join('');
  }).catch(function(){ el.innerHTML='<div class="hx-empty">Could not load headlines.</div>'; });
}

function pool(){ if(!_poolP) _poolP=(window.TDC_RATINGS?TDC_RATINGS.get():Promise.resolve({})).then(function(D){ POOL=((D&&D.teams)||[]).filter(function(t){ return t.projected!==false && t.rating!=null; }).sort(function(a,b){ return (a.rank||999)-(b.rank||999); }); return POOL; }); return _poolP; }
var _key=null, REAL_FN=null;
window.TDC_TEAMHQ={
  // draws the tab once per team + season; resolves to false when the program isn't in the ratings (left D-I)
  show:function(host,o){
    return pool().then(function(){
      var row=rowOf(o.team)||(o.full&&rowOf(o.full)); if(!row) return false;
      var y=+o.season||2027, k=row.full+'|'+y;
      if(k===_key&&HOST===host) return true;
      _key=k; HOST=host; MY=row.full; HQ_SEASON=y; REAL_FN=o.realDepth||null; REALD=null;
      if(window.tdcBandColor&&!document.documentElement.style.getPropertyValue('--tc-band')){ try{ var c=tdcTeamColor(row.full); if(c&&c.c1) document.documentElement.style.setProperty('--tc-band',tdcBandColor(c.c1)); }catch(e){} }
      host.innerHTML=SKELETON; renderSeason();
      return true;
    }).catch(function(e){ console.warn('team overview',e); return false; });
  }
};
})();
