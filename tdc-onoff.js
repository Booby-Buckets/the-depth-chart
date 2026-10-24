/* tdc-onoff.js — a player's on/off splits, every row ranked.
   Team stats with the player on the floor vs off it, plus the difference, and
   a percentile chip beside each number (rank among D-I players with 500+ on-floor
   possessions that season). Grouped General / Shooting / Shot mix / Possessions /
   Defense. Built on tdc-ui.css (.ui-pct, .ui-seg) + tdc-sheets.css (.sheet).

   Data: scripts/data/wowy_index.json (espn id -> seasons) and wowy_<season>.json
   (built by build_wowy.py). Same files tdc-wowy-player.js reads.

   Usage: TDC_ONOFF.render(hostEl, { espn: '5105464', season: 2026 }) */
(function () {
  if (window.TDC_ONOFF) return;

  var get = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var lbl = function (y) { return (y - 1) + '–' + String(y).slice(2); };
  var MIN_POSS = 500;

  // [key, label, higher-is-better (1) / lower (-1), decimals, suffix, tooltip]
  // 'pm' is derived: net per 100 × possessions / 100.
  var GROUPS = [
    ['General', [
      ['min', 'Minutes', 0, 0, '', ''],
      ['poss', 'Possessions', 0, 0, '', ''],
      ['pm', 'Plus-minus', 1, 0, '', 'Points the team outscored opponents by in these minutes'],
      ['net', 'Net rating', 1, 1, '', 'Points per 100 possessions the team outscores opponents by'],
      ['o', 'Offensive rating', 1, 1, '', 'Points scored per 100 possessions'],
      ['d', 'Defensive rating', -1, 1, '', 'Points allowed per 100 possessions (lower is better)']]],
    ['Offense · shooting', [
      ['ts', 'TS%', 1, 1, '%', 'True shooting'],
      ['efg', 'eFG%', 1, 1, '%', ''],
      ['tp', '3P%', 1, 1, '%', ''],
      ['ftp', 'FT%', 1, 1, '%', '']]],
    ['Offense · shot mix & possessions', [
      ['tpar', '3PA rate', 1, 1, '%', 'Share of shots that are threes'],
      ['ftr', 'FT rate', 1, 1, '', 'Free-throw attempts per 100 shots'],
      ['ast', 'Assisted %', 1, 1, '%', 'Share of made shots that were assisted'],
      ['tov', 'TOV%', -1, 1, '%', 'Turnovers per 100 possessions'],
      ['orb', 'ORB%', 1, 1, '%', 'Share of its misses the team rebounds']]],
    ['Defense', [
      ['ots', 'Opp TS%', -1, 1, '%', ''],
      ['oefg', 'Opp eFG%', -1, 1, '%', ''],
      ['otp', 'Opp 3P%', -1, 1, '%', ''],
      ['otov', 'Opp TOV%', 1, 1, '%', 'Opponent turnovers per 100 possessions'],
      ['drb', 'DRB%', 1, 1, '%', 'Share of opponent misses the team rebounds']]]
  ];

  var IDX = null, SEAS = {}, PAIRS = {}, POOL = {};
  var LUCK = false;   // luck-adjusted ratings (opponent 3P% / FT% regressed): o/d/net -> ol/dl/netl
  var K = function (k) { return LUCK ? ({ o: 'ol', d: 'dl', net: 'netl' }[k] || k) : k; };

  function val(side, k) {
    if (!side) return null;
    if (k === 'pm') { var n = side[K('net')]; return n == null ? null : n * side.poss / 100; }
    var v = side[K(k)]; return v == null || !isFinite(v) ? null : +v;
  }

  // Sorted value arrays per (side, key) for the season's qualified pool.
  function pool(season, S) {
    var key = season + (LUCK ? 'L' : '');
    if (POOL[key]) return POOL[key];
    var q = (S.players || []).filter(function (p) { return p.on && p.off && p.on.poss >= MIN_POSS; });
    var P = { on: {}, off: {}, diff: {} };
    GROUPS.forEach(function (g) { g[1].forEach(function (R) {
      var k = R[0], a = [], b = [], c = [];
      q.forEach(function (p) { var x = val(p.on, k), y = val(p.off, k); if (x != null) a.push(x); if (y != null) b.push(y); if (x != null && y != null) c.push(x - y); });
      var s = function (v, w) { return v - w; };
      P.on[k] = a.sort(s); P.off[k] = b.sort(s); P.diff[k] = c.sort(s);
    }); });
    return (POOL[key] = P);
  }

  // Percentile (0-100) of v in a sorted array, flipped when lower is better.
  function pctOf(arr, v, dir) {
    if (v == null || !arr || !arr.length) return null;
    var lo = 0, hi = arr.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
    var p = Math.round(100 * lo / arr.length);
    return dir < 0 ? 100 - p : p;
  }
  function chip(p) {
    if (p == null) return '<span class="ui-pct na">—</span>';
    var c = p >= 85 ? 'p4' : p >= 65 ? 'p3' : p >= 35 ? 'p2' : p >= 15 ? 'p1' : 'p0';
    return '<span class="ui-pct ' + c + '">' + p + '</span>';
  }
  function fmt(v, dec, suf, signed) {
    if (v == null) return '—';
    var s = (+v).toFixed(dec);
    if (signed && v > 0) s = '+' + s;
    return s + (suf || '');
  }

  function css() {
    if (document.getElementById('tdc-onoff-css')) return;
    var st = document.createElement('style'); st.id = 'tdc-onoff-css';
    st.textContent =
      '.oo-top{max-width:820px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}' +
      '.oo-who{display:flex;gap:24px;flex-wrap:wrap}' +
      '.oo-who .ui-tile{border:0;padding:0;text-align:left}' +
      '.oo-wrap{max-width:820px}.oo-tbl{width:100%}' +
      '.oo-tbl td,.oo-tbl th{text-align:right}' +
      '.oo-tbl td.l,.oo-tbl th.l{text-align:left}' +
      '.oo-tbl td.pc{padding-left:2px;padding-right:10px;width:1%}' +
      '.oo-tbl th.pc{padding-left:2px}' +
      '.oo-tbl tr.grp td{background:var(--bg2);font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);text-align:left;padding-top:10px}' +
      '.oo-tbl td.up{color:var(--green);font-weight:700}.oo-tbl td.dn{color:var(--red);font-weight:700}' +
      '.oo-tbl th.side{border-bottom-color:var(--accent)}';
    document.head.appendChild(st);
  }

  function table(p, P) {
    var on = p.on, off = p.off;
    var h = '<div class="sheet-wrap oo-wrap" style="max-height:none"><table class="sheet oo-tbl"><thead><tr>' +
      '<th class="l">Team stat</th><th class="side">On</th><th class="pc">%ile</th><th>Off</th><th class="pc">%ile</th><th>On − off</th><th class="pc">%ile</th>' +
      '</tr></thead><tbody>';
    GROUPS.forEach(function (g) {
      h += '<tr class="grp"><td colspan="7">' + esc(g[0]) + '</td></tr>';
      g[1].forEach(function (R) {
        var k = R[0], dir = R[2], dec = R[3], suf = R[4];
        var a = val(on, k), b = val(off, k), d = a != null && b != null ? a - b : null;
        var count = dir === 0;   // minutes / possessions: rank by volume, no "good/bad" on the off side
        var pa = pctOf(P.on[k], a, count ? 1 : dir), pb = count ? null : pctOf(P.off[k], b, dir), pd = pctOf(P.diff[k], d, count ? 1 : dir);
        var good = d == null || dir === 0 || Math.abs(d) < 0.05 ? '' : (d * dir > 0 ? 'up' : 'dn');
        h += '<tr><td class="l"' + (R[5] ? ' title="' + esc(R[5]) + '"' : '') + '>' + esc(R[1]) + '</td>' +
          '<td class="num">' + fmt(a, dec, suf) + '</td><td class="pc">' + chip(pa) + '</td>' +
          '<td class="num">' + fmt(b, dec, suf) + '</td><td class="pc">' + chip(pb) + '</td>' +
          '<td class="num ' + good + '">' + fmt(d, dec, suf, true) + '</td><td class="pc">' + chip(pd) + '</td></tr>';
      });
    });
    return h + '</tbody></table></div>';
  }

  var shortTeam = function (t) { return window.tdcShortSchool ? tdcShortSchool(t) : t; };
  // heat class for a two-man unit's net rating (same 5 steps as the sheets kit)
  var heat = function (n) { return n == null ? '' : n >= 12 ? 'c4' : n >= 4 ? 'c3' : n <= -12 ? 'c0' : n <= -4 ? 'c1' : 'c2'; };

  function tiles(p, P, S) {
    var on = p.on, off = p.off;
    var dNet = off ? val(on, 'net') - val(off, 'net') : null;
    var rp = (S.players || []).filter(function (x) { return x.rapm && x.on && x.on.poss >= MIN_POSS; }).map(function (x) { return x.rapm.net; }).sort(function (a, b) { return a - b; });
    var rk = p.rapm ? 1 + rp.filter(function (v) { return v > p.rapm.net; }).length : null;
    var T = [
      ['On − off net', fmt(dNet, 1, '', true), pctOf(P.diff.net, dNet, 1)],
      ['Net with player on', fmt(val(on, 'net'), 1, '', true), pctOf(P.on.net, val(on, 'net'), 1)],
      ['RAPM', p.rapm ? fmt(p.rapm.net, 1, '', true) : '—', p.rapm ? pctOf(rp, p.rapm.net, 1) : null],
      ['RAPM rank', rk ? '#' + rk : '—', null, rk ? 'of ' + rp.length : 'needs ' + MIN_POSS + '+ poss']
    ];
    return '<div class="ui-tiles oo-wrap" style="margin-bottom:16px">' + T.map(function (t) {
      return '<div class="ui-tile"><div class="v">' + t[1] + '</div>' + (t[3] ? '<span class="ui-note" style="display:block;margin:4px 0 2px">' + t[3] + '</span>' : chip(t[2])) + '<span class="k">' + t[0] + '</span></div>';
    }).join('') + '</div>';
  }

  function pairs(pr) {
    if (!pr.length) return '<div class="ui-empty oo-wrap">No two-man units with enough possessions.</div>';
    return '<div class="sheet-wrap oo-wrap" style="max-height:none"><table class="sheet oo-tbl"><thead><tr><th class="l">With</th><th>Min</th><th>Net</th><th>Off</th><th>Def</th></tr></thead><tbody>' +
      pr.map(function (x) { var n = LUCK && x[4] != null ? x[4] : x[3];
        return '<tr><td class="l"><a href="player.html?espn=' + esc(x[0]) + '">' + esc(x[1] || x[0]) + '</a></td><td>' + Math.round(x[2] || 0) + '</td>' +
          '<td class="' + heat(n) + '">' + fmt(n, 1, '', true) + '</td><td>' + fmt(x[5], 1) + '</td><td>' + fmt(x[6], 1) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }

  function render(host, opts) {
    if (!host) return; css();
    var espn = opts && opts.espn != null ? String(opts.espn) : null;
    if (!espn) { host.innerHTML = '<div class="ui-empty">On/off needs a matched player id; this player has none yet.</div>'; return; }
    host.innerHTML = '<div class="ui-empty">Loading on/off…</div>';
    (IDX ? Promise.resolve(IDX) : get('scripts/data/wowy_index.json?v=1').then(function (j) { return (IDX = j || {}); })).then(function (I) {
      var seasons = I[espn] || [];
      if (!seasons.length) { host.innerHTML = '<div class="ui-empty">No on/off for this player yet. It is rebuilt from play-by-play lineups for 2023–24 through 2025–26, for players with 30+ minutes in a season.</div>'; return; }
      var cur = opts.season && seasons.indexOf(+opts.season) >= 0 ? +opts.season : seasons[0];
      var draw = function () {
        Promise.all([
          SEAS[cur] ? Promise.resolve(SEAS[cur]) : get('scripts/data/wowy_' + cur + '.json?v=5').then(function (j) { return (SEAS[cur] = j); }),
          PAIRS[cur] ? Promise.resolve(PAIRS[cur]) : get('scripts/data/wowy_pairs_' + cur + '.json?v=1').then(function (j) { return (PAIRS[cur] = j || {}); })
        ]).then(function (r) {
          var S = r[0], PR = r[1] || {};
          if (!S) { host.innerHTML = '<div class="ui-empty">Could not load ' + lbl(cur) + '.</div>'; return; }
          var p = (S.players || []).find(function (x) { return String(x.id) === espn; });
          if (!p || !p.on) { host.innerHTML = '<div class="ui-empty">No ' + lbl(cur) + ' on/off for this player.</div>'; return; }
          var P = pool(cur, S), team = shortTeam(p.team);
          var small = p.on.poss < 300 || (p.off && p.off.poss < 150);
          var h = '<div class="oo-top">' +
            '<span class="ui-seg">' + seasons.slice().sort().map(function (y) { return '<button class="' + (y === cur ? 'on' : '') + '" data-y="' + y + '">' + lbl(y) + '</button>'; }).join('') + '</span>' +
            '<label class="ui-check" title="Sets the team\'s own free-throw shooting and the opponent\'s 3-point and free-throw shooting to the D-I average"><input type="checkbox" id="ooLuck"' + (LUCK ? ' checked' : '') + '> Luck-adjusted</label></div>' +
            '<p class="ui-note oo-wrap" style="margin:-6px 0 14px"><b>' + esc(team) + '</b> · ' + Math.round(p.on.min) + ' minutes on the floor' + (p.off ? ', ' + Math.round(p.off.min) + ' off' : '') + ' · ' + (p.g || 0) + ' games' + (S.low_leverage_removed ? ' · garbage time removed' : '') + (small ? ' · <b>small sample</b>' : '') + '</p>';
          h += tiles(p, P, S);
          if (!p.off) h += '<div class="ui-empty oo-wrap">This player was on the floor nearly every minute, so there is no off-floor sample to compare.</div>';
          else h += table(p, P);
          h += '<div class="ui-row between oo-wrap" style="margin:24px 0 8px"><span class="ui-label">Two-man units · most minutes first</span>' +
            '<a class="ui-label" style="color:var(--accent);text-transform:none;letter-spacing:0" href="wowy.html?team=' + encodeURIComponent(p.team) + '&season=' + cur + '">Full ' + esc(team) + ' WOWY →</a></div>';
          h += pairs(PR[espn] || []);
          h += '<p class="ui-note oo-wrap">Percentile chips rank against D-I players with ' + MIN_POSS + '+ on-floor possessions in ' + lbl(cur) + '. ' +
            'On/off compares the team with this player on the floor against the minutes they sat; RAPM adjusts for teammates and opponents. Rebuilt from play-by-play substitutions' + (cur <= 2025 ? ' (lineups from CollegeBasketballData)' : '') + '.</p>';
          host.innerHTML = h;
          host.querySelectorAll('[data-y]').forEach(function (b) { b.onclick = function () { cur = +b.dataset.y; draw(); }; });
          var lk = host.querySelector('#ooLuck'); if (lk) lk.onchange = function () { LUCK = lk.checked; draw(); };
        });
      };
      draw();
    });
  }

  window.TDC_ONOFF = { render: render };
})();
