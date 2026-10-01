// ═══════════════════════════════════════════════════════════════════════════════
// TDC SCHOOL ROSTERS — Google Apps Script (paste next to tdc_roster_fill.gs)
// ───────────────────────────────────────────────────────────────────────────────
// Extensions → Apps Script → "+" → Script → name it tdc_school_rosters → paste → Save.
// Also re-paste tdc_roster_fill.gs (its onOpen now adds these two items to the TDC menu).
//
// WHERE THE DATA COMES FROM
//   scripts/scrape_school_rosters.py reads every team's roster off its OFFICIAL athletics
//   site (not ESPN — ESPN's 2026-27 rosters were partly last season relabeled), and
//   scripts/build_roster_diff.py compares them with the site and tags every player:
//   returner / transfer (up · lateral · down) / freshman / newcomer (international, JUCO…).
//   The result is published at  www.thedepthchartcbb.com/scripts/data/roster_diff_2027.json
//
// TDC → Pull school rosters (review)
//   Rebuilds a "School Rosters 26-27" tab: one block per team listing
//     ADD       on the school's roster, not in your Sheet           (green)
//     LEFT?     in your Sheet, not on the school's roster           (red)    — never auto-removed
//     SPELLING  same player, spelled differently                    (yellow) — report only *
//     ok        already in your Sheet
//   plus each player's class, height, position, status and where a transfer came from.
//   Teams whose school hasn't posted a 2026-27 roster yet are listed and left alone.
//
// TDC → Apply school-roster additions
//   Appends every ADD player to the BENCH of his team's block on the conference tabs, in your
//   format (Pos · Ht · Name+ · From · Yr · 🌍 flag), tinted green. Nothing is deleted or
//   reordered, and re-running it never adds a player twice. Then run
//   "Fill roster from database" on each tab to pull transfers' stats, sync as usual, and give
//   freshmen / international newcomers their OVR in the site's projection editor.
//
//   * Spelling fixes are NOT applied automatically: a player's site record is keyed by
//     (name, team), so renaming him in the Sheet creates a NEW player id on the next sync and
//     orphans his computed grade until the grade files are rebuilt. Fix the ones that matter by
//     hand, then run scripts/rebuild_grade_files.py.
// ═══════════════════════════════════════════════════════════════════════════════

var SR_SITE = 'https://www.thedepthchartcbb.com';
var SR_TAB = 'School Rosters 26-27';
// conference-tab column numbers (1-based) — same layout sheet_sync.gs reads
var SR_COL = { POS: 3, HT: 4, NAME: 5, FROM: 6, YR: 7, FLAGS: 32 };

function srNorm(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z]/g, '');
}
function srTeamKey(s) {
  return String(s || '').toLowerCase().replace(/saint /g, 'st ').replace(/[^a-z]/g, '');
}

function srLoad() {
  var r = UrlFetchApp.fetch(SR_SITE + '/scripts/data/roster_diff_2027.json?t=' + Date.now(), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Could not load roster_diff_2027.json (HTTP ' + r.getResponseCode() + ')');
  return JSON.parse(r.getContentText());
}

// Every "<Team>: Roster" block on every tab -> {sheet, headerRow, lastRow, names{}}
function srFindBlocks() {
  var blocks = {};
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sh) {
    if (sh.getName() === SR_TAB) return;
    var vals = sh.getDataRange().getValues();
    var cur = null;
    for (var r = 0; r < vals.length; r++) {
      var row = vals[r].map(function (c) { return String(c || '').trim(); });
      var hdr = null;
      for (var c = 0; c < row.length && !hdr; c++) { var m = row[c].match(/^(.+?):\s*Roster\s*$/i); if (m) hdr = m[1].trim(); }
      var endsBlock = row.some(function (x) { return /^Significant .+?:\s*Losses/i.test(x) || /^HC\s*[-–]/i.test(x); });
      if (hdr) {
        cur = { sheet: sh, headerRow: r + 1, lastRow: r + 1, names: {} };
        // sheet_sync.gs's typo self-heal ("Saint Joeseph's" -> "Saint Joseph's"), when it's in the project
        blocks[srTeamKey(typeof fixTeamName === 'function' ? fixTeamName(hdr) : hdr)] = cur;
        continue;
      }
      if (!cur) continue;
      if (endsBlock) { cur = null; continue; }
      var nm = row[SR_COL.NAME - 1];
      if (nm && !/^(name|bench)$/i.test(nm)) {
        cur.names[srNorm(nm.replace(/[\*\+\?\(\)]/g, ''))] = true;
        cur.lastRow = r + 1;
      }
    }
  });
  return blocks;
}

