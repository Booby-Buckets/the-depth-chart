// ═══════════════════════════════════════════════════════════════════════════════
// TDC SYNC — MORE CONFERENCES (paste next to your sync script; NO key in this file)
// ───────────────────────────────────────────────────────────────────────────────
// Extensions → Apps Script → "+" → Script → name it tdc_sync_more → paste → Save.
// Then pick syncMoreConferences in the function dropdown and click Run (not Debug).
//
// Pushes the 24 conference tabs that createNewTeamTabs (tdc_school_rosters.gs) builds to the
// site. It REUSES your existing sync's functions (parseSheet, upsertTeam, insertPlayers,
// insertLosses, readRankings, loadDbGrades, sbPost/sbDelete and its key), so your sync script
// itself does not change and its key never has to be pasted again.
//
// Different from syncToSupabase on purpose:
//   • Losses are cleared PER TEAM, not wiped table-wide — so running this never touches the
//     losses of your 115 main teams (and your main sync never touches these teams' rosters).
//   • A team that is ALSO on one of your main tabs is skipped (its main-tab block is the real one —
//     e.g. AAC teams left on a tab you duplicated as a template). A block with fewer than 8 players
//     is treated as unfinished and skipped. Skipped teams are left exactly as they are.
//   • Departed-player cleanup is per team and only when that team saved cleanly.
//   • ~230 teams is more than one 6-minute Apps Script run can do, so it stops at ~4.5 minutes,
//     remembers where it was, and schedules itself to continue a minute later until every tab is
//     done. Run it again any time to resume; it re-syncs from the first tab once finished.
// ═══════════════════════════════════════════════════════════════════════════════

var MORE_CONF_TABS = ['AEC', 'ASUN', 'Big Sky', 'Big South', 'Big West', 'CAA', 'CUSA', 'Horizon', 'Ivy', 'MAAC', 'MAC',
  'MEAC', 'MVC', 'MWC', 'NEC', 'OVC', 'Patriot', 'SWAC', 'SoCon', 'Southland', 'Summit', 'Sun Belt', 'UAC', 'WCC'];
var MORE_PROP = 'TDC_MORE_NEXT_TAB';
var MORE_LIMIT_MS = 4.5 * 60 * 1000;

function moreNotice(title, msg) {
  Logger.log(title + ' — ' + msg);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, title, 30); } catch (e) {}
}

function moreKey(n) { return String(n || '').toLowerCase().replace(/saint /g, 'st ').replace(/[^a-z]/g, ''); }

function moreClearTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncMoreConferences') ScriptApp.deleteTrigger(t);
  });
}

function syncMoreConferences() {
  var t0 = Date.now();
  var props = PropertiesService.getScriptProperties();
  var from = parseInt(props.getProperty(MORE_PROP) || '0', 10) || 0;
  moreClearTriggers();
  loadDbGrades();                                   // keep existing grades / website depth charts
  var rk = readRankings();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var teamsDone = 0, players = 0, kept = [], skipped = [];
  // Teams on your MAIN tabs belong to your main sync. A copy of one on another tab (e.g. AAC teams
  // left on a tab duplicated as a template) must never move that team's conference or cut its roster.
  var mainKeys = {};
  Object.keys(CONF_TABS).forEach(function (tab) {
    var msh = ss.getSheetByName(tab);
    if (!msh) return;
    try { parseSheet(msh.getDataRange().getValues(), CONF_TABS[tab]).forEach(function (t) { mainKeys[moreKey(t.name)] = tab; }); }
    catch (e) { Logger.log('⚠️ could not read main tab ' + tab + ': ' + e.message); }
  });

  for (var i = from; i < MORE_CONF_TABS.length; i++) {
    if (Date.now() - t0 > MORE_LIMIT_MS) {
      props.setProperty(MORE_PROP, String(i));
      ScriptApp.newTrigger('syncMoreConferences').timeBased().after(60 * 1000).create();
      moreNotice('Sync paused (time limit)', 'Did ' + teamsDone + ' teams; continuing automatically in ~1 minute from the ' +
        MORE_CONF_TABS[i] + ' tab (' + (MORE_CONF_TABS.length - i) + ' tabs left).');
      return;
    }
    var tab = MORE_CONF_TABS[i];
    var sh = ss.getSheetByName(tab);
    if (!sh) { Logger.log('Tab not found: ' + tab); continue; }
    var teams;
    try { teams = parseSheet(sh.getDataRange().getValues(), tab); }
    catch (e) { Logger.log('⚠️ ' + tab + ' parse failed (' + e.message + ') — skipped, nothing changed.'); continue; }

    teams.forEach(function (team) {
      var start = new Date().toISOString();
      var real = team.players.filter(function (p) { return p.name && p.name !== '—' && p.name !== '-'; }).length;
      if (mainKeys[moreKey(team.name)]) { skipped.push(team.name + ' (on your ' + mainKeys[moreKey(team.name)] + ' tab)'); return; }
      if (real < 8) { skipped.push(team.name + ' (' + real + ' players — unfinished block)'); return; }
      // a block laid out differently (class or height sitting in the Name column) parses to "players"
      // named "Sr." / "Fr." / "6-5" — that is a layout mismatch, never a roster
      var junk = team.players.filter(function (p) { return /^((R-|RS-?)?(Fr|So|Jr|Sr|Gr)\.?|\d{1,2}|\d-\d{1,2})$/i.test(String(p.name || '').trim()); }).length;
      if (junk > 1) { skipped.push(team.name + ' (Name column holds class/height — block uses a different column layout)'); return; }
      try {
        upsertTeam(team, rk.rankMap, rk.prevRankMap, rk.tierMap);
        sbDelete('/rest/v1/losses?team=eq.' + encodeURIComponent(team.name));
        insertLosses(team);
        var res = insertPlayers(team);
        if (res.bad === 0) {
          sbDelete('/rest/v1/players?team=eq.' + encodeURIComponent(team.name) + '&updated_at=lt.' + encodeURIComponent(start));
        } else {
          kept.push(team.name);
          Logger.log('⚠️ ' + team.name + ': ' + real + ' parsed, ' + res.saved + ' saved, ' + res.bad + ' failed — existing roster KEPT.');
        }
        teamsDone++;
        players += res.saved;
      } catch (e) {
        Logger.log('❌ ' + team.name + ': ' + e.message + ' — existing roster KEPT.');
      }
    });
    Logger.log('✅ ' + tab + ': ' + teams.length + ' teams');
  }

  props.deleteProperty(MORE_PROP);
  // link ESPN ids (headshots + history) and fill box lines for the new players — same RPCs as the main sync
  try { sbPost('/rest/v1/rpc/backfill_espn_ids', {}); } catch (e) { Logger.log('ESPN id backfill skipped: ' + e.message); }
  try { sbPost('/rest/v1/rpc/backfill_player_stats', {}); } catch (e) { Logger.log('Stat backfill skipped: ' + e.message); }
  if (skipped.length) Logger.log('Skipped (left exactly as they are): ' + skipped.join(', '));
  moreNotice('More conferences synced', 'Finished: ' + teamsDone + ' teams this run, ' + players + ' players saved' +
    (kept.length ? '. Kept old roster (check these blocks): ' + kept.join(', ') : '') +
    (skipped.length ? '. Skipped ' + skipped.length + ' (see log): duplicates of main-tab teams or unfinished blocks' : '') + '.');
}
