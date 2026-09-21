/* tdc-teamname.js — ONE display name per team: the roster sheet's short name.
 *
 * Three spellings of the same program live in the data:
 *   sheet / teams table / team.html key : "UConn", "NC-State", "Ole Miss", "Oregon"
 *   player_history (Sports-Reference)    : "Connecticut", "North Carolina State", "Mississippi", "Oregon"
 *   player_advanced / box_scores (ESPN)  : "UConn Huskies", "NC State Wolfpack", "Ole Miss Rebels", "Oregon Ducks"
 * Everything the reader sees should be the first one. TDCTeamName.short() resolves any of the
 * three to it, synchronously:
 *   1. a rostered team's sheet short, via the ratings short<->full map once installed
 *      (TDCTeamName.install / TDC_RATINGS) — "NC State Wolfpack" -> "NC-State", "Florida Atlantic Owls" -> "FAU"
 *   2. the Sports-Reference spelling cleaned up — "Nevada-Las Vegas" -> "UNLV", "Loyola (IL)" -> "Loyola Chicago"
 *   3. the ESPN full name minus its mascot — "Illinois Fighting Illini" -> "Illinois", "St. John's Red Storm" -> "St. John's"
 * TDCTeamName.fix(rows) rewrites row.team in place for a fetched player_history list.
 * Load before tdc-owned-seasons.js on pages that use it; standalone on the history-reading pages.
 */
