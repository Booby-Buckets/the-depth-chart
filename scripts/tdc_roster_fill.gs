// ═══════════════════════════════════════════════════════════════════════════════
// TDC ROSTER AUTOFILL — Google Apps Script
// ───────────────────────────────────────────────────────────────────────────────
// Paste this into your roster spreadsheet: Extensions → Apps Script → paste →
// Save. Reload the sheet and a "TDC" menu appears → "Fill roster from database".
//
// WHAT IT DOES
//   For every row that has a player Name, it looks the player up in your Supabase
//   `player_history` (their most recent season) and fills in whichever of these
//   columns your sheet has: Ht, PPG, RPG, APG, MPG (+ FG%, 3P%, FT%, STL, BLK).
//   BPM is pulled separately from `bbref_seasons` (advanced stats).
//
//   • Transfers just work — the match is by player NAME across every school, so a
//     Colorado transfer's Colorado line fills in automatically.
//   • It never overwrites a cell you've already typed a value into.
//   • Players with NO match (true freshmen / guys who never played) are left blank
//     and their row is tinted yellow — those are the ones to project in the site's
//     freshman editor.
//
// SAFE TO RE-RUN. Only blank target cells get written; formulas/formatting elsewhere
// are untouched (it writes cell-by-cell, not a bulk overwrite).
// ═══════════════════════════════════════════════════════════════════════════════

var SB_URL = 'https://izlqhnxowdhtdofkwrho.supabase.co';
var SB_KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';   // read-only publishable key

// Header aliases → the DB field to fill. Column matching is case/space/punctuation
// insensitive, so "3P%", "3p pct", "TP_PCT" all map to the same thing.
var COL_MAP = {
  height:['ht','height'],
  ppg:['ppg','pts'], rpg:['rpg','reb'], apg:['apg','ast'], mpg:['mpg','min'],
  fg_pct:['fg%','fgpct','fg'], tp_pct:['3p%','3pt%','tppct','3p','3pt'], ft_pct:['ft%','ftpct','ft'],
  stl:['stl','spg'], blk:['blk','bpg'],
  bpm:['bpm']
};
var NAME_HEADERS = ['name','player'];
// rows whose name cell equals one of these are section dividers, not players
var SKIP_NAMES = /^(bench|name|player|pos|position|significant|roster|starters?|reserves?)$/i;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('TDC')
    .addItem('Fill roster from database', 'fillRosterFromDB')
    .addToUi();
}

function normHeader(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9%]/g, ''); }

// strip status markers so "Trey Green *", "Alon Michaeli +", "Kalu Anya (24-25)" match
function cleanName(raw) {
  return String(raw || '')
    .replace(/\([^)]*\)/g, '')   // (24-25) transfer-year notes
    .replace(/[*+†#]/g, '')      // roster status markers
    .replace(/\s+/g, ' ')
    .trim();
}

function fillRosterFromDB() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var vals = sheet.getDataRange().getValues();
  if (vals.length < 2) { ui.alert('No data on this sheet.'); return; }

  // Find the header row (first row containing a Name/Player header) and map columns.
  var headerRow = -1, col = {};
  for (var r = 0; r < Math.min(vals.length, 20) && headerRow < 0; r++) {
    var nameCol = -1, tmp = {};
    for (var c = 0; c < vals[r].length; c++) {
      var h = normHeader(vals[r][c]);
      if (NAME_HEADERS.indexOf(h) >= 0 && nameCol < 0) nameCol = c;
      for (var key in COL_MAP) {
        if (tmp[key] === undefined) {
          for (var i = 0; i < COL_MAP[key].length; i++) {
            if (h === normHeader(COL_MAP[key][i])) { tmp[key] = c; break; }
          }
        }
      }
    }
    if (nameCol >= 0) { headerRow = r; col = tmp; col.name = nameCol; }
  }
  if (headerRow < 0) { ui.alert('Could not find a "Name" column on this sheet.'); return; }

  // Collect player rows to look up.
  var players = [];
  for (var r = headerRow + 1; r < vals.length; r++) {
    var nm = cleanName(vals[r][col.name]);
    if (nm && !SKIP_NAMES.test(nm) && /[a-z]/i.test(nm)) players.push({ row: r, name: nm });
  }
  if (!players.length) { ui.alert('No player names found under the header.'); return; }

  // One parallel request per player against player_history (most recent season).
  var histReqs = players.map(function (p) {
    return {
      url: SB_URL + '/rest/v1/player_history?select=height,ppg,rpg,apg,mpg,fg_pct,tp_pct,ft_pct,stl,blk,season_year'
                  + '&name=eq.' + encodeURIComponent(p.name) + '&order=season_year.desc&limit=1',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, muteHttpExceptions: true
    };
  });
  var histRes = UrlFetchApp.fetchAll(histReqs);

  // BPM from bbref_seasons (only if the sheet actually has a BPM column).
  var bpmRes = null;
  if (col.bpm !== undefined) {
    var bpmReqs = players.map(function (p) {
      return {
        url: SB_URL + '/rest/v1/bbref_seasons?select=advanced,season_year'
                    + '&player=eq.' + encodeURIComponent(p.name) + '&order=season_year.desc&limit=1',
        headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, muteHttpExceptions: true
      };
    });
    bpmRes = UrlFetchApp.fetchAll(bpmReqs);
  }

  var filled = 0, unmatched = [];
  for (var i = 0; i < players.length; i++) {
    var p = players[i], h = null;
    try { var a = JSON.parse(histRes[i].getContentText()); h = (a && a.length) ? a[0] : null; } catch (e) {}
    if (!h) { unmatched.push(p.name); sheet.getRange(p.row + 1, 1, 1, vals[0].length).setBackground('#fff3cd'); continue; }

    setIfEmpty(sheet, vals, p.row, col.height, h.height);
    setIfEmpty(sheet, vals, p.row, col.ppg, h.ppg);
    setIfEmpty(sheet, vals, p.row, col.rpg, h.rpg);
    setIfEmpty(sheet, vals, p.row, col.apg, h.apg);
    setIfEmpty(sheet, vals, p.row, col.mpg, h.mpg);
    setIfEmpty(sheet, vals, p.row, col.fg_pct, h.fg_pct);
    setIfEmpty(sheet, vals, p.row, col.tp_pct, h.tp_pct);
    setIfEmpty(sheet, vals, p.row, col.ft_pct, h.ft_pct);
    setIfEmpty(sheet, vals, p.row, col.stl, h.stl);
    setIfEmpty(sheet, vals, p.row, col.blk, h.blk);

    if (bpmRes) {
      try {
        var b = JSON.parse(bpmRes[i].getContentText());
        if (b && b.length && b[0].advanced && b[0].advanced.bpm != null)
          setIfEmpty(sheet, vals, p.row, col.bpm, parseFloat(b[0].advanced.bpm));
      } catch (e) {}
    }
    filled++;
  }

  ui.alert(
    'Filled ' + filled + ' player' + (filled === 1 ? '' : 's') + ' from the database.\n\n' +
    (unmatched.length
      ? unmatched.length + ' not found (true freshmen / never played) — highlighted yellow.\n' +
        'Project these in the site\'s freshman editor:\n  • ' + unmatched.join('\n  • ')
      : 'Everyone matched.')
  );
}

// Write value only if the target cell is currently empty (preserves manual overrides).
function setIfEmpty(sheet, vals, r, c, value) {
  if (c === undefined || value === null || value === undefined || value === '') return;
  var cur = vals[r][c];
  if (cur === '' || cur === null || cur === undefined) sheet.getRange(r + 1, c + 1).setValue(value);
}
