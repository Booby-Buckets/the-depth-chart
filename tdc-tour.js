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
#tdcTourWrap{position:fixed;inset:0;z-index:9000;display:none;}\
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
.tdc-tour-dots{display:flex;gap:5px;}\
.tdc-tour-dot{width:6px;height:6px;border-radius:50%;background:var(--border2,#ccd);}\
.tdc-tour-dot.on{background:var(--accent,#3b5bdb);}\
.tdc-explain{position:fixed;left:16px;bottom:16px;z-index:8000;display:inline-flex;align-items:center;gap:7px;padding:8px 13px 8px 10px;border-radius:22px;\
  background:var(--bg2,#fff);color:var(--text,#111);border:1px solid var(--border2,#ccd);box-shadow:0 8px 24px -8px rgba(0,0,0,.45);font:700 12px/1 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;letter-spacing:.02em;cursor:pointer;transition:transform .15s,box-shadow .15s;}\
.tdc-explain:hover{transform:translateY(-1px);box-shadow:0 12px 28px -8px rgba(0,0,0,.5);}\
.tdc-explain i{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--accent,#3b5bdb);color:#141416;font-style:normal;font-size:11px;font-weight:900;}\
@media(max-width:760px){.tdc-explain{left:12px;bottom:12px;padding:8px 11px 8px 9px;}.tdc-explain span{display:none;}}\
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
      { sel:'.table-scroll', t:'The rankings table', html:'Every Division-I team, ordered by <b>Power Rating</b>. The columns, left to right:' + bl(G.power, '<b>Trend</b> — the projected rating\'s path through the season.', '<b>W-L</b> — projected wins and losses.', G.ortg, '<b>Win%</b> — projected share of games won.', '<b>PPG / RPG / APG …</b> — projected per-game points, rebounds, assists, shooting.') + 'Click a column header to sort by it, and click a team to expand its card or open its full page.' },
      { sel:'.tr-drop, .tr-row, tbody tr', t:'Team cards', d:'Click a row and it expands: before the season you get the offseason report (who left, who arrived, what changed); once games start it shows the team\'s rating chart in-season. Click the name to go to the full Team HQ.' },
      { sel:'.tdn-wrap', t:'The menus', html:bl('<b>Teams</b> — rankings, conferences, team stats, compare.', '<b>Players</b> — the player database, awards, the draft board, newcomers.', '<b>Analytics</b> — leaderboards, the stat explorer, shot charts, Moneyball.', '<b>Postseason</b> — brackets, tournaments, March insights.', '<b>More</b> — Explore (every tool), Coach\'s Tier, Betting Lab, your account.') },
      { sel:'.tdc-explain', t:'This button', d:'Every major page has one. Press it any time for a walkthrough of exactly what is on that page and what each number means. It never opens on its own.' }
    ],

    'team.html': [
      { sel:'#teamHero', t:'Team HQ', d:'Everything about one program lives here. The season switcher lower down flips the whole page between the coming season (projected) and any past season (real results) back to 2006-07.' },
      { sel:'#heroRibbon, #heroMetrics', t:'The headline numbers', html:bl(G.power, '<b>Overall / Offense / Defense</b> — 0-99 grades for the team as a whole and each side of the ball, relative to all of Division I.', '<b>Projected record</b> — the most likely wins-losses, with the range a simulated season produces around it.', '<b>Projected seed / rank</b> — where the model places them nationally and in the NCAA tournament.', '<b>Continuity</b> — the share of last season\'s minutes that return. High continuity teams usually out-perform their raw talent early.') },
      { sel:'#heroGrades', t:'Roster grades', html:bl('<b>Depth</b> — how strong the roster is beyond the starting five.', '<b>Recruit</b> — the incoming class.', '<b>NIL Eval / Tier</b> — the estimated market value of the roster and the spending tier the program sits in ($20M+ at the top).') },
      { sel:'.hero-tabs', t:'The tabs', html:bl('<b>Depth Chart</b> — the rotation, position by position.', '<b>Schedule</b> — every game with a projected line.', '<b>Preview</b> — a full matchup report against any opponent.', '<b>Analytics ▾</b> — Team DNA, projected stats, shot charts, on/off, lineups.', '<b>Coach\'s Tier ▾</b> — the scouting tools.', '<b>NIL Value</b> and <b>Betting</b>.') },
      { sel:'#playerSpotlight', t:'Player spotlight', d:'Click any name on the depth chart and his card lands here: projected OVR, role, badges, and his projected per-game line. Click the name again to open his full player page.', tab:'depth' },
      { sel:'.dc-grid', t:'The depth chart', html:'The rotation as the coach would draw it — a column per position (PG, SG, SF, PF, C), starters on top, bench underneath.' + bl('The number on each card is his <b>projected OVR</b> (0-99).', 'The minutes are his <b>projected minutes per game</b> — the same minutes his player page and the team stats are built from.', '★ = projected starter. FR = true freshman, whose line comes from his evaluation rather than college stats.') , tab:'depth' },
      { sel:'#panel-schedule', t:'Schedule', html:'Every game on the slate.' + bl('<b>Line</b> — the projected margin. −7 means this team is favoured by 7.', '<b>Win %</b> — the chance of winning that game.', 'The summary above it is a <b>simulated season</b>: the record range you should expect, not one fixed number, because every game carries uncertainty.'), tab:'schedule' },
      { sel:'#panel-preview', t:'Game preview', html:'Pick any opponent for a matchup report:' + bl(G.spread, 'Four-factor edges — which side wins the shooting, turnover, rebounding and free-throw battles.', 'Each player\'s <b>projected line in that specific game</b>, based on the opponent\'s defense.'), tab:'preview' },
      { sel:'#teamDnaHost', t:'Team DNA', html:'The team\'s statistical identity.' + bl(G.ortg, G.tempo, G.ff, 'Each bar shows the team\'s <b>percentile</b> nationally — the tick is the median team. The matchup projector at the bottom uses the same numbers to project a game against any opponent.'), tab:'dna' },
      { sel:'#projectionsContent', t:'Projected stats', d:'The team\'s projected per-game line (points, rebounds, assists, shooting) for the coming season, each number ranked against every Division-I team from last season so you can see whether 78 points a game is a lot (it is about 65th percentile). Below it: every player\'s projected line.', tab:'projections' },
      { sel:'#teamShotHost', t:'Shot charts', d:'Where the team shoots from and how well. Filled dots are makes, hollow are misses; the heat view shades the floor by how often they shoot from each spot. "His spots" on a player page works the same way for one player.', tab:'shots' },
      { sel:'#onoffHost', t:'On / Off', d:'How the team performs with each player on the floor versus off it, in points per 100 possessions. A big positive on/off means the team is much better when he plays — the closest thing to a plus-minus that box scores can\'t give you.', tab:'onoff' },
      { sel:'#nilContent', t:'NIL value', d:'The estimated market value of each player and the roster in name-image-likeness money, from his projected value and the market for players like him. Not what anyone is actually paid — what the production is worth.', tab:'nil' },
      { sel:'#customizeContent', t:'Lineup Lab', d:'Build your own five: drag players in and out, adjust minutes, and the projected lineup stats update live. Use it to answer "what if he started" questions.', tab:'customize' },
      { sel:'#rrEssence',  t:"Roster Report (Coach's Tier)", d:'A written scouting report on this roster, generated from the projected lines, the depth chart and the coach\'s history — the kind of one-page read an assistant would hand the staff. This top paragraph is the essence: what this roster is, in three sentences.', tab:'report' },
      { sel:'#rrStarters', t:'Starting five', d:'The projected starters\' positives and flaws. Each point names the player and the statistical reason behind it — a shooting weakness is a real three-point number, a rebounding strength is a real rebound rate — so you can check it against the numbers on the depth chart.', tab:'report' },
      { sel:'#rrBench',    t:'Bench & depth', d:'Who helps off the bench and who hurts: which reserves the model trusts with real minutes, and where the drop from starter to backup is steep.', tab:'report' },
      { sel:'#rrSecond',   t:'Second unit', d:'The bench as a group — its strength and its weakness when the starters sit, which decides how the rotation survives foul trouble and injuries.', tab:'report' },
      { sel:'#rrCoach',    t:'Coaching fit', d:'How the current coach\'s habits (pace, rotation size, shot diet, from his real seasons) line up with this roster — where the personnel suits how he coaches and where it doesn\'t. It surfaces the fit; it does not prescribe a system.', tab:'report' }
    ],

    'player.html': [
      { sel:'.player-hero', t:'The player card', html:'One player, everything the site knows about him.' + bl(G.ovr, G.wa, '<b>Big Board</b> — his rank among every player in the country for the coming season.', '<b>Position rank</b> — his rank among players at his position.', '<b>Of 89K all-time</b> — where this season sits among every player-season since 2006-07.') },
      { sel:'.tab-row', t:'The tabs', html:bl('<b>Overview</b> — his projected line next to last season, skills, role.', '<b>Player DNA</b> — the analyst view: dashboard, offense, defense, six-factor.', '<b>Stats</b> — per game, per 40 minutes, advanced, game log, career.', '<b>Shots & Rankings ▾</b> — shot charts, national rankings, percentiles.', '<b>Coach\'s Tier ▾</b> — dossier, role & fit, development path, scheme.', '<b>NIL</b>, <b>Buzz</b> (news), <b>Betting</b> (props).') },
      { sel:'#tdcSeasonSlot', t:'Season switcher', d:'"2026-27 Projected" is the model\'s estimate for the coming season. Every other entry is a real season he played: the stats he actually posted and the grade he earned that year. Historical grades use the same scale, so an 85 in 2016 means the same as an 85 today.' },
      { sel:'#ovrCards', t:'Actual vs projected', html:'Last season on the left, the coming season on the right, with the change on every stat.' + bl('<b>MPG</b> — minutes per game; the projection\'s minutes come from his depth-chart slot, the coach\'s rotation habits and what he played last year.', G.usg, G.ts, 'A drop in points with a drop in minutes usually means a smaller role, not a worse player.') },
      { sel:'#radarChart', t:'Skill wheel', d:'Each spoke is one skill — scoring, shooting, playmaking, rebounding, defense, ball security — shown as a national percentile among players at his position. A full spoke is elite; a short one is a weakness.' },
      { sel:'#panel-playerdna', t:'Player DNA', html:'The analyst view, with sub-tabs:' + bl('<b>Dashboard</b> — his percentile in every category at once.', '<b>Offense</b> — how he scores: shot diet, efficiency by shot type, creation.', '<b>Defense</b> — steals, blocks, rebounding, what the team allows with him on.', '<b>Six-factor</b> — the four factors plus rim protection and creation, as a fingerprint.') + 'Blue is strong, grey is average — the colours are one scale everywhere.', before:function(){ try{ switchTab('playerdna'); }catch(e){} } },
      { sel:'#panel-stats', t:'Stats', html:bl('<b>Per game</b> — the familiar box score.', '<b>Per 40</b> — the same stats stretched to 40 minutes, so a 15-minute bench player and a 35-minute starter can be compared.', '<b>Advanced</b> — usage, TS%, rebound and assist rates, TI (total impact per 40) and Wins Added.', '<b>Career trajectory</b> — his grade season by season.'), before:function(){ try{ switchTab('stats'); }catch(e){} } },
      { sel:'#shotChartHost', t:'Shot chart', d:'Every located shot he took: filled = make, hollow = miss. "His spots" highlights the areas where he shoots better than the national average — and "trouble spots" where he doesn\'t. Shot Flow underneath shows where his shots come from (catch-and-shoot, off the dribble, at the rim) and who sets them up.', before:function(){ try{ _grpPick('shotcharts'); }catch(e){} } },
      { sel:'#rankingsContent', t:'National rankings', d:'His rank in every stat among all Division-I players — and among players at his position — so you can see at a glance what he is elite at.', before:function(){ try{ _grpPick('rankings'); }catch(e){} } },
      { sel:'#distSection', t:'Percentile distributions', html:'Each row is one stat.' + bl('The bar is <b>where he sits</b> among the comparison group; the tick in the middle is the median player.', 'The number on the right is his <b>percentile</b> — 85th means better than 85% of them.', 'The toggle switches the comparison group between the whole country and his position.'), before:function(){ try{ _grpPick('percentiles'); }catch(e){} } },
      { sel:'#nilContent', t:'NIL value', d:'What his projected production is worth in the name-image-likeness market: a dollar figure from his impact, his market premium (position, star power) and the spending tier of his program. An estimate of value, not a report of what he is paid.', before:function(){ try{ switchTab('nil'); }catch(e){} } },
      { sel:'#buzzContent', t:'Buzz', d:'Headlines and posts about him, newest first — the human context behind the numbers.', before:function(){ try{ switchTab('buzz'); }catch(e){} } },
      { sel:'#bettingContent', t:'Betting', d:'His projected prop lines (points, rebounds, assists) and how often he has cleared similar numbers, built from his own game logs.', before:function(){ try{ switchTab('betting'); }catch(e){} } }
    ],

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
      { sel:'#sharpGrid', t:'Betting Lab', html:'The site\'s own twenty seasons of data, pointed at the betting market.' + bl('<b>ATS</b> — against the spread: did the team beat the number, not just win.', '<b>O/U</b> — over/under: did the two teams combine for more or fewer points than the total.', '<b>Sharp trends</b> — situations where teams have historically beaten the number more often than chance.') },
      { sel:'#playerCard', t:'Player props', d:'Search a player for his projected prop lines (points, rebounds, assists) and the edge the model sees against a typical book line. The hit-rate is how often he actually cleared similar numbers in his own game logs.' },
      { sel:'#mlOut', t:'Matchup line', html:'Pick two teams:' + bl(G.spread, 'Home / neutral changes the home-court advantage baked into the line.') }
    ],

    'moneyball.html': [
      { sel:'#mbTabs', t:'Moneyball', html:'Roster-building as math. Four rooms:' + bl('<b>The Market</b> — what every roster is worth.', '<b>Front Office</b> — pick a goal and see the win gap and how to close it.', '<b>GM Mode</b> — build a roster under a budget.', '<b>The Ledger</b> — value against cost, every program.') },
      { sel:'#scatterHost', t:'The Market', html:bl(G.wa, 'Every roster is priced in Wins Added: add up the players and you have the wins the roster is worth above a replacement-level team.', 'The market view shows which play styles are under-priced — where a win costs less to buy.') },
      { sel:'#tab-office', t:'Front Office', d:'Search a team and pick a goal — a win total, a tournament seed. The tool converts the goal into a Power Rating, measures the gap to the roster\'s current projection in wins, and lists concrete recipes to close it: a position upgrade, a portal target, internal development. Simulate lets you slide the assumptions.', before:function(){ try{ showTab('office'); }catch(e){} } },
      { sel:'#gmDash', t:'GM Mode', d:'A budget, a roster, and the real portal pool. Add and remove players and the projected wins, the cap and the depth chart update as you go.', before:function(){ try{ showTab('gm'); }catch(e){} } },
      { sel:'#ledScatterHost', t:'The Ledger', d:'Each dot is a program: what its roster produces (Wins Added) against what it costs (NIL value). Above the line is surplus value — more wins than the money should buy.', before:function(){ try{ showTab('ledger'); }catch(e){} } }
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

    'program-hq.html': [
      { sel:'#picker',      t:'Program HQ',        d:'Your team\'s front door. Pick your program once and this page — and every tool it launches — is built around it.' },
      { sel:'.hx-hero',     t:'The header',        html:bl(G.power, '<b>Projected record, seed and rank</b> for the coming season.', 'The style tag is the team\'s identity from its DNA (Up-Tempo Shooters, Grind-It-Out Bigs…).') },
      { sel:'#hxOutlook',   t:'Outlook',           d:'A plain-English read on the season ahead: what the roster returns, what changed, where the model sees the ceiling and the floor.' },
      { sel:'#hxGame',      t:'Next game',         html:bl(G.spread, 'One click opens the full preview or the scouting report on that opponent.') },
      { sel:'#hxStandings', t:'Standings',         d:'The conference table with each team\'s Power Rating.' },
      { sel:'#hxLeaders',   t:'Leaders',           d:'Your top players by projected OVR and Wins Added.' },
      { sel:'#hqLaunch',    t:'The launchpad',     d:'Twelve tools — depth chart, schedule, DNA, scouting, portal, NIL, betting… — each pre-loaded with your team. Every one of them has its own Explain button.' }
    ],
    'projections.html': [
      { sel:'.ph-hero',     t:'Projections',       d:'Every player\'s projected line for the coming season in one table, and a compare view for putting two next to each other.' },
      { sel:'.tdc-toolbar', t:'Filters',           d:'Search, conference, position and class. Click any column header to sort.' },
      { sel:'#tableWrap',   t:'The table',         html:bl(G.ovr, '<b>Projected line</b> — minutes, points, rebounds, assists, shooting for the coming season, built from his real production, his class\'s development curve and his role on the projected roster.', 'The same numbers his player page and his team\'s depth chart show.') }
    ],
    'draft.html': [
      { sel:'#viewSeg',  t:'Draft',        d:'Two views: the Big Board (every prospect ranked) and the Mock (a projected draft order).' },
      { sel:'#bbSearch', t:'Filters',      d:'Search a name, or narrow by position and class.' },
      { sel:'#bbList',   t:'The Big Board', html:'Prospects ranked by projected value:' + bl(G.ovr, G.wa, 'Age and class matter: a sophomore at 85 is a better bet than a senior at 85 because he has more development left — the board reflects that.') },
      { sel:'#viewMock', t:'The mock',     d:'A projected draft order from the same board, adjusted for position value and team needs.', before:function(){ try{ document.querySelector('#viewSeg [data-v="mock"], #viewSeg button:last-child').click(); }catch(e){} } }
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
      { sel:'.page-h1', t:'Games',  d:'Eight quick games built on the site\'s own data — a fun way to learn what the numbers mean.' },
      { sel:'#grid',    t:'Pick one', html:bl('<b>Guess the Player / College</b> — from a stat line or a career path.', '<b>Grade Guess</b> — guess a player\'s OVR from his line; teaches the grade scale fast.', '<b>Higher or Lower</b> and <b>Rank \'Em</b> — order players by a stat.', '<b>Hoop Grid</b> — the tic-tac-toe of teams and accolades.') }
    ],
    'game.html': [
      { sel:'#content', t:'Box score', html:'One game in full.' + bl('The header has the final, the four factors for each side and the player of the game.', 'Each player\'s line, with his <b>game impact</b> — how much he swung the result, from his stats in that game.', 'Below: the flow of the game and the runs that decided it.') }
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
      { sel:'.controls', t:'Customize', d:'Pick a team to open its Lineup Lab: build your own five, adjust minutes, and see the projected lineup stats change.' },
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
      { sel:'#marketingHero', t:"Coach's Tier", html:'The tools built for a staff. Everything here <b>informs</b> — it surfaces what the numbers say so you can apply your own system; it never tells you how to coach.' + bl('<b>Scouting</b> — the opponent.', '<b>Self-Scout</b> — your own team as an analyst sees it.', '<b>Player Intelligence</b> — every player graded, projected and fitted.', '<b>Game Prep</b> — turning the numbers into a plan.', '<b>Betting Edge</b> — the same data pointed at the market.') },
      { sel:'#ccPick', t:'Pick your program', d:'Set the team you represent once. Every tool below opens with it already selected, and the command center fills with your schedule.' },
      { sel:'#ccSchedCard', t:'Command center', d:'Your next games, each with a one-click scouting report on that opponent.' },
      { sel:'#filters', t:'Find a tool', d:'Filter the hubs by need — an opponent tonight, your rotation, a player you are evaluating, a plan for the week.' },
      { sel:'#grid', t:'The hubs', d:'Flagship tools first, deeper dives folded underneath each one. "Open →" launches the tool with your team loaded.' }
    ],

    'scout.html': [
      { sel:'#selMe', t:'Opponent Scouting Report', d:'Pick your team and the opponent. The season switcher scouts any past season too — useful for a rematch.' },
      { sel:'#scoutStyle', t:'Their identity', html:'How the opponent plays, each number as a national percentile:' + bl(G.tempo, G.ff, G.ortg) },
      { sel:'#scoutScorers', t:'Their personnel', d:'Who scores and how: each player\'s projected line, his usage (the share of the offense that runs through him), his shot diet and where he is vulnerable defensively.' },
      { sel:'#scoutShotHost', t:'Where they shoot from', d:'The team shot chart: the spots they live on and the spots they avoid. The zone strip shows how far above or below the national average they shoot from each area.' },
      { sel:'#scoutShotProfile', t:'Shot profile', d:'The share of their shots at the rim, from mid-range and from three, and how efficient they are from each — where their points actually come from.' },
      { sel:'#scoutAttack', t:'Attack & neutralize', d:'The prep cards. "Attack" lists what the numbers say they are weak at — turnovers under pressure, defending the three, rebounding. "Neutralize" lists what they do best. They are observations for your staff to turn into a plan, not a play call.' },
      { sel:'#scoutGuardPlan', t:'Guarding their scorers', d:'For each of their main scorers: how he gets his points and which of your players project best against that style.' },
      { sel:'#scoutSituational', t:'Situations', d:'How they behave in close games, when they get out in transition, when the pace slows, in foul trouble — the situational identifiers built from twenty seasons of play-by-play.' },
      { sel:'#scoutMarch', t:'March profile', d:'Whether their statistical profile is the kind that holds up in the tournament or the kind that falls early.' },
      { sel:'#keyMatchups', t:'Key matchups', d:'Player-on-player at each spot: the projected edge, and why.' }
    ],

    'self-scout.html': [
      { sel:'#sel', t:'Self-Scout', d:'Pick your program. This is your own team seen the way an opposing analyst would see it.' },
      { sel:'#ssZoneHost', t:'Where you score', d:'Your projected shot zones — the share of your offense at the rim, from mid-range and from three, and how efficient each is. This is what an opponent will try to take away.' },
      { sel:'#ssRotHost', t:'Rotation', d:'Projected minutes and roles for every player, and where the rotation gets thin — the first place foul trouble or an injury hurts.' },
      { sel:'#ssLineupHost', t:'Lineups', d:'Your best five-man units by projected net rating, and the combinations to avoid.' },
      { sel:'#ssTeamSit', t:'Exposures', d:'The situations and matchups that expose you — pace, pressure, size — found before an opponent finds them.' }
    ],

    'matchup.html': [
      { sel:'#selA', t:'Projected Game Plan', d:'Pick both teams. The season switcher runs past matchups with the real rosters of that year.' },
      { sel:'#tabPredict', t:'The projection', html:bl(G.spread, '<b>Attack / neutralize keys</b> — for each side, where the four-factor and personnel edges are.', 'A projected box score for every player in this specific game.'), before:function(){ try{ mtab('predict'); }catch(e){} } },
      { sel:'#tabAdv', t:'Matchup advantage', d:'Player by player: where each man wins or loses his likely matchup, from his offensive profile against the defender\'s.', before:function(){ try{ mtab('adv'); }catch(e){} } }
    ],

    'dossier.html': [
      { sel:'#sel', t:'Player Dossier', d:'Pick any player on any roster.' },
      { sel:'#roster', t:'The roster', d:'Jump between teammates without leaving the page.' },
      { sel:'#out', t:'The dossier', html:'Everything a coach would want on one player:' + bl('<b>Projected line</b> — points, rebounds, assists, minutes for the coming season.', '<b>Situational identifiers</b> — pace sensitivity (better fast or slow?), pressure vulnerability (turnovers when pressed), foul risk, rotation volatility, matchup advantage. Built from twenty seasons of play-by-play.', '<b>Splits</b> — home/away, vs top teams, close games.', '<b>Form & availability</b> — recent trend and injury status.', '<b>Shot creation</b> — how he gets his shots: catch-and-shoot, off the dribble, at the rim.') }
    ],

    'predictive-profile.html': [
      { sel:'#sel', t:'Predictive Profile', d:'Pick any player.' },
      { sel:'#out', t:'The scouting book', d:'How to use him and how to attack him. Each identifier is a prediction, not a summary: whether he thrives when the game speeds up, whether pressure creates turnovers, whether he is likely to foul, how stable his minutes are, and which kind of defender gives him trouble.' }
    ],

    'lineups.html': [
      { sel:'#sel', t:'Lineup Recommender', d:'Pick the program and season.' },
      { sel:'#out', t:'The units', d:'Five-man units built from the projected rotation, ranked by the net rating (points per 100 possessions, scored minus allowed) each one projects to. Balance matters as much as talent: a unit with no spacing or no rim protection is marked down even if its five OVRs are high.' }
    ],

    'game-breakdown.html': [
      { sel:'#sel', t:'Game Breakdown', d:'Pick the program, then a game from its schedule.' },
      { sel:'#games', t:'The games', d:'Every game on the slate; click one.' },
      { sel:'#out', t:'The breakdown', html:bl('<b>Scoring flow</b> — the margin possession by possession, so you can see when the game was decided.', '<b>Runs</b> — the stretches that swung it and who was on the floor.', '<b>Top performers</b> — each player\'s line and his impact in that game.') }
    ],

    'game-review.html': [
      { sel:'#sel', t:'Game Review', d:'Pick the program and a game.' },
      { sel:'#out', t:'The autopsy', html:'A four-factor review of one game:' + bl(G.ff, 'Which factors you won and lost, against what the two teams usually do — the difference between "we shot badly" and "we got worse shots than usual".', 'What it says about the next game.') }
    ],

    'offense.html': [
      { sel:'#sel', t:'Offensive Profile', d:'Pick any program.' },
      { sel:'#out', t:'The profile', html:bl('<b>Coach identity</b> — how his offenses have played, historically.', '<b>Projected offensive DNA</b> — ' + G.ortg, 'Shot diet by zone (rim, mid-range, three) and by type (catch-and-shoot, off the dribble), and who carries each piece of it.') }
    ],

    'defense.html': [
      { sel:'#sel', t:'Defensive Profile', d:'Pick any program.' },
      { sel:'#out', t:'The profile', html:bl('<b>Projected defensive four factors</b> — opponents\' shooting, turnovers forced, defensive rebounding, fouls.', '<b>Rim protection</b> — who protects the rim (blocks, opponent finishing with him on the floor).', '<b>Who can be attacked</b> — the defenders opponents have scored on most efficiently.') }
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

    'cheatsheet.html': [
      { sel:'#statPills', t:'Betting Cheat Sheet', d:'Pick the prop market — points, rebounds, assists, threes.' },
      { sel:'#boardPills', t:'The board', html:bl('<b>Best player bets</b> — the props with the biggest gap between the projection and a typical line.', '<b>Value bets</b> — where the hit-rate over his own game logs is highest.', '<b>Team bets</b> — spreads and totals with an edge.') + 'Sortable, with a conference filter.' },
      { sel:'#teamAnglesSec', t:'Team angles', d:'ATS (against the spread) and over/under trends from twenty seasons of real closing lines — situations where teams have beaten the number more often than chance.' }
    ]
  };

  var STEPS = null, i = 0, W = null;
  function page(){ var p = (location.pathname.split('/').pop() || 'index.html'); return p === '' ? 'index.html' : p; }
  // first VISIBLE match of a comma list ("#heroRibbon, #heroMetrics" — whichever this season renders)
  function q(sel){ try { var parts = String(sel).split(','), first = null; for (var k = 0; k < parts.length; k++) { var el = document.querySelector(parts[k].trim()); if (!el) continue; if (visible(el)) return el; if (!first) first = el; } return first; } catch (e) { return null; } }
  function visible(el){ if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }

  function ensureDom(){
    if (W) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
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
  function place(){
    var el = STEPS[i] ? q(STEPS[i].sel) : null;
    if (STEPS[i] && (STEPS[i].tab || STEPS[i].before)) { prep(STEPS[i]); el = q(STEPS[i].sel); }
    var guard = 0;
    while (!visible(el) && i < STEPS.length - 1 && guard < STEPS.length) { i++; prep(STEPS[i]); el = q(STEPS[i].sel); guard++; }
    if (!visible(el)) { end(); return; }
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
      document.getElementById('tdcTourStep').textContent = 'Step ' + (i + 1) + ' of ' + STEPS.length;
      document.getElementById('tdcTourTitle').textContent = STEPS[i].t;
      var dsc = document.getElementById('tdcTourDesc'); if (STEPS[i].html) dsc.innerHTML = STEPS[i].html; else dsc.textContent = STEPS[i].d || '';
      W.querySelector('.tdc-tour-next').textContent = (i === STEPS.length - 1) ? 'Got it' : 'Next';
      document.getElementById('tdcTourDots').innerHTML = STEPS.map(function (_, k) { return '<span class="tdc-tour-dot' + (k === i ? ' on' : '') + '"></span>'; }).join('');
      var tip = document.getElementById('tdcTourTip'); var th = tip.offsetHeight || 160, tw = Math.min(380, window.innerWidth - 24);
      var bottom = sTop + sH;
      var top = bottom + 14; if (top + th > window.innerHeight - 12) top = Math.max(12, sTop - th - 14);
      if (top + th > window.innerHeight - 12 || top < 12) top = Math.max(12, Math.min(sTop + 24, window.innerHeight - th - 12));   // tall target: tip sits inside its top
      var left = Math.min(Math.max(12, r.left), window.innerWidth - tw - 12);
      tip.style.top = top + 'px'; tip.style.left = left + 'px';
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
    var b = document.createElement('button'); b.type = 'button'; b.className = 'tdc-explain'; b.setAttribute('aria-label', 'Explain this page');
    b.innerHTML = '<i>?</i><span>Explain this page</span>';
    b.addEventListener('click', function () { start(); });
    document.body.appendChild(b);
  }
  function boot(){ button(); }   // on demand only — the walkthrough never opens by itself
  if (document.readyState === 'complete') setTimeout(boot, 400); else window.addEventListener('load', function () { setTimeout(boot, 400); });
  g.TDCTour = { start: start, end: end, register: function (pg, steps) { TOURS[pg] = steps; if (pg === page()) button(); }, tours: TOURS };
})(window);
