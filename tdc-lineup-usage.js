/* tdc-lineup-usage.js — who actually shared the floor, and at which position (team Lineups tab; owner, Nov 2026).
 * Data: scripts/data/lineup_usage/<season>/<slug>.json (build_lineup_usage.py: every five per game from ESPN substitutions).
 *   TDCLineupUsage.seasons(full) -> Promise<[years with data]>
 *   TDCLineupUsage.draw(host, full, season, lastNGames (0 = the season), windowLabel) -> Promise<games on file>
 * The build places each five (F.o, PG..C) closest to everyone's listed positions. Position shares and lineups are totalled for
 * the chosen window in the browser.
 */
(function (g) {
  'use strict';
  var SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'], SEASONS = [2027, 2026];
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var slug = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
  var ht = function (h) { return h ? Math.floor(h / 12) + '-' + (h % 12) : ''; };
  var mins = function (s) { return Math.round(s / 60); };
  function load(full, yr) {
    return fetch('scripts/data/lineup_usage/' + yr + '/' + slug(full) + '.json?h=' + Math.floor(Date.now() / 36e5)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function css() {
    if (document.getElementById('luu-css')) return;
    var s = document.createElement('style'); s.id = 'luu-css';
    s.textContent = '.luu-pos td{vertical-align:middle}.luu-sl{font-weight:800;letter-spacing:.06em;width:44px}' +
      '.luu-pos td a{font-weight:600;margin-right:8px}.luu-pos td b{font-weight:800;font-variant-numeric:tabular-nums;color:var(--text3)}.luu-pos td:nth-child(2) b{color:var(--text)}' +
      '.luu-stack span{display:flex;justify-content:space-between;gap:10px;line-height:1.6}' +
      '.luu-where th,.luu-where td{text-align:center}.luu-where .l{text-align:left}' +
      '.luu-tbl td a{color:inherit;text-decoration:none}.luu-tbl td a:hover{text-decoration:underline}.luu-tbl td small{display:block;font:500 10px Inter,system-ui,sans-serif;color:var(--text3)}' +
      '.luu-more{appearance:none;background:none;border:1px solid var(--border);border-radius:7px;color:var(--text2,var(--text));font:700 11px Inter,system-ui,sans-serif;padding:7px 12px;margin:10px 0 0;cursor:pointer;min-height:32px}' +
      '.luu-note{font:500 11px/1.45 Inter,system-ui,sans-serif;color:var(--text3);margin:10px 0 22px}' +
      '.luu-wide+.lu-h{margin-top:26px}.luu-narrow{display:none}.luu-five{white-space:normal!important;line-height:1.5}.luu-five span{display:block;white-space:nowrap}.luu-five b{display:inline-block;width:24px;font-size:10px;color:var(--text3)}' +
      '@media(max-width:760px){.luu-wide{display:none}.luu-narrow{display:block}.luu-where th:nth-child(2),.luu-where td:nth-child(2){display:none}.luu-where th,.luu-where td{padding-left:3px!important;padding-right:3px!important;font-size:12px}.luu-where td.nm{padding-left:8px!important;overflow-wrap:anywhere;white-space:normal!important}}';
    document.head.appendChild(s);
  }
  // last names, unless two players on the team share one
  function namer(F) {
    var last = {}; Object.keys(F.p).forEach(function (k) { var n = String(F.p[k][0] || '').trim().split(' ').filter(function (w) { return !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w); }).pop() || ''; last[n] = (last[n] || 0) + 1; });
    return function (k) { var full = String((F.p[k] || [k])[0] || k), n = full.trim().split(' ').filter(function (w) { return !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w); }).pop() || full; return last[n] > 1 ? full : n; };
  }
  function totals(F, n) {
    var G = n ? F.g.slice(-n) : F.g, byL = {}, slots = SLOTS.map(function () { return {}; }), all = 0;
    G.forEach(function (x) {
      x[3].forEach(function (r) {
        var L = byL[r[0]] || (byL[r[0]] = { i: r[0], s: 0, pf: 0, pa: 0, games: 0 });
        L.s += r[1]; L.pf += r[2]; L.pa += r[3]; L.games++; all += r[1];
        F.o[r[0]].forEach(function (k, si) { slots[si][k] = (slots[si][k] || 0) + r[1]; });
      });
    });
    return { games: G.length, all: all, rows: Object.keys(byL).map(function (k) { return byL[k]; }).sort(function (a, b) { return b.s - a.s; }), slots: slots };
  }
  function plink(k) { return /^\d+$/.test(k) ? 'player.html?espn=' + encodeURIComponent(k) : '#'; }
  function view(F, n, label, full, more) {
    var T = totals(F, n), N = namer(F);
    if (!T.all) return '';
    // one table, a row per spot. Phones get the players stacked, because the shared mobile fit hides columns from the right
    var spots = SLOTS.map(function (sl, i) {
      return { sl: sl, list: Object.keys(T.slots[i]).map(function (k) { return [k, 100 * T.slots[i][k] / T.all]; }).sort(function (a, b) { return b[1] - a[1]; }).filter(function (x, j) { return j < 2 || x[1] >= 3; }).slice(0, 5) };
    });
    var cell = function (x) { var p = F.p[x[0]] || [x[0]], sub = [ht(p[2]), p[3]].filter(Boolean).join(' · '); return '<a href="' + plink(x[0]) + '"' + (sub ? ' title="' + esc(sub) + '"' : '') + '>' + esc(N(x[0])) + '</a><b>' + Math.round(x[1]) + '%</b>'; };
    var cols = Math.max.apply(null, spots.map(function (r) { return r.list.length; }));
    var head = ''; for (var c = 0; c < cols; c++) head += '<th class="l">' + (c === 0 ? 'Most minutes' : c === 1 ? 'Next' : '') + '</th>';
    var depth = '<div data-fit-keep class="luu-wide"><div class="sheet-wrap" style="max-height:none;"><table class="sheet dense luu-tbl luu-pos"><thead><tr><th class="l">Spot</th>' + head + '</tr></thead><tbody>' +
      spots.map(function (r) { var h = ''; for (var c = 0; c < cols; c++) h += '<td class="l">' + (r.list[c] ? cell(r.list[c]) : '') + '</td>'; return '<tr><td class="l luu-sl">' + r.sl + '</td>' + h + '</tr>'; }).join('') + '</tbody></table></div></div>' +
      '<div data-fit-keep class="luu-narrow"><div class="sheet-wrap" style="max-height:none;"><table class="sheet dense luu-tbl luu-pos"><thead><tr><th class="l">Spot</th><th class="l">Share of minutes</th></tr></thead><tbody>' +
      spots.map(function (r) { return '<tr><td class="l luu-sl">' + r.sl + '</td><td class="l luu-stack">' + r.list.map(function (x) { return '<span>' + cell(x) + '</span>'; }).join('') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    // each player's minutes split by spot: the same data read from the player's side
    var pm = {}; T.rows.forEach(function (L) { F.o[L.i].forEach(function (k, si) { (pm[k] = pm[k] || [0, 0, 0, 0, 0])[si] += L.s; }); });
    var tot = function (k) { return pm[k].reduce(function (a, b) { return a + b; }, 0); };
    var who = Object.keys(pm).sort(function (a, b) { return tot(b) - tot(a); }).slice(0, 10);
    var where = '<div class="lu-h"><h3>Who plays where</h3><small>Each player\'s minutes split by position</small></div><div data-fit-keep><div class="sheet-wrap" style="max-height:none;"><table class="sheet dense luu-tbl luu-where"><thead><tr><th class="l">Player</th><th>MIN</th>' + SLOTS.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr></thead><tbody>' +
      who.map(function (k) { var t = tot(k); return '<tr><td class="l nm"><a href="' + plink(k) + '">' + esc(N(k)) + '</a></td><td class="dim">' + mins(t) + '</td>' + pm[k].map(function (v, si) { var p = Math.round(100 * v / t); return p ? '<td style="background:rgba(168,136,71,' + Math.min(0.9, p / 100).toFixed(2) + ')' + (p >= 55 ? ';color:#1a1408;font-weight:800' : '') + '" title="' + SLOTS[si] + ': ' + mins(v) + ' minutes">' + p + '%</td>' : '<td></td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></div>';
    var rows = T.rows.slice(0, more ? 40 : 10).map(function (L, i) {
      var five = F.o[L.i], pm = L.pf - L.pa;
      return '<tr><td class="c dim">' + (i + 1) + '</td>' + five.map(function (k) { return '<td class="l nm"><a href="' + plink(k) + '">' + esc(N(k)) + '</a></td>'; }).join('') +
        '<td>' + mins(L.s) + '</td><td class="strong">' + (100 * L.s / T.all).toFixed(1) + '%</td><td>' + L.games + '</td><td class="' + (pm >= 5 ? 'c4' : pm > 0 ? 'c3' : pm <= -5 ? 'c0' : pm < 0 ? 'c1' : '') + '">' + (pm > 0 ? '+' : '') + pm + '</td></tr>';
    }).join('');
    // phones: the five read as one cell, because the shared mobile fit would otherwise hide SG through C
    var narrow = T.rows.slice(0, more ? 40 : 10).map(function (L, i) {
      var five = F.o[L.i], pm = L.pf - L.pa;
      return '<tr><td class="l luu-five">' + five.map(function (k, si) { return '<span><b>' + SLOTS[si] + '</b> <a href="' + plink(k) + '">' + esc(N(k)) + '</a></span>'; }).join('') + '</td><td>' + mins(L.s) + '</td><td class="strong">' + (100 * L.s / T.all).toFixed(1) + '%</td><td class="' + (pm >= 5 ? 'c4' : pm > 0 ? 'c3' : pm <= -5 ? 'c0' : pm < 0 ? 'c1' : '') + '">' + (pm > 0 ? '+' : '') + pm + '</td></tr>';
    }).join('');
    var tbl = '<div data-fit-keep class="luu-narrow"><div class="sheet-wrap" style="max-height:none;"><table class="sheet dense luu-tbl"><thead><tr><th class="l">Lineup</th><th>MIN</th><th>%</th><th>+/-</th></tr></thead><tbody>' + narrow + '</tbody></table></div></div>' +
      '<div data-fit-keep class="luu-wide"><div class="sheet-wrap" style="max-height:none;"><table class="sheet dense luu-tbl"><thead><tr><th class="c">#</th>' + SLOTS.map(function (s) { return '<th class="l">' + s + '</th>'; }).join('') +
      '<th title="Minutes this five played together">MIN</th><th title="Share of the team\'s minutes">%</th><th title="Games this five played in">G</th><th title="Points for minus points against while on the floor">+/-</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
      (T.rows.length > 10 ? '<button class="luu-more" data-more="1">' + (more ? 'Show top 10' : 'Show more (' + Math.min(40, T.rows.length) + ')') + '</button>' : '');
    var rl = (F.season === 2027 && g.TDCReal) ? g.TDCReal.team(full) : null, of = (rl && !n) ? ' of ' + rl.gp : '';
    return '<div class="lu-h"><h3>Depth chart by position</h3><small>Share of team minutes at each spot · ' + label + ': ' + T.games + of + (T.games === 1 ? ' game' : ' games') + '</small></div>' + depth + where +
      '<div class="lu-h"><h3>Most used lineups</h3><small>' + T.rows.length + ' different fives</small></div>' + tbl +
      '<div class="luu-note">From substitutions in the play-by-play. Each five is placed by listed position, height and how the player actually plays. Games with incomplete substitution data are left out.</div>';
  }
  var _files = {};
  function file(full, yr) { var k = full + '|' + yr; if (!_files[k]) _files[k] = load(full, yr); return _files[k]; }
  // the seasons with lineup data, and one season's section for the tab's chosen window (n games, 0 = the season)
  function seasons(full) { return Promise.all(SEASONS.map(function (y) { return file(full, y); })).then(function (fs) { return SEASONS.filter(function (y, i) { return fs[i] && fs[i].g && fs[i].g.length; }); }); }
  function draw(host, full, yr, n, label) {
    css(); var more = false;
    return file(full, yr).then(function (F) {
      if (!F || !F.g || !F.g.length) { host.innerHTML = ''; return 0; }
      function paint() {
        host.innerHTML = view(F, n, label, full, more);
        var m = host.querySelector('.luu-more'); if (m) m.onclick = function () { more = !more; paint(); };
      }
      paint();
      return F.g.length;
    });
  }
  g.TDCLineupUsage = { seasons: seasons, draw: draw };
})(window);
