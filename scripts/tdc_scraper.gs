// ═══════════════════════════════════════════════════════════════════════════════
// TDC MULTI-YEAR STATS SCRAPER — Google Apps Script
// Scrapes ESPN JSON API for every D1 team's roster + per-game stats.
// Uses ?season=YEAR on the roster endpoint so historical team assignments
// are correct (transfers show the right school for each season).
//
// HOW TO RUN:
//   1. Set SEASON_YEAR below to the season you want (2025 = 2024-25)
//   2. Run createTrigger() once — it fires scrapeStats() every 5 min automatically
//   3. Watch the Execution Log; it saves progress so it resumes after each timeout
//   4. When done, change SEASON_YEAR and run createTrigger() again for next season
//   5. To stop early: run deleteTriggers()
//   6. To restart a season from scratch: run resetProgress() then createTrigger()
//
// OUTPUT: Creates a sheet tab called "Stats 2025" (or whatever year)
// COLUMNS: Season | Team | Pos | Ht | Name | Yr |
//          PPG | RPG | APG | MPG | FGM | FGA | FG% |
//          3PM | 3PA | 3P% | FTM | FTA | FT% | OR | DR | STL | BLK | TO | GP
// ═══════════════════════════════════════════════════════════════════════════════

var SEASON_YEAR = 2025;   // ← change this per run (2025=2024-25, 2024=2023-24, etc.)
var DELAY_MS    = 400;    // ms between roster fetches
var STAT_DELAY  = 250;    // ms between per-player stat fetches

var HEADERS_ROW = [
  'Season','Team','Pos','Ht','Name','Yr',
  'PPG','RPG','APG','MPG',
  'FGM','FGA','FG%','3PM','3PA','3P%',
  'FTM','FTA','FT%','OR','DR',
  'STL','BLK','TO','GP'
];

var EXP_TO_YR = {'0':'Fr.','1':'So.','2':'Jr.','3':'Sr.','4':'Gr.','5':'Gr.'};

