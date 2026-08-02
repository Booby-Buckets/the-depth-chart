// ============================================================
// THE DEPTH CHART — Google Sheet → Supabase Sync
// ============================================================
//
// This is the version-controlled REFERENCE copy of the Google Apps Script
// that lives in the roster spreadsheet (Extensions → Apps Script).
// Edit here, then paste into the Apps Script editor to deploy.
//
// ⚠️ SECURITY: SUPABASE_KEY below is a PLACEHOLDER on purpose. The live
// script must use the Supabase **legacy service_role** JWT key (Settings →
// API Keys → "Legacy anon, service_role API keys" tab → service_role).
// NEVER commit the real key to this repo — it bypasses RLS and the repo is
// public. Paste the real key only into the Apps Script editor.
//
// Why legacy service_role (not the new sb_secret_ key): now that RLS is
// enforced, writes need a privileged key. The new-format sb_secret_ keys
// reject browser-originated requests, and Apps Script's UrlFetchApp sends a
// Mozilla user-agent that trips that guard (you cannot override the UA in
// Apps Script). The legacy JWT service_role key has no such guard.
// ============================================================

const SUPABASE_URL = 'https://izlqhnxowdhtdofkwrho.supabase.co';
const SUPABASE_KEY = 'PASTE_LEGACY_SERVICE_ROLE_JWT_HERE';   // eyJ... (legacy service_role) — DO NOT COMMIT THE REAL KEY

// Tab name in spreadsheet → conference code stored in DB
const CONF_TABS = {
  'ACC':      'ACC',
  'B10':      'B10',
  'BIG-12':   'BIG-12',
  'Big-East': 'Big-East',
  'SEC':      'SEC',
  'PAC-12':   'PAC-12',
  'A10':      'A10',
  'AAC':      'AAC',
};

// Column indexes in roster sheets (0-based)
const COL = {
  POS:    2,   // C  — Position (may be "PG/SG")
  HT:     3,   // D  — Height
  NAME:   4,   // E  — Player name (* = returning starter, + = addition)
  FROM:   5,   // F  — Transfer origin school OR year if no transfer
  YR:     6,   // G  — Class year
  PPG:    7,   // H
  RPG:    8,   // I
  APG:    9,   // J
  MPG:    10,  // K
  FGM:    11,  // L
  FGA:    12,  // M
  FG_PCT: 13,  // N
  TPM:    14,  // O  — 3PM
  TPA:    15,  // P  — 3PA
  TP_PCT: 16,  // Q
  FTA:    17,  // R
  FTM:    18,  // S
  FT_PCT: 19,  // T
  OREB:   20,  // U
  DREB:   21,  // V
  STL:    22,  // W
  BLK:    23,  // X
  TOV:    24,  // Y
  GP:     30,  // AE
  FLAGS:  31,  // AF — 🌍 🏥 emoji flags
  GRADE:  32,  // AG — TDC grade
};

// Valid positions — anything else passes through as-is
const POS_MAP = { PG:'PG', SG:'SG', CG:'CG', SF:'SF', PF:'PF', C:'C' };

