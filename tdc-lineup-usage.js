/* tdc-lineup-usage.js — who actually shared the floor, and at which position (team Lineups tab; owner, Nov 2026).
 * Data: scripts/data/lineup_usage/<season>/<slug>.json (build_lineup_usage.py: every five per game from ESPN substitutions).
 *   TDCLineupUsage.render(host, fullTeamName)
 * The build places each five (F.o, PG..C) closest to everyone's listed positions. Position shares and lineups are totalled for
 * the chosen window in the browser.
 */
(function (g) {
  'use strict';
  var SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'], SEASONS = [2027, 2026], WINS = [['all', 'Season', 0], ['15', 'Last 15', 15], ['10', 'Last 10', 10], ['5', 'Last 5', 5]];
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
    s.textContent = '.luu-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin:0 0 14px}' +
      '.luu-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--border);border-radius:9px;background:var(--bg2)}' +
      '.luu-seg button{border:0;border-radius:7px;background:none;color:var(--text3);font:700 11px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;padding:6px 12px;cursor:pointer;min-height:30px}' +
      '.luu-seg button:hover{color:var(--text)}.luu-seg button.on{background:var(--accent);color:var(--accent-on,#221c08)}.luu-seg button:disabled{opacity:.35;cursor:default}' +
      '.luu-depth{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:0 0 22px}' +
      '.luu-col{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--panel,var(--bg));min-width:0}' +
      '.luu-col h4{margin:0;padding:7px 10px;background:var(--bg2);border-bottom:1px solid var(--border);font:800 11px Inter,system-ui,sans-serif;letter-spacing:.1em;color:var(--text)}' +
      '.luu-p{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-bottom:1px solid var(--border);font:600 12px Inter,system-ui,sans-serif;color:var(--text);text-decoration:none;min-height:36px;box-sizing:border-box}' +
      '.luu-p:last-child{border-bottom:0}.luu-p:hover .luu-n{text-decoration:underline}' +
      '.luu-p i{position:absolute;left:0;top:0;bottom:0;background:var(--accent);opacity:.16;pointer-events:none}' +
      '.luu-n{position:relative;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.luu-n small{display:block;font:500 10px Inter,system-ui,sans-serif;color:var(--text3)}' +
      '.luu-v{position:relative;font-weight:800;font-variant-numeric:tabular-nums;flex:0 0 auto}' +
      '.luu-tbl td a{color:inherit;text-decoration:none}.luu-tbl td a:hover{text-decoration:underline}.luu-tbl td small{display:block;font:500 10px Inter,system-ui,sans-serif;color:var(--text3)}' +
      '.luu-more{appearance:none;background:none;border:1px solid var(--border);border-radius:7px;color:var(--text2,var(--text));font:700 11px Inter,system-ui,sans-serif;padding:7px 12px;margin:10px 0 0;cursor:pointer;min-height:32px}' +
      '.luu-note{font:500 11px/1.45 Inter,system-ui,sans-serif;color:var(--text3);margin:10px 0 22px}' +
      '.luu-narrow{display:none}.luu-five{white-space:normal!important;line-height:1.5}.luu-five span{display:block;white-space:nowrap}.luu-five b{display:inline-block;width:24px;font-size:10px;color:var(--text3)}' +
      '@media(max-width:900px){.luu-depth{grid-template-columns:minmax(0,1fr)}.luu-seg button{padding:6px 10px;min-height:34px}}' +
      '@media(max-width:760px){.luu-wide{display:none}.luu-narrow{display:block}}';
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
  function view(F, win, full, more) {
    var w = WINS.filter(function (x) { return x[0] === win; })[0] || WINS[0], T = totals(F, w[2]), N = namer(F);
    if (!T.all) return '<div class="empty-note" style="padding:14px 0;">No lineup data for this window.</div>';
    var depth = '<div class="luu-depth">' + SLOTS.map(function (sl, i) {
      var list = Object.keys(T.slots[i]).map(function (k) { return [k, 100 * T.slots[i][k] / T.all]; }).sort(function (a, b) { return b[1] - a[1]; }).filter(function (x, j) { return j < 2 || x[1] >= 3; }).slice(0, 5);
      return '<div class="luu-col"><h4>' + sl + '</h4>' + list.map(function (x) {
        var p = F.p[x[0]] || [x[0]], sub = [ht(p[2]), p[3]].filter(Boolean).join(' · ');
        return '<a class="luu-p" href="' + plink(x[0]) + '"><i style="width:' + Math.min(100, x[1]).toFixed(1) + '%"></i><span class="luu-n">' + esc(N(x[0])) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><span class="luu-v">' + Math.round(x[1]) + '%</span></a>';
      }).join('') + '</div>';
    }).join('') + '</div>';
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
    var rl = (F.season === 2027 && g.TDCReal) ? g.TDCReal.team(full) : null, of = (rl && !w[2]) ? ' of ' + rl.gp : '';
    return '<div class="lu-h"><h3>Depth chart by position</h3><small>Share of team minutes at each spot, ' + w[1].toLowerCase() + ': ' + T.games + of + (T.games === 1 ? ' game' : ' games') + '</small></div>' + depth +
      '<div class="lu-h"><h3>Most used lineups</h3><small>' + T.rows.length + ' different fives</small></div>' + tbl +
      '<div class="luu-note">From substitutions in the play-by-play. Each five is placed by listed position, height and how the player actually plays, so a three-guard lineup moves its biggest guard to the 3. Games with incomplete substitution data are left out.</div>';
  }
  function render(host, full) {
    css(); host.innerHTML = '';
    return Promise.all(SEASONS.map(function (y) { return load(full, y); })).then(function (fs) {
      var have = SEASONS.map(function (y, i) { return { y: y, F: fs[i] }; }).filter(function (x) { return x.F && x.F.g && x.F.g.length; });
      if (!have.length) return;
      var cur = have[0], win = 'all', more = false;
      function draw() {
        var F = cur.F, n = F.g.length;
        var sb = have.length > 1 ? '<div class="luu-seg" data-k="s">' + have.map(function (x) { return '<button data-v="' + x.y + '" class="' + (x === cur ? 'on' : '') + '">' + (x.y - 1) + '-' + String(x.y).slice(2) + '</button>'; }).join('') + '</div>' : '';
        var wb = '<div class="luu-seg" data-k="w">' + WINS.map(function (w) { return '<button data-v="' + w[0] + '" class="' + (w[0] === win ? 'on' : '') + '"' + (w[2] && n <= w[2] ? ' disabled title="Only ' + n + ' games so far"' : '') + '>' + w[1] + '</button>'; }).join('') + '</div>';
        host.innerHTML = '<div class="luu-bar">' + sb + wb + '</div>' + view(F, win, full, more);
        host.querySelectorAll('.luu-seg[data-k=s] button').forEach(function (b) { b.onclick = function () { cur = have.filter(function (x) { return String(x.y) === b.dataset.v; })[0]; win = 'all'; more = false; draw(); }; });
        host.querySelectorAll('.luu-seg[data-k=w] button').forEach(function (b) { b.onclick = function () { if (b.disabled) return; win = b.dataset.v; draw(); }; });
        var m = host.querySelector('.luu-more'); if (m) m.onclick = function () { more = !more; draw(); };
        if (g.tdcSheetHeat) { /* the +/- column carries its own shading; no percentile heat on names */ }
      }
      draw();
    });
  }
  g.TDCLineupUsage = { render: render };
})(window);
