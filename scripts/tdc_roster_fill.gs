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
//   TI (our own impact metric) is COMPUTED from the raw counting stats via
//   tdc_derived.gs — no Sports-Reference data. A legacy "BPM" column gets TI too.
//   Requires the tdc_derived.gs module pasted into the same Apps Script project.
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
  // TI = our owned impact metric (computed, no SR). Also fills a legacy "BPM" column.
  ti:['ti','ti40','impact','bpm'],
  // read-only context used to REJECT name collisions (never written back):
  cls:['class','year','yr','cls','grade'],       // to skip true freshmen (no college history)
  from:['from','transfer','prev','previous','origin']  // transfer's origin school, to corroborate the match
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

function _normTm(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim(); }

// Decide which (if any) player_history row REALLY belongs to this roster player, given
// that a name can be shared by several different people. Returns the row, null (no safe
// match — treat as a freshman/unfound), or 'COLLISION' (ambiguous — flag for manual fix).
// This is what stops a Duke FRESHMAN "Cameron Williams" from inheriting Portland's stats.
function _resolveMatch(p, rows) {
  if (!rows || !rows.length) return null;
  // a true freshman (no transfer origin) has no college history — never adopt a same-name veteran
  if (p.isFresh && !p.from) return null;
  var ids = {}; rows.forEach(function(r){ if (r.espn_id != null) ids[r.espn_id] = 1; });
  var nDistinct = Object.keys(ids).length;
  if (p.from) {   // transfer: only accept a row from his stated ORIGIN school
    var f = _normTm(p.from);
    var hit = rows.filter(function(r){ var t = _normTm(r.team); return t && f && (t.indexOf(f) === 0 || f.indexOf(t) === 0); });
    if (hit.length) return hit[0];
    return nDistinct > 1 ? 'COLLISION' : rows[0];   // name matches, but not his origin → suspect
  }
  // returner: one identity is safe; two+ real players sharing the name can't be told apart here
  if (nDistinct > 1) return 'COLLISION';
  return rows[0];
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

  // Collect player rows to look up (+ class & transfer-origin, read-only, to reject collisions).
  var players = [];
  for (var r = headerRow + 1; r < vals.length; r++) {
    var nm = cleanName(vals[r][col.name]);
    if (nm && !SKIP_NAMES.test(nm) && /[a-z]/i.test(nm)) {
      var cls  = col.cls  !== undefined ? String(vals[r][col.cls]  || '').toLowerCase() : '';
      var from = col.from !== undefined ? String(vals[r][col.from] || '').trim()        : '';
      players.push({ row: r, name: nm, isFresh: /(^|[^a-z])fr\b|fresh/.test(cls), from: from });
    }
  }
  if (!players.length) { ui.alert('No player names found under the header.'); return; }

  // One parallel request per player against player_history (most recent season).
  // Pull the raw counting stats too (fga/fgm/fta/ftm/tpm/tpa/oreb/dreb/tovs/gp) so
  // tdc_derived.gs can compute our owned TI — no separate bbref/SR request needed.
  var histReqs = players.map(function (p) {
    return {
      // pull team + espn_id + up to 6 same-name seasons so we can DETECT collisions
      // ("Cameron Williams" = Portland AND a Duke freshman) instead of blindly taking
      // the most recent one.
      url: SB_URL + '/rest/v1/player_history?select=height,ppg,rpg,apg,mpg,fg_pct,tp_pct,ft_pct,stl,blk'
                  + ',fga,fgm,fta,ftm,tpm,tpa,oreb,dreb,tovs,gp,season_year,team,espn_id'
                  + '&name=eq.' + encodeURIComponent(p.name) + '&order=season_year.desc&limit=6',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, muteHttpExceptions: true
    };
  });
  var histRes = UrlFetchApp.fetchAll(histReqs);

  var filled = 0, unmatched = [], collisions = [];
  for (var i = 0; i < players.length; i++) {
    var p = players[i], rows = [];
    try { rows = JSON.parse(histRes[i].getContentText()) || []; } catch (e) {}
    var h = _resolveMatch(p, rows);
    if (h === 'COLLISION') {   // same name, more than one real player, no way to tell which → don't guess
      collisions.push(p.name); sheet.getRange(p.row + 1, 1, 1, vals[0].length).setBackground('#f8d7da'); continue;
    }
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

    // Our owned impact metric — computed from the raw stats (tdc_derived.gs), no SR.
    if (col.ti !== undefined) {
      var ti = tdcImpact40FromPerGame(h, h.gp);
      if (ti !== null) setIfEmpty(sheet, vals, p.row, col.ti, ti);
    }
    filled++;
  }

  ui.alert(
    'Filled ' + filled + ' player' + (filled === 1 ? '' : 's') + ' from the database.\n\n' +
    (collisions.length
      ? collisions.length + ' AMBIGUOUS name' + (collisions.length === 1 ? '' : 's') + ' — highlighted RED, NOT filled (more than one\n' +
        'real player shares the name, e.g. a freshman vs a same-named veteran). Fill these\n' +
        'by hand or add a "From" school so the right one is picked:\n  • ' + collisions.join('\n  • ') + '\n\n'
      : '') +
    (unmatched.length
      ? unmatched.length + ' not found (true freshmen / never played) — highlighted yellow.\n' +
        'Project these in the site\'s freshman editor:\n  • ' + unmatched.join('\n  • ')
      : (collisions.length ? '' : 'Everyone matched.'))
  );
}

// Write value only if the target cell is currently empty (preserves manual overrides).
function setIfEmpty(sheet, vals, r, c, value) {
  if (c === undefined || value === null || value === undefined || value === '') return;
  var cur = vals[r][c];
  if (cur === '' || cur === null || cur === undefined) sheet.getRange(r + 1, c + 1).setValue(value);
}