const TEAM_COLORS = {
  "Clemson":{"color":"#F66733","color2":"#522D80","rgb":"246,103,51"},
  "Miami":{"color":"#F47321","color2":"#005030","rgb":"244,115,33"},
  "Duke":{"color":"#003087","color2":"#001a4e","rgb":"0,48,135"},
  "Notre Dame":{"color":"#0C2340","color2":"#AE9142","rgb":"12,35,64"},
  "North Carolina":{"color":"#4B9CD3","color2":"#13294B","rgb":"75,156,211"},
  "Virginia":{"color":"#232D4B","color2":"#F84C1E","rgb":"35,45,75"},
  "SMU":{"color":"#0033A0","color2":"#C8102E","rgb":"0,51,160"},
  "Stanford":{"color":"#8C1515","color2":"#2E2D29","rgb":"140,21,21"},
  "Florida State":{"color":"#782F40","color2":"#CEB888","rgb":"120,47,64"},
  "Louisville":{"color":"#AD0000","color2":"#000000","rgb":"173,0,0"},
  "Wake Forest":{"color":"#9E7E38","color2":"#000000","rgb":"158,126,56"},
  "NC State":{"color":"#CC0000","color2":"#231F20","rgb":"204,0,0"},
  "Boston College":{"color":"#8B0000","color2":"#A4813A","rgb":"139,0,0"},
  "California":{"color":"#003262","color2":"#FDB515","rgb":"0,50,98"},
  "Syracuse":{"color":"#D44500","color2":"#000E54","rgb":"212,69,0"},
  "Pittsburgh":{"color":"#003594","color2":"#FFB81C","rgb":"0,53,148"},
  "Georgia Tech":{"color":"#B3A369","color2":"#003057","rgb":"179,163,105"},
  "Virginia Tech":{"color":"#CF4420","color2":"#630031","rgb":"207,68,32"},
  "Michigan":{"color":"#00274C","color2":"#FFCB05","rgb":"0,39,76"},
  "Northwestern":{"color":"#4E2A84","color2":"#000000","rgb":"78,42,132"},
  "Oregon":{"color":"#154733","color2":"#FEE123","rgb":"21,71,51"},
  "Michigan State":{"color":"#18453B","color2":"#FFFFFF","rgb":"24,69,59"},
  "Purdue":{"color":"#CEB888","color2":"#000000","rgb":"206,184,136"},
  "Nebraska":{"color":"#E41C38","color2":"#000000","rgb":"228,28,56"},
  "USC":{"color":"#990000","color2":"#FFC72C","rgb":"153,0,0"},
  "Illinois":{"color":"#E84A27","color2":"#13294B","rgb":"232,74,39"},
  "UCLA":{"color":"#2D68C4","color2":"#F2A900","rgb":"45,104,196"},
  "Wisconsin":{"color":"#C5050C","color2":"#FFFFFF","rgb":"197,5,12"},
  "Ohio State":{"color":"#BA0C2F","color2":"#FFFFFF","rgb":"186,12,47"},
  "Iowa":{"color":"#FFCD00","color2":"#000000","rgb":"255,205,0"},
  "Indiana":{"color":"#990000","color2":"#FFFFFF","rgb":"153,0,0"},
  "Maryland":{"color":"#E03A3E","color2":"#FFD520","rgb":"224,58,62"},
  "Minnesota":{"color":"#7A0019","color2":"#FFD700","rgb":"122,0,25"},
  "Washington":{"color":"#4B2E83","color2":"#B7A57A","rgb":"75,46,131"},
  "Penn State":{"color":"#1E407C","color2":"#FFFFFF","rgb":"30,64,124"},
  "Rutgers":{"color":"#CC0033","color2":"#FFFFFF","rgb":"204,0,51"},
  "Texas Tech":{"color":"#CC0000","color2":"#000000","rgb":"204,0,0"},
  "Houston":{"color":"#C8102E","color2":"#63666A","rgb":"200,16,46"},
  "BYU":{"color":"#002469","color2":"#FFFFFF","rgb":"0,36,105"},
  "Arizona":{"color":"#CC0033","color2":"#003366","rgb":"204,0,51"},
  "Iowa State":{"color":"#C8102E","color2":"#F1BE48","rgb":"200,16,46"},
  "Oklahoma State":{"color":"#FF7300","color2":"#000000","rgb":"255,115,0"},
  "Baylor":{"color":"#003015","color2":"#FFB81C","rgb":"0,48,21"},
  "Colorado":{"color":"#CFB87C","color2":"#000000","rgb":"207,184,124"},
  "Kansas State":{"color":"#512888","color2":"#FFFFFF","rgb":"81,40,136"},
  "UCF":{"color":"#000000","color2":"#FFC904","rgb":"0,0,0"},
  "TCU":{"color":"#4D1979","color2":"#A3A9AC","rgb":"77,25,121"},
  "Arizona State":{"color":"#8C1D40","color2":"#FFC627","rgb":"140,29,64"},
  "Cincinnati":{"color":"#E00122","color2":"#000000","rgb":"224,1,34"},
  "Utah":{"color":"#CC0000","color2":"#FFFFFF","rgb":"204,0,0"},
  "Kansas":{"color":"#0051A5","color2":"#E8000D","rgb":"0,81,165"},
  "West Virginia":{"color":"#002855","color2":"#EAAA00","rgb":"0,40,85"},
  "UConn":{"color":"#000E2F","color2":"#E4002B","rgb":"0,14,47"},
  "Marquette":{"color":"#003366","color2":"#FFCC00","rgb":"0,51,102"},
  "Creighton":{"color":"#005CA9","color2":"#FFFFFF","rgb":"0,92,169"},
  "St. John's":{"color":"#CC0000","color2":"#000000","rgb":"204,0,0"},
  "Villanova":{"color":"#00205B","color2":"#FFFFFF","rgb":"0,32,91"},
  "Seton Hall":{"color":"#003189","color2":"#FFFFFF","rgb":"0,49,137"},
  "Georgetown":{"color":"#041E42","color2":"#8D817B","rgb":"4,30,66"},
  "Providence":{"color":"#003DA5","color2":"#FFFFFF","rgb":"0,61,165"},
  "Butler":{"color":"#13294B","color2":"#9EA2A2","rgb":"19,41,75"},
  "DePaul":{"color":"#005EB8","color2":"#C6093B","rgb":"0,94,184"},
  "Xavier":{"color":"#0C2340","color2":"#9EA2A2","rgb":"12,35,64"},
  "Kentucky":{"color":"#0033A0","color2":"#FFFFFF","rgb":"0,51,160"},
  "Alabama":{"color":"#9E1B32","color2":"#828A8F","rgb":"158,27,50"},
  "Vanderbilt":{"color":"#866D4B","color2":"#000000","rgb":"134,109,75"},
  "Florida":{"color":"#0021A5","color2":"#FA4616","rgb":"0,33,165"},
  "Texas":{"color":"#BF5700","color2":"#FFFFFF","rgb":"191,87,0"},
  "Texas A&M":{"color":"#500000","color2":"#FFFFFF","rgb":"80,0,0"},
  "Arkansas":{"color":"#9D2235","color2":"#FFFFFF","rgb":"157,34,53"},
  "Auburn":{"color":"#0C2340","color2":"#E87722","rgb":"12,35,64"},
  "Ole Miss":{"color":"#CE1126","color2":"#14213D","rgb":"206,17,38"},
  "LSU":{"color":"#461D7C","color2":"#FDD023","rgb":"70,29,124"},
  "Mississippi State":{"color":"#660000","color2":"#FFFFFF","rgb":"102,0,0"},
  "Tennessee":{"color":"#FF8200","color2":"#58595B","rgb":"255,130,0"},
  "Oklahoma":{"color":"#841617","color2":"#FFFFFF","rgb":"132,22,23"},
  "South Carolina":{"color":"#73000A","color2":"#000000","rgb":"115,0,10"},
  "Georgia":{"color":"#BA0C2F","color2":"#000000","rgb":"186,12,47"},
  "Missouri":{"color":"#F1B82D","color2":"#000000","rgb":"241,184,45"},
  "San Diego State":{"color":"#A6192E","color2":"#000000","rgb":"166,25,46"},
  "Gonzaga":{"color":"#002966","color2":"#CC0000","rgb":"0,41,102"},
  "Colorado State":{"color":"#1E4D2B","color2":"#C8C372","rgb":"30,77,43"},
  "Boise State":{"color":"#0033A0","color2":"#D64309","rgb":"0,51,160"},
  "Utah State":{"color":"#00263A","color2":"#8A8D8F","rgb":"0,38,58"},
  "Texas State":{"color":"#501214","color2":"#8A8D8F","rgb":"80,18,20"},
  "Washington State":{"color":"#981E32","color2":"#5E6A71","rgb":"152,30,50"},
  "Oregon State":{"color":"#D3832B","color2":"#000000","rgb":"211,131,43"},
  "Fresno State":{"color":"#CC0000","color2":"#003087","rgb":"204,0,0"},
  "Nevada":{"color":"#003366","color2":"#8C7340","rgb":"0,51,102"},
  "New Mexico":{"color":"#BA0C2F","color2":"#63666A","rgb":"186,12,47"},
  "Air Force":{"color":"#003087","color2":"#8A8D8F","rgb":"0,48,135"},
  "Wyoming":{"color":"#492F24","color2":"#FFC425","rgb":"73,47,36"},
  "Davidson":{"color":"#CC0000","color2":"#000000","rgb":"204,0,0"},
  "Dayton":{"color":"#CE1141","color2":"#004B8D","rgb":"206,17,65"},
  "Duquesne":{"color":"#003087","color2":"#CC0000","rgb":"0,48,135"},
  "Fordham":{"color":"#7B0D1E","color2":"#FFFFFF","rgb":"123,13,30"},
  "George Mason":{"color":"#006633","color2":"#FFD700","rgb":"0,102,51"},
  "George Washington":{"color":"#002855","color2":"#FFD200","rgb":"0,40,85"},
  "La Salle":{"color":"#00539B","color2":"#C8A951","rgb":"0,83,155"},
  "Loyola Chicago":{"color":"#82162A","color2":"#C8A85A","rgb":"130,22,42"},
  "Rhode Island":{"color":"#002147","color2":"#75B2DD","rgb":"0,33,71"},
  "Richmond":{"color":"#002B5C","color2":"#CE1126","rgb":"0,43,92"},
  "Saint Joseph's":{"color":"#9E1B34","color2":"#9E7733","rgb":"158,27,52"},
  "Saint Louis":{"color":"#003DA5","color2":"#9E9E9E","rgb":"0,61,165"},
  "St. Bonaventure":{"color":"#6E3B2A","color2":"#F2C050","rgb":"110,59,42"},
  "VCU":{"color":"#F8C300","color2":"#000000","rgb":"248,195,0"},
  "Charlotte":{"color":"#046A38","color2":"#B3A369","rgb":"4,106,56"},
  "East Carolina":{"color":"#592A8A","color2":"#FFC72C","rgb":"89,42,138"},
  "Florida Atlantic":{"color":"#003366","color2":"#CC0000","rgb":"0,51,102"},
  "Memphis":{"color":"#003087","color2":"#898D8D","rgb":"0,48,135"},
  "North Texas":{"color":"#00853E","color2":"#FFFFFF","rgb":"0,133,62"},
  "Rice":{"color":"#002469","color2":"#C1C6C8","rgb":"0,36,105"},
  "South Florida":{"color":"#006747","color2":"#CFC493","rgb":"0,103,71"},
  "Temple":{"color":"#9D2235","color2":"#FFFFFF","rgb":"157,34,53"},
  "Tulane":{"color":"#006747","color2":"#418FDE","rgb":"0,103,71"},
  "Tulsa":{"color":"#002D62","color2":"#C8102E","rgb":"0,45,98"},
  "UAB":{"color":"#1E6B52","color2":"#FFD100","rgb":"30,107,82"},
  "UTSA":{"color":"#F15A22","color2":"#002A5C","rgb":"241,90,34"},
  "Wichita State":{"color":"#000000","color2":"#FFD200","rgb":"0,0,0"},
};