function pullSchoolRosters() {
  var data = srLoad();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SR_TAB) || ss.insertSheet(SR_TAB);
  sh.clear();
  var head = ['Team', 'Change', 'Name', 'Pos', 'Ht', 'Wt', 'Class', 'Status', 'Move', 'From / prev school', 'Hometown', '🌍', 'In your Sheet as', 'Source'];
  var out = [head], colors = [head.map(function () { return '#d9d9d9'; })];
  var blocks = srFindBlocks();
  var nAdd = 0, nLeft = 0, nSpell = 0, notPosted = [];
  data.forEach(function (t) {
    if (!t.players || !t.players.length || t.stale) { notPosted.push(t.team + ' — ' + (t.error || 'no roster')); return; }
    var blk = blocks[srTeamKey(t.team)];
    var spell = {}; (t.renamed || []).forEach(function (x) { spell[srNorm(x.school)] = x.site; });
    out.push([t.team + (blk ? '' : '   (no "' + t.team + ': Roster" block found in the Sheet)'), '', '', '', '', '', '', '', '', '', '', '', '', t.url]);
    colors.push(head.map(function () { return '#eeeeee'; }));
    t.players.forEach(function (p) {
      var inSheet = blk && blk.names[srNorm(p.name)];
      var change = 'ok', bg = '#ffffff';
      if (spell[srNorm(p.name)] && !inSheet) { change = 'SPELLING'; bg = '#fff2cc'; nSpell++; }
      else if (!inSheet && !(blk && p.site_name && blk.names[srNorm(p.site_name)])) { change = 'ADD'; bg = '#d9ead3'; nAdd++; }
      var move = p.status === 'transfer' ? (p.move || '') : '';
      out.push(['', change, p.name, p.sheet_pos, p.ht || '', p.wt || '', p.sheet_yr || '', p.status, move,
        p.sheet_from || p.prev_school || '', p.hometown || '', p.intl ? '🌍' : '', spell[srNorm(p.name)] || p.site_name || '', '']);
      colors.push(head.map(function () { return bg; }));
    });
    (t.removed || []).forEach(function (n) {
      out.push(['', 'LEFT?', n, '', '', '', '', 'not on the school roster', '', '', '', '', n, '']);
      colors.push(head.map(function () { return '#f4cccc'; }));
      nLeft++;
    });
  });
  if (notPosted.length) {
    out.push(['No 2026-27 roster posted yet (left alone):', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    colors.push(head.map(function () { return '#eeeeee'; }));
    notPosted.forEach(function (n) { out.push(['', n, '', '', '', '', '', '', '', '', '', '', '', '']); colors.push(head.map(function () { return '#ffffff'; })); });
  }
  sh.getRange(1, 1, out.length, head.length).setNumberFormat('@').setValues(out).setBackgrounds(colors);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, head.length);
  ss.setActiveSheet(sh);
  SpreadsheetApp.getUi().alert('School rosters pulled', nAdd + ' to ADD (green)\n' + nLeft + ' possibly LEFT (red — check, nothing is removed)\n' +
    nSpell + ' SPELLING differences (yellow — report only)\n' + notPosted.length + ' teams have not posted a 2026-27 roster yet\n\n' +
    'Run TDC → Apply school-roster additions to add the green players to the bench of each team.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function applySchoolAdditions() {
  var ui = SpreadsheetApp.getUi();
  var data = srLoad();
  var blocks = srFindBlocks();
  // count first, so the confirm says exactly what will happen
  var plan = [];
  data.forEach(function (t) {
    if (!t.players || t.stale) return;
    var blk = blocks[srTeamKey(t.team)];
    if (!blk) return;
    var spell = {}; (t.renamed || []).forEach(function (x) { spell[srNorm(x.school)] = true; });
    var adds = t.players.filter(function (p) {
      return !blk.names[srNorm(p.name)] && !spell[srNorm(p.name)] && !(p.site_name && blk.names[srNorm(p.site_name)]);
    });
    if (adds.length) plan.push({ team: t.team, blk: blk, adds: adds });
  });
  var total = plan.reduce(function (a, x) { return a + x.adds.length; }, 0);
  if (!total) { ui.alert('Nothing to add — every school-roster player is already in your Sheet.'); return; }
  var ok = ui.alert('Apply school-roster additions?', 'Adds ' + total + ' players to the bench of ' + plan.length +
    ' teams (tinted green). Nothing is deleted or reordered. Continue?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  // bottom-up per sheet so inserting rows never shifts a block we haven't written yet
  plan.sort(function (a, b) {
    if (a.blk.sheet.getName() !== b.blk.sheet.getName()) return a.blk.sheet.getName() < b.blk.sheet.getName() ? -1 : 1;
    return b.blk.lastRow - a.blk.lastRow;
  });
  plan.forEach(function (x) {
    var sh = x.blk.sheet, at = x.blk.lastRow;
    sh.insertRowsAfter(at, x.adds.length);
    var width = Math.max(sh.getLastColumn(), SR_COL.FLAGS);
    var rows = x.adds.map(function (p) {
      var r = []; for (var i = 0; i < width; i++) r.push('');
      r[SR_COL.POS - 1] = p.sheet_pos || '';
      r[SR_COL.HT - 1] = p.ht || '';
      r[SR_COL.NAME - 1] = p.name + '+';
      r[SR_COL.FROM - 1] = p.sheet_from || '';
      r[SR_COL.YR - 1] = p.sheet_yr || '';
      r[SR_COL.FLAGS - 1] = p.intl ? '🌍' : '';
      return r;
    });
    var rng = sh.getRange(at + 1, 1, rows.length, width);
    sh.getRange(at + 1, SR_COL.HT, rows.length, 1).setNumberFormat('@');   // keep "6-7" from turning into a date
    rng.setValues(rows).setBackground('#d9ead3');
  });
  ui.alert('Added ' + total + ' players across ' + plan.length + ' teams.\n\nNext: run TDC → Fill roster from database on each conference tab ' +
    '(fills transfers\' stats), then sync. Freshmen and international newcomers get their OVR in the site\'s projection editor.');
}