// ── Entry point ────────────────────────────────────────────────────────────────
function scrapeStats() {
  var ss        = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = 'Stats ' + SEASON_YEAR;
  var sheet     = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  var props     = PropertiesService.getScriptProperties();
  var key       = 'idx_' + SEASON_YEAR;

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS_ROW);
    sheet.setFrozenRows(1);
  }

  var startIdx = parseInt(props.getProperty(key) || '0');
  Logger.log('Resuming at team ' + startIdx + ' / ' + TEAMS.length);

  var start = Date.now();

  for (var i = startIdx; i < TEAMS.length; i++) {
    // Stop at 5 min so Apps Script doesn't hard-kill us before we save progress
    if (Date.now() - start > 300000) {
      props.setProperty(key, String(i));
      Logger.log('Time limit hit — saved at index ' + i + '. Trigger will continue automatically.');
      return;
    }

    var teamName = TEAMS[i][0];
    var espnId   = TEAMS[i][1];
    var players  = scrapeTeam(teamName, espnId, SEASON_YEAR);

    if (players.length > 0) {
      var rows = players.map(function(p) {
        return [
          p.season_year, p.team, p.position, p.height, p.name, p.yr,
          p.ppg, p.rpg, p.apg, p.mpg,
          p.fgm, p.fga, p.fg_pct, p.tpm, p.tpa, p.tp_pct,
          p.ftm, p.fta, p.ft_pct, p.oreb, p.dreb,
          p.stl, p.blk, p.tovs, p.gp
        ];
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
           .setValues(rows);
    }

    Logger.log('[' + (i + 1) + '/' + TEAMS.length + '] ' + teamName + ': ' + players.length + ' players');
    Utilities.sleep(DELAY_MS);
  }

  // All teams done for this season
  props.deleteProperty(key);
  deleteTriggers();
  Logger.log('✓ Season ' + SEASON_YEAR + ' complete! ' + (sheet.getLastRow() - 1) + ' players in sheet.');
}

// ── Scrape one team ────────────────────────────────────────────────────────────
function scrapeTeam(teamName, espnId, year) {
  var rosterUrl = 'https://site.api.espn.com/apis/site/v2/sports/basketball'
                + '/mens-college-basketball/teams/' + espnId
                + '/roster?season=' + year;

  var rosterData = fetchJson(rosterUrl);
  if (!rosterData || !rosterData.athletes) return [];

  var players = [];

  for (var j = 0; j < rosterData.athletes.length; j++) {
    var p = rosterData.athletes[j];
    if (!p.id || !p.fullName) continue;

    var ht  = p.height ? Math.floor(p.height / 12) + '-' + (p.height % 12) : '';
    var pos = (p.position && p.position.abbreviation) ? p.position.abbreviation : '';
    var exp = (p.experience && p.experience.years != null) ? String(p.experience.years) : '0';
    var yr  = EXP_TO_YR[exp] || 'Fr.';

    Utilities.sleep(STAT_DELAY);

    var statsUrl = 'https://sports.core.api.espn.com/v2/sports/basketball'
                 + '/leagues/mens-college-basketball/seasons/' + year
                 + '/types/2/athletes/' + p.id + '/statistics/0';

    var s = flattenStats(fetchJson(statsUrl));

    players.push({
      season_year : year,
      team        : teamName,
      position    : pos,
      height      : ht,
      name        : p.fullName,
      yr          : yr,
      ppg         : r1(s.avgPoints),
      rpg         : r1(s.avgRebounds),
      apg         : r1(s.avgAssists),
      mpg         : r1(s.avgMinutes),
      fgm         : r1(s.avgFieldGoalsMade),
      fga         : r1(s.avgFieldGoalsAttempted),
      fg_pct      : r1(s.fieldGoalPct),
      tpm         : r1(s.avgThreePointFieldGoalsMade),
      tpa         : r1(s.avgThreePointFieldGoalsAttempted),
      tp_pct      : r1(s.threePointFieldGoalPct),
      ftm         : r1(s.avgFreeThrowsMade),
      fta         : r1(s.avgFreeThrowsAttempted),
      ft_pct      : r1(s.freeThrowPct),
      oreb        : r1(s.avgOffensiveRebounds),
      dreb        : r1(s.avgDefensiveRebounds),
      stl         : r1(s.avgSteals),
      blk         : r1(s.avgBlocks),
      tovs        : r1(s.avgTurnovers),
      gp          : s.gamesPlayed || null
    });
  }

  return players;
}

// ── JSON fetch helper ──────────────────────────────────────────────────────────
function fetchJson(url) {
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    return JSON.parse(resp.getContentText());
  } catch(e) {
    return null;
  }
}

// ── Flatten ESPN stats categories into a flat key→value object ─────────────────
function flattenStats(data) {
  var out = {};
  if (!data || !data.splits) return out;
  (data.splits.categories || []).forEach(function(cat) {
    (cat.stats || []).forEach(function(st) {
      out[st.name] = st.value;
    });
  });
  return out;
}

function r1(v) {
  var n = parseFloat(v);
  return isNaN(n) ? null : Math.round(n * 10) / 10;
}

// ── Trigger management ─────────────────────────────────────────────────────────
function createTrigger() {
  deleteTriggers();
  ScriptApp.newTrigger('scrapeStats').timeBased().everyMinutes(5).create();
  Logger.log('Trigger created. scrapeStats() will fire every 5 minutes until complete.');
}

function deleteTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
}

function resetProgress() {
  PropertiesService.getScriptProperties().deleteProperty('idx_' + SEASON_YEAR);
  Logger.log('Progress reset for season ' + SEASON_YEAR + '. Run createTrigger() to start fresh.');
}