// ============================================================
// ENTRY POINTS
// ============================================================

/** Quick connection check — run first to verify API key works */
function testConnection() {
  const res = sbGet('/rest/v1/teams?select=name&limit=3');
  Logger.log('Status: ' + res.code);
  Logger.log('Body: '   + res.body);
}

/** Debug a single conference tab without writing to DB */
function debugTeam() {
  const TAB  = 'SEC';   // ← change to whichever tab you want to inspect
  const CONF = 'SEC';

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TAB);
  if (!sheet) { Logger.log('Tab not found: ' + TAB); return; }

  const rows = sheet.getDataRange().getValues();

  Logger.log('=== RAW ROWS 1–25 ===');
  rows.slice(0, 25).forEach((row, i) =>
    Logger.log('Row ' + (i + 1) + ': ' + row.slice(0, 16).map(c => String(c || '').trim()).join(' | '))
  );

  const teams = parseSheet(rows, CONF);
  Logger.log('=== PARSED ' + teams.length + ' TEAMS ===');
  for (const t of teams) {
    Logger.log('--- ' + t.name + ' | ' + t.players.length + ' players | grades: coach=' +
      t.coach_grade + ' depth=' + t.depth_grade + ' recruit=' + t.recruit_grade + ' nil=' + t.nil_grade);
    t.players.slice(0, 8).forEach((p, i) =>
      Logger.log('  ' + (i + 1) + '. [' + p.position + (p.position2 ? '/' + p.position2 : '') + '] ' +
        p.name + ' ht:' + p.height + ' yr:' + p.yr + ' grade:' + p.tdc_grade +
        (p.from_school ? ' from:' + p.from_school : ''))
    );
  }
}

