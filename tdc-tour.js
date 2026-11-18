/* tdc-tour.js — "Explain this page": a spotlight walkthrough of the tools on the page you're on.
 *
 * The homepage's first-visit tour (spotlight + tip card) generalised into one module:
 *   • a fixed  ? Explain  pill on every page that has a walkthrough (bottom-left, above the fold-in)
 *   • steps per page, keyed by the page filename below (sel = what to spotlight, t/d = copy,
 *     tab = a page tab to open first via switchTab, before = any prep function)
 *   • missing targets are skipped, so a gated/blurred section or an empty state can't strand it
 *   • on demand only: nothing opens by itself on any page (the old first-visit auto-tour is gone)
 * Add a page: TDCTour.register('foo.html', [ {sel:'#x', t:'…', d:'…'}, … ]) or edit TOURS below.
 */
(function (g) {
  var CSS = '\
#tdcTourWrap{position:fixed;inset:0;z-index:2147483100;display:none;}\
#tdcTourWrap.on{display:block;}\
.tdc-tour-spot{position:absolute;border-radius:12px;box-shadow:0 0 0 9999px rgba(8,10,18,.74);transition:all .32s cubic-bezier(.22,1,.36,1);pointer-events:none;}\
.tdc-tour-tip{position:absolute;max-width:380px;max-height:calc(100vh - 24px);overflow:auto;background:var(--bg2,#fff);border:1px solid var(--border2,#ccd);border-radius:14px;padding:16px 18px;box-shadow:0 18px 50px -12px rgba(0,0,0,.6);transition:all .32s cubic-bezier(.22,1,.36,1);}\
.tdc-tour-step{font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--accent,#3b5bdb);margin-bottom:6px;}\
.tdc-tour-t{font-weight:800;font-size:15px;color:var(--text,#111);margin-bottom:5px;}\
.tdc-tour-d{font-size:13px;color:var(--text2,#445);line-height:1.5;}.tdc-tour-d b{color:var(--text,#111);}.tdc-tour-d ul{color:var(--text2,#445);}\
.tdc-tour-nav{display:flex;align-items:center;justify-content:space-between;margin-top:14px;gap:10px;}\
.tdc-tour-skip{font-size:12px;font-weight:600;color:var(--text3,#778);background:none;border:none;cursor:pointer;padding:4px;}\
.tdc-tour-skip:hover{color:var(--text2,#445);}\
.tdc-tour-next{font-size:12.5px;font-weight:800;color:#141416;background:var(--accent,#E6D5A8);border:none;border-radius:20px;padding:8px 18px;cursor:pointer;}\
.tdc-tour-dots{display:flex;gap:5px;flex:1;min-width:0;justify-content:center;}\
.tdc-tour-bar{display:block;width:100%;max-width:140px;height:4px;border-radius:2px;background:var(--border2,#ccd);overflow:hidden;}.tdc-tour-bar i{display:block;height:100%;background:var(--accent,#3b5bdb);}\
.tdc-tour-next{flex:none;}.tdc-tour-tip{box-sizing:border-box;}\
.tdc-tour-dot{width:6px;height:6px;border-radius:50%;background:var(--border2,#ccd);}\
.tdc-tour-dot.on{background:var(--accent,#3b5bdb);}\
.tdc-explain{position:fixed;left:16px;bottom:16px;z-index:2147483050;display:inline-flex;align-items:center;gap:7px;padding:8px 13px 8px 10px;border-radius:22px;\
  background:var(--bg2,#fff);color:var(--text,#111);border:1px solid var(--border2,#ccd);box-shadow:0 8px 24px -8px rgba(0,0,0,.45);font:700 12px/1 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;letter-spacing:.02em;cursor:pointer;transition:transform .15s,box-shadow .15s;}\
.tdc-explain:hover{transform:translateY(-1px);box-shadow:0 12px 28px -8px rgba(0,0,0,.5);}\
.tdc-explain i{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--accent,#3b5bdb);color:#141416;font-style:normal;font-size:11px;font-weight:900;}\
@media(max-width:760px){.tdc-explain{left:10px;bottom:10px;padding:6px 8px;opacity:.55;transform:scale(.85);transform-origin:left bottom;}.tdc-explain:active,.tdc-explain:hover{opacity:1;}.tdc-explain span{display:none;}}\
@media print{.tdc-explain,#tdcTourWrap{display:none !important;}}';

  // ── walkthroughs, by page ──────────────────────────────────────────────────
  // Written for someone who knows nothing about college basketball analytics or this site:
  // every step says what the thing IS, what the numbers MEAN, and how to READ it.
  // (`html` = rich copy with bullet definitions; `tab`/`before` open the right view first.)
  var G = {   // shared plain-English definitions
    power:  '<b>Power Rating</b> — how many points better (or worse) than an average Division-I team this team is, on a neutral court, adjusted for who they played. +18 means they would beat an average team by about 18. The gap between two teams\' Power Ratings is the projected point spread between them.',
    ovr:    '<b>OVR / Overall</b> — a 0-99 grade. For a player it is his projected value for the coming season, built from his own statistics (how much he helps his team win per minute, adjusted for the league he played in) plus how players of his class typically develop. 90+ is an All-American, 80s a high-major starter, 70s a rotation player, 60s the end of the bench.',
    wa:     '<b>Wins Added</b> — how many wins a player is worth over a season compared with a replacement-level player (the kind of freely available player any program can find). +5 means his team wins about five more games because he is on the floor instead of that replacement.',
    ortg:   '<b>ORtg / DRtg</b> — points scored / allowed per 100 possessions. Per-possession numbers strip out how fast a team plays, so a slow team and a fast team can be compared fairly. Higher offense is better; lower defense is better. Net = the difference.',
    tempo:  '<b>Tempo</b> — possessions per 40 minutes: how fast the team plays. 60 is a grind, 75 is a sprint.',
    ff:     '<b>Four Factors</b> — the four things that decide basketball games: shooting (effective FG%, which counts a three as 1.5 makes), turnovers (% of possessions given away), offensive rebounding (% of your own misses you get back) and free throws (how often you get to the line). A team wins by winning most of these.',
    usg:    '<b>Usage %</b> — the share of his team\'s possessions a player finishes (with a shot, free throws or a turnover) while he is on the floor. 20% is average; 30%+ is a star who the offense runs through.',
    ts:     '<b>TS% / eFG%</b> — shooting efficiency. True Shooting counts everything (twos, threes and free throws) as points per shooting attempt; effective FG% credits a three as 1.5 makes. Both fix the flaw in plain FG%, which treats a corner three like a lay-up.',
    pct:    '<b>Percentile</b> — where a number sits against everyone else. 90th percentile = better than 90% of Division-I players (or teams). 50th is exactly average.',
    proj:   '<b>Projected vs Actual</b> — "actual" is what really happened last season; "projected" is the model\'s estimate for the coming season, built from every returning player\'s real production, the transfers\' production at their old level, freshman evaluations and the coach\'s history.',
    spread: '<b>Spread / total / win probability</b> — the spread is the projected margin (Duke −7 means Duke by seven); the total is the projected combined score; win probability turns the spread into a percentage chance.'
  };
  function bl(){ return '<ul style="margin:8px 0 0;padding-left:16px;">' + Array.prototype.slice.call(arguments).map(function (x) { return '<li style="margin:4px 0;">' + x + '</li>'; }).join('') + '</ul>'; }

  var TOURS = {
    'index.html': [
      { sel:'#whStrip', t:'Welcome — start here', html:'The Depth Chart grades every Division-I player and team from real statistics, then projects the coming season. These four cards are the fastest ways in:' + bl('<b>Explore</b> — a map of every tool on the site.', '<b>Program HQ</b> — pick your team and get a front door built around it.', '<b>Compare</b> — any two players or programs side by side.', '<b>Scout</b> — a full report on an opponent.') },
      { sel:'#searchInput', t:'Find a team', d:'Type any school and press enter to open its HQ page. The pills underneath filter the rankings by conference (ACC, SEC, Big Ten…) so you can see just one league.' },
      { sel:'.ix-sheet', t:'The rankings table', html:'Every Division-I team, ordered by <b>Power Rating</b>. The columns, left to right:' + bl(G.power, '<b>W-L</b> — projected wins and losses.', G.ortg, '<b>Win%</b> — projected share of games won.', '<b>PPG / REB / APG …</b> — projected per-game points, rebounds, assists, shooting.') + 'Each stat is shaded against the rest of Division I: green near the top, red near the bottom. Click a column header to sort by it, and click a team to open its page.' },
      { sel:'.tdn-wrap', t:'The menus', html:bl('<b>Teams</b> — rankings, conferences, team stats, compare.', '<b>Players</b> — the player database, awards, the draft board, newcomers.', '<b>Analytics</b> — leaderboards, the stat explorer, shot charts, Moneyball.', '<b>Postseason</b> — brackets, tournaments, March insights.', '<b>More</b> — Explore (every tool), Coach\'s Tier, Betting Lab, your account.') },
      { sel:'.tdc-explain', t:'This button', d:'Every major page has one. Press it any time for a walkthrough of exactly what is on that page and what each number means. It never opens on its own.' }
    ],

    // Nov 18 2026 walkthrough, owner: "shows you steps and different things … simpler than a lot of text together".
    // One small thing per step (a number, a column, a button), one or two sentences, an optional "Try:" line.
    'team.html': (function(){
      var op=function(id){ return function(){ try{ var b=document.querySelector('.hero-tabs [onclick*="(\''+id+'\'"]'); (b&&/_tgPick/.test(b.getAttribute('onclick')||'')&&g._tgPick?g._tgPick:g.switchTab)(id,b); }catch(e){} }; };
      // the n-th match of a selector has no stable id of its own: tag it so the step can point at it
      var nth=function(id,sel,n,tab){ return function(){ if(tab) op(tab)(); setTimeout(function(){ var e=document.querySelectorAll(sel)[n]; if(e) e.id=id; },tab?1800:0); }; };
      var T=function(x){ return '<div style="margin-top:8px;font-size:12.5px;"><b>Try:</b> '+x+'</div>'; };
      return [
      { sel:'#__intro', t:'Welcome to the team page', html:'Everything about one team: how good they are, who plays and every game. This walk-through points at one thing at a time.' },
      { sel:'.hero-tabrow .hero-tabs', alt:'.mt-strip', t:'The tabs', html:'Each tab is a different view of the team. On a phone they live in the bar at the bottom: swipe it for more.'+T('a tab with ▾ opens a menu of more views. 🔒 means subscribers only.') },
      { sel:'.hero-id', t:'The team', html:'Team name, conference, head coach and our national rank.'+T('tap the coach\'s name to see his coaching record.') },
      { sel:'#heroRibbon .hrb:nth-child(1)', t:'Power Rating', html:'How many points better than an average D-I team, on a neutral court. +25 means they would beat an average team by about 25.' },
      { sel:'#heroRibbon .hrb:nth-child(2)', t:'Record', html:'The real record so far. Underneath: the record we project by the end of the season.' },
      { sel:'#heroRibbon .hrb:nth-child(3)', t:'Projected seed', html:'Their NCAA Tournament seed if the season played out as we project, and their chance to make the field.' },
      { sel:'#heroRibbon .hrb:nth-child(4)', t:'National rank', html:'Where they rank among all 365 D-I teams by Power Rating.' },
      { sel:'#heroRibbon .hrb:nth-child(5)', t:'Conference', html:'Their league and where we project them to finish in it.'+T('tap it to open the conference page.') },
      { sel:'#heroRibbon .hrb:nth-child(6)', t:'Continuity', html:'The share of last season\'s minutes that came back. Low means a mostly new roster.' },
      { sel:'#teamSeasonSelect', t:'Season', html:'Switch the whole page to any season back to 2006-07.'+T('pick last season, then come back to Current.') },
      { sel:'#followTeamBtn', t:'Follow', html:'Follow the team and their games and news show up first on your home page.' },

      { sel:'#hxGame table.hq-next', t:'Results', html:'Every game played. Green is a win, red a loss.'+T('tap <b>Box score →</b> to open the game.'), before:op('overview') },
      { sel:'#tourNext', alt:'#hxGame', t:'Still to play', html:'Every game left, with our <b>win chance</b>, our <b>line</b> (−7 = favoured by 7) and the projected score.', before:nth('tourNext','#hxGame table',1) },
      { sel:'#rotSheet tr.sec', t:'Rotation', html:'Who actually plays. Starters are the five used most so far; then the bench.' },
      { sel:'#rotSheet td.dc-ovr', t:'OVR', html:'Each player\'s grade from 0 to 99, from his own stats. The ring runs red (low) to green (high).' },
      { sel:'#rotSheet td.nm', t:'The players', html:'Class, height and where he came from sit next to his name. Then his games, starts, minutes, points, rebounds and assists.'+T('tap a name to open his player page.') },
      { sel:'#hxAnalytics', t:'Team grades', html:'Overall, Power, Offense and Defense, each with a national rank and percentile (99 = better than 99% of teams).' },
      { sel:'#hxStandings', t:'Standings', html:'The conference table: real games so far plus our projection for the rest.' },
      { sel:'#hxMediaCard', t:'News', html:'The latest headlines about the roster.' },
      { sel:'#hqLaunch', alt:'#hxCmdLbl', t:'More tools', html:'Every other tool on the site, already set to this team.' },

      { sel:'#depthContent', t:'Depth Chart', html:'The rotation by position, PG to C, then the bench. MIN is projected minutes per game.', before:op('depth') },
      { sel:'#depthContent .dc-oop', alt:'#depthContent td.dc-ovr', t:'Out of position', html:'A small amber <b>−N</b> on a ring means he is playing out of position, and his grade drops by N there.' },
      { sel:'#shotDistCard', t:'Shot share', html:'Who takes the team\'s shots, and how much of the load each player carries.' },

      { sel:'#tsCount', t:'Scouting Report', html:'The team\'s stat line.'+T('switch between <b>Per game</b> and <b>Totals</b>.'), before:op('scout') },
      { sel:'#tsSheet', t:'Strengths and weaknesses', html:'Every offense and defense stat. The small number is its D-I rank: near 1 is a strength, past 250 a weakness.' },

      { sel:'#schedBody .tsp-sum', t:'Schedule', html:'Our projected record, from simulating the season thousands of times.', before:op('schedule') },
      { sel:'#schedBody .tsp-wrap', t:'Every game', html:'Each game with our line and win chance. Tournament games list the possible opponents until the bracket decides.' },

      { sel:'#lineupHistHost .lu-yrs', t:'Lineups', html:'Who really started, from box scores.'+T('pick <b>Last 5</b> to see the newest rotation.'), before:op('lineups') },
      { sel:'#luUsageHost .lud-g', t:'Depth by position', html:'Each position\'s share of minutes, player by player.' },
      { sel:'#luUsageHost .luu-wide', alt:'#luUsageHost .luu-narrow', t:'Most-used fives', html:'The five-man groups that have played most together, and their +/−.' },
      { sel:'#luHistHost .lu-two', t:'Best and worst starts', html:'Average margin with each starting five.' },

      { sel:'#onoffSheetHost .to-bar', t:'On/Off', html:'The team with each player on the floor vs on the bench.'+T('pick a season, or switch the view to Shooting or Defense.'), before:op('onoff') },
      { sel:'#onoffSheetHost .to-wrap', t:'Read the table', html:'<b>Net</b> is the team\'s margin per 100 possessions. <b>RAPM</b> is the fairest single number: it adjusts for teammates and opponents.' },
      { sel:'#onoffLab', t:'Ask your own question', html:'Pick players to see the team with them together, apart, or one without the other.' },

      { sel:'#teamStatShiftHost .ssx-mates', t:'Stat Line Shift', html:'Pick a teammate: see how every other player\'s stats change when he is on the floor.', before:op('statshift') },
      { sel:'#teamStatShiftHost .ssx-bar', t:'Views', html:'Shift, With and Without, plus Shooting, Playmaking and Team views.' },

      { sel:'#teamStatsHost .sheet-wrap', t:'Team Stats', html:'Every player\'s numbers.'+T('tap a player for his card; switch to <b>Per 40</b> to compare starters and bench fairly.'), before:op('teamstats') },
      { sel:'#tourLog', alt:'#teamStatsHost', t:'Game log', html:'The team\'s line in every game.'+T('tap a row for the box score.'), before:nth('tourLog','#teamStatsHost .sheet-wrap',1) },

      { sel:'#teamDnaHost .ds-chips', t:'Team DNA', html:'The team\'s identity in numbers. Ratings here are adjusted for schedule.', before:op('dna') },
      { sel:'#teamDnaHost .ds-ctl', t:'Season and matchup', html:'Pick a season, or pick an opponent to set the two teams side by side.' },
      { sel:'#dnaSheetHost', t:'Offense and defense', html:'Every stat with its D-I rank. Green = good for this team.' },
      { sel:'#teamDnaHost .ds-more', t:'Where the margin comes from', html:'How much each of the four factors (shooting, turnovers, rebounds, free throws) adds to the margin.' },

      { sel:'#teamTrendsHost .trt-kpis', t:'Trends', html:'How the season is moving: the rating trend and results against our line.', before:op('trends') },
      { sel:'#teamTrendLine', t:'The chart', html:'The rating after every game.'+T('switch the stat at the top.') },
      { sel:'#teamTrendsHost table.trl', t:'Game by game', html:'Our line, the real result and the difference for each game.' },
      { sel:'#teamTrendsHost table.trt-pl', t:'Players', html:'Each player\'s real numbers next to his projection.' },

      { sel:'#projModeBar', t:'Projections', html:'<b>Real</b> = games played. <b>Projected</b> = our full-season estimate.', before:op('projections') },
      { sel:'#realTeamWrap', t:'Every player\'s line', html:'Games, minutes, points, rebounds, assists and shooting.' },

      { sel:'#teamShotSeason', t:'Shot chart', html:'Every located shot.'+T('pick a season (located shots start in 2019-20).'), before:op('shots') },
      { sel:'#teamAssistWebHost', t:'Assist web', html:'Who passes to whom for made baskets.'+T('switch between <b>Web</b>, <b>Sheet</b> and <b>Flow</b>.') },
      { sel:'#teamShotProfHost .tsp-ctl', t:'Shot profile', html:'Every shooting number per 100 possessions.'+T('flip between <b>vs average opponent</b> and <b>Raw</b>.'), before:op('shotprof') },
      { sel:'#teamShotQHost .sq-tiles', t:'Shot quality', html:'<b>Quality</b> = how good the shots are. <b>Shot-making</b> = points added by making them.', before:op('shotq') },
      { sel:'#teamTwinHost', t:'Shot twin', html:'Past team seasons whose shot profile is closest to this one.', before:op('twin') },
      { sel:'#teamAfterHost', t:'Possessions', html:'How possessions start and end, and what each kind is worth.', before:op('poss') },
      { sel:'#teamHuntHost', t:'Hunt Great', html:'Every shot graded great, average or bad, for the team and each player.', before:op('hunt') },

      { sel:'#gpMatch', alt:'#pvHost', t:'Game Preview', html:'The next game: our line, total and win chance.', before:op('preview') },
      { sel:'#gpPlayers', alt:'#pvHost', t:'Player lines', html:'Each player\'s projected line in this game, adjusted for the opponent.' },

      { sel:'#lbSheet', alt:'#customizeContent', t:'Lineup Lab', html:'Build your own rotation.'+T('drag a player onto another to swap them, or change minutes with − / +.'), before:op('customize') },
      { sel:'#czWin', alt:'#customizeContent', t:'How it wins', html:'What your lineup does best, and its D-I rank. It updates as you change things.' },

      { sel:'#panel-report', t:'Roster Report', html:'A written scouting report on the roster: strengths, flaws, bench and coach fit.', before:op('report') },
      { sel:'#nilSheet', alt:'#nilContent', t:'NIL Value', html:'What each player\'s production is worth on the open market. An estimate, not what anyone is paid.', before:op('nil') },
      { sel:'#teamBettingContent .sheet-wrap', alt:'#teamBettingContent', t:'Betting', html:'The team against the spread and the total, season by season, then every player\'s props.', before:op('betting') },
      { sel:'#teamFeedHost', t:'Feed', html:'Articles, posts and forum threads about the team.', before:op('feed') },
      { sel:'#__end', t:'That\'s it', html:'Tap <b>?</b> at the bottom-left any time to run this again.', before:op('overview') }
      ];
    })(),

    // Nov 18 2026 (owner: "deep walkthroughs on every page that explain deeply what the page is and how to use it"):
    // what the page is → how to get around → each header piece → each Overview box → every tab and sub-tab.
    // Each step: what it is, how to read it, and a "How to use" line.
    'player.html': (function(){
      var GRP=['shotcharts','shotgenome','shotflow','twin','aftermath','mastery','percentiles','scout','dossier','role','devpath','scheme','portalfit','statshift'];
      var op=function(id){ return function(){ try{ (GRP.indexOf(id)>=0&&g._grpPick?g._grpPick:g.switchTab)(id); }catch(e){} }; };
      var use=function(x){ return '<div style="margin-top:9px;padding-top:8px;border-top:1px solid var(--border,#e3e3e3);"><b>How to use it:</b> '+x+'</div>'; };
      return [
      { sel:'#__intro', t:'What this page is', html:'Everything we know about one player, on one page: who he is, how good he is (the <b>OVR</b> grade), what he is doing this season, how he compares with every player in Division I, and how his team plays with him and without him.'+bl('Numbers come from real box scores and play-by-play, not opinions.', 'Every grade and percentile is on one national scale, so an 85 means the same thing on every page and in every season.', '"Projected" always means our model\'s estimate for 2026-27; "so far" / "Real" means games he has actually played this season.')+use('start with the header and Overview for the big picture, then open the tab for the question you have: how he scores (Shots), how he fits (Scouting), what the team does with him (On/Off).') },
      { sel:'.tab-row-wrap', alt:'.mp-strip', t:'Getting around', html:'The page is split into tabs. On a computer they run across the top; on a phone they sit in the bar at the bottom of the screen (swipe it sideways for more).'+bl('<b>Overview</b> — the one-screen summary.', '<b>Stats</b> and <b>Trends</b> — the numbers, and how they are moving.', '<b>Comps</b> — the players he most resembles.', '<b>DNA</b> — the analyst view.', '<b>On/Off</b> and <b>Line shift</b> — his team with him vs without him.', '<b>Shots</b> — seven shot views (a row of buttons appears under the header).', '<b>Scouting</b> — reports, role, development, scheme and portal fit.', '<b>NIL</b>, <b>Betting</b>, <b>Buzz</b> — market value, props, news.')+use('on any tab except Overview the header shrinks to his name, Follow and the season picker, so the tab has the room.') },
      { sel:'.pa-hero .pc-id', t:'Who he is', html:'His photo, school and conference, name, and the bio row: position, class, height and <b>Role</b> — the playing style our clustering gives him from how he actually plays (Shot Creator, Stretch Big, Point of Attack…), not his listed position.'+use('tap the school to open the team page; <b>☆ Follow</b> adds him to your followed players, so his games and news show up on your home feed.') },
      { sel:'#paProj', t:'The stat line', html:'His per-game numbers for the season picked in the header — points, rebounds, assists, minutes on top; shooting (FG%, 3P%, FT%) and usage underneath.'+bl('The small coloured number under each stat is the <b>change</b> vs his previous season: green up, red down.', G.usg, 'Early in a season the "so far" line moves a lot from game to game; it settles after about 10 games.')+use('flip the season picker to see any past season, or 2026-27 projected, in the same layout.') },
      { sel:'#paOvr', alt:'.pc-seal', t:'The overall (OVR) and ranks', html:G.ovr+bl('<b>The ring</b> — the grade; its colour runs red (low) to green (high).', '<b>▲/▼ since preseason</b> — how much his real games have moved the grade from where it started the season.', '<b>#… in D-I</b> — his national rank among every player, and the percentile.', '<b>Team rank</b> — where he sits on his own roster.')+use('the grade is built from statistics only — no reputation or recruiting hype once he has college games. Compare two players on Compare Players for a head-to-head.') },
      { sel:'#tdcSeasonSlot', t:'Season picker', html:'Changes the season for the whole page: the stat line, Overview boxes and most tabs follow it.'+bl('<b>2026-27 so far</b> — the games he has played this season.', '<b>2026-27 projected</b> — our model\'s estimate for the full season.', 'Any older season — what he really did that year, graded on the same scale.')+use('pick last season to see where he was coming from, then come back to "so far" to see what has changed.') },
      { sel:'.pa-hero .tdc-mode', alt:'#statModeSlot', t:'Real / Projected', html:'A second switch for this season only: <b>Real</b> shows the numbers from games he has played; <b>Projected</b> shows our full-season estimate.'+use('early in the season use Projected for a steadier picture; once he has 10+ games, Real is the better guide.') },
      { sel:'#ovrCards', t:'Overview · Stats', html:'His season-by-season stat table: this season, the projection, last season and the difference.'+bl('Cells are shaded red to green against every D-I player — green is better than most.', 'The "vs" row shows the change from last season, stat by stat.')+use('scan the shading first: a column of green is a strength, a column of red is a gap.') , before:op('overview') },
      { sel:'#ovcForm', t:'Recent form', html:'His last five games, newest first: minutes, points, rebounds, assists and shooting, each against his own season average.'+use('a hot or cold streak shows up here before it moves his season numbers.') },
      { sel:'#ovcTrend', t:'Grade by season', html:'His overall (OVR) for every college season, so you can see the arc of his career — the "+6 over 4 seasons" note is the total change.'+use('a steady climb usually means a player still developing; a drop often lines up with a transfer or a role change.') },
      { sel:'#ovcRead', t:'The read', html:'Three one-line verdicts — what he does better than most players (green) and where he falls short (red) — measured against everyone in D-I.'+use('the fastest way to describe him to someone in one sentence.') },
      { sel:'#ovcComps', t:'Plays like', html:'The players whose statistical profile is closest to his — same shot mix, rates and role — with how similar they are.'+use('tap a name to open that player; comps are a quick way to picture a player you have never watched.') },
      { sel:'#ovcBottom', t:'Bottom line', html:'A short written summary that pulls the numbers together: role, strengths, weaknesses, what to expect.' },
      { sel:'#skillSheet', t:'Skill profile', html:'Each skill — scoring, shooting, playmaking, rebounding, defense, ball security — as a <b>percentile</b> vs every D-I player.'+bl(G.pct)+use('look for the two or three skills above the 80th percentile: that is his identity.') },
      { sel:'#ovcShot', t:'Shot profile', html:'Where his shots come from (rim, paint, mid-range, three) and how often each goes in, against the national average.'+use('the Shots tab has the full chart and seven deeper views.') },
      { sel:'#impactSection', t:'Wins added', html:G.wa+bl('Split into offense and defense, so you can see where his value comes from.')+use('the best single number for "how much does he matter to winning".') },
      { sel:'#ovcFit', t:'Team fit', html:'How his game lines up with the rest of his roster: what he adds that the team is short of, and where he overlaps with teammates.' },
      { sel:'#ovcAmplifier', t:'Lineup Amplifier', html:'Which teammates make him better and which make him worse, from the lineups they have shared. Part of Coach\'s Tier.' },
      { sel:'#panel-stats', t:'Stats tab', html:'The full numbers.'+bl('<b>Per Game / Per 40 Min / Advanced</b> — three views of every season. Per 40 stretches each line to 40 minutes, so a bench player and a starter compare fairly; Advanced adds usage, TS%, rates and Wins Added.', '<b>Tournament splits</b> — March vs the regular season.', '<b>Game Log</b> — every game; pick the season with the year buttons.', '<b>Peak metrics</b> — his best single-season marks.')+use('switch to Per 40 before comparing two players with very different minutes.'), before:op('stats') },
      { sel:'#panel-trends', t:'Trends tab', html:'How his season is moving.'+bl('<b>The chart</b> — his season average after each game (the line) and each single game (grey dots), against his projection (the dashed line). Switch the stat with Overall / PTS / REB / AST / MIN / FG% / 3P%.', '<b>Preseason scrimmages</b> — what he did in the exhibitions and how they moved his projection.', '<b>Game log</b> — every game with the projection for that night next to it.')+use('a line that stays above the dashed projection means he is outplaying expectations.'), before:op('trends') },
      { sel:'#panel-comps', t:'Comps tab', html:'The full comparison behind "Plays like": every player whose statistical profile is closest to his, with headshots, how similar each one is and the numbers that make them alike.'+use('tap any comp to open his page; comps from past seasons show how players like him turned out.'), before:op('comps') },
      { sel:'#panel-playerdna', t:'DNA tab', html:'The analyst view, seven sub-tabs:'+bl('<b>Dashboard</b> — Wins Added (total, offense, defense) and Team Impact, each with a national percentile.', '<b>Fingerprint</b> — his skill points per 100 possessions from play-by-play.', '<b>Splits</b> — home/away, wins/losses, by opponent quality.', '<b>Skill comps</b> — players with the closest skill fingerprint.', '<b>Offense / Defense</b> — how he scores and what the team allows with him on.', '<b>6-Factor</b> — the four factors plus rim protection and creation as one fingerprint.')+'<b>vs All D1 / vs Guards</b> switches the comparison group.'+use('Dashboard first for the verdict, then Offense or Defense for the why.'), before:op('playerdna') },
      { sel:'#panel-onoff', t:'On/Off tab', html:'His team with him on the floor vs with him on the bench, from play-by-play.'+bl('<b>With him / Without / Swing</b> — the team\'s numbers in each state and the difference. Green swing = the team is better with him.', G.ortg, '<b>RAPM</b> — his on/off impact adjusted for who he played with and against: the fairest single on/off number.', '<b>Two-man units</b> — how he does alongside each teammate.', '<b>Team On/Off</b> — every teammate\'s on/off, ranked vs D-I.')+'Pick the season with the year buttons; <b>Luck-adjusted</b> evens out free-throw and opponent three-point luck.'+use('small samples (under ~200 minutes) swing a lot — the page flags them.'), before:op('onoff') },
      { sel:'#panel-statshift', t:'Line shift tab', html:'His own stat line with and without each teammate on the floor — does he score more, shoot better or pass more next to a particular player?'+bl('<b>With / Without / Shift</b> for every teammate.', 'Views: Overview, Shooting, Playmaking & D, Team on floor.')+use('find the teammate whose minutes make his numbers jump — that is a pairing worth keeping together.'), before:op('statshift') },
      { sel:'#panel-shotcharts', t:'Shots · Charts', html:'Where he shoots from and how well.'+bl('<b>Shot Genome card</b> — Look Quality (how good his shots are before release), Shot-Making (points he adds on top), Creation and Self-creation, each with a percentile.', '<b>Shot chart</b> — every located shot, by season.', '<b>Shot profile by season</b> — share of shots at the rim, in the paint, mid-range and from three, against the D-I figure.')+'The row of buttons under the header switches between the seven shot views.'+use('a high Look Quality with low Shot-Making = good shots that aren\'t falling; the reverse = a tough shot-maker.'), before:op('shotcharts') },
      { sel:'#panel-shotgenome', t:'Shots · Genome', html:'The full Shot Genome for any season, plus his <b>career genome</b>: how his shot quality and shot-making have changed year to year.', before:op('shotgenome') },
      { sel:'#panel-shotflow', t:'Shots · Flow', html:'How his shots are created and finished: where they come from (catch-and-shoot, off the dribble, at the rim), whether they went in, and which teammate set them up.', before:op('shotflow') },
      { sel:'#panel-twin', t:'Shots · Twin', html:'The players whose shot profile — where they shoot from and how often — is closest to his.', before:op('twin') },
      { sel:'#panel-aftermath', t:'Shots · After', html:'Every first-chance shot and what happened next: points per attempt, and after his misses how often his team got the offensive rebound or the other team scored.', before:op('aftermath') },
      { sel:'#panel-mastery', t:'Shots · Mastery', html:'Points per shot for each shot type against a 1.1 bar (roughly what a good offense scores per shot). Above the bar = a shot he should keep taking; below = one to cut.', before:op('mastery') },
      { sel:'#panel-percentiles', t:'Shots · Percentiles', html:'Every stat as a percentile bar against all of D-I (or his position with the toggle). The tick is the median player; the number is his percentile.', before:op('percentiles') },
      { sel:'#panel-scout', t:'Scouting report', html:'A full report in one place: measurements, projected statistics, a written summary and playing style, durability, efficiency, his best games, archetype fit and the most similar players.'+use('the page to send someone who wants the whole picture of one player.'), before:op('scout') },
      { sel:'#panel-dossier', t:'Player dossier', html:'His situational splits from last season — against good and bad opponents, home and away, in close games, in conference play — plus availability (foul risk, rotation volatility) and which opponent styles he scores best against.', before:op('dossier') },
      { sel:'#panel-role', t:'Role & fit', html:'His archetype and traits, the style signals behind it, how he fits his current roster, his on/off impact, the five-man groups he plays best in, his development stage and how his scoring is spread across games.', before:op('role') },
      { sel:'#panel-devpath', t:'Development', html:'His grade path by year next to players who started at the same level, so you can see whether he is ahead of or behind the usual curve.', before:op('devpath') },
      { sel:'#panel-scheme', t:'Scheme Lab', html:'The same player dropped into different systems — fast vs slow, five-out vs post-heavy — and how his projected line changes in each.', before:op('scheme') },
      { sel:'#panel-portalfit', t:'Portal fit', html:'Every program ranked by how well he would fit there: team success, his projected production, coach fit and roster need.'+use('switch the column buttons to rank by the factor you care about most.'), before:op('portalfit') },
      { sel:'#panel-nil', t:'NIL value', html:'An open-market estimate of what his production is worth in name-image-likeness money: where he sits among players at his position, what the price is built on, comparable players and his team\'s top earners. An estimate of value, not a report of what he is paid.', before:op('nil') },
      { sel:'#panel-betting', t:'Betting', html:'His props against the line.'+bl('Pick the market — Points, Rebounds, Assists, 3-Pointers, PRA, Stl+Blk — and the line with − / +.', '<b>Stats vs the line</b> — how often he has gone over, by season.', '<b>Game distribution</b> and <b>game log</b> — every game against that line.')+use('look for a line his recent games clear far more (or less) often than half the time.'), before:op('betting') },
      { sel:'#panel-buzz', t:'Buzz', html:'Headlines and fan posts about him, newest first — the human context behind the numbers.', before:op('buzz') },
      { sel:'#__end', t:'That\'s the page', html:'Tap <b>? Explain this page</b> at the bottom-left any time to run this again. Every page on the site has its own walkthrough.', before:op('overview') }
      ];
    })(),

    'compare-players.html': [
      { sel:'#modePlayers', t:'Players or teams', d:'Two players or two programs side by side. Either can be a current roster or any real season back to 2006-07 — a 2016 Jalen Brunson against a 2026 point guard is a fair comparison because every grade is on one scale.' },
      { sel:'#si1', t:'Pick your two', d:'Start typing a name. Current players list first; past seasons list below them with the year. Swap flips the sides; Clear starts over.' },
      { sel:'.cmp-heads', t:'The head-to-head cards', html:bl(G.ovr, 'The archetype tag is his play style (Scoring Guard, Stretch Big, Connector Wing…), found by clustering thousands of player-seasons by how they play.') },
      { sel:'.compare-section', t:'Reading the sheets', html:'Every section is a row-by-row comparison with the better side highlighted:' + bl('<b>Season stats</b> — the box score, with the D-I average underneath.', '<b>Skill profile</b> — each player\'s percentile wheel at his position.', '<b>Projection vs All-American ceiling</b> — how close his projected line is to a typical All-American at his position.', '<b>Advanced metrics</b> — ' + G.usg + ' ' + G.ts, '<b>Head-to-head matchup</b> — if they guarded each other, who wins, from their offensive and defensive profiles.', '<b>Fit together / chemistry</b> — whether they would work in the same lineup (spacing, overlapping roles).', '<b>Shot charts & shot flow</b> — where each one shoots from and how the shots are created.', '<b>Next-season projection</b> — the model\'s line for the coming year, with a note on how each one was built.', '<b>NIL value</b> and <b>most similar players</b> since 2006.') }
    ],

    'roster.html': [
      { sel:'#seasonFilter', t:'The Player Database', html:'Every player in Division I, for any season since 2011-12, with filters that stack:' + bl('<b>Season</b> — 2026-27 shows every player\'s <i>projected</i> line; past seasons show real stats.', '<b>Conference / Team / Position / Class / Height</b>.', '<b>Grade</b> — minimum OVR.', '<b>WA</b> — minimum Wins Added.', '⚙ <b>Query Builder</b> — stat thresholds like "3P% over 38 and at least 5 attempts".') },
      { sel:'#searchInput', t:'Search', d:'Any player, any season, by name.' },
      { sel:'#tableContainer', t:'The table', html:bl('<b>OVR</b> — ' + G.ovr, '<b>WA</b> — ' + G.wa, 'Then the box score: minutes, points, rebounds, assists, shooting, steals, blocks, turnovers.', '<b>TEND</b> columns — shot tendency: how ball-dominant he projects to be (100 = the #1 option), and the share of his shots that are threes, twos and free throws.') + 'Click any column header to sort. The colour toggle shades every cell by national percentile — deeper blue is better.' }
    ],

    'team-stats.html': [
      { sel:'#searchBox', t:'Projected team stats', d:'Every rostered program\'s projected per-game line for the coming season. Type a school to find it, or filter by conference. The pool selector changes who the percentile shading compares against.' },
      { sel:'#leadersEl', t:'Leaders', d:'Who projects to lead the country in each category — scoring, rebounding, assists, shooting.' },
      { sel:'#statsTable', t:'The table', html:'One row per team. The projected line is built by adding up every player\'s projected line, fitted so the team scores what its projected offense and pace imply.' + bl('<b>PPG / RPG / APG</b> — points, rebounds, assists per game.', '<b>FG% / 3P% / FT%</b> — shooting.', '<b>FGA / 3PA</b> — attempts: how much they shoot and how much of it is threes.', '<b>TOV / STL / BLK / OREB / DREB</b> — turnovers, steals, blocks, offensive and defensive rebounds.') + 'Click a header to sort; shading is the national percentile against last season\'s real teams.' }
    ],

    'analytics.html': [
      { sel:'#leadersView', t:'Leaders', html:'National leaderboards on the site\'s own metrics for any season:' + bl(G.wa, '<b>TI (Total Impact)</b> — a player\'s per-40-minute value on both ends, from his box-score rates, adjusted for the strength of the league.', G.usg, 'Plus the standard scoring, rebounding and shooting boards.'), before:function(){ try{ setView('leaders'); }catch(e){} } },
      { sel:'#explorerView', t:'Stat Explorer', d:'Pick any stat for the X axis and any other for the Y axis and every player becomes a dot. Use it to find the outliers — the high-usage, high-efficiency players in the top right, or the volume shooters who don\'t make them.', before:function(){ try{ setView('explorer'); }catch(e){} } },
      { sel:'#landscapeView', t:'League Landscape', html:bl('<b>Contender quadrant</b> — offense against defense; the top right is where champions live.', '<b>Scoring bubbles</b> — who scores and how efficiently.', '<b>March drop-offs</b> — which profiles tend to fall early in the tournament.'), before:function(){ try{ setView('landscape'); }catch(e){} } }
    ],

    'betting.html': [
      { sel:'#blTabs', t:'Betting Lab', html:'Everything you can bet on, priced by our model. One tab per market:' + bl('<b>Games</b> and <b>Props</b> — the slate and the prop board.', '<b>Futures</b>, <b>Conferences</b>, <b>Win totals</b>, <b>Awards</b> — our odds from 2,000 simulated seasons.', '<b>Trends</b> and <b>Tools</b> — real closing-line records, a matchup calculator and a prop explorer.') },
      { sel:'#csDates', t:'Pick a game day', d:'The Games tab re-runs for the slate you pick: tonight\'s plays, the fades, then every game.', before:function(){ try{ TDC_BL.show('games'); }catch(e){} } },
      { sel:'#csBest', t:'Best bets', html:'One slip per play, ranked by confidence (the dots).' + bl('<b>Props</b> — a backtested pattern (bounce-back or regression) that our projection agrees with.', '<b>Spreads and totals</b> — once books post, games where our line is 3+ points (totals 4+) off the market.', '<b>Fades</b> (red) — the bets the public likes that have lost: overs after career years, teams that keep failing to cover.') },
      { sel:'#slRows', t:'Every game', html:'Each game is a ticket like a sportsbook: away team over home team, with spread, total and moneyline boxes.' + bl(G.spread, 'Until books post, the boxes hold our numbers; our favorite\'s boxes are tinted.', 'Once books post, the big number is the book\'s and ours sits under it. A <b>green box</b> is a side our model likes.') },
      { sel:'#boardPills', t:'Prop board', html:bl('<b>Bounce-back Overs</b> — last season ran well below his career pace per minute; players drift back toward their norm.', '<b>Regression Unders</b> — last season ran well above it.', '<b>Value Movers</b> — the biggest gaps between our projection and his career norm.'), before:function(){ try{ TDC_BL.show('props'); }catch(e){} } },
      { sel:'#futPills', t:'Futures', html:'Title, Final Four, make the field, No. 1 seed and the NIT.' + bl('<b>Our %</b> — share of 2,000 simulated seasons (regular season, conference tournaments, the committee, March).', '<b>Fair odds</b> — that chance as a price, no vig.', '<b>Edge</b> — our % minus the book’s, once the feed has book futures.'), before:function(){ try{ TDC_BL.show('futures'); }catch(e){} } },
      { sel:'#wtTbl', t:'Win totals', d:'Every team’s regular-season win line with the over and under chance and a fair price for each side.', before:function(){ try{ TDC_BL.show('wins'); }catch(e){} } },
      { sel:'#teamTbl', t:'Trends', html:bl('<b>ATS</b> — against the spread: did the team beat the closing number, not just win.', '<b>Over%</b> — how often its games went over the closing total.'), before:function(){ try{ TDC_BL.show('trends'); }catch(e){} } }
    ],

    'moneyball.html': [
      { sel:'#mbTabs', t:'Moneyball', html:'One idea: find what the market misprices. ' + bl('<b>What the market pays for</b> — every D-I transfer since 2013: how strong a program each trait earned him, against his impact after the move.', '<b>2026-27 transfers</b> — this year\'s class scored the same way.', '<b>GM Mode</b> — build a roster rated by the rankings engine.') },
      { sel:'#marketBody', t:'Market vs result', d:'Blue is the market\'s weight on a trait, gold is how much it shows up in the result. A verdict appears only when the gap holds in both eras and its 95% range clears zero.' },
      { sel:'#classBody', t:'The transfer class', d:'Expected impact at the new school against a typical transfer to a program that strong. Positive is a pickup that profiles above its level.', before:function(){ try{ showTab('class'); }catch(e){} } },
      { sel:'#gmBody', t:'GM Mode', html:bl('<b>Roster value</b> — each player\'s worth in rating points over a replacement-level player, his cost per point and his surplus at the league price of a point.', '<b>Path to the goal</b> — dead-money cuts, then the signings that buy the most rating per dollar.', '<b>The frontier</b> — every target\'s cost against the rating he adds; the gold line is the best you can do at each price.'), before:function(){ try{ showTab('gm'); }catch(e){} } },
    ],

    'portal.html': [
      { sel:'#pickPlayer', t:'Portal Fit', d:'Pick a player in the transfer portal and every program is ranked by how well he would fit there.' },
      { sel:'#wgrid', t:'What "fit" means', html:'Four ingredients, weighted the way you want:' + bl('<b>Need</b> — does the team have a hole at his position and role?', '<b>Team success</b> — how good the destination is.', '<b>Production</b> — how much he would actually play and produce there, given the competition for minutes.', '<b>Coach fit</b> — does the coach\'s style (pace, shot diet, rotation) suit how he plays?') },
      { sel:'#results', t:'Best fits', d:'Programs ranked by fit score, each with the reasons: the positional need, the projected role and minutes, the coach match. Filter by conference or minimum rank.' }
    ],

    'transfer-fit.html': [
      { sel:'#picker', t:'Transfer Fit Report', d:'Pick any player and any destination school — even a move that hasn\'t happened — and the report models the fit as if he were on that roster.' },
      { sel:'#report', t:'The report', html:bl('<b>Role</b> — where he would slot into the depth chart and his projected minutes.', '<b>Projected line</b> — his stats on the new roster, with production discounted or lifted for the change in level of competition.', '<b>Rotation impact</b> — whose minutes he takes.', '<b>Team impact</b> — the change in the destination\'s projected rating and wins.', '<b>Style fit</b> — how his way of playing matches the coach\'s system.') }
    ],

    'coach.html': [
      { sel:'.chero', t:'The coach page', d:'Career record, the schools and years, the style archetype (Up-Tempo Shooters, Grind-It-Out Bigs…) and the TDC Coach Grade with its national rank among every active and former coach in the database.' },
      { sel:'.gparts', t:'The four parts of the grade', html:bl('<b>Winning & quality</b> — results, adjusted for the talent he had.', '<b>Tournament / peak</b> — how far his best teams went.', '<b>Player development</b> — how much his players improved compared with what the model expected of them.', '<b>Consistency</b> — how little his teams swing year to year.') + 'Each bar is measured against the median coach (the tick).' },
      { sel:'.cstrip', t:'Career numbers', d:'Record, seasons, average Power Rating with its career rank, national titles, Final Fours, NCAA appearances, players coached and the development number (+1.1 means his players beat expectation by about a grade point a year — 79th percentile).' },
      { sel:'#rundown', t:'Rundown', d:'How his teams play, from their real box scores: pace, three-point rate, free-throw rate, rotation size, bench minutes, how concentrated the scoring is on one star.' },
      { sel:'#rosterfit', t:'Roster fit', d:'How this year\'s roster suits the way he coaches — where the personnel matches his habits and where it doesn\'t.' }
    ],

    'conference.html': [
      { sel:'#tiles', t:'The league in numbers', d:'Composite record, the best team by Power Rating, the champion and the NCAA results for the season you picked. The season selector goes back to 2006-07.' },
      { sel:'#stand', t:'Standings', html:bl('<b>Conf / Overall</b> — league and full records.', G.power, '<b>Seed</b> — NCAA tournament seed, and how far they went.') + 'Click a team to open its HQ.' },
      { sel:'#awards', t:'Conference awards', d:'Player of the year, defensive player, rookie, sixth man and the all-conference teams — projected for the coming season from the players\' projected value, actual for past seasons.' },
      { sel:'#coaches', t:'Coaches', d:'Every head coach in the league with his grade and style.' }
    ],

    'awards.html': [
      { sel:'#seasonPills', t:'Season', d:'Projected awards for the coming season, or the real winners of any past season.' },
      { sel:'#content', t:'The ballot', html:'Chosen by projected impact, so it is consistent with every other page:' + bl(G.ovr, G.wa, '<b>All-America teams</b> — the five best players in the country, three teams deep.', '<b>Conference honours</b> — the same for each league.', '<b>All-Freshman</b> — the best first-year players.') }
    ],

    'tournaments.html': [
      { sel:'#catPills', t:'Tournaments', d:'The NCAA tournament, the NIT and every conference tournament, for any season.' },
      { sel:'#tlist', t:'The field', d:'Every team in the field with its seed, its result, and how the model rated it going in — so you can see which upsets the numbers saw coming. Click one for its bracket.' },
      { sel:'#marchInsights', t:'March insights', d:'What actually wins in March, from twenty years of results: which statistical profiles go deep and which fall early.' }
    ],

    'shot-genome.html': [
      { sel:'#mode', t:'Shot Genome', html:'Two original measures of shooting, built from where every shot was taken:' + bl('<b>Look Quality</b> — how good a player\'s shots are <i>before</i> he releases them: the eFG% an average shooter would post on that same shot diet. Open corner threes and lay-ups are high-quality looks; contested long twos are not.', '<b>Shot-Making (SM+)</b> — how many points per 100 shots he adds <i>on top</i> of what his looks are worth. Pure finishing skill.', '<b>Creation (CR)</b> — the expected points his passing generates for teammates.') },
      { sel:'#quad', t:'The quadrant', d:'Every player placed by the quality of his shots (across) and his shot-making (up). Top right: great looks and makes them — the elite. Top left: makes hard shots. Bottom right: gets good looks but misses them.' }
    ],

    'projections.html': [
      { sel:'.ph-hero',     t:'Projections',       d:'Every player\'s projected line for the coming season in one table, and a compare view for putting two next to each other.' },
      { sel:'.tdc-toolbar', t:'Filters',           d:'Search, conference, position and class. Click any column header to sort.' },
      { sel:'#tableWrap',   t:'The table',         html:bl(G.ovr, '<b>Projected line</b> — minutes, points, rebounds, assists, shooting for the coming season, built from his real production, his class\'s development curve and his role on the projected roster.', 'The same numbers his player page and his team\'s depth chart show.') }
    ],
    'draft.html': [
      { sel:'.page-h1',  t:'What this is',  d:'An NBA draft board, not a college one. Everyone here is ranked by how good an NBA PROSPECT he is — so a polished older scorer can sit below a younger player who has more room to grow.' },
      { sel:'#seasonSeg',t:'Which class',   d:'The 2027 board is this season\u2019s prospects. The 2028 board is a way-too-early look: the same players a year further on, with seniors dropped.' },
      { sel:'#bbSearch', t:'Filters',       d:'Search a name, or narrow by position and class.' },
      { sel:'#bbList',   t:'The Big Board', html:'Prospects ranked by projected NBA value:' + bl(G.ovr, G.wa, 'Age and class matter: a sophomore at 85 is a better bet than a senior at 85 because he has more development left \u2014 the board reflects that.') },
      { sel:'.method',   t:'How it is scored', d:'Open this for the full method: the four lenses, athletic tools read from the box score, age and runway, level of competition, and the empty-calories check that docks volume scoring the efficiency does not back up.' }
    ],
    'mock-draft.html': [
      { sel:'.page-h1',  t:'The Mock Draft', d:'A separate tool from the Big Board. It does not rank anyone \u2014 it takes the finished board and fills a pick-by-pick NBA draft order from it. It is being rebuilt; the Big Board itself is live.' }
    ],
    'newcomers.html': [
      { sel:'#teamSel', t:'Newcomer OVRs',  d:'Every incoming freshman and international/JUCO player who has no college statistics yet, by team.' },
      { sel:'#missTog', t:'Missing grades', d:'Filter to newcomers who don\'t have an evaluation yet.' },
      { sel:'.tablewrap', t:'The list',    html:bl('A newcomer\'s <b>OVR</b> is an evaluation, not a statistic — recruiting rank, profile and comparable players — until he plays college games.', 'His projected line is fitted to the minutes and points left on his team\'s roster after the returners.') }
    ],
    'gradelist.html': [
      { sel:'.controls', t:'Grade list',   d:'Every player\'s projected OVR in a plain list — filter by conference, team and position, and pick a format to copy.' },
      { sel:'.card',     t:'The list',     html:bl(G.ovr, 'The numbers here are the same projected OVRs every other page shows; the copy button gives you the list as text for a spreadsheet.') }
    ],
    'coaches.html': [
      { sel:'.filters',  t:'Coaching Lab',    d:'Every head coach graded on one scale. Filter by conference or search a name.' },
      { sel:'#content',  t:'The rankings',    html:bl('<b>TDC Coach Grade</b> — 0-100, from four parts: winning adjusted for the talent he had, tournament peak, player development and consistency.', '<b>Style</b> — his archetype from how his teams actually play (pace, shot diet, rotation).', 'Click a coach for his full page.') },
      { sel:'#msheet',   t:'Style sheet',     d:'Every coach\'s tendencies side by side — pace, three-point rate, bench minutes, how much the offense runs through one star.' }
    ],
    'development.html': [
      { sel:'.ss-band', t:'Player development', html:'How much players improve, and who improves them.' + bl('<b>Development</b> here is the gap between how a player\'s grade changed and how a player of his class and starting grade typically changes. +2 means he beat the usual curve by two grade points.', 'Programs and coaches are ranked by the average development of their players.') },
      { sel:'.sheet-wrap', t:'The sheet', d:'Every player-season with his grade before and after and the development delta. Filter by team, coach or class; sort by any column.' }
    ],
    'bracket.html': [
      { sel:'#out', t:'Bracketology', html:'A projected NCAA tournament field built from the Power Ratings:' + bl('<b>Seeds</b> 1-16 by projected strength, with automatic bids for projected conference champions.', '<b>Regions</b> follow the real bracketing rules — top seeds spread across regions, conference rivals kept apart where possible.', 'Once the real bracket is announced, the page shows it with the model\'s pick for every game.') }
    ],
    'games.html': [
      { sel:'h1', t:'Games',  d:'Eight quick games built on the site\'s own data. Each has a daily puzzle, the same for everyone, that resets at midnight Eastern.' },
      { sel:'#grid, .grid',   t:'Pick one', html:bl('<b>Guess the Player / College</b> — from a stat line or a career path.', '<b>Grade Guess</b> — guess a player\'s OVR from his line; teaches the grade scale fast.', '<b>Higher or Lower</b> and <b>Rank \'Em</b> — order players by a stat.', '<b>Hoop Grid</b> — the tic-tac-toe of teams and accolades.') }
    ],
    'game.html': [
      { sel:'.ghb', t:'The final', d:'Final score and each team\'s game rating (0-10): 6.3 means they played exactly as expected, higher means they beat it.' },
      { sel:'.gm-strip', t:'The numbers', d:'Margin, what we expected, how far the result landed from it, total points and possessions.' },
      { sel:'.gt-bar', t:'The tabs', html:bl('<b>Game</b> — the box score (switch teams; RTG is a 0-10 game rating), then the player of the game, flow, efficiency, shots and lineups.', '<b>Why it went that way</b> — which skills decided it, who beat his usual, and the swing.', '<b>Game flow · Shot chart · Rotation · On/Off</b> — the full detail from the play-by-play, when ESPN has it.') }
    ],
    'buzz.html': [
      { sel:'#q',     t:'The Wire',   d:'News and posts about players and programs, searchable.' },
      { sel:'#trend', t:'Trending',   d:'Who is being talked about most right now.' },
      { sel:'#feed',  t:'The feed',   d:'Headlines first, newest at the top; click a name to jump to that player or team.' }
    ],
    'just-added.html': [
      { sel:'#feed', t:'Just added', d:'Everything new on the site — players added to rosters, transfers, new tools — newest first.' }
    ],
    'preview.html': [
      { sel:'#gpSub',  t:'Game preview', d:'A full matchup report for one game: pick the team and opponent in the address (team= and opp=) or open it from a schedule.' },
      { sel:'#gpHost', t:'The report',   html:bl(G.spread, '<b>Four-factor edges</b> — which side wins shooting, turnovers, rebounding and free throws, and by how much.', '<b>Projected box score</b> — every player\'s line in this game, based on the opponent\'s defense.', '<b>Injuries</b> and who is out.') }
    ],
    'customize.html': [
      { sel:'.cz-controls', t:'Customize', d:'Pick a team to open its Lineup Lab: build your own five, adjust minutes, and see the projected lineup stats change.' },
      { sel:'#grid',     t:'Teams',     d:'Every rostered program; click one.' }
    ],
    'game-guess.html': [
      { sel:'#content', t:'Guess the Player', html:'A stat line from a real season; name the player.' + bl('The clues are his stats and bio, revealed one at a time — fewer clues used, more points.', 'It is a quick way to learn what a 15-and-8 line looks like against a 20-and-4.') }
    ],
    'game-college.html': [
      { sel:'#content', t:'Guess the College', d:'A player\'s line and bio; name the school he played for. Difficulty changes how famous the player is.' }
    ],
    'game-grade.html': [
      { sel:'#content', t:'Grade Guess', html:'A real stat line; guess the OVR the site gave it.' + bl(G.ovr, 'Playing a few rounds is the fastest way to calibrate: what an 80 looks like, what a 92 looks like.') }
    ],
    'game-higher.html': [
      { sel:'#cards', t:'Higher or Lower', d:'Two players — does the one on the right have a higher or lower number in the stat shown? Keep the streak alive.' }
    ],
    'game-rank.html': [
      { sel:'#rows', t:"Rank 'Em", d:'Five players; drag them into order by the stat named at the top, then reveal.' }
    ],
    'game-statline.html': [
      { sel:'#content', t:'Stat Line Guess', d:'A season stat line, one clue at a time; name the player before the clues run out.' }
    ],
    'game-career.html': [
      { sel:'#content', t:'Career Path', d:'A player\'s career, season by season, revealed one year at a time; name him as early as you can.' }
    ],
    'game-grid.html': [
      { sel:'#content', t:'Hoop Grid', d:'A 3×3 grid: each square needs a player who fits both its row and its column — a team and a conference, a stat threshold and an accolade. Nine correct fills the board.' }
    ],
    'explore.html': [
      { sel:'#xpFilter', t:'Every tool on the site', d:'Filter the map by what you are trying to do — understand a player, a team, a matchup, the portal, the postseason.' },
      { sel:'#xpBody', t:'The map', d:'Every page with a one-line description of what it answers. Start anywhere; every page has its own Explain button.' },
      { sel:'#xpGloss', t:'Glossary', html:'What each stat means, in plain English. The ones you will see everywhere:' + bl(G.power, G.ovr, G.wa, G.ortg, G.pct) }
    ],

    'coach-tier.html': [
      { sel:'#marketingHero', t:'Scouting & Game Prep', html:'The tools built for a staff. Everything here <b>informs</b> — it surfaces what the numbers say so you can apply your own system; it never tells you how to coach.' + bl('<b>Scouting</b> — the opponent.', '<b>Self-Scout</b> — your own team as an analyst sees it.', '<b>Player Intelligence</b> — every player graded, projected and fitted.', '<b>Game Prep</b> — turning the numbers into a plan.', '<b>Betting Edge</b> — the same data pointed at the market.') },
      { sel:'#ccPick', t:'Pick your program', d:'Set the team you represent once. Every tool below opens with it already selected, and the command center fills with your schedule.' },
      { sel:'#ccSchedCard', t:'Command center', d:'Your next games, each with a one-click scouting report on that opponent.' },
      { sel:'#filters', t:'Find a tool', d:'Filter the hubs by need — an opponent tonight, your rotation, a player you are evaluating, a plan for the week.' },
      { sel:'#grid', t:'The hubs', d:'Flagship tools first, deeper dives folded underneath each one. "Open →" launches the tool with your team loaded.' }
    ],



    'matchup.html': [
      { sel:'#selA', t:'Matchup', d:'Pick both teams. The season switcher runs past matchups with the real rosters of that year.' },
      { sel:'#tabPredict', t:'The projection', html:bl(G.spread, '<b>When each side has the ball</b> — its offense percentile against the other\'s defense, factor by factor, with the gap.', '<b>Shot zones and possessions</b> — what one side takes and scores against what the other allows, from last season\'s play-by-play.'), before:function(){ try{ mtab('predict'); }catch(e){} } },
      { sel:'#tabAdv', t:'Matchup advantage', d:'Who gains and who struggles in this game: each rotation player\'s shooting against defenses like tonight\'s opponent (edge vs his season mark), on a chart and by style of defense.', before:function(){ try{ mtab('adv'); }catch(e){} } }
    ],

    'dossier.html': [
      { sel:'#sel', t:'Player Dossier', d:'Pick any player on any roster.' },
      { sel:'#roster', t:'The roster', d:'Jump between teammates without leaving the page.' },
      { sel:'#out', t:'The dossier', html:'Everything a coach would want on one player:' + bl('<b>Projected line</b> — points, rebounds, assists, minutes for the coming season.', '<b>Situational identifiers</b> — pace sensitivity (better fast or slow?), pressure vulnerability (turnovers when pressed), foul risk, rotation volatility, matchup advantage. Built from twenty seasons of play-by-play.', '<b>Splits</b> — home/away, vs top teams, close games.', '<b>Form & availability</b> — recent trend and injury status.', '<b>Shot creation</b> — how he gets his shots: catch-and-shoot, off the dribble, at the rim.') }
    ],


    'lineups.html': [
      { sel:'#sel', t:'Lineup Recommender', d:'Pick the program and season.' },
      { sel:'#out', t:'The units', d:'Five-man units built from the projected rotation, ranked by the net rating (points per 100 possessions, scored minus allowed) each one projects to. Balance matters as much as talent: a unit with no spacing or no rim protection is marked down even if its five OVRs are high.' }
    ],


    'game-review.html': [
      { sel:'#sel', t:'Game Review', d:'Pick the program and a season.' },
      { sel:'#log', t:'The game log', d:'Every game of the season with its margin; pick one (the latest opens first).' },
      { sel:'#out', t:'The game', html:'One game, in numbers:' + bl('<b>Where the margin came from</b> — shooting, turnovers, offensive rebounds, free throws and possessions, each in points; they add up to the final margin.', '<b>Side by side</b> — the box numbers plus three-point and shot-quality context.', '<b>Game flow, rotation and shot charts</b> from the play-by-play.') }
    ],



    'roles.html': [
      { sel:'#sel', t:'Personnel Book', d:'Pick any program.' },
      { sel:'#out', t:'Role & fit', html:'One card per player:' + bl(G.ovr, '<b>Archetype</b> — his play style, from clustering thousands of player-seasons (Scoring Guard, Stretch Big, Connector Wing…).', '<b>Development path</b> — how players of his class and profile typically grow.', '<b>How to attack him</b> — the weaknesses in his profile.'), before:function(){ try{ rtab('roles'); }catch(e){} } },
      { sel:'#archBody', t:'Archetypes', d:'The ten style clusters, what defines each, and where every player on the roster sits. Two players in the same cluster compete for the same role.', before:function(){ try{ rtab('arch'); }catch(e){} } }
    ],

    'onoff.html': [
      { sel:'#search', t:'On / Off & WOWY', html:'Search a player.' + bl('<b>On / off</b> — the team\'s net rating with him on the floor minus with him off. +8 means the team is 8 points per 100 possessions better when he plays.', '<b>WOWY</b> — "with or without you": the same idea over whole games he played versus games he missed.', 'Small samples swing wildly; the number is more trustworthy the more minutes it is built on.') }
    ],

    'consistency.html': [
      { sel:'#sel', t:'Consistency', d:'Pick a program.' },
      { sel:'#out', t:'Reliability', d:'Each player\'s game-to-game variation: how often he delivers close to his average versus swinging between big games and no-shows. A high-average, high-variance scorer is a different bet from a steady one.' }
    ],

    'roster-dev.html': [
      { sel:'#sel', t:'Development Timeline', d:'Pick a program.' },
      { sel:'#out', t:'Year over year', d:'Each player\'s grade season by season, with the trajectory read: ahead of the usual development curve for his class, on it, or behind it.' }
    ],

    'predict.html': [
      { sel:'#q', t:'Projected Ratings & Schedule', html:'Find a team.' + bl(G.power, '<b>Game-by-game odds</b> — the projected line and win probability for every game.', '<b>Simulated season</b> — the season played thousands of times, giving a range of records rather than one number.') },
      { sel:'#sweepPanel', t:'Conference sweep', d:'Every team in a league projected side by side — the projected standings.' }
    ],

    'conferences.html': [
      { sel:'#tiles, .tiles', t:'Every conference at a glance', d:'One tile per Division-I league for the season shown: how strong it is, who leads it and how many teams it has. Click a tile to open that conference\'s own page (standings, team ratings and its tournament).' },
      { sel:'#hub', t:'The conference table', html:'Every league side by side, ranked by strength.' + bl(G.power + ' The conference number is the average of its teams.', '<b>Top team</b> — the best-rated team in that league.', '<b>Depth</b> — how strong the middle and bottom of the league are, not just the top.') },
      { sel:'#pwrbox', t:'Power rating by conference', d:'How the conferences stack up when you compare every team in them, not just the champions.' }
    ],

    'player-rankings.html': [
      { sel:'#grpRow', t:'Pick a list', d:'Choose the group of players to rank: everyone, a position, a class (freshmen, transfers…) or a category list.' },
      { sel:'#byRow', t:'Rank by', html:'Choose the number the list is sorted by.' + bl(G.ovr, G.wa, '<b>Per-game stats</b> — points, rebounds, assists and the rest, from the 2026-27 projection.') },
      { sel:'#confRow', t:'Conference filter', d:'Narrow the list to one league (ACC, SEC, Big Ten…) or keep every Division-I player.' },
      { sel:'#prSearch', t:'Find a player', d:'Type a player or a school to jump straight to him in the current list.' },
      { sel:'.sheet-wrap, #prHead', t:'The rankings', d:'The ranked list. Green-shaded cells are strong for that column, red are weak. Click a player for his full page.' }
    ],

    'transfers.html': [
      { sel:'#tpSum', t:'The 2026-27 portal class', d:'The headline numbers for this year\'s transfer class: how many players moved, how many committed and where the most value went.' },
      { sel:'#viewRow', t:'Players or teams', d:'<b>Players</b> lists every transfer; <b>Teams</b> ranks the schools by the talent they added and lost through the portal (their portal "haul").' },
      { sel:'#posRow, #lvlRow', t:'Filters', html:bl('<b>Position</b> — guards, wings or bigs.', '<b>Move</b> — up a level (mid-major to high-major), down a level, or across.') },
      { sel:'#tpBoards', t:'Top boards', d:'Quick lists: the best transfers still available, the biggest commitments and the biggest level jumps.' },
      { sel:'.sheet-wrap, #tpHead', t:'The full tracker', html:'Every transfer with his old school, his new one and his projected value.' + bl(G.ovr) + 'Click a row to see how well he fits every program (Portal Fit).' }
    ],

    'today.html': [
      { sel:'.dates', t:'Pick a day', d:'The week strip jumps to any day around this one, the arrows step a day at a time and the calendar jumps to any date. Everything below re-loads for the day you pick.' },
      { sel:'#scrimSec', t:'Scrimmages & exhibitions', d:'Preseason games, including the "secret" scrimmages. They are unofficial: they never count in a team\'s record. Click one for its box score and its Reality Meter (how game-like it was, which sets how much it moves our projections).' },
      { sel:'#gameSec', t:'Games', html:'Every Division-I game that day: live scores while they are on, finals after. Before tip-off you see our line.' + bl(G.spread) }
    ],

    'plays.html': [
      { sel:'#pfSearch', t:'Build a search', d:'Search every play in Division-I play-by-play back to 2008. Pick a season, a team, a player, the kind of play (three-pointer, dunk, block…), the result and the situation (late and close, overtime…).' },
      { sel:'#f-form', t:'Stat conditions', d:'Add a condition on a number, for example plays where the win probability swung by more than 20%, or shots taken with under five seconds left.' },
      { sel:'#chips', t:'Your filters', d:'Each filter you add shows here as a chip; click one to remove it.' },
      { sel:'#res', t:'The results', html:'Every matching play, newest first (or as sorted).' + bl('<b>WPA</b> — win probability added: how much the play changed the team\'s chance of winning.', '<b>xPts / POE</b> — how many points an average shooter would expect from that shot, and how many he scored over that expectation.') }
    ],

    'scrimmage.html': [
      { sel:'.ghb', t:'The final', d:'Unofficial preseason scrimmage or exhibition: it does not count in either team\'s record or season stats.' },
      { sel:'.gm-strip', t:'The numbers', d:'Margin, our pregame line, how far the result landed from it, total points, possessions, and how much this game counts toward the players\' projections.' },
      { sel:'.gt-bar', t:'The tabs', html:bl('<b>Summary</b> — player of the game and how each player did against our projection.', '<b>Box score</b> — both teams\' lines and who did not play.', '<b>Team stats</b> — shooting, four factors and how each possession ended.', '<b>Game flow · Shots · Rotation</b> — from the play-by-play, when there is one.', '<b>How much it counts</b> — the Reality Meter.') },
      { sel:'#gt-counts .rm, #gt-counts', t:'The Reality Meter', before:(function(id){ return function(){ var b=document.querySelector('.gt-tab[data-t="'+id+'"]'); if(b) b.click(); }; })('counts'), html:'How much this looked like a real game, read from the box score (0-100):' + bl('<b>Rotation</b> — were the minutes concentrated like a real game, or spread around to experiment?', '<b>Availability</b> — did the projected rotation play and start?', '<b>Competitive</b> — big margins mean garbage time.', '<b>Pace / line fit</b> — a normal number of possessions and a believable result.') + 'The higher it is, the more these lines count toward the players\' projections.' }
    ],

    'forum.html': [
      { sel:'#catChips', t:'Categories', d:'Filter the forum to one topic: transfer portal, recruiting, game threads or general talk.' },
      { sel:'#foSearch', t:'Search', d:'Find a topic by its title or text.' },
      { sel:'#postBtnWrap', t:'Start a topic', d:'Sign in to post. Every post follows the forum rules; reported posts are reviewed by a moderator.' },
      { sel:'#listView', t:'The topics', d:'Newest activity first. Pinned topics stay on top; locked topics can be read but not replied to.' }
    ],

    'community.html': [
      { sel:'#tab-forum', t:'Forum', d:'Discussion threads by topic: portal, recruiting, game threads and general talk.' },
      { sel:'#tab-members', t:'Members', d:'Everyone with an account, with their favorite team and member badges.' },
      { sel:'#tab-feed', t:'Feed', d:'The latest activity across the site: new posts, follows and fan-site stories.' }
    ],

    'fan.html': [
      { sel:'#dirPubs', t:'Fan publications', d:'Each team can have its own fan site: articles written by its fans, with a masthead and editors. These are the publications running now.' },
      { sel:'#dirLatest', t:'Latest stories', d:'The newest articles across every fan site.' },
      { sel:'#dirTeams', t:'Find your team', d:'Open any team\'s fan site and forum, or apply to write for it.' }
    ],

    'league.html': [
      { sel:'.hero-cards', t:'How it works', d:'Public fantasy leagues on real 2026-27 players from the five power conferences: draft (auction or snake), compete in points, rebounds and assists all season, then a March playoff bracket.' },
      { sel:'#jCode', alt:'#app .btn, .btn', t:'Join a league', d:'Have an invite code from a friend? Enter it to join their league and claim a team.' },
      { sel:'#cName', alt:'#app .btn, .btn', t:'Start a league', d:'Name your league and your team, pick an auction or snake draft, then share the invite code. Leagues use real 2026-27 players and our projections.' },
      { sel:'#view', alt:'.hero-cards', t:'Your league', d:'Once you are in: the draft board, your roster, the standings (rotisserie categories) and the March playoff bracket, priced by simulating the tournament.' }
    ],

    'dynasty.html': [
      { sel:'#dyHead', t:'Dynasty (beta)', d:'Run a program over many seasons: recruit, develop and play games simulated by our own game engine, built on 20 years of real box scores.' },
      { sel:'#dyBody', t:'Your program', d:'Your roster, season and results live here. It is a beta, so features are still being added.' }
    ]
  };

  var STEPS = null, i = 0, W = null;
  function page(){ var p = (location.pathname.split('/').pop() || 'index.html'); return p === '' ? 'index.html' : p; }
  // first VISIBLE match of a comma list ("#heroRibbon, #heroMetrics" — whichever this season renders)
  function q(sel){ try { var parts = String(sel).split(','), first = null; for (var k = 0; k < parts.length; k++) { var el = document.querySelector(parts[k].trim()); if (!el) continue; if (visible(el)) return el; if (!first) first = el; } return first; } catch (e) { return null; } }
  function visible(el){ if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }

  // The button's styles live in CSS too, so inject them with the button, not only when a tour
  // opens: until now the "Explain this page" button rendered as a bare browser button, painted
  // in the top-left while the page was still empty and then pushed below the content.
  var cssIn = false;
  function ensureCss(){ if (cssIn) return; cssIn = true; var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }
  function ensureDom(){
    if (W) return;
    ensureCss();
    W = document.createElement('div'); W.id = 'tdcTourWrap'; W.setAttribute('role', 'dialog'); W.setAttribute('aria-label', 'Page walkthrough');
    W.innerHTML = '<div class="tdc-tour-spot" id="tdcTourSpot"></div>'
      + '<div class="tdc-tour-tip" id="tdcTourTip"><div class="tdc-tour-step" id="tdcTourStep"></div><div class="tdc-tour-t" id="tdcTourTitle"></div><div class="tdc-tour-d" id="tdcTourDesc"></div>'
      + '<div class="tdc-tour-nav"><button class="tdc-tour-skip" type="button">Skip</button><div class="tdc-tour-dots" id="tdcTourDots"></div><button class="tdc-tour-next" type="button">Next</button></div></div>';
    document.body.appendChild(W);
    W.querySelector('.tdc-tour-skip').addEventListener('click', end);
    W.querySelector('.tdc-tour-next').addEventListener('click', next);
    document.addEventListener('keydown', function (e) { if (!W.classList.contains('on')) return; if (e.key === 'Escape') end(); if (e.key === 'ArrowRight' || e.key === 'Enter') next(); });
  }
  function prep(step){
    try {
      if (step.tab) {
        // click the page's own tab control when there is one (team.html's switchTab needs the button)
        var btn = null, cands = document.querySelectorAll('[onclick*="switchTab("], [onclick*="Pick("], [data-tab]');
        for (var k = 0; k < cands.length && !btn; k++) {
          var oc = cands[k].getAttribute('onclick') || '', dt = cands[k].getAttribute('data-tab') || '';
          if (oc.indexOf("('" + step.tab + "'") >= 0 || oc.indexOf('("' + step.tab + '"') >= 0 || dt === step.tab) btn = cands[k];   // switchTab('x' / _tgPick('x' / _grpPick('x'
        }
        if (btn) btn.click(); else if (typeof g.switchTab === 'function') { try { g.switchTab(step.tab); } catch (e) {} }
      }
      if (typeof step.before === 'function') step.before();
    } catch (e) {}
  }
  // the step's target, else its alternate (alt), else the tab's own panel — a Pro/Premium tab shows its lock
  // card instead of the content, and the walkthrough should light that card, not skip the step
  function target(st){
    var el = q(st.sel); if (visible(el)) return el;
    var alt = st.alt || (st.tab ? '#panel-' + st.tab : null);
    var e2 = alt ? q(alt) : null; return visible(e2) ? e2 : el;
  }
  function place(){
    var el = STEPS[i] ? target(STEPS[i]) : null;
    if (STEPS[i] && (STEPS[i].tab || STEPS[i].before)) { prep(STEPS[i]); el = target(STEPS[i]); }
    if (!visible(el)) {
      // the target may still be loading (a tab panel, data that arrives late): look again, and if it never
      // shows (an empty state, a gated or not-yet-built section) still EXPLAIN the step — centred, no
      // spotlight — instead of silently skipping it or closing the walkthrough (it used to look broken)
      var mine = ++_seq; centred();
      [500, 1300, 2600].forEach(function (ms) { setTimeout(function () { if (mine !== _seq) return; var e2 = target(STEPS[i]); if (visible(e2)) { _seq++; spotlight(e2); } }, ms); });
      return;
    }
    spotlight(el);
  }
  function texts(){
    document.getElementById('tdcTourStep').textContent = 'Step ' + (i + 1) + ' of ' + STEPS.length;
    document.getElementById('tdcTourTitle').textContent = STEPS[i].t;
    var dsc = document.getElementById('tdcTourDesc'); if (STEPS[i].html) dsc.innerHTML = STEPS[i].html; else dsc.textContent = STEPS[i].d || '';
    W.querySelector('.tdc-tour-next').textContent = (i === STEPS.length - 1) ? 'Got it' : 'Next';
    document.getElementById('tdcTourDots').innerHTML = STEPS.length > 12
      ? '<span class="tdc-tour-bar"><i style="width:' + Math.round((i + 1) / STEPS.length * 100) + '%"></i></span>'   // 40 dots pushed Next off a phone
      : STEPS.map(function (_, k) { return '<span class="tdc-tour-dot' + (k === i ? ' on' : '') + '"></span>'; }).join('');
  }
  function centred(){
    texts();
    var spot = document.getElementById('tdcTourSpot');
    spot.style.left = (window.innerWidth / 2) + 'px'; spot.style.top = (window.innerHeight / 2) + 'px'; spot.style.width = '0px'; spot.style.height = '0px';
    var tip = document.getElementById('tdcTourTip'), tw = Math.min(380, window.innerWidth - 24), th = tip.offsetHeight || 160;
    tip.style.maxWidth = tw + 'px'; tip.style.left = Math.max(12, (window.innerWidth - tw) / 2) + 'px'; tip.style.top = Math.max(12, (window.innerHeight - th) / 2) + 'px';
  }
  function spotlight(el){
    var tall = function(){ return el.getBoundingClientRect().height > window.innerHeight - 80; };
    var scrollTo = function(){ try { el.scrollIntoView({ behavior: 'smooth', block: tall() ? 'start' : 'center' }); } catch (e) {} };
    scrollTo();
    var my = ++_seq;
    // measure once the scroll settles, then again after a tab's content has rendered (panels load
    // async — a first measure of a just-opened Schedule tab caught it empty), and once more late
    // for slow data; each pass re-centres if the target grew
    [360, 1200, 2600, 4500].forEach(function (ms, n) { setTimeout(function () { if (my !== _seq) return; if (n) scrollTo(); setTimeout(function () { if (my === _seq) measure(el); }, n ? 350 : 0); }, ms); });
  }
  var _seq = 0;
  function measure(el){
    {
      var r = el.getBoundingClientRect(), pad = 8;
      var spot = document.getElementById('tdcTourSpot');
      // a target taller than the screen is lit from its top edge (never from above the viewport)
      var sTop = Math.max(r.top, 8), sH = Math.min(r.bottom - sTop, window.innerHeight - sTop - 12);
      spot.style.left = (r.left - pad) + 'px'; spot.style.top = (sTop - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (sH + pad * 2) + 'px';
      texts();
      var tip = document.getElementById('tdcTourTip'); var th = tip.offsetHeight || 160, tw = Math.min(380, window.innerWidth - 24);
      var bottom = sTop + sH;
      var top = bottom + 14; if (top + th > window.innerHeight - 12) top = Math.max(12, sTop - th - 14);
      if (top + th > window.innerHeight - 12 || top < 12) top = Math.max(12, Math.min(sTop + 24, window.innerHeight - th - 12));   // tall target: tip sits inside its top
      var left = Math.min(Math.max(12, r.left), window.innerWidth - tw - 12);
      tip.style.maxWidth = tw + 'px'; tip.style.top = top + 'px'; tip.style.left = left + 'px';
    }
  }
  function next(){ if (i >= STEPS.length - 1) { end(); return; } i++; place(); }
  function end(){ if (!W) return; _seq++; W.classList.remove('on'); window.removeEventListener('resize', place); }
  function start(steps){
    STEPS = steps || TOURS[page()]; if (!STEPS || !STEPS.length) return false;
    ensureDom(); i = 0; W.classList.add('on'); place(); window.addEventListener('resize', place); return true;
  }
  function button(){
    if (!TOURS[page()] || document.querySelector('.tdc-explain')) return;
    ensureCss();
    var b = document.createElement('button'); b.type = 'button'; b.className = 'tdc-explain'; b.setAttribute('aria-label', 'Explain this page');
    b.innerHTML = '<i>?</i><span>Explain this page</span>';
    b.addEventListener('click', function () { start(); });
    document.body.appendChild(b);
  }
  // on demand only — the walkthrough never opens by itself. Pages that re-render their body after load could
  // drop the button, so it re-checks for a while after boot.
  function boot(){ button(); var n = 0, iv = setInterval(function () { button(); if (++n >= 15) clearInterval(iv); }, 2000); }
  if (document.readyState === 'complete') setTimeout(boot, 400); else window.addEventListener('load', function () { setTimeout(boot, 400); });
  g.TDCTour = { start: start, end: end, register: function (pg, steps) { TOURS[pg] = steps; if (pg === page()) button(); }, tours: TOURS };
})(window);