(function (g) {
  // Sports-Reference spellings whose short form isn't the SR name minus a "(XX)" tag — targets
  // spelled the way the SHEET spells them (the team.html key)
  var SR2SHORT = { 'nevada-las vegas': 'UNLV', 'connecticut': 'UConn', 'brigham young': 'BYU', 'louisiana state': 'LSU',
    'southern california': 'USC', 'texas christian': 'TCU', 'southern methodist': 'SMU', 'virginia commonwealth': 'VCU',
    'north carolina state': 'NC-State', 'nc state': 'NC-State', 'mississippi': 'Ole Miss', 'central florida': 'UCF',
    'alabama-birmingham': 'UAB', 'massachusetts': 'UMass', 'massachusetts-lowell': 'UMass Lowell', 'loyola (il)': 'Loyola Chicago',
    'loyola (md)': 'Loyola Maryland', 'texas-san antonio': 'UTSA', 'maryland-baltimore county': 'UMBC', 'maryland-eastern shore': 'Maryland Eastern Shore',
    'texas-el paso': 'UTEP', 'texas-arlington': 'UT Arlington', 'illinois-chicago': 'UIC', 'penn': 'Penn', 'pennsylvania': 'Penn',
    'southern mississippi': 'Southern Miss', 'louisiana-monroe': 'UL Monroe', 'arkansas-little rock': 'Little Rock',
    'purdue-fort wayne': 'Purdue Fort Wayne', 'iupui': 'IU Indianapolis', 'houston baptist': 'Houston Christian',
    'cal state long beach': 'Long Beach State', 'albany (ny)': 'UAlbany', 'texas-rio grande valley': 'UT Rio Grande Valley',
    'nebraska-omaha': 'Omaha', 'detroit': 'Detroit Mercy', 'st. francis (pa)': 'Saint Francis', 'saint francis (pa)': 'Saint Francis',
    'st. francis (ny)': 'St. Francis Brooklyn', 'southern illinois-edwardsville': 'SIU Edwardsville', 'tennessee-martin': 'UT Martin',
    'appalachian state': 'App State', 'hawaii': "Hawai'i", 'san jose state': 'San José State', 'pitt': 'Pittsburgh',
    'college of charleston': 'Charleston', 'charleston (sc)': 'Charleston', 'east carolina': 'ECU', 'florida atlantic': 'FAU',
    'miami (fl)': 'Miami', "st. john's (ny)": "St. John's", 'texas a&m-corpus christi': 'Texas A&M-Corpus Christi',
    'arkansas-pine bluff': 'Arkansas-Pine Bluff', 'queens (nc)': 'Queens', 'ut martin': 'UT Martin', 'ole miss': 'Ole Miss',
    'unlv': 'UNLV', 'uconn': 'UConn' };
  // ESPN mascots: drop the last word, then a leading mascot modifier ("Golden Gophers", "Red Storm")
  var MOD = /^(blue|red|golden|fighting|rainbow|ragin'|mean|runnin'|delta|scarlet|crimson|black|green|purple|yellow|demon|horned|big|great|thundering|screaming|sun|tar|river|mountain|wolf|white|orange|silver|flying|lady|mighty|nittany|ramblin'|fightin'|jumbo)$/;
  // when prefix-matching a short against a full name, the leftover must be a mascot, not a sibling school
  var MARK = /\b(state|christian|baptist|southern|atlantic|international|wesleyan|a&m|a&t|tech|valley|central|northern|western|eastern|of|st|college)\b/;

  var M = { full2s: {}, shorts: [] };   // installed map: lower(full|short) -> sheet short
  function install(teams) {
    // teams: [{team: short, full: espnFull}] (predictive_ratings shape) or [{name: short}] (teams table)
    (teams || []).forEach(function (t) {
      if (!t) return;
      var s = t.team || t.name, f = t.full;
      if (!s || (f && f === s)) return;            // un-rostered teams carry the full name in both — no short to learn
      if (M.shorts.indexOf(s) < 0) M.shorts.push(s);
      M.full2s[String(s).toLowerCase()] = s;
      if (f) M.full2s[String(f).toLowerCase()] = s;
    });
  }
  function stripMascot(full) {
    var w = String(full || '').trim().split(/\s+/);
    if (w.length < 2) return full;
    w.pop();
    if (w.length > 1 && MOD.test(w[w.length - 1].toLowerCase())) w.pop();
    return w.join(' ');
  }
  function srShort(sr) {
    if (!sr) return null;
    var lo = String(sr).toLowerCase().trim();
    if (SR2SHORT[lo]) return SR2SHORT[lo];
    return String(sr).replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();   // "Saint Mary's (CA)" -> "Saint Mary's"
  }
  // (espnFull, srName) -> sheet short. Pass each name in ITS slot: an SR spelling is never
  // mascot-stripped ("Weber State" must stay "Weber State"), an ESPN full always is.
  function short(espnFull, srName) {
    var cands = [espnFull, srName].filter(Boolean);
    if (!cands.length) return null;
    for (var c = 0; c < cands.length; c++) {
      var lo = String(cands[c]).toLowerCase().trim();
      if (M.full2s[lo]) return M.full2s[lo];
      if (SR2SHORT[lo]) return SR2SHORT[lo];
    }
    if (espnFull) {
      var lo2 = String(espnFull).toLowerCase().trim(), best = null;
      M.shorts.forEach(function (s) { var sl = s.toLowerCase(); if (lo2.indexOf(sl + ' ') === 0) { var rest = lo2.slice(sl.length + 1); if (!MARK.test(rest) && (!best || s.length > best.length)) best = s; } });
      if (best) return best;
    }
    if (srName) return srShort(srName);
    return srShort(stripMascot(espnFull));
  }
  function fix(rows, key) { key = key || 'team'; (rows || []).forEach(function (r) { if (r && r[key]) { var s = short(null, r[key]); if (s) r[key] = s; } }); return rows; }

  var _readyP = null;
  function ready() {
    if (_readyP) return _readyP;
    _readyP = (g.TDC_RATINGS && g.TDC_RATINGS.get)
      ? g.TDC_RATINGS.get().then(function (d) { install((d && d.teams) || []); return true; }).catch(function () { return false; })
      : Promise.resolve(false);
    return _readyP;
  }
  g.TDCTeamName = { short: short, fix: fix, install: install, ready: ready, stripMascot: stripMascot, srShort: srShort, _map: M };
})(window);