/** Full sync — UPSERT players (ids preserved) + rebuild losses, then backfill
 *  espn_id/stats and remove departed players. */
function syncToSupabase() {
  Logger.log('=== TDC SYNC START ===');

  // ── Wipe losses (fully rebuilt each run). PLAYERS are UPSERTed on (name,team),
  // NOT wiped, so a returning player keeps the SAME id across syncs — which keeps
  // the id-keyed grade files valid. Departed players are removed by a targeted
  // cleanup after the loop (see below). SYNC_START marks the pre-upsert instant so
  // that cleanup only deletes rows nothing touched this run.
  Logger.log('Wiping losses...');
  sbDelete('/rest/v1/losses?team=not.is.null');
  var SYNC_START = new Date().toISOString();
  Logger.log('Losses wiped. Upsert cutoff: ' + SYNC_START);

  // ── Rankings ───────────────────────────────────────────────
  const { rankMap, prevRankMap, tierMap } = readRankings();
  Logger.log('Rankings loaded: ' + Object.keys(rankMap).length + ' current, ' +
    Object.keys(prevRankMap).length + ' previous');

  // ── Conference tabs ────────────────────────────────────────
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let totalTeams = 0, totalPlayers = 0, totalLosses = 0;

  for (const [tabName, confCode] of Object.entries(CONF_TABS)) {
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) { Logger.log('Tab not found: ' + tabName); continue; }

    Logger.log('Processing ' + tabName + '...');
    const teams = parseSheet(sheet.getDataRange().getValues(), confCode);

    for (const team of teams) {
      try {
        upsertTeam(team, rankMap, prevRankMap, tierMap);
        insertLosses(team);
        insertPlayers(team);
        Logger.log('  ✅ ' + team.name + ': ' + team.players.length + ' players, ' + team.losses.length + ' losses');
        totalTeams++;
        totalPlayers += team.players.length;
        totalLosses  += team.losses.length;
      } catch (e) {
        Logger.log('  ❌ ' + team.name + ': ' + e.message);
      }
    }
  }

  // ── Remove departed players ─────────────────────────────────
  // Anyone whose (name,team) wasn't upserted this run still has an OLD updated_at.
  // Delete only those. Guarded: if far fewer players synced than expected (a tab
  // failed to parse), SKIP the delete so a partial run can't wipe a conference.
  var MIN_EXPECTED = 800;
  if (totalPlayers >= MIN_EXPECTED) {
    sbDelete('/rest/v1/players?updated_at=lt.' + encodeURIComponent(SYNC_START));
    Logger.log('Departed-player cleanup ran (synced ' + totalPlayers + ' players).');
  } else {
    Logger.log('⚠️ Cleanup SKIPPED — only ' + totalPlayers + ' players synced (< ' +
      MIN_EXPECTED + '). Departed players left in place to avoid a partial-sync wipe.');
  }

  // ── Recover ESPN ids (headshots + projection joins) ─────────
  // The upsert preserves espn_id on existing players, so this now only fills it in
  // for NEWLY-added players (their first sync). Matches players → player_history
  // server-side (unique name, team tie-break, never guesses). Create the function
  // once via scripts/backfill_espn_ids.sql.
  try { sbPost('/rest/v1/rpc/backfill_espn_ids', {}); Logger.log('ESPN id backfill invoked.'); }
  catch (e) { Logger.log('ESPN id backfill skipped (create it via backfill_espn_ids.sql): ' + e.message); }
  // Fill statless returners' box lines from player_history (by the restored espn_id).
  try { sbPost('/rest/v1/rpc/backfill_player_stats', {}); Logger.log('Player-stat backfill invoked.'); }
  catch (e) { Logger.log('Player-stat backfill skipped (create it via backfill_espn_ids.sql): ' + e.message); }

  // ── Recent Additions tab ───────────────────────────────────
  syncRecentAdditions(ss);

  Logger.log('=== SYNC COMPLETE: ' + totalTeams + ' teams | ' + totalPlayers + ' players | ' + totalLosses + ' losses ===');
}


