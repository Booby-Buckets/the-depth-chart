/* tdc-onoff.js — a player's on/off profile, every number ranked.
   Team stats with the player on the floor vs off it, plus the difference, and a
   percentile chip beside each number (rank among D-I players with 500+ on-floor
   possessions that season). Collapsible sections: General, then Offense and Defense,
   each split Shooting / Play style / Playmaking (databallr's on/off layout).

   Data: scripts/data/wowy_index.json (espn id -> seasons) and wowy_<season>.json
   (built by build_wowy.py: rim/mid zones, steals, blocks, pace since Oct 2026).

   Usage: TDC_ONOFF.render(hostEl, { espn: '5105464', season: 2026, side: false })
          side: false drops the right column (tiles + two-man units), for narrow hosts. */
(function () {
  if (window.TDC_ONOFF) return;

  var get = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var lbl = function (y) { return (y - 1) + '–' + String(y).slice(2); };
  var MIN_POSS = 500;
  var DV = 7;   // wowy_<season>.json cache-buster: bump on every rebuild

  // [key, label, higher-is-better (1) / lower (-1) / volume (0), decimals, suffix, tooltip]
  // derived keys: 'pm' = plus-minus (net × poss / 100), 'pm100' = the same per 100 possessions
  var GROUPS = [
    ['Our numbers', [
      ['Game state', [
        ['crunch', 'Crunch Lift', 1, 1, '', 'Net rating in close, late minutes: second half or OT, 8:00 or less left, within 6'],
        ['behind', 'Behind Lift', 1, 1, '', 'Net rating while his team is trailing']]],
      ['Shot quality', [
        ['diet', 'Shot Diet', 1, 1, '%', 'The eFG% the team\'s shot mix (rim / mid / three) would produce at D-I average make rates: how good the looks are'],
        ['make', 'Shot Making', 1, 1, '', 'Actual eFG% minus Shot Diet: making more (or fewer) than those looks should give'],
        ['odiet', 'Opp Shot Diet', -1, 1, '%', 'The same for the shots the defense gives up'],
        ['omake', 'Opp Shot Making', -1, 1, '', 'Opponent eFG% minus their Shot Diet']]],
      ['Possessions', [
        ['pedge', 'Possession Edge', 1, 1, '', 'Extra scoring chances per 100: turnovers forced minus committed, plus offensive rebounds won minus allowed']]]]],
    ['General', [[null, [
      ['min', 'Minutes', 0, 0, '', ''],
      ['poss', 'Possessions', 0, 0, '', ''],
      ['pm', '+/-', 1, 0, '', 'Points the team outscored opponents by in these minutes'],
      ['o', 'ORtg', 1, 1, '', 'Points scored per 100 possessions'],
      ['d', 'DRtg', -1, 1, '', 'Points allowed per 100 possessions (lower is better)'],
      ['net', 'NetRtg', 1, 1, '', 'Points per 100 possessions the team outscores opponents by'],
      ['pace', 'Pace', 0, 1, '', 'Possessions per 40 minutes']]]]],
    ['Offense', [
      ['Finishing & shooting', [
        ['efg', 'eFG%', 1, 1, '%', ''],
        ['ts', 'TS%', 1, 1, '%', 'True shooting'],
        ['fg', 'FG%', 1, 1, '%', ''],
        ['tp', '3PT%', 1, 1, '%', ''],
        ['midp', 'Mid FG%', 1, 1, '%', 'Two-point jump shots and hooks'],
        ['rimp', 'Rim FG%', 1, 1, '%', 'Layups, dunks and tips'],
        ['ftp', 'FT%', 1, 1, '%', '']]],
      ['Shot mix', [
        ['rimr', 'Rim Att%', 1, 1, '%', 'Share of shots at the rim'],
        ['midr', 'Mid Att%', -1, 1, '%', 'Share of shots from mid-range'],
        ['tpar', '3PAr', 1, 1, '%', 'Share of shots that are threes'],
        ['ftr', 'FT rate', 1, 1, '', 'Free-throw attempts per 100 shots']]],
      ['Ball & boards', [
        ['ast', 'Ast%', 1, 1, '%', 'Share of made shots that were assisted'],
        ['tov', 'TO%', -1, 1, '%', 'Turnovers per 100 possessions'],
        ['ostl', 'Opp Stl%', -1, 1, '%', 'Opponent steals per 100 possessions'],
        ['oblk', 'Opp Blk%', -1, 1, '%', 'Share of the team\'s shots that get blocked'],
        ['orb', 'OREB%', 1, 1, '%', 'Share of its misses the team rebounds']]]]],
    ['Defense', [
      ['Shots allowed', [
        ['oefg', 'Opp eFG%', -1, 1, '%', ''],
        ['ots', 'Opp TS%', -1, 1, '%', ''],
        ['ofg', 'Opp FG%', -1, 1, '%', ''],
        ['otp', 'Opp 3PT%', -1, 1, '%', ''],
        ['omidp', 'Opp Mid FG%', -1, 1, '%', ''],
        ['orimp', 'Opp Rim FG%', -1, 1, '%', '']]],
      ['Shot mix allowed', [
        ['orimr', 'Opp Rim Att%', -1, 1, '%', 'Share of opponent shots at the rim'],
        ['omidr', 'Opp Mid Att%', 1, 1, '%', 'Share of opponent shots from mid-range'],
        ['otpar', 'Opp 3PAr', -1, 1, '%', 'Share of opponent shots that are threes'],
        ['oftr', 'Opp FT rate', -1, 1, '', 'Opponent free-throw attempts per 100 shots']]],
      ['Disruption & boards', [
        ['oast', 'Opp Ast%', -1, 1, '%', 'Share of opponent makes that were assisted'],
        ['otov', 'Opp TO%', 1, 1, '%', 'Opponent turnovers per 100 possessions'],
        ['stl', 'Stl%', 1, 1, '%', 'Team steals per 100 opponent possessions'],
        ['blk', 'Blk%', 1, 1, '%', 'Share of opponent shots the team blocks'],
        ['drb', 'DREB%', 1, 1, '%', 'Share of opponent misses the team rebounds']]]]]
  ];
  var ROWS = [];
  GROUPS.forEach(function (g) { g[1].forEach(function (s) { s[1].forEach(function (R) { ROWS.push(R); }); }); });

  var IDX = null, SEAS = {}, PAIRS = {}, POOL = {};
  var LUCK = false;   // luck-adjusted ratings (opponent 3P% / FT% regressed): o/d/net -> ol/dl/netl
  var K = function (k) { return LUCK ? ({ o: 'ol', d: 'dl', net: 'netl' }[k] || k) : k; };
  var CLOSED = {};    // collapsed sections, kept across seasons

  var LG = null;   // the season's league rates (S.league), for Shot Diet
  var SIT = { crunch: ['c', 25, 15], behind: ['t', 60, 30] };   // split key, min poss on, min poss off
  var num = function (v) { return v == null || !isFinite(v) ? null : +v; };
  function diet(rimr, midr, tpar) {
    if (!LG || rimr == null || midr == null || tpar == null || LG.rimp == null) return null;
    return (rimr * LG.rimp + midr * LG.midp + tpar * LG.tp * 1.5) / 100;
  }
  // value of stat k for player p with him on ('on') or off ('off') the floor
  function stat(p, w, k) {
    if (SIT[k]) { var x = p.sit && p.sit[SIT[k][0]]; if (!x || x[2] < SIT[k][1] || x[3] < SIT[k][2]) return null; return num(x[w === 'on' ? 0 : 1]); }
    var side = p[w]; if (!side) return null;
    if (k === 'pm') { var n = side[K('net')]; return n == null ? null : n * side.poss / 100; }
    if (k === 'diet') return diet(side.rimr, side.midr, side.tpar);
    if (k === 'odiet') return diet(side.orimr, side.omidr, side.otpar);
    if (k === 'make') { var d = diet(side.rimr, side.midr, side.tpar); return d == null || side.efg == null ? null : side.efg - d; }
    if (k === 'omake') { var e = diet(side.orimr, side.omidr, side.otpar); return e == null || side.oefg == null ? null : side.oefg - e; }
    if (k === 'pedge') { if ([side.tov, side.otov, side.orb, side.drb].some(function (v) { return v == null; })) return null;
      return (side.otov - side.tov) + 0.5 * (side.orb - (100 - side.drb)); }   // about half a missed shot per possession
    return num(side[K(k)]);
  }
  var val = function (side, k) { return side ? num(k === 'pm' ? (side[K('net')] == null ? null : side[K('net')] * side.poss / 100) : side[K(k)]) : null; };

  // Sorted value arrays per (side, key) for the season's qualified pool.
  function pool(season, S) {
    LG = S.league || null;
    var key = season + (LUCK ? 'L' : '');
    if (POOL[key]) return POOL[key];
    var q = (S.players || []).filter(function (p) { return p.on && p.off && p.on.poss >= MIN_POSS; });
    var P = { on: {}, off: {}, diff: {} }, s = function (v, w) { return v - w; };
    ROWS.forEach(function (R) {
      var k = R[0], a = [], b = [], c = [];
      q.forEach(function (p) { var x = stat(p, 'on', k), y = stat(p, 'off', k); if (x != null) a.push(x); if (y != null) b.push(y); if (x != null && y != null) c.push(x - y); });
      P.on[k] = a.sort(s); P.off[k] = b.sort(s); P.diff[k] = c.sort(s);
    });
    P.sw = q.map(function (p) { return (val(p.on, 'net') - val(p.off, 'net')) / 100 * p.on.poss / 33; }).filter(isFinite).sort(s);
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
  // solid chip: red (0) → neutral (50) → green (100)
  function chip(p) {
    if (p == null) return '<span class="oo-pc na">—</span>';
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var mid = dark ? [58, 58, 62] : [244, 242, 237], hi = [47, 133, 90], lo = [196, 78, 72];
    var t = Math.min(1, Math.abs(p - 50) / 50), end = p >= 50 ? hi : lo;
    var c = mid.map(function (m, i) { return Math.round(m + (end[i] - m) * t); });
    var fg = t > 0.45 ? '#fff' : (dark ? '#e8e6e1' : '#1b1a17');
    return '<span class="oo-pc" style="background:rgb(' + c.join(',') + ');color:' + fg + '">' + p + '</span>';
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
      '.oo-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}' +
      '.oo-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:32px;align-items:start}' +
      '.oo-grid.solo{grid-template-columns:minmax(0,1fr)}' +
      '@media(max-width:1000px){.oo-grid{grid-template-columns:1fr}}' +
      '.oo-side .ui-tiles{grid-template-columns:repeat(2,1fr)}' +
      '.oo-wide{margin:0 0 18px}.oo-wide .ui-tiles{grid-template-columns:repeat(4,1fr)}' +
      '.oo-tight .oo-pro{font-size:13px}.oo-tight .oo-pro col.n{width:15%}.oo-tight .oo-pro col.c{width:40px}.oo-tight .oo-pro td{padding:6px 5px}.oo-tight .oo-grid{gap:22px}' +
      '.oo-h{display:flex;justify-content:space-between;align-items:baseline;margin:20px 0 8px}' +
      '.oo-h a{font-size:12px;font-weight:700;color:var(--text3);text-decoration:none}.oo-h a:hover{color:var(--accent)}' +
      /* the profile table */
      '.oo-pro{width:100%;table-layout:fixed;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:14px}' +
      '.oo-pro th{font:800 10.5px Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);text-align:right;padding:6px 8px 10px;vertical-align:bottom;border-bottom:1px solid var(--border)}' +
      '.oo-pro col.n{width:17%}.oo-pro col.c{width:44px}' +
      '.oo-pro th.with{color:var(--text);box-shadow:inset 0 -3px 0 var(--accent)}' +
      '.oo-pro th.lead{text-align:left}.oo-lg{width:22px;height:22px;object-fit:contain;vertical-align:middle}' +
      '.oo-pro tbody[data-sec="Our numbers"] tr.sec td span{color:var(--accent)}' +
      '.oo-pro th.pc,.oo-pro td.pc{text-align:left;padding-left:2px;padding-right:6px}' +
      '.oo-pro td.k{overflow:hidden;text-overflow:ellipsis}' +
      '.oo-col > * + *{margin-top:22px}' +
      '.oo-side .oo-pro{margin-top:0}' +
      '.oo-pro td{padding:7px 8px;text-align:right;border-bottom:1px solid var(--border);white-space:nowrap}' +
      '.oo-pro td.k{text-align:left;color:var(--text2);font-weight:600}' +
      '.oo-pro td.up{color:var(--green,#1f8a45);font-weight:700}.oo-pro td.dn{color:var(--red,#c0392b);font-weight:700}' +
      '.oo-pro tr.sec td{border-bottom:0;padding:22px 8px 6px;text-align:left;cursor:pointer;user-select:none}' +
      '.oo-pro tr.sec td span{font:800 15px Inter,system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--text)}' +
      '.oo-pro tr.sec td i{display:inline-block;font-style:normal;color:var(--text3);margin-right:8px;transition:transform .15s}' +
      '.oo-pro tbody.closed tr.sec td i{transform:rotate(-90deg)}' +
      '.oo-pro tbody.closed tr:not(.sec){display:none}' +
      '.oo-pro tr.sub td{border-bottom:0;padding:14px 8px 4px;text-align:left;font:800 11px Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--text3)}' +
      '.oo-pro tbody:first-of-type tr.sec td{padding-top:12px}' +
      '.oo-pc{display:inline-block;min-width:30px;padding:3px 5px;border-radius:5px;font:700 12px Inter,system-ui,sans-serif;text-align:center;box-sizing:border-box}' +
      '.oo-pc.na{color:var(--text3);font-weight:600}' +
      '.oo-who{display:inline-flex;flex-direction:column;align-items:center;gap:4px;text-transform:none;letter-spacing:0}' +
      '.oo-av{position:relative;width:46px;height:46px;border-radius:50%;border:2px solid var(--border2);background:var(--bg2);display:flex;align-items:center;justify-content:center;overflow:visible}' +
      '.oo-av img{width:100%;height:100%;object-fit:cover;border-radius:50%}.oo-av img.lg{width:62%;height:62%;object-fit:contain;border-radius:0}' +
      '.oo-av.on{border-color:#d9a91a}.oo-av.off img{filter:grayscale(1);opacity:.65}' +
      '.oo-av b{position:absolute;top:-7px;right:-12px;font:800 9px Inter,system-ui,sans-serif;letter-spacing:.06em;padding:2px 5px;border-radius:4px;background:#f2c94c;color:#1b1a17}' +
      '.oo-av.off b{background:var(--text3);color:var(--bg)}' +
      '.oo-who small{font:700 10.5px Inter,system-ui,sans-serif;color:var(--text2);max-width:90px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.oo-tbl{width:100%}.oo-tbl td,.oo-tbl th{text-align:right}.oo-tbl td.l,.oo-tbl th.l{text-align:left}' +
      '.oo-tbl td.l a{color:var(--text);font-weight:700;text-decoration:none}.oo-tbl td.l a:hover{text-decoration:underline}';
    document.head.appendChild(st);
  }

  function logo(p) {
    var lg = '';
    try { var c = window.tdcTeamColor && tdcTeamColor(p.team); lg = c && c.logo || ''; } catch (e) {}
    return lg ? '<img class="oo-lg" src="' + lg + '" alt="">' : '';
  }
  function avatar(p, cls, tag) {
    var photo = (window.tdcShowPhotos && window.tdcShowPhotos()) ? 'https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/' + p.id + '.png' : '';
    var lg = '';
    try { var c = window.tdcTeamColor && tdcTeamColor(p.team); lg = c && c.logo || ''; } catch (e) {}
    var img = photo ? '<img src="' + photo + '" alt="" onerror="this.className=\'lg\';this.src=\'' + lg + '\'">' : (lg ? '<img class="lg" src="' + lg + '" alt="">' : '');
    var last = String(p.name || '').split(' ').slice(-1)[0];
    return '<span class="oo-who"><span class="oo-av ' + cls + '">' + img + '<b>' + tag + '</b></span><small>' + esc(last) + ' ' + tag.toLowerCase() + '</small></span>';
  }

  function table(p, P, only) {
    var on = p.on, off = p.off;
    var h = '<table class="oo-pro"><colgroup><col><col class="n"><col class="c"><col class="n"><col class="c"><col class="n"><col class="c"></colgroup><thead><tr><th class="lead">' + logo(p) + '</th>' +
      '<th class="with" title="The team with him on the floor">With him</th><th class="pc">Rank</th><th title="The team with him on the bench">Without</th><th class="pc">Rank</th><th title="With him minus without him">Swing</th><th class="pc">Rank</th></tr></thead>';
    GROUPS.forEach(function (g) {
      if (only && only.indexOf(g[0]) < 0) return;
      h += '<tbody class="' + (CLOSED[g[0]] ? 'closed' : '') + '" data-sec="' + esc(g[0]) + '"><tr class="sec"><td colspan="7"><i>▾</i><span>' + esc(g[0]) + '</span></td></tr>';
      g[1].forEach(function (sub) {
        var rows = sub[1].filter(function (R) { return stat(p, 'on', R[0]) != null || stat(p, 'off', R[0]) != null; });
        if (!rows.length) return;
        if (sub[0]) h += '<tr class="sub"><td colspan="7">' + esc(sub[0]) + '</td></tr>';
        rows.forEach(function (R) {
          var k = R[0], dir = R[2], dec = R[3], suf = R[4];
          var a = stat(p, 'on', k), b = stat(p, 'off', k), d = a != null && b != null ? a - b : null;
          var count = dir === 0;   // minutes / possessions / pace: rank by volume, no good/bad colour
          var pa = pctOf(P.on[k], a, count ? 1 : dir), pb = pctOf(P.off[k], b, count ? 1 : dir), pd = pctOf(P.diff[k], d, count ? 1 : dir);
          var good = d == null || count || Math.abs(d) < 0.05 ? '' : (d * dir > 0 ? 'up' : 'dn');
          h += '<tr><td class="k"' + (R[5] ? ' title="' + esc(R[5]) + '"' : '') + '>' + esc(R[1]) + '</td>' +
            '<td>' + fmt(a, dec, suf) + '</td><td class="pc">' + chip(pa) + '</td>' +
            '<td>' + fmt(b, dec, suf) + '</td><td class="pc">' + chip(pb) + '</td>' +
            '<td class="' + good + '">' + fmt(d, dec, suf, true) + '</td><td class="pc">' + chip(pd) + '</td></tr>';
        });
      });
      h += '</tbody>';
    });
    return h + '</table>';
  }

  var slugOf = function (t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); };
  var shortTeam = function (t) { return window.tdcShortSchool ? tdcShortSchool(t) : t; };
  // heat class for a two-man unit's net rating (same 5 steps as the sheets kit)
  var heat = function (n) { return n == null ? '' : n >= 12 ? 'c4' : n >= 4 ? 'c3' : n <= -12 ? 'c0' : n <= -4 ? 'c1' : 'c2'; };

  function tiles(p, P, S) {
    var on = p.on, off = p.off;
    var dNet = off ? val(on, 'net') - val(off, 'net') : null;
    var sw = dNet == null ? null : dNet / 100 * on.poss / 33;   // ~33 points of margin per win
    var rp = (S.players || []).filter(function (x) { return x.rapm && x.on && x.on.poss >= MIN_POSS; }).map(function (x) { return x.rapm.net; }).sort(function (a, b) { return a - b; });
    var rk = p.rapm ? 1 + rp.filter(function (v) { return v > p.rapm.net; }).length : null;
    var T = [
      ['On − off net', fmt(dNet, 1, '', true), pctOf(P.diff.net, dNet, 1)],
      ['Swing Wins', fmt(sw, 1, '', true), pctOf(P.sw, sw, 1)],
      ['RAPM', p.rapm ? fmt(p.rapm.net, 1, '', true) : '—', p.rapm ? pctOf(rp, p.rapm.net, 1) : null],
      ['RAPM rank', rk ? '#' + rk : '—', null, rk ? 'of ' + rp.length : 'needs ' + MIN_POSS + '+ poss']
    ];
    return '<div class="ui-tiles" style="margin-bottom:0">' + T.map(function (t) {
      return '<div class="ui-tile"><div class="v">' + t[1] + '</div>' + (t[3] ? '<span class="ui-note" style="display:block;margin:4px 0 2px">' + t[3] + '</span>' : chip(t[2])) + '<span class="k">' + t[0] + '</span></div>';
    }).join('') + '</div>';
  }

  function pairs(pr) {
    if (!pr.length) return '<div class="ui-empty">No two-man units with enough possessions.</div>';
    return '<div class="sheet-wrap" style="max-height:none"><table class="sheet oo-tbl"><thead><tr><th class="l">With</th><th>Min</th><th>Net</th><th>Off</th><th>Def</th></tr></thead><tbody>' +
      pr.map(function (x) { var n = LUCK && x[4] != null ? x[4] : x[3];
        return '<tr><td class="l"><a href="player.html?espn=' + esc(x[0]) + '">' + esc(x[1] || x[0]) + '</a></td><td>' + Math.round(x[2] || 0) + '</td>' +
          '<td class="' + heat(n) + '">' + fmt(n, 1, '', true) + '</td><td>' + fmt(x[5], 1) + '</td><td>' + fmt(x[6], 1) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }

  function season(y) { return SEAS[y] ? Promise.resolve(SEAS[y]) : get('scripts/data/wowy_' + y + '.json?v=' + DV).then(function (j) { return (SEAS[y] = j); }); }

  function render(host, opts) {
    if (!host) return; css(); opts = opts || {};
    var espn = opts.espn != null ? String(opts.espn) : null, side = opts.side !== false;
    if (!espn) { host.innerHTML = '<div class="ui-empty">On/off needs a matched player id; this player has none yet.</div>'; return; }
    host.innerHTML = '<div class="ui-empty">Loading on/off…</div>';
    (IDX ? Promise.resolve(IDX) : get('scripts/data/wowy_index.json?v=1').then(function (j) { return (IDX = j || {}); })).then(function (I) {
      var seasons = I[espn] || [];
      if (!seasons.length) { host.innerHTML = '<div class="ui-empty">No on/off for this player yet. It is rebuilt from play-by-play lineups for 2023–24 through 2025–26, for players with 30+ minutes in a season.</div>'; return; }
      var cur = opts.season && seasons.indexOf(+opts.season) >= 0 ? +opts.season : seasons[0];
      var draw = function () {
        Promise.all([
          season(cur),
          !side ? Promise.resolve({}) : PAIRS[cur] ? Promise.resolve(PAIRS[cur]) : get('scripts/data/wowy_pairs_' + cur + '.json?v=1').then(function (j) { return (PAIRS[cur] = j || {}); })
        ]).then(function (r) {
          var S = r[0], PR = r[1] || {};
          if (!S) { host.innerHTML = '<div class="ui-empty">Could not load ' + lbl(cur) + '.</div>'; return; }
          var p = (S.players || []).find(function (x) { return String(x.id) === espn; });
          if (!p || !p.on) { host.innerHTML = '<div class="ui-empty">No ' + lbl(cur) + ' on/off for this player.</div>'; return; }
          var P = pool(cur, S), team = shortTeam(p.team);
          var small = p.on.poss < 300 || (p.off && p.off.poss < 150);
          var h = '<div class="oo-top">' +
            (opts.seasons !== false ? '<span class="ui-seg">' + seasons.slice().sort().map(function (y) { return '<button class="' + (y === cur ? 'on' : '') + '" data-y="' + y + '">' + lbl(y) + '</button>'; }).join('') + '</span>' : '<span></span>') +
            '<label class="ui-check" title="Sets the team\'s own free-throw shooting and the opponent\'s 3-point and free-throw shooting to the D-I average"><input type="checkbox" class="ooLuck"' + (LUCK ? ' checked' : '') + '> Luck-adjusted</label></div>' +
            '<p class="ui-note" style="margin:-4px 0 6px"><b>' + esc(team) + '</b> · ' + Math.round(p.on.min) + ' minutes on the floor' + (p.off ? ', ' + Math.round(p.off.min) + ' off' : '') + ' · ' + (p.g || 0) + ' games' + (S.low_leverage_removed ? ' · garbage time removed' : '') + (small ? ' · <b>small sample</b>' : '') + '</p>';
          var noOff = '<div class="ui-empty">This player was on the floor nearly every minute, so there is no off-floor sample to compare.</div>';
          var units = '<div><div class="oo-h" style="margin-top:0"><span class="ui-label">Two-man units · most minutes first</span>' +
            '<span><a href="onoff-lab.html?team=' + encodeURIComponent(slugOf(p.team)) + '&season=' + cur + '&q=together&p=' + encodeURIComponent(espn) + '">On/Off Lab →</a> &nbsp; <a href="wowy.html?team=' + encodeURIComponent(p.team) + '&season=' + cur + '">Full ' + esc(team) + ' WOWY →</a></span></div>' + pairs(PR[espn] || []) + '</div>';
          if (!p.off) h += '<div class="oo-grid' + (side ? '' : ' solo') + '"><div class="oo-col">' + noOff + '</div>' + (side ? '<div class="oo-col oo-side">' + tiles(p, P, S) + units + '</div>' : '') + '</div>';
          else if (side && opts.tilesTop) h += '<div class="oo-wide">' + tiles(p, P, S) + '</div><div class="oo-grid"><div class="oo-col">' + table(p, P, ['General', 'Offense']) + '</div>' +
            '<div class="oo-col oo-side">' + table(p, P, ['Our numbers', 'Defense']) + units + '</div></div>';
          else if (side) h += '<div class="oo-grid"><div class="oo-col">' + table(p, P, ['General', 'Offense']) + '</div>' +
            '<div class="oo-col oo-side">' + tiles(p, P, S) + table(p, P, ['Our numbers', 'Defense']) + units + '</div></div>';
          else h += '<div class="oo-grid solo"><div class="oo-col">' + table(p, P) + '</div></div>';
          h += '<details class="ui-about"><summary>How this works</summary><p>Each chip ranks the number against D-I players with ' + MIN_POSS + '+ on-floor possessions in ' + lbl(cur) + ' (green = good for the team, red = bad). ' +
            'On/off compares the team with this player on the floor against the minutes they sat; RAPM adjusts for teammates and opponents. Rim = layups, dunks and tips; mid = every other two. Rebuilt from play-by-play substitutions' + (cur <= 2025 ? ' (lineups from CollegeBasketballData)' : '') + '; garbage time removed.</p></details>';
          host.innerHTML = h;
          host.querySelectorAll('[data-y]').forEach(function (b) { b.onclick = function () { cur = +b.dataset.y; draw(); }; });
          host.querySelectorAll('tbody[data-sec] tr.sec').forEach(function (tr) { tr.onclick = function () { var tb = tr.parentNode; tb.classList.toggle('closed'); CLOSED[tb.dataset.sec] = tb.classList.contains('closed'); }; });
          var lk = host.querySelector('.ooLuck'); if (lk) lk.onchange = function () { LUCK = lk.checked; draw(); };
        });
      };
      draw();
    });
  }

  window.TDC_ONOFF = { render: render };
})();
