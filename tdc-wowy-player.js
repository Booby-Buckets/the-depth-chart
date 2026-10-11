/* tdc-wowy-player.js — the player page's On/Off tab (Oct 2026, owner: "add WOWY and on/off to the player page").
   Same numbers as wowy.html, for one player: his team with him on the floor vs off it (net, ratings and the four
   factors, with a luck-adjusted switch), his RAPM with its D-I rank, and his two-man units (WOWY with each
   teammate). Data: scripts/data/wowy_index.json (which seasons he has), wowy_<season>.json (the season's players
   + league averages), wowy_pairs_<season>.json (two-man units) — built by scripts/build_wowy.py +
   build_wowy_player.py. Usage: TDC_WOWYP.render(hostEl, {espn}) */
(function () {
  'use strict';
  var IDX = null, SEAS = {}, PAIRS = {};
  var get = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var lbl = function (y) { return (y - 1) + '-' + String(y).slice(2); };
  // key, label, higher is better (1) or worse (-1), size of a meaningful gap (for shading)
  var ROWS = [['net', 'Net rating', 1, 8, 'Points per 100 possessions the team outscores opponents by'],
    ['o', 'Offensive rating', 1, 5, 'Points scored per 100 possessions'], ['d', 'Defensive rating', -1, 5, 'Points allowed per 100 possessions (lower is better)'],
    ['ts', 'TS%', 1, 3, 'True shooting'], ['efg', 'eFG%', 1, 3, ''], ['tp', '3P%', 1, 3, ''], ['tpar', '3PA rate', 1, 6, 'Share of shots that are threes'],
    ['tov', 'TOV%', -1, 2, 'Turnovers per 100 possessions'], ['orb', 'ORB%', 1, 4, 'Share of its misses the team rebounds'], ['ftr', 'FT rate', 1, 6, 'Free-throw attempts per shot'],
    ['ots', 'Opp TS%', -1, 3, ''], ['otp', 'Opp 3P%', -1, 3, ''], ['otov', 'Opp TOV%', 1, 2, ''], ['drb', 'DRB%', 1, 4, 'Share of opponent misses the team rebounds']];
  var LUCK = false;
  var K = function (k) { return LUCK ? ({ o: 'ol', d: 'dl', net: 'netl' }[k] || k) : k; };
  function cls(gap, dir, sc) { if (gap == null || !isFinite(gap)) return ''; var g = gap * dir / sc; return g >= 1.5 ? 'c4' : g >= 0.5 ? 'c3' : g <= -1.5 ? 'c0' : g <= -0.5 ? 'c1' : 'c2'; }
  var f1 = function (v) { return v == null || !isFinite(v) ? '—' : (+v).toFixed(1); };
  var sg = function (v) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + (+v).toFixed(1); };
  function css() {
    if (document.getElementById('wyp-css')) return;
    var s = document.createElement('style'); s.id = 'wyp-css';
    s.textContent = '.wyp-top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px}' +
      '.wyp-seg{display:inline-flex;border:1px solid var(--border2);border-radius:8px;overflow:hidden}.wyp-seg button{background:none;border:0;border-left:1px solid var(--border2);padding:6px 12px;font:700 12.5px Inter,system-ui,sans-serif;color:var(--text2);cursor:pointer}' +
      '.wyp-seg button:first-child{border-left:0}.wyp-seg button.on{background:var(--text);color:var(--bg)}' +
      '.wyp-note{font-size:12px;color:var(--text3);margin:2px 0 12px;line-height:1.5}.wyp-note b{color:var(--text2)}' +
      '.wyp-h{font:800 11px Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin:20px 0 8px;display:flex;justify-content:space-between;gap:10px}' +
      '.wyp-h a{color:var(--accent);text-transform:none;letter-spacing:0;font-weight:700;text-decoration:none}' +
      '.wyp-kpi{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--border);border-radius:10px;overflow:hidden;margin:0 0 6px}' +
      '.wyp-kpi div{padding:10px 12px;border-left:1px solid var(--border)}.wyp-kpi div:first-child{border-left:0}' +
      '.wyp-kpi span{display:block;font:700 10px Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)}' +
      '.wyp-kpi b{display:block;font:800 22px Inter,system-ui,sans-serif;margin-top:2px}.wyp-kpi i{font-style:normal;font-size:11.5px;color:var(--text3)}' +
      '.wyp-tbl td.l{white-space:nowrap}.wyp-tbl td.oo{font-weight:800}.wyp-luck{display:flex;gap:6px;align-items:center;font-size:12.5px;color:var(--text2)}' +
      '@media(max-width:640px){.wyp-kpi{grid-template-columns:1fr 1fr}.wyp-kpi div:nth-child(3){border-left:0}.wyp-kpi div:nth-child(n+3){border-top:1px solid var(--border)}}';
    document.head.appendChild(s);
  }
  function render(host, opts) {
    if (!host) return; css();
    var espn = opts && opts.espn != null ? String(opts.espn) : null;
    if (!espn) { host.innerHTML = '<div class="wyp-note">On/off needs a matched player id; this player has none yet.</div>'; return; }
    host.innerHTML = '<div class="wyp-note">Loading on/off…</div>';
    (IDX ? Promise.resolve(IDX) : get('scripts/data/wowy_index.json?v=1').then(function (j) { IDX = j || {}; return IDX; })).then(function (I) {
      var seasons = I[espn] || [];
      if (!seasons.length) { host.innerHTML = '<div class="wyp-note">No on/off data for him yet. On/off is rebuilt from play-by-play lineups for 2023-24 through 2025-26; players need 30+ minutes in a season.</div>'; return; }
      var cur = seasons[0];
      var draw = function () {
        host.innerHTML = '<div class="wyp-note">Loading ' + lbl(cur) + '…</div>';
        Promise.all([SEAS[cur] ? Promise.resolve(SEAS[cur]) : get('scripts/data/wowy_' + cur + '.json?v=5').then(function (j) { SEAS[cur] = j; return j; }),
          PAIRS[cur] ? Promise.resolve(PAIRS[cur]) : get('scripts/data/wowy_pairs_' + cur + '.json?v=1').then(function (j) { PAIRS[cur] = j || {}; return PAIRS[cur]; })]).then(function (r) {
          var S = r[0], PR = r[1] || {};
          if (!S) { host.innerHTML = '<div class="wyp-note">Could not load ' + lbl(cur) + '.</div>'; return; }
          var p = (S.players || []).find(function (x) { return String(x.id) === espn; });
          if (!p) { host.innerHTML = '<div class="wyp-note">No ' + lbl(cur) + ' on/off for him.</div>'; return; }
          var L = S.league || {}, on = p.on || {}, off = p.off || null;
          // RAPM rank among players with 500+ on-court possessions that season
          var pool = (S.players || []).filter(function (x) { return x.rapm && x.on && x.on.poss >= 500; }).map(function (x) { return x.rapm.net; }).sort(function (a, b) { return b - a; });
          var rk = p.rapm ? 1 + pool.filter(function (v) { return v > p.rapm.net; }).length : null;
          var team = window.tdcShortSchool ? tdcShortSchool(p.team) : p.team;
          var oo = function (k) { k = K(k); return off && on[k] != null && off[k] != null ? on[k] - off[k] : null; };
          var html = '<div class="wyp-top"><span class="wyp-seg">' + seasons.map(function (y) { return '<button class="' + (y === cur ? 'on' : '') + '" data-y="' + y + '">' + lbl(y) + '</button>'; }).join('') + '</span>' +
            '<label class="wyp-luck" title="Sets the team\'s own free-throw shooting and the opponent\'s 3-point and free-throw shooting to the D-I average"><input type="checkbox" id="wypLuck"' + (LUCK ? ' checked' : '') + '> Luck adjusted</label></div>' +
            '<div class="wyp-note"><b>' + esc(team) + '</b> · ' + Math.round(on.min || 0) + ' minutes on the floor' + (off ? ', ' + Math.round(off.min || 0) + ' off' : '') + ' · ' + (p.g || 0) + ' games · garbage time removed' + (on.poss < 300 || (off && off.poss < 150) ? ' · <b>small sample</b>' : '') + '</div>' +
            '<div class="wyp-kpi">' +
              '<div><span>On-off net</span><b class="' + (oo('net') > 0 ? 'up' : 'dn') + '">' + sg(oo('net')) + '</b><i>team with him minus without</i></div>' +
              '<div><span>Net with him</span><b>' + sg(on[K('net')]) + '</b><i>per 100 possessions</i></div>' +
              '<div><span>RAPM</span><b>' + (p.rapm ? sg(p.rapm.net) : '—') + '</b><i>' + (p.rapm ? 'O ' + sg(p.rapm.o) + ' · D ' + sg(p.rapm.d) : '') + '</i></div>' +
              '<div><span>RAPM rank</span><b>' + (rk ? '#' + rk : '—') + '</b><i>' + (rk ? 'of ' + pool.length + ' (500+ poss)' : 'needs 500+ possessions') + '</i></div></div>' +
            '<div class="wyp-h"><span>With him on the floor vs off</span><a href="wowy.html?team=' + encodeURIComponent(p.team) + '&season=' + cur + '">Full ' + esc(team) + ' WOWY →</a></div>' +
            '<div class="sheet-wrap" style="max-height:none"><table class="sheet dense wyp-tbl"><thead><tr><th class="l">Team stat</th><th>On</th><th>Off</th><th>On − off</th><th>D-I avg</th></tr></thead><tbody>' +
            ROWS.map(function (R) { var k = R[0], a = on[K(k)], b = off ? off[K(k)] : null, d = oo(k), lg = L[k];
              return '<tr' + (R[4] ? ' title="' + esc(R[4]) + '"' : '') + '><td class="l">' + R[1] + '</td><td class="' + cls(k === 'net' ? a : (a != null && lg != null ? a - lg : null), R[2], R[3]) + '">' + f1(a) + '</td><td>' + f1(b) + '</td>' +
                '<td class="oo ' + cls(d, R[2], R[3]) + '">' + sg(d) + '</td><td class="dim">' + (k === 'net' ? '0.0' : f1(lg)) + '</td></tr>'; }).join('') +
            '</tbody></table></div>';
          var pr = PR[espn] || [];
          html += '<div class="wyp-h"><span>Two-man units · with each teammate</span><span>' + (pr.length ? 'most minutes first' : '') + '</span></div>';
          html += pr.length ? '<div class="sheet-wrap" style="max-height:none"><table class="sheet dense wyp-tbl"><thead><tr><th class="l">With</th><th>Min</th><th>Net</th><th>Off</th><th>Def</th></tr></thead><tbody>' +
            pr.map(function (x) { var n = LUCK && x[4] != null ? x[4] : x[3];
              return '<tr><td class="l"><a href="player.html?espn=' + esc(x[0]) + '">' + esc(x[1] || x[0]) + '</a></td><td>' + Math.round(x[2] || 0) + '</td><td class="oo ' + cls(n, 1, 8) + '">' + sg(n) + '</td><td>' + f1(x[5]) + '</td><td>' + f1(x[6]) + '</td></tr>'; }).join('') +
            '</tbody></table></div>' : '<div class="wyp-note">No two-man units with enough possessions.</div>';
          html += '<div class="wyp-note" style="margin-top:12px">On/off compares how ' + esc(team) + ' played with him on the floor against the minutes he sat. RAPM adjusts for who he played with and against. Rebuilt from play-by-play substitutions' + (cur <= 2025 ? ' (lineups from CollegeBasketballData)' : '') + '.</div>';
          host.innerHTML = html;
          host.querySelectorAll('[data-y]').forEach(function (b) { b.onclick = function () { cur = +b.dataset.y; draw(); }; });
          var lk = host.querySelector('#wypLuck'); if (lk) lk.onchange = function () { LUCK = lk.checked; draw(); };
        });
      };
      draw();
    });
  }
  window.TDC_WOWYP = { render: render };
})();