// ============================================================
// RANKINGS READER
// ============================================================

function readRankings() {
  const rankMap = {}, prevRankMap = {}, tierMap = {};
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const rankSheet = ss.getSheetByName('TDC-Rank');
  if (!rankSheet) { Logger.log('TDC-Rank tab not found — skipping rankings'); return { rankMap, prevRankMap, tierMap }; }

  const rows = rankSheet.getDataRange().getValues();

  // Previous rankings — columns A (rank) and B (team)
  for (const row of rows) {
    const rank = parseInt(String(row[0] || '').trim());
    const name = String(row[1] || '').trim();
    if (!isNaN(rank) && name && !name.match(/^Tier/i)) prevRankMap[name] = rank;
  }

  // Current rankings — columns D (rank) and E (team)
  let currentTier = '';
  for (const row of rows) {
    const d = String(row[3] || '').trim();
    const e = String(row[4] || '').trim();
    if (!d && !e) continue;
    if (e.match(/^Tier/i) || d.match(/^Tier/i)) { currentTier = e || d; continue; }
    if (d.toLowerCase().includes('updated')) continue;
    const rank = parseInt(d);
    if (!isNaN(rank) && e) { rankMap[e] = rank; tierMap[e] = currentTier; }
  }

  // Fallback: if D-E columns are empty, promote A-B to current
  if (Object.keys(rankMap).length === 0) {
    Logger.log('D-E columns empty — using A-B as current rankings');
    let fallbackTier = '';
    for (const row of rows) {
      const a = String(row[0] || '').trim();
      const b = String(row[1] || '').trim();
      if (b.match(/^Tier/i) || a.match(/^Tier/i)) { fallbackTier = b || a; continue; }
      const rank = parseInt(a);
      if (!isNaN(rank) && b) { rankMap[b] = rank; tierMap[b] = fallbackTier; }
    }
  }

  return { rankMap, prevRankMap, tierMap };
}


// ============================================================
// TEAM UPSERT
// ============================================================

function upsertTeam(team, rankMap, prevRankMap, tierMap) {
  const colors     = TEAM_COLORS[team.name] || { color: '#666666', color2: '#333333', rgb: '100,100,100' };
  const rankNum    = rankMap[team.name]     || null;
  const prevRank   = prevRankMap[team.name] || null;
  const rankChange = (rankNum && prevRank)  ? prevRank - rankNum : null; // positive = moved up
  const teamTier   = tierMap[team.name]     || null;

  sbPost('/rest/v1/teams?on_conflict=name', [{
    name:          team.name,
    conference:    team.conf,
    conf:          team.conf,
    head_coach:    team.coach,
    coach:         team.coach,
    color:         colors.color,
    color2:        colors.color2,
    color_rgb:     colors.rgb,
    primary_color: colors.color,
    coach_grade:   team.coach_grade   || null,
    depth_grade:   team.depth_grade   || null,
    recruit_grade: team.recruit_grade || null,
    nil_grade:     team.nil_grade     || null,
    nil_tier:      team.nil_tier      || null,
    tdc_rank_num:  rankNum,
    tdc_rank:      rankNum            || null,
    team_tier:     teamTier,
    rank_change:   rankChange,
    updated_at:    new Date().toISOString(),
  }]);
}


// ============================================================
// LOSSES INSERT
// ============================================================

function insertLosses(team) {
  if (!team.losses.length) return;
  sbPost('/rest/v1/losses', team.losses.map(l => ({
    team:   team.name,
    pos:    l.position,
    name:   l.name,
    yr:     l.yr,
    dest:   'Transfer/Grad',
    height: l.height,
    ppg:    l.ppg,    rpg:    l.rpg,    apg:    l.apg,    mpg:    l.mpg,
    fgm:    l.fgm,    fga:    l.fga,    fg_pct: l.fg_pct,
    tpm:    l.tpm,    tpa:    l.tpa,    tp_pct: l.tp_pct,
    ftm:    l.ftm,    fta:    l.fta,    ft_pct: l.ft_pct,
    oreb:   l.oreb,   dreb:   l.dreb,
    stl:    l.stl,    blk:    l.blk,    tovs:   l.tovs,   gp:     l.gp,
  })));
}