// ── Full D1 team list (362 programs) ──────────────────────────────────────────
var TEAMS = [
  ['Abilene Christian Wildcats', 2000],
  ['Air Force Falcons', 2005],
  ['Akron Zips', 2006],
  ['Alabama A&M Bulldogs', 2010],
  ['Alabama Crimson Tide', 333],
  ['Alabama State Hornets', 2011],
  ['Alcorn State Braves', 2016],
  ['American University Eagles', 44],
  ['App State Mountaineers', 2026],
  ['Arizona State Sun Devils', 9],
  ['Arizona Wildcats', 12],
  ['Arkansas Razorbacks', 8],
  ['Arkansas State Red Wolves', 2032],
  ['Arkansas-Pine Bluff Golden Lions', 2029],
  ['Army Black Knights', 349],
  ['Auburn Tigers', 2],
  ['Austin Peay Governors', 2046],
  ['BYU Cougars', 252],
  ['Ball State Cardinals', 2050],
  ['Baylor Bears', 239],
  ['Bellarmine Knights', 91],
  ['Belmont Bruins', 2057],
  ['Bethune-Cookman Wildcats', 2065],
  ['Binghamton Bearcats', 2066],
  ['Boise State Broncos', 68],
  ['Boston College Eagles', 103],
  ['Boston University Terriers', 104],
  ['Bowling Green Falcons', 189],
  ['Bradley Braves', 71],
  ['Brown Bears', 225],
  ['Bryant Bulldogs', 2803],
  ['Bucknell Bison', 2083],
  ['Buffalo Bulls', 2084],
  ['Butler Bulldogs', 2086],
  ['Cal Poly Mustangs', 13],
  ['Cal State Bakersfield Roadrunners', 2934],
  ['Cal State Fullerton Titans', 2239],
  ['Cal State Northridge Matadors', 2463],
  ['California Baptist Lancers', 2856],
  ['California Golden Bears', 25],
  ['Campbell Fighting Camels', 2097],
  ['Canisius Golden Griffins', 2099],
  ['Central Arkansas Bears', 2110],
  ['Central Connecticut Blue Devils', 2115],
  ['Central Michigan Chippewas', 2117],
  ['Charleston Cougars', 232],
  ['Charleston Southern Buccaneers', 2127],
  ['Charlotte 49ers', 2429],
  ['Chattanooga Mocs', 236],
  ['Chicago State Cougars', 2130],
  ['Cincinnati Bearcats', 2132],
  ['Clemson Tigers', 228],
  ['Cleveland State Vikings', 325],
  ['Coastal Carolina Chanticleers', 324],
  ['Colgate Raiders', 2142],
  ['Colorado Buffaloes', 38],
  ['Colorado State Rams', 36],
  ['Columbia Lions', 171],
  ['Coppin State Eagles', 2154],
  ['Cornell Big Red', 172],
  ['Creighton Bluejays', 156],
  ['Dartmouth Big Green', 159],
  ['Davidson Wildcats', 2166],
  ['Dayton Flyers', 2168],
  ['DePaul Blue Demons', 305],
  ['Delaware Blue Hens', 48],
  ['Delaware State Hornets', 2169],
  ['Denver Pioneers', 2172],
  ['Detroit Mercy Titans', 2174],
  ['Drake Bulldogs', 2181],
  ['Drexel Dragons', 2182],
  ['Duke Blue Devils', 150],
  ['Duquesne Dukes', 2184],
  ['East Carolina Pirates', 151],
  ['East Tennessee State Buccaneers', 2193],
  ['East Texas A&M Lions', 2837],
  ['Eastern Illinois Panthers', 2197],
  ['Eastern Kentucky Colonels', 2198],
  ['Eastern Michigan Eagles', 2199],
  ['Eastern Washington Eagles', 331],
  ['Elon Phoenix', 2210],
  ['Evansville Purple Aces', 339],
  ['Fairfield Stags', 2217],
  ['Fairleigh Dickinson Knights', 161],
  ['Florida A&M Rattlers', 50],
  ['Florida Atlantic Owls', 2226],
  ['Florida Gators', 57],
  ['Florida Gulf Coast Eagles', 526],
  ['Florida International Panthers', 2229],
  ['Florida State Seminoles', 52],
  ['Fordham Rams', 2230],
  ['Fresno State Bulldogs', 278],
  ['Furman Paladins', 231],
  ['Gardner-Webb Runnin Bulldogs', 2241],
  ['George Mason Patriots', 2244],
  ['George Washington Revolutionaries', 45],
  ['Georgetown Hoyas', 46],
  ['Georgia Bulldogs', 61],
  ['Georgia Southern Eagles', 290],
  ['Georgia State Panthers', 2247],
  ['Georgia Tech Yellow Jackets', 59],
  ['Gonzaga Bulldogs', 2250],
  ['Grambling Tigers', 2755],
  ['Grand Canyon Lopes', 2253],
  ['Green Bay Phoenix', 2739],
  ['Hampton Pirates', 2261],
  ['Harvard Crimson', 108],
  ['Hawaii Rainbow Warriors', 62],
  ['High Point Panthers', 2272],
  ['Hofstra Pride', 2275],
  ['Holy Cross Crusaders', 107],
  ['Houston Christian Huskies', 2277],
  ['Houston Cougars', 248],
  ['Howard Bison', 47],
  ['IU Indianapolis Jaguars', 85],
  ['Idaho State Bengals', 304],
  ['Idaho Vandals', 70],
  ['Illinois Fighting Illini', 356],
  ['Illinois State Redbirds', 2287],
  ['Incarnate Word Cardinals', 2916],
  ['Indiana Hoosiers', 84],
  ['Indiana State Sycamores', 282],
  ['Iona Gaels', 314],
  ['Iowa Hawkeyes', 2294],
  ['Iowa State Cyclones', 66],
  ['Jackson State Tigers', 2296],
  ['Jacksonville Dolphins', 294],
  ['Jacksonville State Gamecocks', 55],
  ['James Madison Dukes', 256],
  ['Kansas City Roos', 140],
  ['Kansas Jayhawks', 2305],
  ['Kansas State Wildcats', 2306],
  ['Kennesaw State Owls', 338],
  ['Kent State Golden Flashes', 2309],
  ['Kentucky Wildcats', 96],
  ['LSU Tigers', 99],
  ['La Salle Explorers', 2325],
  ['Lafayette Leopards', 322],
  ['Lamar Cardinals', 2320],
  ['Le Moyne Dolphins', 2330],
  ['Lehigh Mountain Hawks', 2329],
  ['Liberty Flames', 2335],
  ['Lipscomb Bisons', 288],
  ['Little Rock Trojans', 2031],
  ['Long Beach State Beach', 299],
  ['Long Island University Sharks', 112358],
  ['Longwood Lancers', 2344],
  ['Louisiana Ragin Cajuns', 309],
  ['Louisiana Tech Bulldogs', 2348],
  ['Louisville Cardinals', 97],
  ['Loyola Chicago Ramblers', 2350],
  ['Loyola Maryland Greyhounds', 2352],
  ['Loyola Marymount Lions', 2351],
  ['Maine Black Bears', 311],
  ['Manhattan Jaspers', 2363],
  ['Marist Red Foxes', 2368],
  ['Marquette Golden Eagles', 269],
  ['Marshall Thundering Herd', 276],
  ['Maryland Eastern Shore Hawks', 2379],
  ['Maryland Terrapins', 120],
  ['Massachusetts Minutemen', 113],
  ['McNeese Cowboys', 2377],
  ['Memphis Tigers', 235],
  ['Mercer Bears', 2382],
  ['Mercyhurst Lakers', 2385],
  ['Merrimack Warriors', 2771],
  ['Miami OH RedHawks', 193],
  ['Miami Hurricanes', 2390],
  ['Michigan State Spartans', 127],
  ['Michigan Wolverines', 130],
  ['Middle Tennessee Blue Raiders', 2393],
  ['Milwaukee Panthers', 270],
  ['Minnesota Golden Gophers', 135],
  ['Mississippi State Bulldogs', 344],
  ['Mississippi Valley State Delta Devils', 2400],
  ['Missouri State Bears', 2623],
  ['Missouri Tigers', 142],
  ['Monmouth Hawks', 2405],
  ['Montana Grizzlies', 149],
  ['Montana State Bobcats', 147],
  ['Morehead State Eagles', 2413],
  ['Morgan State Bears', 2415],
  ['Mount St Marys Mountaineers', 116],
  ['Murray State Racers', 93],
  ['NC State Wolfpack', 152],
  ['NJIT Highlanders', 2885],
  ['Navy Midshipmen', 2426],
  ['Nebraska Cornhuskers', 158],
  ['Nevada Wolf Pack', 2440],
  ['New Hampshire Wildcats', 160],
  ['New Haven Chargers', 2441],
  ['New Mexico Lobos', 167],
  ['New Mexico State Aggies', 166],
  ['New Orleans Privateers', 2443],
  ['Niagara Purple Eagles', 315],
  ['Nicholls Colonels', 2447],
  ['Norfolk State Spartans', 2450],
  ['North Alabama Lions', 2453],
  ['North Carolina AT Aggies', 2448],
  ['North Carolina Central Eagles', 2428],
  ['North Carolina Tar Heels', 153],
  ['North Dakota Fighting Hawks', 155],
  ['North Dakota State Bison', 2449],
  ['North Florida Ospreys', 2454],
  ['North Texas Mean Green', 249],
  ['Northeastern Huskies', 111],
  ['Northern Arizona Lumberjacks', 2464],
  ['Northern Colorado Bears', 2458],
  ['Northern Illinois Huskies', 2459],
  ['Northern Iowa Panthers', 2460],
  ['Northern Kentucky Norse', 94],
  ['Northwestern State Demons', 2466],
  ['Northwestern Wildcats', 77],
  ['Notre Dame Fighting Irish', 87],
  ['Oakland Golden Grizzlies', 2473],
  ['Ohio Bobcats', 195],
  ['Ohio State Buckeyes', 194],
  ['Oklahoma Sooners', 201],
  ['Oklahoma State Cowboys', 197],
  ['Old Dominion Monarchs', 295],
  ['Ole Miss Rebels', 145],
  ['Omaha Mavericks', 2437],
  ['Oral Roberts Golden Eagles', 198],
  ['Oregon Ducks', 2483],
  ['Oregon State Beavers', 204],
  ['Pacific Tigers', 279],
  ['Penn State Nittany Lions', 213],
  ['Pennsylvania Quakers', 219],
  ['Pepperdine Waves', 2492],
  ['Pittsburgh Panthers', 221],
  ['Portland Pilots', 2501],
  ['Portland State Vikings', 2502],
  ['Prairie View AM Panthers', 2504],
  ['Presbyterian Blue Hose', 2506],
  ['Princeton Tigers', 163],
  ['Providence Friars', 2507],
  ['Purdue Boilermakers', 2509],
  ['Purdue Fort Wayne Mastodons', 2870],
  ['Quinnipiac Bobcats', 2514],
  ['Radford Highlanders', 2515],
  ['Rhode Island Rams', 227],
  ['Rice Owls', 242],
  ['Richmond Spiders', 257],
  ['Rider Broncs', 2520],
  ['Robert Morris Colonials', 2523],
  ['Rutgers Scarlet Knights', 164],
  ['SE Louisiana Lions', 2545],
  ['SIU Edwardsville Cougars', 2565],
  ['SMU Mustangs', 2567],
  ['Sacramento State Hornets', 16],
  ['Sacred Heart Pioneers', 2529],
  ['Saint Francis Red Flash', 2598],
  ['Saint Josephs Hawks', 2603],
  ['Saint Louis Billikens', 139],
  ['Saint Marys Gaels', 2608],
  ['Saint Peters Peacocks', 2612],
  ['Sam Houston Bearkats', 2534],
  ['Samford Bulldogs', 2535],
  ['San Diego State Aztecs', 21],
  ['San Diego Toreros', 301],
  ['San Francisco Dons', 2539],
  ['San Jose State Spartans', 23],
  ['Santa Clara Broncos', 2541],
  ['Seattle U Redhawks', 2547],
  ['Seton Hall Pirates', 2550],
  ['Siena Saints', 2561],
  ['South Alabama Jaguars', 6],
  ['South Carolina Gamecocks', 2579],
  ['South Carolina State Bulldogs', 2569],
  ['South Carolina Upstate Spartans', 2908],
  ['South Dakota Coyotes', 233],
  ['South Dakota State Jackrabbits', 2571],
  ['South Florida Bulls', 58],
  ['Southeast Missouri State Redhawks', 2546],
  ['Southern Illinois Salukis', 79],
  ['Southern Jaguars', 2582],
  ['Southern Miss Golden Eagles', 2572],
  ['Southern Utah Thunderbirds', 253],
  ['St Bonaventure Bonnies', 179],
  ['St Johns Red Storm', 2599],
  ['St Thomas-Minnesota Tommies', 2900],
  ['Stanford Cardinal', 24],
  ['Stephen F Austin Lumberjacks', 2617],
  ['Stetson Hatters', 56],
  ['Stonehill Skyhawks', 284],
  ['Stony Brook Seawolves', 2619],
  ['Syracuse Orange', 183],
  ['TCU Horned Frogs', 2628],
  ['Tarleton State Texans', 2627],
  ['Temple Owls', 218],
  ['Tennessee State Tigers', 2634],
  ['Tennessee Tech Golden Eagles', 2635],
  ['Tennessee Volunteers', 2633],
  ['Texas AM Aggies', 245],
  ['Texas AM-Corpus Christi Islanders', 357],
  ['Texas Longhorns', 251],
  ['Texas Southern Tigers', 2640],
  ['Texas State Bobcats', 326],
  ['Texas Tech Red Raiders', 2641],
  ['The Citadel Bulldogs', 2643],
  ['Toledo Rockets', 2649],
  ['Towson Tigers', 119],
  ['Troy Trojans', 2653],
  ['Tulane Green Wave', 2655],
  ['Tulsa Golden Hurricane', 202],
  ['UAB Blazers', 5],
  ['UAlbany Great Danes', 399],
  ['UC Davis Aggies', 302],
  ['UC Irvine Anteaters', 300],
  ['UC Riverside Highlanders', 27],
  ['UC San Diego Tritons', 28],
  ['UC Santa Barbara Gauchos', 2540],
  ['UCF Knights', 2116],
  ['UCLA Bruins', 26],
  ['UConn Huskies', 41],
  ['UIC Flames', 82],
  ['UL Monroe Warhawks', 2433],
  ['UMBC Retrievers', 2378],
  ['UMass Lowell River Hawks', 2349],
  ['UNC Asheville Bulldogs', 2427],
  ['UNC Greensboro Spartans', 2430],
  ['UNC Wilmington Seahawks', 350],
  ['UNLV Rebels', 2439],
  ['USC Trojans', 30],
  ['UT Arlington Mavericks', 250],
  ['UT Martin Skyhawks', 2630],
  ['UT Rio Grande Valley Vaqueros', 292],
  ['UTEP Miners', 2638],
  ['UTSA Roadrunners', 2636],
  ['Utah State Aggies', 328],
  ['Utah Tech Trailblazers', 3101],
  ['Utah Utes', 254],
  ['Utah Valley Wolverines', 3084],
  ['VCU Rams', 2670],
  ['VMI Keydets', 2678],
  ['Valparaiso Beacons', 2674],
  ['Vanderbilt Commodores', 238],
  ['Vermont Catamounts', 261],
  ['Villanova Wildcats', 222],
  ['Virginia Cavaliers', 258],
  ['Virginia Tech Hokies', 259],
  ['Wagner Seahawks', 2681],
  ['Wake Forest Demon Deacons', 154],
  ['Washington Huskies', 264],
  ['Washington State Cougars', 265],
  ['Weber State Wildcats', 2692],
  ['West Georgia Wolves', 2698],
  ['West Virginia Mountaineers', 277],
  ['Western Carolina Catamounts', 2717],
  ['Western Illinois Leathernecks', 2710],
  ['Western Kentucky Hilltoppers', 98],
  ['Western Michigan Broncos', 2711],
  ['Wichita State Shockers', 2724],
  ['William Mary Tribe', 2729],
  ['Winthrop Eagles', 2737],
  ['Wisconsin Badgers', 275],
  ['Wofford Terriers', 2747],
  ['Wright State Raiders', 2750],
  ['Wyoming Cowboys', 2751],
  ['Xavier Musketeers', 2752],
  ['Yale Bulldogs', 43],
  ['Youngstown State Penguins', 2754]
];
