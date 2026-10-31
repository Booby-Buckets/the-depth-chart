/* tdc-statshift-player.js — the player page's Stat Line Shift tab (statshift.html for one player).
 *
 *   TDC_SHIFT.compare(host, [{espn,name,season},…], wrap)  compare page: together vs apart, or each one's top teammates
 *   TDC_SHIFT.renderTeam(host, {team})   team page: every player's line without -> with a picked teammate
 *   TDC_SHIFT.renderPlayer(host, {espn, name})
 *     "His line with each teammate": his own line without -> with each teammate on the floor
 *     "Teammates with him":          each teammate's line without -> with him on the floor
 *
 * Data: scripts/data/statshift/<season>/{players.json (espn -> team file), <team>.json} from
 * scripts/build_statshift.py. Each vector = his box (13), his team's box (13), the opponent's box (13), seconds.
 * "Without" = his total minus "with" (includes games the teammate missed). Garbage time is removed.
 */
(function () {
  var BASE = 'scripts/data/statshift/', V = '?v=1', SEASONS = [2026, 2025];
  var F = ['pts', 'fga', 'fgm', 'tpa', 'tpm', 'fta', 'ftm', 'orb', 'drb', 'tov', 'ast', 'stl', 'blk'], N = F.length, I = {};
  F.forEach(function (f, i) { I[f] = i; });
  var CACHE = {};
  function get(f) { return CACHE[f] || (CACHE[f] = fetch(BASE + f + V).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sl(y) { return (y - 1) + '-' + String(y).slice(2); }
  function poss(v, o) { return Math.max(0, v[o + I.fga] - v[o + I.orb] + v[o + I.tov] + 0.44 * v[o + I.fta]); }
  function k70(v) { var p = (poss(v, N) + poss(v, 2 * N)) / 2; return p > 0 ? 70 / p : null; }
  function cnt(f) { return function (v) { var k = k70(v); return k == null ? null : v[I[f]] * k; }; }
  function pct(n, d, min) { return d >= min ? 100 * n / d : null; }
  // same definitions and shading as statshift.html: label, value, better direction (0 = unshaded), a big change
  var S = {
    usg: ['USG', function (v) { var t = v[N + I.fga] + 0.44 * v[N + I.fta] + v[N + I.tov]; return t > 0 ? 100 * (v[I.fga] + 0.44 * v[I.fta] + v[I.tov]) / t : null; }, 0, 3],
    pts: ['PTS', cnt('pts'), 1, 3],
    ast: ['AST', cnt('ast'), 1, 1.2],
    reb: ['REB', function (v) { var k = k70(v); return k == null ? null : (v[I.orb] + v[I.drb]) * k; }, 1, 1.5],
    tov: ['TOV', cnt('tov'), -1, 0.8],
    ts: ['TS%', function (v) { return pct(v[I.pts], 2 * (v[I.fga] + 0.44 * v[I.fta]), 8); }, 1, 4],
    tp: ['3P%', function (v) { return pct(v[I.tpm], v[I.tpa], 8); }, 1, 5],
    pm: ['+/-', function (v) { var k = k70(v); return k == null ? null : (v[N + I.pts] - v[2 * N + I.pts]) * k; }, 0, 6]
  };
  var COLS = ['usg', 'pts', 'ast', 'reb', 'tov', 'ts', 'tp', 'pm'];
  function heat(k, d) { var s = S[k]; if (!s[2] || d == null) return ''; var g = d * s[2] / s[3]; return g >= 1.5 ? 'c4' : g >= 0.5 ? 'c3' : g <= -1.5 ? 'c0' : g <= -0.5 ? 'c1' : 'c2'; }
  function f1(v) { return v == null ? '—' : (+v).toFixed(1); }
  function sg(v) { if (v == null) return ''; var r = +(+v).toFixed(1); return (r > 0 ? '+' : '') + r.toFixed(1); }
  function sub(a, b) { return a.map(function (x, i) { return x - b[i]; }); }

  function css() {
    if (document.getElementById('ssp-css')) return;
    var s = document.createElement('style'); s.id = 'ssp-css';
    s.textContent =
      '.ssp-ctl{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px}' +
      '.ssp-ctl select{background:var(--bg2);border:1px solid var(--border2);border-radius:8px;color:var(--text);font:600 13px Inter,system-ui,sans-serif;padding:6px 9px}' +
      '.ssp-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--border);border-radius:9px;background:var(--bg2)}' +
      '.ssp-seg button{background:none;border:0;border-radius:7px;padding:6px 12px;font:700 11px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);cursor:pointer}' +
      '.ssp-seg button.on{background:var(--accent);color:var(--accent-on,#221c08)}' +
      '.ssp-ctl a{margin-left:auto;font-size:12.5px;font-weight:700;color:var(--text3);text-decoration:none}.ssp-ctl a:hover{color:var(--text)}' +
      '.ssp-note{font-size:12.5px;color:var(--text3);line-height:1.5;margin:0 0 10px}.ssp-note b{color:var(--text2)}' +
      '.ssp-tbl th[data-s]{cursor:pointer;white-space:nowrap}.ssp-tbl th.sorted{color:var(--accent)}' +
      '.ssp-tbl td.nm a{color:var(--text);font-weight:700;text-decoration:none;white-space:nowrap}.ssp-tbl td.nm a:hover{text-decoration:underline}' +
      '.ssp-tbl .sm{display:block;font-size:11px;font-weight:600;color:var(--text3);white-space:nowrap}' +
      '.ssp-tbl td.sh{white-space:nowrap;text-align:center}.ssp-tbl td .ab{display:block;font-weight:700;color:var(--text)}.ssp-tbl td .o{color:var(--text3);font-weight:600}' +
      '.ssp-tbl td .dl{display:block;font-size:10.5px;font-weight:800;margin-top:1px}' +
      '.ssp-tbl td .dl.up{color:var(--green,#1f8a45)}.ssp-tbl td .dl.dn{color:var(--red,#c0392b)}.ssp-tbl td .dl.n{color:var(--text3)}' +
      '.ssp-tbl tr.thin td{opacity:.5}' +
      '.ssp-pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.ssp-pair{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  }

  // find the seasons this player has data for: [{season, file}]
  function seasonsFor(id) {
    return Promise.all(SEASONS.map(function (y) { return get(y + '/players.json').then(function (m) { return m && m[id] ? { season: y, file: m[id] } : null; }); }))
      .then(function (a) { return a.filter(Boolean); });
  }

  function renderPlayer(host, o) {
    if (!host) return;
    css();
    var id = String((o && o.espn) || '');
    if (!id) { host.innerHTML = '<div class="ssp-note">No lineup data for this player.</div>'; return; }
    host.innerHTML = '<div class="ssp-note">Loading lineups…</div>';
    var st = { mode: 'his', sort: 'mw', desc: true, small: false };
    seasonsFor(id).then(function (list) {
      if (!list.length) { host.innerHTML = '<div class="ssp-note">No play-by-play lineup data for this player yet (2024-25 and 2025-26 D-I games with substitution logs).</div>'; return; }
      st.season = list[0].season;
      var draw = function () {
        var cur = list.find(function (x) { return x.season === st.season; });
        get(st.season + '/' + cur.file).then(function (D) {
          if (!D) { host.innerHTML = '<div class="ssp-note">Couldn\'t load the lineup file.</div>'; return; }
          var byId = {}; D.players.forEach(function (p) { byId[p.id] = p; });
          var me = byId[id]; if (!me) { host.innerHTML = '<div class="ssp-note">Under 10 minutes for ' + esc(D.team) + ' this season.</div>'; return; }
          var first = String((o && o.name) || me.name).split(' ')[0];
          var rows = D.players.filter(function (p) { return p.id !== id; }).map(function (p) {
            var base, w;
            if (st.mode === 'his') { base = me.all; w = (D.w[id] || {})[p.id]; }   // his line, split by teammate p
            else { base = p.all; w = (D.w[p.id] || {})[id]; }                      // teammate p's line, split by him
            w = w || base.map(function () { return 0; });
            var wo = sub(base, w), r = { p: p, mw: w[3 * N] / 60, mo: wo[3 * N] / 60, s: {} };
            COLS.forEach(function (k) { var a = S[k][1](wo), b = S[k][1](w); r.s[k] = [a, b, (a != null && b != null) ? b - a : null]; });
            return r;
          }).filter(function (r) { return st.small || (r.mw >= 15 && r.mo >= 15); });
          var key = st.sort;
          var val = function (r) { if (key === 'mw') return r.mw; var s = r.s[key]; return s && s[2] != null ? s[2] : -1e9; };
          rows.sort(function (a, b) { return st.desc ? val(b) - val(a) : val(a) - val(b); });
          var who = st.mode === 'his' ? 'Teammate' : 'Player';
          var head = '<th class="l" data-s="mw">' + who + '<span class="sm">min w/o → min w/</span></th>' + COLS.map(function (k) { return '<th data-s="' + k + '">' + S[k][0] + '</th>'; }).join('');
          var body = rows.map(function (r) {
            return '<tr class="' + ((r.mw < 40 || r.mo < 40) ? 'thin' : '') + '"><td class="l nm"><a href="player.html?espn=' + esc(r.p.id) + '">' + esc(r.p.name) + '</a><span class="sm">' + Math.round(r.mo) + ' w/o → ' + Math.round(r.mw) + ' w/</span></td>' +
              COLS.map(function (k) { var s = r.s[k], dir = S[k][2];
                return '<td class="sh ' + heat(k, s[2]) + '"><span class="ab"><span class="o">' + f1(s[0]) + '</span> → ' + f1(s[1]) + '</span><span class="dl ' + (s[2] == null ? '' : (!dir ? 'n' : (s[2] * dir > 0 ? 'up' : 'dn'))) + '">' + sg(s[2]) + '</span></td>'; }).join('') + '</tr>';
          }).join('');
          var note = st.mode === 'his'
            ? 'How <b>' + esc(first) + '\'s own line</b> changes with each teammate on the floor with him. Per 70 possessions; each cell reads without → with.'
            : 'How each teammate\'s line changes with <b>' + esc(first) + '</b> on the floor (' + Math.round(me.all[3 * N] / 60) + ' minutes). Per 70 possessions; each cell reads without → with.';
          host.innerHTML =
            '<div class="ssp-ctl">' +
              (list.length > 1 ? '<select id="sspSeason" aria-label="Season">' + list.map(function (x) { return '<option value="' + x.season + '"' + (x.season === st.season ? ' selected' : '') + '>' + sl(x.season) + '</option>'; }).join('') + '</select>' : '<span class="ssp-note" style="margin:0">' + sl(st.season) + '</span>') +
              '<span class="ssp-seg" id="sspMode"><button data-k="his" class="' + (st.mode === 'his' ? 'on' : '') + '">His line with each teammate</button><button data-k="mates" class="' + (st.mode === 'mates' ? 'on' : '') + '">Teammates with him</button></span>' +
              '<label class="ssp-note" style="margin:0;display:flex;gap:6px;align-items:center"><input type="checkbox" id="sspSmall"' + (st.small ? ' checked' : '') + '> Small samples</label>' +
              '<a href="statshift.html?team=' + encodeURIComponent(D.team) + '&with=' + encodeURIComponent(id) + (st.season !== 2026 ? '&season=' + st.season : '') + '">Open in Stat Line Shift →</a>' +
            '</div>' +
            '<div class="ssp-note">' + note + ' Green = better with him on the floor, red = worse; usage and +/- aren\'t shaded. "Without" includes games the other player missed. Garbage time removed.</div>' +
            '<div class="sheet-wrap" style="max-height:none"><table class="sheet dense ssp-tbl"><thead><tr>' + head + '</tr></thead><tbody>' +
              (body || '<tr><td class="l" colspan="9">No teammate with 15+ minutes on both sides. Tick "Small samples".</td></tr>') + '</tbody></table></div>';
          host.querySelectorAll('#sspMode button').forEach(function (b) { b.onclick = function () { st.mode = b.dataset.k; draw(); }; });
          var se = host.querySelector('#sspSeason'); if (se) se.onchange = function () { st.season = +se.value; draw(); };
          host.querySelector('#sspSmall').onchange = function (e) { st.small = e.target.checked; draw(); };
          host.querySelectorAll('.ssp-tbl th[data-s]').forEach(function (th) { if (th.dataset.s === key) th.classList.add('sorted');
            th.onclick = function () { if (st.sort === th.dataset.s) st.desc = !st.desc; else { st.sort = th.dataset.s; st.desc = true; } draw(); }; });
        });
      };
      draw();
    });
  }
  // the team's file for a season: exact name, else the first team whose name starts with / contains it ("Duke")
  function teamFile(season, name) {
    return get(season + '/index.json').then(function (X) {
      if (!X || !name) return null;
      var n = String(name).toLowerCase(), T = X.teams;
      var t = T.find(function (x) { return x.team.toLowerCase() === n; }) || T.find(function (x) { return x.team.toLowerCase().indexOf(n + ' ') === 0; }) ||
              T.find(function (x) { return x.team.toLowerCase().indexOf(n) >= 0; });
      return t ? t.file : null;
    });
  }

  // ── team page: the on/off-style sheet. Pick a teammate (chips); every other player's line with him on the floor vs off it.
  // [key, header, value(v), better direction (0 = no colour), a big change, decimals, suffix]
  function teamStat(k, h, fn, dir, big, dec, suf) { return { k: k, h: h, fn: fn, dir: dir, big: big, dec: dec, suf: suf || '' }; }
  var TS = (function () {
    var tposs = function (v) { return (poss(v, N) + poss(v, 2 * N)) / 2; };
    var per = function (fn) { return function (v) { var k = k70(v); return k == null ? null : fn(v) * k; }; };
    var L = [
      teamStat('usg', 'USG', S.usg[1], 0, 3, 1, '%'), teamStat('pts', 'PTS', S.pts[1], 1, 3, 1), teamStat('ast', 'AST', S.ast[1], 1, 1.2, 1),
      teamStat('reb', 'REB', S.reb[1], 1, 1.5, 1), teamStat('tov', 'TOV', S.tov[1], -1, 0.8, 1), teamStat('ts', 'TS%', S.ts[1], 1, 4, 1, '%'),
      teamStat('tp', '3P%', S.tp[1], 1, 5, 1, '%'), teamStat('pm', '+/-', S.pm[1], 1, 6, 1),
      teamStat('fga', 'FGA', cnt('fga'), 0, 2, 1), teamStat('fgp', 'FG%', function (v) { return pct(v[I.fgm], v[I.fga], 8); }, 1, 4, 1, '%'),
      teamStat('tpa', '3PA', cnt('tpa'), 0, 1.2, 1), teamStat('fta', 'FTA', cnt('fta'), 1, 1.2, 1),
      teamStat('ftp', 'FT%', function (v) { return pct(v[I.ftm], v[I.fta], 5); }, 1, 6, 1, '%'),
      teamStat('efg', 'eFG%', function (v) { return v[I.fga] >= 8 ? 100 * (v[I.fgm] + 0.5 * v[I.tpm]) / v[I.fga] : null; }, 1, 4, 1, '%'),
      teamStat('orb', 'OREB', cnt('orb'), 1, 0.8, 1), teamStat('drb', 'DREB', cnt('drb'), 1, 1.2, 1),
      teamStat('ato', 'AST/TO', function (v) { return v[I.tov] >= 2 ? v[I.ast] / v[I.tov] : null; }, 1, 0.4, 2),
      teamStat('stl', 'STL', cnt('stl'), 1, 0.5, 1), teamStat('blk', 'BLK', cnt('blk'), 1, 0.5, 1),
      teamStat('ortg', 'ORtg', function (v) { var p = tposs(v); return p >= 20 ? 100 * v[N + I.pts] / p : null; }, 1, 5, 1),
      teamStat('drtg', 'DRtg', function (v) { var p = tposs(v); return p >= 20 ? 100 * v[2 * N + I.pts] / p : null; }, -1, 5, 1),
      teamStat('net', 'Net', function (v) { var p = tposs(v); return p >= 20 ? 100 * (v[N + I.pts] - v[2 * N + I.pts]) / p : null; }, 1, 7, 1),
      teamStat('pace', 'Pace', function (v) { return v[3 * N] >= 600 ? tposs(v) * 2400 / v[3 * N] : null; }, 0, 2, 1),
      teamStat('oefg', 'Opp eFG%', function (v) { var o = 2 * N; return v[o + I.fga] >= 20 ? 100 * (v[o + I.fgm] + 0.5 * v[o + I.tpm]) / v[o + I.fga] : null; }, -1, 3, 1, '%')
    ], M = {};
    L.forEach(function (s) { M[s.k] = s; });
    return M;
  })();
  var TSETS = [
    ['over', 'Overview', ['usg', 'pts', 'ast', 'reb', 'tov', 'ts', 'tp', 'pm']],
    ['shoot', 'Shooting', ['fga', 'fgp', 'tpa', 'tp', 'fta', 'ftp', 'efg', 'ts']],
    ['play', 'Playmaking & D', ['ast', 'tov', 'ato', 'orb', 'drb', 'stl', 'blk']],
    ['team', 'Team on floor', ['ortg', 'drtg', 'net', 'pace', 'oefg', 'pm']]
  ];
  // same ramp as tdc-onoff.js fill(): red → neutral → green, theme-aware
  function fill(p) {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var mid = dark ? [58, 58, 62] : [244, 242, 237], hi = [47, 133, 90], lo = [196, 78, 72];
    var t = Math.min(1, Math.abs(p - 50) / 50), end = p >= 50 ? hi : lo;
    var c = mid.map(function (m, i) { return Math.round(m + (end[i] - m) * t); });
    return ['rgb(' + c.join(',') + ')', t > 0.45 ? '#fff' : (dark ? '#e8e6e1' : '#1b1a17')];
  }
  // phones: "C. Boozer"; more of the first name when two teammates would match (Cam. / Cay. Boozer)
  function shortName(n, k) { var w = String(n || '').split(' ').filter(function (x) { return !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(x); });
    return w.length > 1 ? w[0].slice(0, k || 1) + '. ' + w.slice(1).join(' ') : n; }
  function shortNames(L) { var out = {};
    L.forEach(function (p) { var k = 1, sn = shortName(p.name, 1);
      while (k < 6 && L.some(function (q) { return q !== p && shortName(q.name, k) === sn; })) { k++; sn = shortName(p.name, k); }
      out[p.id] = sn; });
    return out; }
  function teamCss() {
    if (document.getElementById('ssx-css')) return;
    var s = document.createElement('style'); s.id = 'ssx-css';
    s.textContent =
      '.ssx-bar{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin:0 0 12px}.ssx-bar .ui-check{margin-left:auto}' +
      '.ssx-lbl{font:800 10px Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin:0 0 6px}' +
      '.ssx-mates{display:flex;gap:6px;overflow-x:auto;padding:0 0 4px;margin:0 0 12px;scrollbar-width:thin}' +
      '.ssx-mate{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-start;gap:1px;border:1px solid var(--border2);background:var(--bg);border-radius:9px;padding:6px 11px;cursor:pointer;text-align:left;font:700 12.5px Inter,system-ui,sans-serif;color:var(--text)}' +
      '.ssx-mate small{font-size:10.5px;font-weight:600;color:var(--text3)}' +
      '.ssx-mate:hover{border-color:var(--text3)}' +
      '.ssx-mate.on{background:var(--accent);border-color:var(--accent);color:var(--accent-on,#221c08)}.ssx-mate.on small{color:inherit;opacity:.75}' +
      '.ssx-meta{font-size:12.5px;color:var(--text3);margin:0 0 10px;line-height:1.5}.ssx-meta b{color:var(--text2)}.ssx-meta a{color:var(--text3);font-weight:700;text-decoration:none;margin-left:6px}.ssx-meta a:hover{color:var(--text)}' +
      '.ssx-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:10px;background:var(--bg)}' +
      '.ssx-t{border-collapse:separate;border-spacing:0;width:100%;font-variant-numeric:tabular-nums;font-size:13px}' +
      '.ssx-t th{position:sticky;top:0;background:var(--bg2);font:800 10px Inter,system-ui,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);padding:9px 8px;border-bottom:1px solid var(--border);cursor:pointer;white-space:nowrap}' +
      '.ssx-t th:hover{color:var(--text)}.ssx-t th.on{color:var(--text);box-shadow:inset 0 -3px 0 var(--accent)}' +
      '.ssx-t td{padding:0;border-bottom:1px solid var(--border);text-align:center;white-space:nowrap;height:38px}' +
      '.ssx-t td.pl,.ssx-t th.pl{position:sticky;left:0;z-index:1;background:var(--bg);text-align:left;padding:0 12px;min-width:170px;border-right:1px solid var(--border)}' +
      '.ssx-t th.pl{background:var(--bg2);z-index:2}.ssx-t td.pl .snm{display:none}' +
      '.ssx-t td.pl a{color:var(--text);font-weight:700;text-decoration:none}.ssx-t td.pl small{display:block;font-size:10.5px;color:var(--text3);font-weight:600}' +
      '.ssx-t td.vol{color:var(--text2);padding:0 10px;font-weight:600}' +
      '.ssx-t td.h{min-width:64px;font-weight:700;border-left:2px solid var(--bg)}.ssx-t td.h.na{color:var(--text3);font-weight:500}' +
      '.ssx-t td.h .fr{display:block;font-size:10px;font-weight:600;opacity:.75;margin-top:1px}' +
      '.ssx-t tr.thin td.h{opacity:.55}' +
      '.ssx-key{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--text3);margin:10px 2px 0}.ssx-key i{display:inline-block;width:22px;height:12px;border-radius:3px}' +
      '@media(max-width:700px){.ssx-bar .ui-seg{display:flex;flex-wrap:wrap}.ssx-bar .ui-check{margin-left:0}.ssx-t td.pl,.ssx-t th.pl{min-width:0;padding:0 8px}.ssx-t td.pl small,.ssx-t td.pl .fnm{display:none}.ssx-t td.pl .snm{display:inline}.ssx-t td.h{min-width:52px}.ssx-t td.h .fr{display:none}}';
    document.head.appendChild(s);
  }
  function seg(name, list, cur) {
    return '<span class="ui-seg">' + list.map(function (x) { return '<button type="button" data-' + name + '="' + x[0] + '" class="' + (String(x[0]) === String(cur) ? 'on' : '') + '">' + esc(x[1]) + '</button>'; }).join('') + '</span>';
  }

  function renderTeam(host, o) {
    if (!host) return;
    teamCss();
    var names = [].concat(o && o.team || []).filter(Boolean);
    host.innerHTML = '<div class="ui-empty">Loading lineups…</div>';
    var st = { sort: 'mw', asc: false, small: false, mate: null, view: 'diff', set: 'over' };
    var find = function (y) { var i = 0, next = function () { return i < names.length ? teamFile(y, names[i++]).then(function (f) { return f || next(); }) : Promise.resolve(null); }; return next(); };
    Promise.all(SEASONS.map(function (y) { return find(y).then(function (f) { return f ? { season: y, file: f } : null; }); })).then(function (a) {
      var list = a.filter(Boolean);
      if (!list.length) { host.innerHTML = '<div class="ui-empty">No play-by-play lineup data for this team yet (2024-25 and 2025-26 D-I games with substitution logs).</div>'; return; }
      st.season = list[0].season;
      var draw = function () {
        var cur = list.find(function (x) { return x.season === st.season; });
        get(st.season + '/' + cur.file).then(function (D) {
          if (!D || !D.players.length) { host.innerHTML = '<div class="ui-empty">Couldn\'t load the lineup file.</div>'; return; }
          var byId = {}; D.players.forEach(function (p) { byId[p.id] = p; });
          if (!st.mate || !byId[st.mate]) st.mate = D.players[0].id;
          var M = byId[st.mate], mid = st.mate, SN = shortNames(D.players), last = SN[mid] || String(M.name).split(' ').slice(-1)[0];   // "Cam. Boozer": a bare last name can be two teammates
          var setDef = TSETS.find(function (x) { return x[0] === st.set; }), C = setDef[2].map(function (k) { return TS[k]; });
          var rows = D.players.filter(function (p) { return p.id !== mid; }).map(function (p) {
            var w = (D.w[p.id] || {})[mid] || p.all.map(function () { return 0; }), wo = sub(p.all, w), r = { p: p, mw: w[3 * N] / 60, mo: wo[3 * N] / 60, s: {} };
            C.forEach(function (c) { var x = c.fn(wo), y = c.fn(w); r.s[c.k] = [x, y, (x != null && y != null) ? y - x : null]; });
            return r;
          }).filter(function (r) { return st.small || (r.mw >= 15 && r.mo >= 15); });
          var vi = st.view === 'with' ? 1 : st.view === 'without' ? 0 : 2;
          if (st.sort !== 'mw' && st.sort !== 'name' && !TS[st.sort]) st.sort = 'mw';
          if (TS[st.sort] && setDef[2].indexOf(st.sort) < 0) st.sort = 'mw';
          var key = function (r) { return st.sort === 'mw' ? r.mw : st.sort === 'name' ? r.p.name : r.s[st.sort][vi]; };
          rows.sort(function (a, b) {
            var x = key(a), y = key(b);
            if (st.sort === 'name') return st.asc ? String(x).localeCompare(y) : String(y).localeCompare(x);
            if (x == null) return 1; if (y == null) return -1;
            var dir = TS[st.sort] && TS[st.sort].dir < 0 ? -1 : 1;   // lower-is-better (TOV, DRtg): best first
            return (st.asc ? 1 : -1) * dir * (x - y);
          });
          var VIEWS = [['diff', 'Shift'], ['with', 'With ' + last], ['without', 'Without ' + last]];
          var bar = '<div class="ssx-bar">' + (list.length > 1 ? seg('y', list.map(function (x) { return [x.season, sl(x.season)]; }), st.season) : '') +
            seg('v', VIEWS, st.view) + seg('s', TSETS.map(function (x) { return [x[0], x[1]]; }), st.set) +
            '<label class="ui-check"><input type="checkbox" class="ssxSmall"' + (st.small ? ' checked' : '') + '> Small samples</label></div>';
          var mates = '<div class="ssx-lbl">On the floor or off it: pick a player</div><div class="ssx-mates">' + D.players.map(function (p) {
            return '<button type="button" class="ssx-mate' + (p.id === mid ? ' on' : '') + '" data-m="' + esc(p.id) + '">' + esc(SN[p.id]) + '<small>' + Math.round(p.all[3 * N] / 60) + ' min</small></button>'; }).join('') + '</div>';
          var head = '<thead><tr><th class="pl" data-k="name">Player</th><th data-k="mw" class="' + (st.sort === 'mw' ? 'on' : '') + '" title="Minutes with ' + esc(M.name) + ' on the floor">Min w/</th>' +
            C.map(function (c) { return '<th data-k="' + c.k + '" class="' + (st.sort === c.k ? 'on' : '') + '">' + esc(c.h) + '</th>'; }).join('') + '</tr></thead>';
          var body = rows.map(function (r) {
            var cells = C.map(function (c) {
              var s = r.s[c.k], v = s[vi];
              if (v == null) return '<td class="h na">—</td>';
              // colour = is this side better than the other one; Shift: better with him on the floor
              var g = s[2] == null || !c.dir ? null : s[2] * c.dir / c.big * (vi === 0 ? -1 : 1);
              var f = g == null ? null : fill(Math.max(0, Math.min(100, 50 + 25 * g)));
              var txt = (vi === 2 && v > 0 ? '+' : (c.k === 'pm' || c.k === 'net') && v > 0 ? '+' : '') + (+v).toFixed(c.dec) + (vi === 2 ? '' : c.suf);
              var fr = vi === 2 ? '<span class="fr">' + (+s[0]).toFixed(c.dec) + ' → ' + (+s[1]).toFixed(c.dec) + '</span>' : '';
              return '<td class="h"' + (f ? ' style="background:' + f[0] + ';color:' + f[1] + '"' : '') + ' title="' + esc(c.h + ' · without ' + last + ' ' + f1(s[0]) + ' → with ' + f1(s[1]) + (s[2] != null ? ' (' + sg(s[2]) + ')' : '')) + '">' + txt + fr + '</td>';
            }).join('');
            return '<tr class="' + ((r.mw < 40 || r.mo < 40) ? 'thin' : '') + '"><td class="pl"><a href="player.html?espn=' + esc(r.p.id) + '&tab=statshift"><span class="fnm">' + esc(r.p.name) + '</span><span class="snm">' + esc(SN[r.p.id]) + '</span></a>' +
              '<small>' + Math.round(r.mw) + ' min with · ' + Math.round(r.mo) + ' without' + ((r.mw < 40 || r.mo < 40) ? ' · small sample' : '') + '</small></td><td class="vol">' + Math.round(r.mw) + '</td>' + cells + '</tr>';
          }).join('');
          var vName = st.view === 'diff' ? 'Shift (with ' + esc(M.name) + ' on the floor − off it)' : st.view === 'with' ? 'With ' + esc(M.name) + ' on the floor' : 'With ' + esc(M.name) + ' off the floor';
          host.innerHTML = bar + mates +
            '<p class="ssx-meta"><b>' + vName + '</b> · ' + esc(setDef[1]) + ' · ' + sl(st.season) + ' · per 70 possessions · garbage time removed' +
              '<a href="statshift.html?team=' + encodeURIComponent(D.team) + '&with=' + encodeURIComponent(mid) + (st.season !== 2026 ? '&season=' + st.season : '') + '">Open in Stat Line Shift →</a></p>' +
            '<div class="ssx-wrap"><table class="ssx-t">' + head + '<tbody>' +
              (body || '<tr><td class="pl" colspan="' + (C.length + 2) + '">No teammate with 15+ minutes on both sides. Tick "Small samples".</td></tr>') + '</tbody></table></div>' +
            '<div class="ssx-key">Cell colour = ' + (st.view === 'diff' ? 'how much his number moves with ' + esc(last) + ' on the floor' : 'this side vs the other') + ':' +
              [0, 25, 50, 75, 100].map(function (q) { var f = fill(q); return '<i style="background:' + f[0] + '"></i>' + (q === 0 ? 'worse' : q === 100 ? 'better' : ''); }).join(' ') +
              ' · usage, volume and pace aren\'t coloured · "without" includes games ' + esc(last) + ' missed · faded rows = small sample</div>';
          host.querySelectorAll('[data-y]').forEach(function (b) { b.onclick = function () { st.season = +b.dataset.y; st.mate = null; draw(); }; });
          host.querySelectorAll('[data-v]').forEach(function (b) { b.onclick = function () { st.view = b.dataset.v; draw(); }; });
          host.querySelectorAll('[data-s]').forEach(function (b) { b.onclick = function () { st.set = b.dataset.s; draw(); }; });
          host.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { st.mate = b.dataset.m; draw(); }; });
          host.querySelector('.ssxSmall').onchange = function (e) { st.small = e.target.checked; draw(); };
          host.querySelectorAll('.ssx-t th[data-k]').forEach(function (th) { th.onclick = function () { var k = th.dataset.k; if (st.sort === k) st.asc = !st.asc; else { st.sort = k; st.asc = k === 'name'; } draw(); }; });
          var on = host.querySelector('.ssx-mate.on'); if (on && on.scrollIntoView) { var mw = host.querySelector('.ssx-mates'); mw.scrollLeft = on.offsetLeft - mw.offsetLeft - 8; }
        });
      };
      draw();
    });
  }
  // compare page: two players. Teammates in a season we have -> each one's line without -> with the other.
  // Otherwise -> side by side, each player's line with his five most-played teammates. Hides `wrap` when neither has data.
  function compare(host, ps, wrap) {
    if (!host) return;
    css();
    var hide = function () { if (wrap) wrap.style.display = 'none'; host.innerHTML = ''; };
    ps = (ps || []).map(function (p) { return { id: String(p && p.espn || ''), name: (p && p.name) || '', season: p && p.season ? +p.season : null }; });
    if (!ps.length || !ps.some(function (p) { return p.id; })) return hide();
    Promise.all(SEASONS.map(function (y) { return get(y + '/players.json'); })).then(function (maps) {
      var at = function (p, y) { var m = maps[SEASONS.indexOf(y)]; return p.id && m && m[p.id] ? m[p.id] : null; };
      var pick = function (p) { var ys = SEASONS.filter(function (y) { return at(p, y) && (!p.season || p.season === y); }); return ys[0] || null; };
      var together = ps.length === 2 && SEASONS.find(function (y) { var f = at(ps[0], y); return f && f === at(ps[1], y) && (!ps[0].season || ps[0].season === y) && (!ps[1].season || ps[1].season === y); });
      var cell = function (k, s) { var dir = S[k][2];
        return '<td class="sh ' + heat(k, s[2]) + '"><span class="ab"><span class="o">' + f1(s[0]) + '</span> → ' + f1(s[1]) + '</span><span class="dl ' + (s[2] == null ? '' : (!dir ? 'n' : (s[2] * dir > 0 ? 'up' : 'dn'))) + '">' + sg(s[2]) + '</span></td>'; };
      var split = function (base, w) { w = w || base.map(function () { return 0; }); var wo = sub(base, w), s = {};
        COLS.forEach(function (k) { var a = S[k][1](wo), b = S[k][1](w); s[k] = [a, b, (a != null && b != null) ? b - a : null]; });
        return { s: s, mw: w[3 * N] / 60, mo: wo[3 * N] / 60 }; };
      var head = function (lbl) { return '<thead><tr><th class="l">' + lbl + '<span class="sm">min w/o → min w/</span></th>' + COLS.map(function (k) { return '<th>' + S[k][0] + '</th>'; }).join('') + '</tr></thead>'; };
      var row = function (label, r, href) { return '<tr class="' + ((r.mw < 40 || r.mo < 40) ? 'thin' : '') + '"><td class="l nm">' + (href ? '<a href="' + href + '">' + label + '</a>' : label) + '<span class="sm">' + Math.round(r.mo) + ' w/o → ' + Math.round(r.mw) + ' w/</span></td>' + COLS.map(function (k) { return cell(k, r.s[k]); }).join('') + '</tr>'; };
      var foot = '<div class="ssp-note" style="margin-top:8px">Per 70 possessions; each cell reads without → with. Green = better with him on the floor, red = worse; usage and +/- aren\'t shaded. "Without" includes games the other player missed. Garbage time removed.</div>';
      if (together) {
        return get(together + '/' + at(ps[0], together)).then(function (D) {
          var A = D && D.players.find(function (x) { return x.id === ps[0].id; }), B = D && D.players.find(function (x) { return x.id === ps[1].id; });
          if (!A || !B) return hide();
          var ra = split(A.all, (D.w[A.id] || {})[B.id]), rb = split(B.all, (D.w[B.id] || {})[A.id]);
          host.innerHTML = '<div class="ssp-note">Teammates at ' + esc(D.team) + ' in ' + sl(together) + ': <b>' + Math.round(ra.mw) + ' minutes</b> on the floor together. How each one\'s own line changes with the other on the floor.' +
            ' <a href="statshift.html?team=' + encodeURIComponent(D.team) + '&with=' + encodeURIComponent(B.id) + (together !== 2026 ? '&season=' + together : '') + '" style="font-weight:700;color:var(--text3)">Open in Stat Line Shift →</a></div>' +
            '<div class="sheet-wrap" style="max-height:none"><table class="sheet dense ssp-tbl">' + head('Player') + '<tbody>' +
            row(esc(A.name) + ' <span class="sm" style="display:inline">with ' + esc(B.name.split(' ').slice(-1)[0]) + '</span>', ra) +
            row(esc(B.name) + ' <span class="sm" style="display:inline">with ' + esc(A.name.split(' ').slice(-1)[0]) + '</span>', rb) +
            '</tbody></table></div>' + foot;
          if (wrap) wrap.style.display = '';
        });
      }
      Promise.all(ps.map(function (p) { var y = pick(p); return y ? get(y + '/' + at(p, y)).then(function (D) { return D ? { p: p, y: y, D: D } : null; }) : Promise.resolve(null); })).then(function (got) {
        if (!got.some(Boolean)) return hide();
        var col = function (g, p) {
          if (!g) return '<div class="ssp-note">No play-by-play lineup data for ' + esc(p.name || 'this player') + ' (2024-25 and 2025-26 only).</div>';
          var D = g.D, me = D.players.find(function (x) { return x.id === g.p.id; });
          if (!me) return '<div class="ssp-note">Under 10 minutes in ' + sl(g.y) + '.</div>';
          var mates = D.players.filter(function (x) { return x.id !== me.id; }).map(function (x) { var r = split(me.all, (D.w[me.id] || {})[x.id]); r.x = x; return r; })
            .filter(function (r) { return r.mw >= 15 && r.mo >= 15; }).sort(function (a, b) { return b.mw - a.mw; }).slice(0, 5);
          return '<div class="ssp-note" style="margin-bottom:6px"><b>' + esc(me.name) + '</b> · ' + esc(D.team) + ' · ' + sl(g.y) + ' · <a href="player.html?espn=' + esc(me.id) + '&tab=statshift" style="font-weight:700;color:var(--text3)">all teammates →</a></div>' +
            '<div class="sheet-wrap" style="max-height:none"><table class="sheet dense ssp-tbl">' + head('His line with') + '<tbody>' +
            (mates.map(function (r) { return row(esc(r.x.name), r, 'player.html?espn=' + esc(r.x.id)); }).join('') || '<tr><td class="l" colspan="9">No teammate with 15+ minutes on both sides.</td></tr>') + '</tbody></table></div>';
        };
        host.innerHTML = '<div class="ssp-note">Not teammates in a season we have lineups for, so here is each player\'s own line with his five most-played teammates on the floor vs off it.</div>' +
          '<div class="ssp-pair">' + ps.map(function (p, i) { return '<div>' + col(got[i], p) + '</div>'; }).join('') + '</div>' + foot;
        if (wrap) wrap.style.display = '';
      });
    });
  }
  window.TDC_SHIFT = { renderPlayer: renderPlayer, renderTeam: renderTeam, compare: compare };
})();