// ============================================================
// PLAYERS INSERT
// ============================================================

// A freshman / redshirt-freshman has no prior-year college line, so the model can't
// grade him — his SHEET grade is the only signal. Everyone else has last season's
// stats, so the DATA grade (written by the re-grade pipeline) should win.
function _isFreshman(p) { return /^r?-?fr\.?/i.test(String(p.yr || '').trim()); }

function insertPlayers(team) {
  if (!team.players.length) return;

  var now = new Date().toISOString();   // > SYNC_START, so these survive the cleanup
  // Base row WITHOUT tdc_grade. We add tdc_grade ONLY for freshmen below — so the
  // upsert never overwrites an experienced player's DATA grade with your sheet
  // ranking. (A merge-duplicates upsert only updates the columns present in the
  // payload; omitting tdc_grade leaves the DB value intact.)
  const base = (p, i) => ({
    team:             team.name,
    name:             p.name || '—',
    position:         p.position,
    position2:        p.position2  || null,
    class_year:       p.yr,
    yr:               p.yr,
    height:           p.height     || null,
    starter:          p.starter,
    is_addition:      p.is_addition,
    depth_order:      i + 1,
    hometown:         p.from_school || null,
    is_international: p.is_international || false,
    is_injured:       p.is_injured       || false,
    updated_at:       now,
    ppg:    p.ppg,    rpg:    p.rpg,    apg:    p.apg,    mpg:    p.mpg,
    fgm:    p.fgm,    fga:    p.fga,    fg_pct: p.fg_pct,
    tpm:    p.tpm,    tpa:    p.tpa,    tp_pct: p.tp_pct,
    ftm:    p.ftm,    fta:    p.fta,    ft_pct: p.ft_pct,
    oreb:   p.oreb,   dreb:   p.dreb,
    stl:    p.stl,    blk:    p.blk,    tovs:   p.tovs,   gp:     p.gp,
  });
  // NOTE: espn_id is also intentionally NOT in the payload — same reason: the upsert
  // preserves the backfilled id (headshots + grade joins) across syncs.

  // Bucket the roster: freshmen carry a grade, experienced don't, '—' slots plain-insert.
  const froshRows = [], expRows = [], slotRows = [];
  team.players.forEach(function (p, i) {
    const row = base(p, i);
    const real = row.name && row.name !== '—' && row.name !== '-';
    if (!real) { slotRows.push(row); return; }
    if (_isFreshman(p)) { row.tdc_grade = p.tdc_grade || null; froshRows.push(row); }
    else expRows.push(row);   // no tdc_grade key → DB data grade preserved
  });

  const s = (froshRows[0] || expRows[0] || slotRows[0]) || {};
  Logger.log('    Sample: ' + s.name + ' pos=' + s.position +
    ' ppg=' + s.ppg + ' grade=' + (('tdc_grade' in s) ? s.tdc_grade : '(kept DB data grade)'));

  const BATCH = 50;
  // Freshmen and experienced go in SEPARATE upsert batches so a batch's column set is
  // uniform — a mixed batch would null out tdc_grade for the experienced rows.
  for (let i = 0; i < froshRows.length; i += BATCH) {
    sbPost('/rest/v1/players?on_conflict=name,team', froshRows.slice(i, i + BATCH));
  }
  for (let i = 0; i < expRows.length; i += BATCH) {
    sbPost('/rest/v1/players?on_conflict=name,team', expRows.slice(i, i + BATCH));
  }
  for (let i = 0; i < slotRows.length; i += BATCH) {
    sbPost('/rest/v1/players', slotRows.slice(i, i + BATCH));
  }
}


// ============================================================
// RECENT ADDITIONS SYNC
// ============================================================

