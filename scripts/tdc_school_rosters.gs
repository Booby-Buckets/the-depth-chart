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
// TDC → Apply school-roster additions   (or run applySchoolAdditions from the editor; no pop-ups — results show as a corner notice + in the execution log)
//   Teams you've ALREADY updated (the block holds any 2026-27 newcomer) are locked: never touched.
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

// Non-blocking result notice: a corner toast in the Sheet + the execution log. (A ui.alert run
// from the editor waits for someone to click OK in the Sheet tab, and times out after 6 min.)
function srNotice(title, msg) {
  Logger.log(title + ' — ' + msg);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, title, 30); } catch (e) {}
}

function srLoad() {
  var r = UrlFetchApp.fetch(SR_SITE + '/scripts/data/roster_diff_2027.json?t=' + Date.now(), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Could not load roster_diff_2027.json (HTTP ' + r.getResponseCode() + ')');
  return JSON.parse(r.getContentText());
}

// Your main conference tabs — the ones your sync pushes to the site (sheet_sync.gs's CONF_TABS when
// it's in this project). A team's block on one of these always wins over a copy on any other tab.
function srMainTabs() {
  if (typeof CONF_TABS === 'object' && CONF_TABS) return Object.keys(CONF_TABS);
  return ['ACC', 'B10', 'Big-Ten', 'BIG-12', 'Big-East', 'SEC', 'PAC-12', 'A10', 'AAC'];
}

// Every "<Team>: Roster" block on every tab, tab by tab: [{tab, main, key, sheet, headerRow, lastRow, names{}}]
function srScanTabs() {
  var main = srMainTabs(), out = [];
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sh) {
    if (sh.getName() === SR_TAB) return;
    var lastRow = sh.getLastRow();
    if (lastRow < 1) return;
    // only the roster columns (A..L) — reading whole stat tabs is what made this slow
    var vals = sh.getRange(1, 1, lastRow, Math.min(12, Math.max(1, sh.getLastColumn()))).getValues();
    var cur = null;
    for (var r = 0; r < vals.length; r++) {
      var row = vals[r].map(function (c) { return String(c || '').trim(); });
      var hdr = null;
      for (var c = 0; c < row.length && !hdr; c++) { var m = row[c].match(/^(.+?):\s*Roster\s*$/i); if (m) hdr = m[1].trim(); }
      var endsBlock = row.some(function (x) { return /^Significant .+?:\s*Losses/i.test(x) || /^HC\s*[-–]/i.test(x); });
      if (hdr) {
        // sheet_sync.gs's typo self-heal ("Saint Joeseph's" -> "Saint Joseph's"), when it's in the project
        var key = srTeamKey(typeof fixTeamName === 'function' ? fixTeamName(hdr) : hdr);
        cur = { tab: sh.getName(), main: main.indexOf(sh.getName()) >= 0, key: key, sheet: sh, headerRow: r + 1, lastRow: r + 1, names: {} };
        out.push(cur);
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
  return out;
}

// One block per team. When a team is on more than one tab, the copy on a MAIN tab wins (never a
// template / work-in-progress copy elsewhere); among equals the fuller block wins. blk.copies lists
// every tab the team appears on.
function srFindBlocks() {
  var blocks = {};
  srScanTabs().forEach(function (b) {
    var cur = blocks[b.key];
    if (!cur) { b.copies = [b.tab]; blocks[b.key] = b; return; }
    cur.copies.push(b.tab);
    var better = (b.main && !cur.main) ||
      (b.main === cur.main && Object.keys(b.names).length > Object.keys(cur.names).length);
    if (better) { b.copies = cur.copies; blocks[b.key] = b; }
  });
  return blocks;
}

// A team you've ALREADY updated for 2026-27 is never touched. "Updated" = its block in the Sheet
// already holds at least one of the school's 2026-27 newcomers (a freshman, transfer or other
// non-returner). A block still showing last season's roster — or an empty block — has none.
function srIsUpdated(t, blk) {
  if (!blk) return false;
  if (!blk.main) return true;          // only on your own tab (e.g. a conference you're building) -> yours, untouched
  return t.players.some(function (p) {
    return p.status !== 'returner' && (blk.names[srNorm(p.name)] || (p.site_name && blk.names[srNorm(p.site_name)]));
  });
}

function pullSchoolRosters() {
  var data = srLoad();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SR_TAB) || ss.insertSheet(SR_TAB);
  sh.clear();
  var head = ['Team', 'Change', 'Name', 'Pos', 'Ht', 'Wt', 'Class', 'Status', 'Move', 'From / prev school', 'Hometown', '🌍', 'In your Sheet as', 'Source'];
  var out = [head], colors = [head.map(function () { return '#d9d9d9'; })];
  var blocks = srFindBlocks();
  var nAdd = 0, nLeft = 0, nSpell = 0, notPosted = [], locked = [], newTeams = [];
  data.forEach(function (t) {
    if (!t.players || !t.players.length || t.stale) { notPosted.push(t.team + ' — ' + (t.error || 'no roster')); return; }
    var blk = blocks[srTeamKey(t.team)];
    if (srIsUpdated(t, blk)) { locked.push(t.team); return; }
    if (!blk) { newTeams.push(t.team); return; }   // no block anywhere (new team, or one that fell out of the Sheet) -> createNewTeamTabs
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
  if (locked.length) {
    out.push(['🔒 Already updated by you — not touched (' + locked.length + '):', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    colors.push(head.map(function () { return '#eeeeee'; }));
    out.push(['', locked.join(', '), '', '', '', '', '', '', '', '', '', '', '', '']);
    colors.push(head.map(function () { return '#ffffff'; }));
  }
  if (newTeams.length) {
    out.push(['🆕 Not in your Sheet yet — run createNewTeamTabs to add them (' + newTeams.length + '):', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    colors.push(head.map(function () { return '#eeeeee'; }));
    out.push(['', newTeams.join(', '), '', '', '', '', '', '', '', '', '', '', '', '']);
    colors.push(head.map(function () { return '#ffffff'; }));
  }
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
  var summary = locked.length + ' already-updated teams locked (not touched) · ' + nAdd + ' to ADD · ' + nLeft +
    ' possibly LEFT (never removed) · ' + nSpell + ' spelling differences (report only) · ' + notPosted.length + ' not posted yet · ' + newTeams.length + ' new teams ready for createNewTeamTabs';
  srNotice('School rosters pulled', summary + '. Next: run applySchoolAdditions to add the green players.');
}

function applySchoolAdditions() {
  var data = srLoad();
  var blocks = srFindBlocks();
  // count first, so the confirm says exactly what will happen
  var plan = [];
  data.forEach(function (t) {
    if (!t.players || t.stale) return;
    var blk = blocks[srTeamKey(t.team)];
    if (!blk || srIsUpdated(t, blk)) return;      // already updated by you -> never touched
    var spell = {}; (t.renamed || []).forEach(function (x) { spell[srNorm(x.school)] = true; });
    var adds = t.players.filter(function (p) {
      return !blk.names[srNorm(p.name)] && !spell[srNorm(p.name)] && !(p.site_name && blk.names[srNorm(p.site_name)]);
    });
    if (adds.length) plan.push({ team: t.team, blk: blk, adds: adds });
  });
  var total = plan.reduce(function (a, x) { return a + x.adds.length; }, 0);
  if (!total) { srNotice('Nothing to add', 'Every school-roster player is already in your Sheet (or the team is locked).'); return; }
  // no confirm dialog: this only ADDS rows (green), skips locked teams, and you reviewed the list first

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
  srNotice('School rosters applied', 'Added ' + total + ' players to ' + plan.map(function (x) { return x.team; }).join(', ') +
    ' (green rows). Next: sync as usual; give freshmen / international newcomers their OVR in the site editor.');
}


// ── NEW TEAMS: every D1 team with no block anywhere in the Sheet ─────────────────────────────────────
// One tab per conference, named with the site's conference code (WCC, MVC, Sun Belt…), each team
// a block in the exact layout sheet_sync.gs reads:
//   HC - <coach>            (always written: the sync carries the previous coach forward otherwise)
//   <Team>: Roster
//   Pos. | Ht. | Name | From | Yr.
//   players — depth order = last season's minutes, then class; newcomers marked "+"
//   Significant <Team>: Losses
// Teams already in the Sheet (any "<Team>: Roster" block on any tab) are never touched, and a
// re-run only adds teams that are still missing. Stats are filled on the site by the sync's
// espn-id + stat backfill once syncMoreConferences (tdc_sync_more.gs) pushes these tabs.
function createNewTeamTabs() {
  var data = srLoad();
  var blocks = srFindBlocks();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var byConf = {}, n = 0;
  data.forEach(function (t) {
    if (t.stale || !t.players || !t.players.length || !t.conf) return;
    if (blocks[srTeamKey(t.team)]) return;                       // already in the Sheet (any tab) — never touched
    // no block anywhere: a new team, OR one of yours that fell out of the Sheet (ECU/Rice/UTSA after the
    // Sept 29 sync) — its block goes on its conference tab (for those three, your AAC tab)
    (byConf[t.conf] = byConf[t.conf] || []).push(t);
    n++;
  });
  if (!n) { srNotice('Nothing to create', 'Every D1 team with a posted roster already has a block in your Sheet.'); return; }
  var W = SR_COL.FLAGS + 1;                                       // A..AG
  function blank() { var r = []; for (var i = 0; i < W; i++) r.push(''); return r; }
  var made = [];
  var t0 = Date.now(), stoppedAt = null;
  Object.keys(byConf).sort().forEach(function (conf) {
    if (stoppedAt || Date.now() - t0 > 4.5 * 60 * 1000) { stoppedAt = stoppedAt || conf; return; }   // stop cleanly before Google's 6-min limit
    var sh = ss.getSheetByName(conf) || ss.insertSheet(conf);
    var rows = [], bold = [];
    byConf[conf].sort(function (a, b) { return a.team < b.team ? -1 : 1; }).forEach(function (t) {
      var r;
      r = blank(); r[0] = 'HC - ' + (t.coach || 'TBD'); bold.push(rows.length); rows.push(r);
      r = blank(); r[SR_COL.NAME - 1] = t.team + ': Roster'; bold.push(rows.length); rows.push(r);
      r = blank(); r[SR_COL.POS - 1] = 'Pos.'; r[SR_COL.HT - 1] = 'Ht.'; r[SR_COL.NAME - 1] = 'Name';
      r[SR_COL.FROM - 1] = 'From'; r[SR_COL.YR - 1] = 'Yr.'; rows.push(r);
      t.players.forEach(function (p) {
        r = blank();
        r[SR_COL.POS - 1] = p.sheet_pos || '';
        r[SR_COL.HT - 1] = p.ht || '';
        r[SR_COL.NAME - 1] = p.name + (p.status === 'returner' ? '' : '+');
        r[SR_COL.FROM - 1] = p.sheet_from || '';
        r[SR_COL.YR - 1] = p.sheet_yr || '';
        r[SR_COL.FLAGS - 1] = p.intl ? '🌍' : '';
        rows.push(r);
      });
      r = blank(); r[0] = 'Significant ' + t.team + ': Losses'; bold.push(rows.length); rows.push(r);
      rows.push(blank());
      made.push(t.team);
    });
    var last = sh.getLastRow();
    var start = last ? last + 2 : 1;
    if (sh.getMaxColumns() < W) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
    if (sh.getMaxRows() < start + rows.length) sh.insertRowsAfter(sh.getMaxRows(), start + rows.length - sh.getMaxRows());
    sh.getRange(start, SR_COL.HT, rows.length, 1).setNumberFormat('@');   // heights stay "6-7", not dates
    sh.getRange(start, 1, rows.length, W).setValues(rows);
    // one call for every header line on the tab (row-by-row bolding was ~700 calls -> timeout)
    if (bold.length) sh.getRangeList(bold.map(function (i) { return 'A' + (start + i) + ':AG' + (start + i); })).setFontWeight('bold');
  });
  if (stoppedAt) {
    srNotice('Paused — run createNewTeamTabs again', made.length + ' teams added so far; stopped before the ' + stoppedAt +
      ' tab to stay under Google\'s time limit. Run it again — it only adds the teams still missing.');
    return;
  }
  srNotice('New teams added', made.length + ' teams across ' + Object.keys(byConf).length + ' conference tabs (' +
    Object.keys(byConf).sort().join(', ') + '). Next: add tdc_sync_more.gs and run syncMoreConferences.');
}

// Diagnostic: every tab that holds "<Team>: Roster" blocks, which teams are on it (player count),
// and any team that appears on MORE than one tab. Read-only.
function listRosterBlocks() {
  var all = srScanTabs(), by = {}, seen = {};
  all.forEach(function (b) { (seen[b.key] = seen[b.key] || []).push(b.tab); });
  all.forEach(function (b) {
    var dup = seen[b.key].length > 1 ? ' [ALSO ON ' + seen[b.key].filter(function (t) { return t !== b.tab; }).join('/') + ']' : '';
    (by[b.tab] = by[b.tab] || []).push(b.key + '(' + Object.keys(b.names).length + ')' + dup);
  });
  var main = srMainTabs();
  Object.keys(by).sort().forEach(function (tab) {
    Logger.log((main.indexOf(tab) >= 0 ? 'MAIN ' : 'other ') + tab + ' — ' + by[tab].length + ' teams: ' + by[tab].join(', '));
  });
}
