/* tdc-teamonoff.js — a team's on/off sheet in the databallr / BasketballQuant style (team page On/Off tab, Oct 30 2026).
   One row per player, one column per stat; every cell is filled by its D-I percentile (players with 500+ on-floor
   possessions that season: green good for the team, red bad), so the whole roster reads at a glance.
     View:  On − Off (the swing) · On court · Off court
     Stats: Overview · Shooting · Four factors · Defense · Shot quality
   Click a header to sort; click a player for his full on/off profile (TDC_ONOFF.render) underneath.

   Data: scripts/data/wowy_<season>.json through TDC_ONOFF.api (same numbers and ranks as the player On/Off tab).
   Usage: TDC_TEAMONOFF.render(host, { team: 'Duke Blue Devils', season: 2026, seasons: [2024, 2025, 2026], note })
   League-wide (onoff.html): leave out team; minPoss / minOff (on- and off-floor possessions), filter(p) → bool,
   limit (rows, then Show more), sort (starting column, e.g. 'rapm').
   Each row then names the player's team.
   Player page: player (espn id) instead of team → his team that season, his row highlighted, seasons from wowy_index. */
(function () {
  if (window.TDC_TEAMONOFF) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var lbl = function (y) { return (y - 1) + '–' + String(y).slice(2); };
  var slug = function (t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); };
  var MIN_MIN = 40;
  var logo = function (t) { var lg = ''; try { var c = window.tdcTeamColor && tdcTeamColor(t); lg = c && c.logo || ''; } catch (e) {}
    return lg ? '<img class="to-lg" src="' + lg + '" alt="" loading="lazy">' : ''; };
  var teamOf = function (t) { try { return (window.tdcShortSchool && tdcShortSchool(t)) || t; } catch (e) { return t; } };
  // phones: "C. Boozer" (keeps the first name's initial so the Boozer twins stay apart)
  // phones: "C. Boozer" — suffixes (II, Jr.) dropped; more of the first name when two teammates would match (Cam. / Cay. Boozer)
  var shortName = function (n, k) { var w = String(n || '').split(' ').filter(function (x) { return !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(x); });
    return w.length > 1 ? w[0].slice(0, k || 1) + '. ' + w.slice(1).join(' ') : n; };
  var shortNames = function (L) { var out = {};
    L.forEach(function (p) { var k = 1, sn = shortName(p.name, 1);
      while (k < 6 && L.some(function (q) { return q !== p && shortName(q.name, k) === sn; })) { k++; sn = shortName(p.name, k); }
      out[p.id] = sn; });
    return out; };   // a player needs 40+ minutes on the floor to get a row

  // [key, short header]; labels, direction, decimals and tooltips come from tdc-onoff.js
  var SETS = [
    ['over', 'Overview', [['net', 'Net'], ['o', 'ORtg'], ['d', 'DRtg'], ['pm', '+/-'], ['pace', 'Pace'], ['crunch', 'Crunch'], ['pedge', 'Poss Edge']]],
    ['shoot', 'Shooting', [['efg', 'eFG%'], ['ts', 'TS%'], ['tp', '3P%'], ['rimp', 'Rim%'], ['midp', 'Mid%'], ['ftp', 'FT%'], ['tpar', '3PAr'], ['rimr', 'Rim Att'], ['ftr', 'FTr'], ['ast', 'Ast%']]],
    ['ff', 'Four factors', [['efg', 'eFG%'], ['tov', 'TO%'], ['orb', 'OREB%'], ['ftr', 'FTr'], ['oefg', 'Opp eFG%'], ['otov', 'Opp TO%'], ['drb', 'DREB%'], ['oftr', 'Opp FTr']]],
    ['def', 'Defense', [['oefg', 'Opp eFG%'], ['otp', 'Opp 3P%'], ['orimp', 'Opp Rim%'], ['orimr', 'Opp Rim Att'], ['otpar', 'Opp 3PAr'], ['stl', 'Stl%'], ['blk', 'Blk%'], ['otov', 'Opp TO%'], ['drb', 'DREB%']]],
    ['sq', 'Shot quality', [['lq', 'Look Q'], ['sm', 'Shot-Mk'], ['gsr', 'Great'], ['bsr', 'Bad'], ['olq', 'Opp Look Q'], ['osm', 'Opp Shot-Mk'], ['trppp', 'Trans Pts'], ['hcppp', 'HC Pts'], ['scp', '2nd Ch']]]
  ];
  var VIEWS = [['diff', 'On − Off'], ['on', 'On court'], ['off', 'Off court']];
  var ST = { set: 'over', view: 'diff', sort: 'net', asc: false, open: null };

  function css() {
    if (document.getElementById('tdc-teamonoff-css')) return;
    var st = document.createElement('style'); st.id = 'tdc-teamonoff-css';
    st.textContent =
      '.to-bar{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin:0 0 12px}' +
      '.to-bar .ui-check{margin-left:auto}' +
      '.to-meta{font-size:12.5px;color:var(--text3);margin:0 0 10px}.to-meta b{color:var(--text2)}' +
      '.to-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:10px;background:var(--bg)}' +
      '.to-t{border-collapse:separate;border-spacing:0;width:100%;font-variant-numeric:tabular-nums;font-size:13px}' +
      '.to-t th{position:sticky;top:0;background:var(--bg2);font:800 10px Inter,system-ui,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);' +
        'padding:9px 6px;text-align:center;border-bottom:1px solid var(--border);cursor:pointer;white-space:nowrap;user-select:none}' +
      '.to-t th:hover{color:var(--text)}.to-t th.on{color:var(--text);box-shadow:inset 0 -3px 0 var(--accent)}' +
      '.to-t th.grp{cursor:default;box-shadow:none;border-bottom:0;padding-bottom:2px;color:var(--text2)}' +
      '.to-t td{padding:0;border-bottom:1px solid var(--border);text-align:center;white-space:nowrap;height:38px}' +
      '.to-t td.pl,.to-t th.pl{position:sticky;left:0;z-index:1;background:var(--bg);text-align:left;padding:0 12px;min-width:170px;border-right:1px solid var(--border)}' +
      '.to-t th.pl{background:var(--bg2);z-index:2}' +
      '.to-t td.pl .snm{display:none}' +
      '.to-t td.pl a{color:var(--text);font-weight:700;text-decoration:none}.to-t td.pl small{display:block;font-size:10.5px;color:var(--text3);font-weight:600}' +
      '.to-t td.vol{color:var(--text2);padding:0 10px;font-weight:600}' +
      '.to-t td.h{min-width:64px;font-weight:700;border-left:2px solid var(--bg)}' +
      '.to-t td.h.na{color:var(--text3);font-weight:500}' +
      '.to-t tr.p{cursor:pointer}.to-t tr.p:hover td.pl{background:var(--bg2)}' +
      '.to-t tr.p.open td.pl{box-shadow:inset 3px 0 0 var(--accent)}' +
      '.to-t tr.thin td.h{opacity:.55}' +
      '.to-t tr.me td.pl{background:color-mix(in srgb,var(--accent) 12%,var(--bg));box-shadow:inset 3px 0 0 var(--accent)}' +
      '.to-det{margin:18px 0 0;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg)}' +
      '.to-dh{display:flex;justify-content:space-between;align-items:center;background:var(--strip,#1b1a17);color:#fff;padding:10px 14px;font:800 11.5px Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase}' +
      '.to-x{background:none;border:0;color:#fff;font-size:14px;cursor:pointer;opacity:.75}.to-x:hover{opacity:1}' +
      '.to-prof{padding:14px 16px 4px}' +
      '.to-lg{width:20px;height:20px;object-fit:contain;float:left;margin:6px 8px 0 0}' +
      '.to-more{display:block;margin:10px auto 0;border:1px solid var(--border2);background:var(--bg);border-radius:999px;padding:7px 16px;font:700 12px Inter,system-ui,sans-serif;color:var(--text2);cursor:pointer}' +
      '.to-key{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--text3);margin:10px 2px 0}' +
      '.to-key i{display:inline-block;width:22px;height:12px;border-radius:3px}' +
      '@media(max-width:700px){.to-bar .ui-seg{display:flex;flex-wrap:wrap}.to-bar .ui-check{margin-left:0}.to-t td.pl,.to-t th.pl{min-width:0;padding:0 8px}.to-t td.pl small,.to-t td.pl .fnm{display:none}.to-t td.pl .snm{display:inline}.to-t td.pl{white-space:nowrap!important}.to-meta.top{display:none}.to-t td.h{min-width:52px}}';
    document.head.appendChild(st);
  }

  function seg(name, list, cur) {
    return '<span class="ui-seg">' + list.map(function (x) { return '<button data-' + name + '="' + x[0] + '" class="' + (x[0] === cur ? 'on' : '') + '">' + esc(x[1]) + '</button>'; }).join('') + '</span>';
  }

  function render(host, o) {
    if (!host || !window.TDC_ONOFF || !TDC_ONOFF.api) return;
    css(); o = o || {};
    if (o.player && !o.seasons) {   // the seasons he has on/off for, then draw
      fetch('scripts/data/wowy_index.json?v=1').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (I) {
        var ys = (I[String(o.player)] || []).map(Number);
        if (!ys.length) { host.innerHTML = ''; var pn = host.closest('.ui-panel'), t = host.previousElementSibling;   // no data: drop the section (panelized or not)
          if (pn && !pn.contains(document.querySelector('#playerWowyHost'))) pn.hidden = true; else if (t && t.classList.contains('sec-title')) t.hidden = true; return; }
        render(host, Object.assign({}, o, { seasons: ys }));
      });
      return;
    }
    var seasons = (o.seasons || [2024, 2025, 2026]).slice().sort(), cur = o.season && seasons.indexOf(+o.season) >= 0 ? +o.season : seasons[seasons.length - 1];
    var want = slug(o.team), SHOWN = o.limit || 0;
    if (o.sort && !host._sorted) { host._sorted = 1; ST.sort = o.sort; ST.asc = false; }   // a page's starting sort, once
    host.innerHTML = '<div class="ui-empty">Loading on/off…</div>';
    var draw = function () {
      TDC_ONOFF.api(cur).then(function (A) {
        if (!A) { host.innerHTML = '<div class="ui-empty">Could not load ' + lbl(cur) + '.</div>'; return; }
        if (o.player) { var me = (A.S.players || []).find(function (p) { return String(p.id) === String(o.player); }); want = me ? slug(me.team) : '__none'; }
        var league = !want;
        var players = (A.S.players || []).filter(function (p) { return (league || slug(p.team) === want) && p.on && p.on.min >= MIN_MIN &&
          (!o.minPoss || p.on.poss >= o.minPoss) && (!o.minOff || (p.off && p.off.poss >= o.minOff)) && (!o.filter || o.filter(p)); });
        var setDef = SETS.find(function (x) { return x[0] === ST.set; }), cols = setDef[2];
        var bar = '<div class="to-bar">' + (seasons.length > 1 ? seg('y', seasons.map(function (y) { return [y, lbl(y)]; }), cur) : '') +
          seg('v', VIEWS, ST.view) + seg('s', SETS.map(function (x) { return [x[0], x[1]]; }), ST.set) +
          '<label class="ui-check" title="Sets the team\'s own free-throw shooting and the opponent\'s 3-point and free-throw shooting to the D-I average"><input type="checkbox" class="toLuck"' + (A.luck() ? ' checked' : '') + '> Luck-adjusted</label></div>';
        if (!players.length) { host.innerHTML = bar + '<div class="ui-empty">' + (league ? 'No players match the filter.' : 'No ' + lbl(cur) + ' on/off for this team. It is rebuilt from play-by-play lineups (2023–24 on).') + '</div>'; wire(); return; }
        // RAPM: rank among the D-I pool (Overview only)
        var rp = (A.S.players || []).filter(function (x) { return x.rapm && x.on && x.on.poss >= A.MIN; }).map(function (x) { return x.rapm.net; }).sort(function (a, b) { return a - b; });
        var rapmPct = function (v) { if (v == null) return null; var n = 0; rp.forEach(function (x) { if (x < v) n++; }); return Math.round(100 * n / rp.length); };
        var val = function (p, k) {
          if (k === 'rapm') return p.rapm ? p.rapm.net : null;
          var a = A.stat(p, 'on', k), b = A.stat(p, 'off', k);
          return ST.view === 'on' ? a : ST.view === 'off' ? b : (a != null && b != null ? a - b : null);
        };
        var pctOf = function (p, k, v) { return k === 'rapm' ? rapmPct(v) : A.pct(ST.view, k, v); };
        var C = (ST.set === 'over' ? [['rapm', 'RAPM']] : []).concat(cols);
        if (!C.some(function (c) { return c[0] === ST.sort; }) && ST.sort !== 'min' && ST.sort !== 'name') ST.sort = C[0][0];
        var key = function (p) { return ST.sort === 'min' ? p.on.min : ST.sort === 'name' ? p.name : val(p, ST.sort); };
        players.sort(function (a, b) {
          var x = key(a), y = key(b);
          if (ST.sort === 'name') return ST.asc ? String(x).localeCompare(y) : String(y).localeCompare(x);
          if (x == null) return 1; if (y == null) return -1;
          var dir = A.meta[ST.sort] && A.meta[ST.sort][2] < 0 ? -1 : 1;   // lower-is-better stats (DRtg, TO%…): best first
          return (ST.asc ? 1 : -1) * dir * (x - y);
        });
        var total = players.length;
        if (o.limit && !league) o.limit = 0;
        if (o.limit) players = players.slice(0, SHOWN);
        var SN = shortNames(players);
        var openP = (A.S.players || []).find(function (p) { return String(p.id) === ST.open; }) || null;
        var vName = VIEWS.find(function (v) { return v[0] === ST.view; })[1];
        var head = '<thead><tr><th class="pl" data-k="name">Player</th><th data-k="min" class="' + (ST.sort === 'min' ? 'on' : '') + '">Min</th>' +
          C.map(function (c) { var R = A.meta[c[0]]; var tip = c[0] === 'rapm' ? 'Regularized adjusted plus-minus: net points per 100 he adds after accounting for teammates and opponents' : R ? (R[1] + (R[5] ? ': ' + R[5] : '')) : c[1];
            return '<th data-k="' + c[0] + '" class="' + (ST.sort === c[0] ? 'on' : '') + '" title="' + esc(tip) + '">' + esc(c[1]) + '</th>'; }).join('') + '</tr></thead>';
        var body = players.map(function (p) {
          var thin = p.on.poss < 300 || !p.off || p.off.poss < 150, open = ST.open === String(p.id);
          var cells = C.map(function (c) {
            var k = c[0], v = val(p, k), R = A.meta[k] || ['rapm', 'RAPM', 1, 1, ''];
            if (v == null) return '<td class="h na">—</td>';
            var pc = R[2] === 0 ? null : pctOf(p, k, v), f = pc == null ? null : A.fill(pc);   // pace / shot mix volume: no good or bad
            var signed = ST.view === 'diff' || k === 'rapm' || k === 'net' || k === 'pm' || k === 'crunch' || k === 'pedge' || k === 'sm' || k === 'osm';
            var dec = k === 'pm' ? 0 : R[3], txt = (signed && v > 0 ? '+' : '') + (+v).toFixed(dec) + (ST.view === 'diff' ? '' : (R[4] || ''));
            return '<td class="h"' + (f ? ' style="background:' + f[0] + ';color:' + f[1] + '"' : '') + ' title="' + esc(R[1]) + ' · ' + vName + ': ' + txt + (pc != null ? ' · ' + pc + 'th percentile among D-I players' : '') + '">' + txt + '</td>';
          }).join('');
          return '<tr class="p' + (thin ? ' thin' : '') + (o.player && String(p.id) === String(o.player) ? ' me' : '') + (open ? ' open' : '') + '" data-id="' + esc(p.id) + '"><td class="pl">' + (league ? logo(p.team) : '') + '<a href="player.html?espn=' + esc(p.id) + '&tab=onoff"><span class="fnm">' + esc(p.name) + '</span><span class="snm">' + esc(SN[p.id]) + '</span></a>' +
            '<small>' + (league ? esc(teamOf(p.team)) + ' · ' : '') + (p.g || 0) + ' g · ' + Math.round(p.on.poss) + ' on / ' + Math.round(p.off ? p.off.poss : 0) + ' off poss' + (thin ? ' · small sample' : '') + '</small></td>' +
            '<td class="vol">' + Math.round(p.on.min) + '</td>' + cells + '</tr>';
        }).join('');
        host.innerHTML = bar +
          '<p class="to-meta top"><b>' + esc(vName) + '</b> · ' + esc(setDef[1]) + ' · ' + lbl(cur) + (A.S.low_leverage_removed ? ' · garbage time removed' : '') + ' · click a player for his full profile</p>' +
          '<div class="to-wrap"><table class="to-t">' + head + '<tbody>' + body + '</tbody></table></div>' +
          (o.limit && total > players.length ? '<button type="button" class="to-more">Show ' + Math.min(o.limit, total - players.length) + ' more · ' + players.length + ' of ' + total + '</button>' : '') +
          '<div class="to-key">Cell colour = rank among D-I players with ' + A.MIN + '+ on-floor possessions' + (ST.view === 'diff' ? ' (their on − off)' : '') + ':' +
          ['0', '25', '50', '75', '100'].map(function (q) { var f = A.fill(+q); return '<i style="background:' + f[0] + '"></i>' + q; }).join(' ') + ' · green = good for the team · faded rows = small sample</div>' +
          (o.note ? '<p class="to-meta" style="margin-top:8px">' + o.note + '</p>' : '') +
          (openP ? '<div class="to-det"><div class="to-dh"><span>' + esc(openP.name) + ' · full on/off profile</span><button type="button" class="to-x" aria-label="Close">✕</button></div><div class="to-prof"></div></div>' : '');
        wire();
        var prof = host.querySelector('.to-prof');
        if (prof) { TDC_ONOFF.render(prof, { espn: ST.open, season: cur, seasons: false, side: false });
          host.querySelector('.to-x').onclick = function () { ST.open = null; draw(); };
          host.querySelector('.to-det').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      });
    };
    function wire() {
      host.querySelectorAll('[data-y]').forEach(function (b) { b.onclick = function () { cur = +b.dataset.y; ST.open = null; draw(); }; });
      host.querySelectorAll('[data-v]').forEach(function (b) { b.onclick = function () { ST.view = b.dataset.v; draw(); }; });
      host.querySelectorAll('[data-s]').forEach(function (b) { b.onclick = function () { ST.set = b.dataset.s; draw(); }; });
      host.querySelectorAll('th[data-k]').forEach(function (th) { th.onclick = function () { var k = th.dataset.k; if (ST.sort === k) ST.asc = !ST.asc; else { ST.sort = k; ST.asc = k === 'name'; } draw(); }; });
      host.querySelectorAll('tr.p').forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('a')) return; ST.open = ST.open === tr.dataset.id ? null : tr.dataset.id; draw(); }; });
      var mr = host.querySelector('.to-more'); if (mr) mr.onclick = function () { SHOWN += o.limit; draw(); };
      var lk = host.querySelector('.toLuck'); if (lk) lk.onchange = function () { TDC_ONOFF.api(cur).then(function (A) { A.luck(lk.checked); draw(); }); };
    }
    draw();
  }

  window.TDC_TEAMONOFF = { render: render };
})();