function syncRecentAdditions(ss) {
  const sheet = ss.getSheetByName('Recent Additions');
  if (!sheet) { Logger.log('Recent Additions tab not found — skipping'); return; }

  const rows      = sheet.getDataRange().getValues();
  const additions = [];
  let currentDate = '';

  for (const row of rows) {
    // Check for a date header cell — e.g. "May / 1 / 2026"
    const dateCell = row.map(c => String(c || '').trim())
      .find(c => c.match(/^[A-Za-z]+\s*\/\s*\d+\s*\/\s*\d{4}$/));
    if (dateCell) { currentDate = dateCell; continue; }

    const pos  = String(row[0] || '').trim();
    const name = String(row[2] || '').trim();
    const from = String(row[3] || '').trim();
    const yr   = String(row[4] || '').trim();
    const to   = String(row[11] || '').trim();
    const grade = String(row[10] || '').trim();

    // Skip header / empty rows
    if (!name || name === 'Name' || pos === 'Pos.' || pos === 'Pos') continue;

    const ppg = parseFloat(row[5]);
    const rpg = parseFloat(row[6]);
    const apg = parseFloat(row[7]);
    const mpg = parseFloat(row[8]);
    const bpm = parseFloat(row[9]);

    additions.push({
      position:   pos,
      height:     normalizeHeight(row[1]),
      name:       name.replace(/[\*\+]/g, '').trim(),
      from_team:  from,
      to_team:    to,
      class_year: yr,
      ppg:        isNaN(ppg) ? null : ppg,
      rpg:        isNaN(rpg) ? null : rpg,
      apg:        isNaN(apg) ? null : apg,
      mpg:        isNaN(mpg) ? null : mpg,
      bpm:        isNaN(bpm) ? null : bpm,
      tdc_grade:  grade || null,
      added_date: currentDate,
    });
  }

  // Wipe and re-insert
  sbDelete('/rest/v1/recent_additions?id=gt.0');
  if (additions.length) {
    sbPost('/rest/v1/recent_additions', additions);
    Logger.log('✅ Recent Additions: ' + additions.length + ' players');
  }
}


// ============================================================
// SHEET PARSER
// ============================================================

function parseSheet(rows, confCode) {
  const teams = [];
  let team      = null;
  let inRoster  = false;
  let inLosses  = false;
  let depthIdx  = 0;
  let coach     = '';
  let grades    = {};
  let gradeState = null; // null | 'expect-values'

  for (const row of rows) {
    const cells = row.map(c => String(c || '').trim());

    // ── Skip column header rows (contain "Name" and "PPG") ──
    if (cells.includes('Name') && cells.includes('PPG')) continue;

    // ── Coach line: "HC - Name" ──────────────────────────────
    const coachCell = cells.find(c => c.match(/^HC\s*[-–]/i));
    if (coachCell) {
      const m = coachCell.match(/^HC\s*[-–]\s*(.+)/i);
      if (m) coach = m[1].trim();
      gradeState = null;
      continue;
    }

    // ── Grade header row (contains "Coach" or "Roster" label) ──
    if (cells.some(c => c === 'Coach' || c === 'Roster') &&
        !cells.some(c => c.match(/:\s*Roster\s*$/i))) {
      gradeState = 'expect-values';
      continue;
    }

    // ── Grade values row ─────────────────────────────────────
    if (gradeState === 'expect-values') {
      grades = {
        coach_grade:   row[2]  ? String(row[2]).trim()  : null,
        depth_grade:   row[5]  ? String(row[5]).trim()  : null,
        recruit_grade: row[6]  ? String(row[6]).trim()  : null,
        nil_grade:     row[8]  ? String(row[8]).trim()  : null,
        nil_tier:      row[10] ? String(row[10]).trim() : null,
      };
      gradeState = null;
      continue;
    }

    // ── Roster header: "Team Name: Roster" ──────────────────
    const rosterMatch = cells.reduce((found, cell) => {
      if (found) return found;
      const m = cell.match(/^(.+?):\s*Roster\s*$/i);
      return m || null;
    }, null);
    if (rosterMatch) {
      team = {
        name:          rosterMatch[1].trim(),
        conf:          confCode,
        coach,
        players:       [],
        losses:        [],
        coach_grade:   grades.coach_grade,
        depth_grade:   grades.depth_grade,
        recruit_grade: grades.recruit_grade,
        nil_grade:     grades.nil_grade,
        nil_tier:      grades.nil_tier,
      };
      teams.push(team);
      inRoster = true;
      inLosses = false;
      depthIdx = 0;
      continue;
    }

    // ── Losses section header ────────────────────────────────
    if (cells.some(c => c.match(/^Significant .+?:\s*Losses/i))) {
      inLosses = true;
      inRoster = false;
      continue;
    }

    if (!team) continue;

    // ── Bench divider (doesn't affect parsing, just a label row) ──
    if (cells.some(c => c.toLowerCase() === 'bench')) continue;

    const rawPos  = cells[COL.POS];
    const rawName = cells[COL.NAME];

    // ── Blank row in roster = empty starter slot placeholder ──
    if (!rawPos && !rawName) {
      if (inRoster && depthIdx < 5) {
        team.players.push(emptySlot(++depthIdx));
      }
      continue;
    }

    if (!rawName) continue;

    // ── Parse position (supports "PG/SG", "SF/PF", etc.) ────
    const posParts = rawPos.split(/[\/,]/).map(s => s.trim()).filter(Boolean);
    const pos1 = POS_MAP[posParts[0]] || posParts[0] || '';
    const pos2 = posParts[1] ? (POS_MAP[posParts[1]] || posParts[1]) : null;

    // ── Parse name — strip *, +, ?, parens ───────────────────
    const name = rawName.replace(/[\*\+\?\(\)]/g, '').replace(/\s+/g, ' ').trim();
    if (!name) continue;

    // ── Parse from-school vs class-year ──────────────────────
    // If col F looks like a year ("So.", "Jr.", etc.), there's no transfer origin
    const yearPat = /^(Fr\.|So\.|Jr\.|Sr\.|Gr\.|R-Fr\.|R-So\.|R-Jr\.|R-Sr\.|R-Gr\.)/i;
    const colF    = cells[COL.FROM];
    const colG    = cells[COL.YR];
    const fromSchool = yearPat.test(colF) ? ''   : colF;
    const yr         = yearPat.test(colF) ? colF : colG;

    const isReturnStarter = rawName.includes('*');
    const isAddition      = rawName.includes('+') || yr === 'Fr.';
    const flags           = cells[COL.FLAGS];

    const stats = parseStats(row);

    if (inLosses) {
      team.losses.push({
        position: pos1,
        name, yr,
        height: normalizeHeight(row[COL.HT]),
        ...stats,
      });
    } else if (inRoster) {
      team.players.push({
        position:         pos1,
        position2:        pos2,
        name, yr,
        from_school:      fromSchool,
        height:           normalizeHeight(row[COL.HT]),
        starter:          isReturnStarter,
        is_addition:      isAddition,
        depth_order:      ++depthIdx,
        tdc_grade:        cells[COL.GRADE] || null,
        is_international: flags.includes('🌍'),
        is_injured:       flags.includes('🏥'),
        ...stats,
      });
    }
  }

  return teams;
}


