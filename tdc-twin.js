/* tdc-twin.js — Shot Profile Twin: a player-season's free-throw, rim, midrange and three-point VOLUME (attempts per 100
 * possessions on the floor) and EFFICIENCY, each against that season's D-I average, and the closest player-seasons in
 * any year (scripts/build_shot_twins.py -> scripts/data/shot_aftermath/twin_pool.json).
 *
 *   TDC_TWIN.render(host, {espn, season})              his profile, his #1 twin beside it, and the closest matches
 *   TDC_TWIN.compare(host, [{espn,season},{espn,season}])  two players' profiles side by side (compare page)
 *
 * Matching: every dimension is standardised by its season's spread; the distance is the root-mean-square gap over the
 * dimensions both seasons have (at least six of the eight); match = 100 − 10 × distance. Bars: volume is neutral grey
 * (how often, not good or bad); efficiency is gold above the D-I average, blue below (validated palette).
 */
(function () {
  var URLS = { player: 'scripts/data/shot_aftermath/twin_pool.json?v=2', team: 'scripts/data/shot_aftermath/team_twin_pool.json?v=3', teamdef: 'scripts/data/shot_aftermath/team_def_twin_pool.json?v=2' };
  var POOLS = {}, PS = {}, POOL = null, KIND = 'player';
  var Z = [['FT', 'ftV', 'ftE'], ['Rim', 'rimV', 'rimE'], ['Mid', 'midV', 'midE'], ['3P', 'tV', 'tE']];
  var C = null;   // column index (same layout in both pools: a team row keeps its id / name / conference / possessions in the player slots)
  function load(kind) { kind = kind || 'player';
    return (PS[kind] || (PS[kind] = fetch(URLS[kind]).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })))
      .then(function (j) { POOLS[kind] = j; POOL = j; KIND = kind; if (j) { C = {}; j.cols.forEach(function (c, i) { C[c] = i; }); } return j; }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sl(y) { return (y - 1) + '–' + String(y).slice(2); }
  function short(t) { try { return (window.TDCTeamName && TDCTeamName.short) ? TDCTeamName.short(t) : t; } catch (e) { return t; } }
  function css() {
    if (document.getElementById('twin-css')) return;
    var s = document.createElement('style'); s.id = 'twin-css';
    s.textContent =
      // volume unit: full on wide cards, short (and no +/- gap, the D-I AVG column is right there) on phones
      '.twin .tw-tr small{font-size:inherit;font-weight:inherit;}.twin .tw-us{display:none;}@media(max-width:640px){.twin .tw-ul,.twin .tw-d{display:none;}.twin .tw-us{display:inline;}}' +
      '.twin{--tw-vol:#8A867A;--tw-pos:#B07D17;--tw-neg:#2F7FC1;}[data-theme="dark"] .twin{--tw-vol:#6D7486;--tw-pos:#B8862A;--tw-neg:#3A8BCB;}' +
      '.tw-pair{display:grid;grid-template-columns:1fr 1fr;gap:18px;}@media(max-width:900px){.tw-pair{grid-template-columns:1fr;}}' +
      '.tw-card{border:1px solid var(--border2);border-radius:12px;padding:14px 16px 10px;background:var(--bg);}' +
      '.tw-hd{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px;}' +
      '.tw-nm{font-size:19px;font-weight:800;color:var(--text);} .tw-nm a{color:inherit;text-decoration:none;} .tw-nm a:hover{text-decoration:underline;}' +
      '.tw-meta{font-size:12px;color:var(--text3);} .tw-chips{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 6px;}' +
      '.tw-chip{font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:6px;border:1px solid var(--border2);color:var(--text2);font-variant-numeric:tabular-nums;}' +
      '.tw-chip.m{border-color:var(--tw-pos);color:var(--text);}' +
      '.tw-zone{display:grid;grid-template-columns:38px 1fr 54px;align-items:center;column-gap:8px;}' +
      '.tw-zt{grid-column:1 / span 3;display:grid;grid-template-columns:38px 1fr 54px;column-gap:8px;margin:10px 0 2px;font-size:10.5px;font-weight:800;letter-spacing:.08em;color:var(--text3);}' +
      '.tw-zt b{font-size:13px;color:var(--text);text-align:center;letter-spacing:.04em;} .tw-zt span{display:flex;justify-content:space-between;}' +
      '.tw-rl{font-size:10.5px;font-weight:800;letter-spacing:.08em;color:var(--text3);}' +
      '.tw-tr{position:relative;height:22px;background:var(--bg2);border-radius:4px;margin:2px 0;}' +
      '.tw-tr i{position:absolute;top:3px;bottom:3px;border-radius:3px;} .tw-mid{position:absolute;top:0;bottom:0;left:50%;width:1px;background:var(--text3);}' +
      '.tw-tr span{position:absolute;top:0;line-height:22px;font-size:12px;font-weight:700;color:var(--text);white-space:nowrap;font-variant-numeric:tabular-nums;}' +
      '.tw-lg{font-size:11.5px;color:var(--text3);text-align:right;font-variant-numeric:tabular-nums;}' +
      '.tw-foot{display:none;}' +   // owner rule: no explanatory footnotes under charts
      '.tw-tbl td.pos{color:var(--tw-pos);} .tw-tbl td.neg{color:var(--tw-neg);} .tw-tbl tr.sel td{background:var(--bg2);} .tw-tbl tbody tr{cursor:pointer;}' +
      '.tw-top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px;font-size:13px;color:var(--text2);}' +
      '.tw-top select{font:600 12.5px Inter,system-ui,sans-serif;padding:5px 8px;border:1px solid var(--border2);border-radius:6px;background:var(--bg2);color:var(--text);}' +
      '.tw-empty{padding:22px;text-align:center;color:var(--text3);font-size:13px;}' +
      '.tw-side{display:inline-flex;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:3px;gap:3px;}.tw-side button{font:700 12px Inter,system-ui,sans-serif;padding:5px 11px;border:0;border-radius:5px;background:none;color:var(--text3);cursor:pointer;}.tw-side button.on{background:var(--text);color:var(--bg);}';
    document.head.appendChild(s);
  }
  function rowsOf(espn) { return POOL.rows.filter(function (r) { return String(r[0]) === String(espn); }).sort(function (a, b) { return b[1] - a[1]; }); }
  function zOf(r, d) { var v = r[C[d]], sd = POOL.seasons[r[1]].sd[d]; return v == null ? null : v / sd; }
  function dist(a, b) {
    var s = 0, n = 0; POOL.dims.forEach(function (d) { var x = zOf(a, d), y = zOf(b, d); if (x != null && y != null) { s += (x - y) * (x - y); n++; } });
    return n >= 6 ? Math.sqrt(s / n) : null;
  }
  function matches(r, k) {
    var out = [];
    POOL.rows.forEach(function (o) { if (o === r) return; var d = dist(r, o); if (d != null) out.push([d, o]); });
    out.sort(function (a, b) { return a[0] - b[0]; });
    return out.slice(0, k || 12).map(function (x) { return { r: x[1], match: Math.max(0, 100 - 10 * x[0]) }; });
  }
  // one player-season's profile card
  function card(r, badge) {
    var S = POOL.seasons[r[1]], avg = S.avg, sdv = S.sd;
    var T = KIND !== 'player', DEF = KIND === 'teamdef';
    var head = '<div class="tw-hd"><div class="tw-nm">' + (T ? '<a href="team.html?team=' + encodeURIComponent(short(r[2])) + '">' + esc(short(r[2])) + '</a>' :
        '<a href="player.html?espn=' + esc(r[0]) + '&name=' + encodeURIComponent(r[2] || '') + '">' + esc(r[2] || '—') + '</a>') + '</div>' +
      '<div class="tw-meta">' + (T ? esc(r[3] || '') + ' · ' + sl(r[1]) : esc(short(r[3])) + ' · ' + sl(r[1]) + (r[4] ? ' · ' + ({ G: 'guard', F: 'forward', C: 'center' }[r[4]] || '') : '')) + '</div></div>' +
      '<div class="tw-chips">' + (badge ? '<span class="tw-chip m">' + badge + '</span>' : '') + '<span class="tw-chip">' + r[C.pts100] + ' pts / 100 poss' + (DEF ? ' allowed' : '') + '</span>' +
      (r[C.ts] != null ? '<span class="tw-chip">' + (DEF ? 'Opp. ' : '') + 'TS% ' + (100 * r[C.ts]).toFixed(1) + '</span>' : '') + '<span class="tw-chip">' + Number(r[C.min]).toLocaleString() + (T ? (DEF ? ' possessions faced' : ' possessions') : ' min') + '</span></div>';
    var body = '';
    Z.forEach(function (z) {
      body += '<div class="tw-zt"><span></span><span><span>BELOW AVG</span><b>' + z[0] + '</b><span>ABOVE AVG</span></span><span style="text-align:right">D-I AVG</span></div>';
      [['VOL', z[1]], ['EFF', z[2]]].forEach(function (k) {
        var d = k[1], rel = r[C[d]], isE = k[0] === 'EFF';
        var bar = '';
        if (rel == null) bar = '<span style="left:52%;color:var(--text3)">too few attempts</span>';
        else {
          var x = Math.max(-1, Math.min(1, rel / (2.5 * sdv[d]))), w = Math.abs(x) * 50, l = x < 0 ? 50 - w : 50;
          var col = isE ? (rel >= 0 ? 'var(--tw-pos)' : 'var(--tw-neg)') : 'var(--tw-vol)';
          var raw = Math.max(0, avg[d] + rel), txt = isE ? (100 * raw).toFixed(1) + '% (' + (rel >= 0 ? '+' : '') + (100 * rel).toFixed(1) + ')' : raw.toFixed(1) + '<small class="tw-ul"> / 100 poss</small><small class="tw-us">/100</small><small class="tw-d"> (' + (rel >= 0 ? '+' : '') + rel.toFixed(1) + ')</small>';   // the unit on the number: the footnote that says so is hidden by tdc-skin
          bar = '<i style="left:' + l + '%;width:' + Math.max(w, 0.6) + '%;background:' + col + '"></i>' +
            '<span style="' + (x < 0 ? 'left:52%' : 'right:52%') + '">' + txt + '</span>';
        }
        body += '<div class="tw-rl">' + k[0] + '</div><div class="tw-tr"><div class="tw-mid"></div>' + bar + '</div><div class="tw-lg">' + (isE ? (100 * avg[d]).toFixed(1) + '%' : avg[d].toFixed(1)) + '</div>';
      });
    });
    // SHOT QUALITY: expected points per shot from where the shots come from (D-I make rate by zone), and
    // SHOT-MAKING: actual points per shot minus that. Gold = more points than D-I, blue = fewer.
    if (C.xpps != null) {
      var xq = r[C.xpps], mk = r[C.smk], lx = S.xpps;
      body += '<div class="tw-zt"><span></span><span><span>BELOW AVG</span><b>Shot quality</b><span>ABOVE AVG</span></span><span style="text-align:right">D-I AVG</span></div>';
      [['QUAL', xq == null || lx == null ? null : xq - lx, xq == null ? '' : xq.toFixed(3) + ' (' + (xq - lx >= 0 ? '+' : '') + (xq - lx).toFixed(3) + ')', 0.12, lx != null ? lx.toFixed(3) : '—'],
       ['MAKE', mk, mk == null ? '' : (mk >= 0 ? '+' : '') + mk.toFixed(3) + ' / shot', 0.25, '0.000']].forEach(function (q) {
        var bar;
        if (q[1] == null) bar = '<span style="left:52%;color:var(--text3)">too few shots</span>';
        else { var x = Math.max(-1, Math.min(1, q[1] / q[3])), w = Math.abs(x) * 50, l = x < 0 ? 50 - w : 50;
          bar = '<i style="left:' + l + '%;width:' + Math.max(w, 0.6) + '%;background:' + (q[1] >= 0 ? 'var(--tw-pos)' : 'var(--tw-neg)') + '"></i><span style="' + (x < 0 ? 'left:52%' : 'right:52%') + '">' + q[2] + '</span>'; }
        body += '<div class="tw-rl">' + q[0] + '</div><div class="tw-tr"><div class="tw-mid"></div>' + bar + '</div><div class="tw-lg">' + q[4] + '</div>';
      });
    }
    return '<div class="tw-card">' + head + '<div class="tw-zone">' + body + '</div><div class="tw-foot">Volume is ' + (KIND === 'teamdef' ? 'opponent ' : '') + 'attempts per 100 possessions' + (KIND !== 'player' ? '' : ' on the floor') + '; efficiency is FG% (FT% for free throws), against that season’s D-I average.</div></div>';
  }
  function qCell(v) { if (v == null) return '<td>—</td>'; return '<td class="' + (v >= 0 ? 'pos' : 'neg') + '">' + (v >= 0 ? '+' : '') + v.toFixed(3) + '</td>'; }
  function fmtRel(v, isE) { if (v == null) return '<td>—</td>'; var t = isE ? (v >= 0 ? '+' : '') + (100 * v).toFixed(1) + '%' : (v >= 0 ? '+' : '') + v.toFixed(1); return '<td class="' + (isE ? (v >= 0 ? 'pos' : 'neg') : '') + '">' + t + '</td>'; }

  function render(host, o) {
    if (!host) return; css(); o = o || {}; host.classList.add('twin');
    var kind = o.teamId != null ? (o.side === 'def' ? 'teamdef' : 'team') : 'player', isT = kind !== 'player', who = isT ? 'team' : 'player';
    host.innerHTML = '<div class="tw-empty">Loading every ' + who + '-season since 2009-10…</div>';
    load(kind).then(function () {
      if (!POOL) { host.innerHTML = '<div class="tw-empty">Shot profiles are not available.</div>'; return; }
      var mine = rowsOf(isT ? o.teamId : o.espn);
      if (!mine.length) { host.innerHTML = '<div class="tw-empty">' + (isT ? 'No D-I play-by-play for this team.' : 'No D-I season with 300+ minutes for him yet.') + '</div>'; return; }
      var r = (o.season && mine.find(function (x) { return x[1] === o.season; })) || mine[0];
      var M = matches(r, 12), pick = 0;
      var myPool = POOL, myC = C, myKind = kind;
      var draw = function () { POOL = myPool; C = myC; KIND = myKind;
        var t = M[pick];
        var sel = mine.length > 1 ? '<select id="twSeason">' + mine.map(function (x) { return '<option value="' + x[1] + '"' + (x === r ? ' selected' : '') + '>' + sl(x[1]) + (isT ? '' : ' · ' + esc(short(x[3]))) + '</option>'; }).join('') + '</select>' : '';
        var sideBtns = isT ? '<span class="tw-side">' + [['off', 'Offense'], ['def', 'Defense']].map(function (b) { return '<button type="button" data-side="' + b[0] + '" class="' + ((o.side === 'def') === (b[0] === 'def') ? 'on' : '') + '">' + b[1] + '</button>'; }).join('') + '</span>' : '';
        var h = '<div class="tw-top"><span>' + (isT ? (kind === 'teamdef' ? 'What opponents shot against them in <b>' + sl(r[1]) + '</b>, and the closest defensive team-seasons in any year since 2009-10.' : 'Their <b>' + sl(r[1]) + '</b> shot profile and the closest team-seasons in any year since 2009-10.') : 'His <b>' + sl(r[1]) + '</b> shot profile and the closest player-seasons in any year since 2009-10.') + '</span><span style="display:flex;gap:8px;align-items:center">' + sideBtns + sel + '</span></div>' +
          '<div class="tw-pair">' + card(r, 'Selected') + (t ? card(t.r, '#' + (pick + 1) + ' twin · ' + t.match.toFixed(1) + ' match') : '<div class="tw-card tw-empty">No close match.</div>') + '</div>';
        h += '<div class="sheet-wrap tw-tbl" style="max-height:none;margin-top:14px;"><table class="sheet dense"><thead><tr><th class="l">#</th><th class="l">' + (isT ? 'Team season' : 'Player season') + '</th><th>Match</th>' +
          Z.map(function (z) { return '<th title="' + z[0] + ' attempts per 100 possessions, vs the D-I average">' + z[0] + ' /100 poss</th><th title="' + z[0] + (z[0] === 'FT' ? ' FT%' : ' FG%') + ', vs the D-I average">' + z[0] + ' eff</th>'; }).join('') + (C.xpps != null ? '<th>Shot quality</th><th>Shot-making</th>' : '') + '</tr></thead><tbody>' +
          M.map(function (m, i) { var x = m.r; return '<tr data-i="' + i + '" class="' + (i === pick ? 'sel' : '') + '"><td class="l">' + (i + 1) + '</td><td class="l"><b>' + esc(isT ? short(x[2]) : (x[2] || '—')) + '</b> <span class="small">· ' + esc(isT ? (x[3] || '') : short(x[3])) + ' · ' + sl(x[1]) + '</span></td><td><b>' + m.match.toFixed(1) + '</b></td>' +
            Z.map(function (z) { return fmtRel(x[C[z[1]]], false) + fmtRel(x[C[z[2]]], true); }).join('') +
            (C.xpps != null ? qCell(x[C.xpps] != null && POOL.seasons[x[1]].xpps != null ? x[C.xpps] - POOL.seasons[x[1]].xpps : null) + qCell(x[C.smk]) : '') + '</tr>'; }).join('') + '</tbody></table></div>' +
          '<div class="tw-foot">Pick a row to put that ' + who + '-season beside ' + (isT ? 'them' : 'him') + '. Similarity weights all eight dimensions equally after standardising each by its season’s spread; two player-seasons must share at least six of them (an efficiency needs 15+ attempts). Every D-I player-season with 300+ minutes since 2009-10, from ESPN play-by-play.</div>';
        host.innerHTML = h;
        var s = host.querySelector('#twSeason'); if (s) s.onchange = function () { render(host, Object.assign({}, o, { season: +s.value })); };
        host.querySelectorAll('.tw-tbl tbody tr').forEach(function (tr) { tr.onclick = function () { pick = +tr.getAttribute('data-i'); draw(); }; });
        host.querySelectorAll('.tw-side button').forEach(function (b) { b.onclick = function () { render(host, Object.assign({}, o, { side: b.getAttribute('data-side'), season: r[1] })); }; });
      };
      draw();
    });
  }
  function compare(host, list, kind) {
    if (!host) return Promise.resolve(); css(); host.classList.add('twin'); kind = kind || 'player';
    host.innerHTML = '<div class="tw-empty">Loading shot profiles…</div>';
    return load(kind).then(function () {   // returned: callers chain a second compare so the shared pool state never interleaves
      if (!POOL) { host.innerHTML = ''; return; }
      var rs = (list || []).map(function (p) { var m = rowsOf(p && (kind !== 'player' ? p.teamId : p.espn)); return (p && p.season && m.find(function (x) { return x[1] === p.season; })) || m[0] || null; });
      if (!rs.some(Boolean)) { host.innerHTML = '<div class="tw-empty">' + (kind !== 'player' ? 'No D-I play-by-play for these teams.' : 'No D-I seasons with 300+ minutes for these players.') + '</div>'; return; }
      var both = rs[0] && rs[1] ? dist(rs[0], rs[1]) : null;
      host.innerHTML = (both != null ? '<div class="tw-top"><span>Shot-profile match: <b>' + Math.max(0, 100 - 10 * both).toFixed(1) + '</b> (100 = identical, relative to each season’s D-I average)</span></div>' : '') +
        '<div class="tw-pair">' + rs.map(function (r) { return r ? card(r) : '<div class="tw-card tw-empty">No data.</div>'; }).join('') + '</div>';
    });
  }
  window.TDC_TWIN = { render: render, compare: compare, load: load };
})();