// ============================================================
// HELPERS
// ============================================================

/** Parse all numeric stat columns from a raw sheet row */
function parseStats(row) {
  const n = v => { const x = parseFloat(v); return isNaN(x) ? null : x; };
  return {
    ppg:    n(row[COL.PPG]),
    rpg:    n(row[COL.RPG]),
    apg:    n(row[COL.APG]),
    mpg:    n(row[COL.MPG]),
    fgm:    n(row[COL.FGM]),
    fga:    n(row[COL.FGA]),
    fg_pct: n(row[COL.FG_PCT]),
    tpm:    n(row[COL.TPM]),
    tpa:    n(row[COL.TPA]),
    tp_pct: n(row[COL.TP_PCT]),
    ftm:    n(row[COL.FTM]),
    fta:    n(row[COL.FTA]),
    ft_pct: n(row[COL.FT_PCT]),
    oreb:   n(row[COL.OREB]),
    dreb:   n(row[COL.DREB]),
    stl:    n(row[COL.STL]),
    blk:    n(row[COL.BLK]),
    tovs:   n(row[COL.TOV]),
    gp:     n(row[COL.GP]),
  };
}

/** Normalize a height cell — handles Date objects (Sheets auto-converts 6-8 to a date) */
function normalizeHeight(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val)) return `${val.getMonth() + 1}-${val.getDate()}`;
  const s = String(val).trim();
  if (!s) return null;
  // Already in "6-8" or "6'8" format
  const direct = s.match(/^(\d)['\-](\d{1,2})$/);
  if (direct) return `${direct[1]}-${direct[2]}`;
  // Sheets parsed it as a date string
  const d = new Date(s);
  if (!isNaN(d.getTime()) && s.length > 3) return `${d.getMonth() + 1}-${d.getDate()}`;
  // Generic pattern fallback
  const hm = s.match(/(\d+)['\-–](\d+)/);
  if (hm) return `${hm[1]}-${hm[2]}`;
  return s || null;
}

/** Empty starter slot (blank row in sheet = unfilled position) */
function emptySlot(depthOrder) {
  return {
    position: '', position2: null, name: '—', yr: '', from_school: '',
    height: null, starter: false, is_addition: false,
    depth_order: depthOrder, tdc_grade: null,
    is_international: false, is_injured: false,
    ppg: null, rpg: null, apg: null, mpg: null,
    fgm: null, fga: null, fg_pct: null,
    tpm: null, tpa: null, tp_pct: null,
    ftm: null, fta: null, ft_pct: null,
    oreb: null, dreb: null, stl: null, blk: null, tovs: null, gp: null,
  };
}


// ============================================================
// SUPABASE HELPERS
// ============================================================

function sbGet(path) {
  const res = UrlFetchApp.fetch(SUPABASE_URL + path, {
    method:             'GET',
    headers:            { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
    muteHttpExceptions: true,
  });
  return { code: res.getResponseCode(), body: res.getContentText() };
}

function sbPost(path, body) {
  const res = UrlFetchApp.fetch(SUPABASE_URL + path, {
    method:             'POST',
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      // resolution=merge-duplicates makes ?on_conflict=name a real UPSERT
      // (update the existing team row instead of erroring 23505). Harmless
      // for the freshly-wiped players/losses/recent_additions inserts.
      Prefer:         'return=minimal,resolution=merge-duplicates',
    },
    payload:            JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 400) {
    throw new Error('POST ' + path + ' → ' + code + ': ' + res.getContentText().slice(0, 200));
  }
}

function sbDelete(path) {
  UrlFetchApp.fetch(SUPABASE_URL + path, {
    method:             'DELETE',
    headers:            { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
    muteHttpExceptions: true,
  });
}
