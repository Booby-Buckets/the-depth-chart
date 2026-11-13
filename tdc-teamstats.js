/* tdc-teamstats.js — the team page "Team Stats" tab (owner, Nov 12 2026: "a full stats page for the actual team stats").
   Real box-score numbers only, any season we have box scores for:
     1. Team vs opponents        (per game / totals)
     2. Players                  (per game / totals / shooting, team total row)
     3. Game log                 (the team's line in every game)
   TDC_TEAMSTATS.show(host, {full, season})   full = the ESPN name used in `games` / `box_scores` ("Notre Dame Fighting Irish")
   Sheet kit tables (tdc-sheets.css); per-game player columns shaded by tdcSheetHeat when the page loads it. */
(function () {
  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye', H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  var K = ['min', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'oreb', 'dreb', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function lbl(y) { y = +y; return (y - 1) + '-' + String(y).slice(2); }
  var CSS =
    '.tst h2{font:800 22px "Playfair Display",Georgia,serif;letter-spacing:-.01em;color:var(--text);margin:0;}' +
    '.tst-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px 14px;flex-wrap:wrap;margin:26px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--text);}' +
    '.tst-head:first-child{margin-top:0;}' +
    '.tst-head .sub{font-size:12px;color:var(--text3);display:flex;align-items:center;gap:10px;flex-wrap:wrap;}' +
    '.tst-tog{display:inline-flex;border:1px solid var(--border2);border-radius:999px;overflow:hidden;}' +
    '.tst-tog button{font:700 11.5px Inter,system-ui,sans-serif;padding:5px 12px;border:0;background:none;color:var(--text2);cursor:pointer;}' +
    '.tst-tog button.on{background:var(--text);color:var(--bg);}' +
    '.tst table th,.tst table td{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
    '.tst table th.l,.tst table td.l{text-align:left;}' +
    '.tst tr.opp td{color:var(--text2);} .tst tr.dif td{color:var(--text3);font-size:11.5px;}' +
    '.tst tfoot td{font-weight:800;border-top:2px solid var(--border2);background:var(--bg2);}' +
    '.tst td.nm a{color:var(--text);text-decoration:none;font-weight:600;} .tst td.nm a:hover{color:var(--accent);text-decoration:underline;}' +
    '.tst .w{color:#2e8b57;font-weight:800;} .tst .x{color:#c75d5d;font-weight:800;}' +
    '[data-theme="dark"] .tst .w{color:#6fbf7e;} [data-theme="dark"] .tst .x{color:#e07a7a;}' +
    '.tst tr.lnk{cursor:pointer;}' +
    '.tst-foot{font-size:11.5px;color:var(--text3);line-height:1.5;margin:8px 2px 0;}';
  function css() { if (document.getElementById('tst-css')) return; var s = document.createElement('style'); s.id = 'tst-css'; s.textContent = CSS; document.head.appendChild(s); }
  function pref(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function setPref(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // every box row of the team's games (its own players and the opponents'), paged on a stable ORDER BY
  function rowsFor(full, yr) {
    var q = encodeURIComponent(full), out = [];
    function page(off) {
      return fetch(SB + '/rest/v1/box_scores?season_year=eq.' + yr + '&or=(team.eq.' + q + ',opp.eq.' + q + ')&select=game_id,date,team,opp,player,espn_id,starter,' + K.join(',') +
        '&order=game_id.asc,espn_id.asc&limit=1000&offset=' + off, { headers: H })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) { out = out.concat(rows || []); return rows && rows.length === 1000 ? page(off + 1000) : out; });
    }
    return page(0);
  }
  function games(full, yr) {
    var q = encodeURIComponent(full);
    return fetch(SB + '/rest/v1/games?season_year=eq.' + yr + '&or=(home.eq.' + q + ',away.eq.' + q + ')&status=eq.STATUS_FINAL&select=id,date,home,away,home_score,away_score,neutral,conf_game&order=date.asc', { headers: H })
      .then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
  }
  var sum = function () { var o = {}; K.forEach(function (k) { o[k] = 0; }); return o; };
  var add = function (T, r) { K.forEach(function (k) { T[k] += +r[k] || 0; }); };
  var pct = function (m, a) { return a > 0 ? (100 * m / a).toFixed(1) : '—'; };
  var f1 = function (v) { return v.toFixed(1); };
  var sg = function (d, dp) { return (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(dp); };
  var efg = function (T) { return T.fga > 0 ? (100 * (T.fgm + 0.5 * T.tpm) / T.fga).toFixed(1) : '—'; };
  var ts = function (T) { var d = 2 * (T.fga + 0.44 * T.fta); return d > 0 ? (100 * T.pts / d).toFixed(1) : '—'; };

  function teamTable(me, op, g, mode) {
    var C = [['pts', 'PTS'], ['fgm', 'FGM'], ['fga', 'FGA'], ['fg%', 'FG%'], ['tpm', '3PM'], ['tpa', '3PA'], ['3p%', '3P%'], ['ftm', 'FTM'], ['fta', 'FTA'], ['ft%', 'FT%'],
      ['efg', 'eFG%'], ['oreb', 'OREB'], ['dreb', 'DREB'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['tov', 'TO'], ['pf', 'PF']];
    var val = function (T, k) {
      if (k === 'fg%') return T.fga ? 100 * T.fgm / T.fga : 0; if (k === '3p%') return T.tpa ? 100 * T.tpm / T.tpa : 0;
      if (k === 'ft%') return T.fta ? 100 * T.ftm / T.fta : 0; if (k === 'efg') return T.fga ? 100 * (T.fgm + 0.5 * T.tpm) / T.fga : 0;
      return mode === 'pg' ? T[k] / g : T[k];
    };
    var isPct = function (k) { return /%|efg/.test(k); };
    var cell = function (T, k) { var v = val(T, k); return isPct(k) || mode === 'pg' ? f1(v) : String(v); };
    var row = function (cls, name, f) { return '<tr class="' + cls + '"><td class="l">' + name + '</td><td>' + g + '</td>' + C.map(function (c) { return '<td>' + f(c[0]) + '</td>'; }).join('') + '</tr>'; };
    return '<div class="sheet-wrap" style="max-height:none;" data-fit-keep><table class="sheet dense freeze"><thead><tr><th class="l"></th><th>G</th>' +
      C.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      row('me', '<b>Team</b>', function (k) { return cell(me, k); }) +
      row('opp', 'Opponents', function (k) { return cell(op, k); }) +
      '<tr class="dif"><td class="l">Difference</td><td></td>' + C.map(function (c) { var d = val(me, c[0]) - val(op, c[0]); return '<td>' + sg(d, isPct(c[0]) || mode === 'pg' ? 1 : 0) + '</td>'; }).join('') + '</tr>' +
      '</tbody></table></div>';
  }

  function playerTable(P, team, g, mode) {
    var list = Object.keys(P).map(function (k) { return P[k]; }).sort(function (a, b) { return b.T.min - a.T.min || b.T.pts - a.T.pts; });
    var link = function (p) { return p.id ? '<a href="player.html?espn=' + p.id + '&name=' + encodeURIComponent(p.name) + '">' + esc(p.name) + '</a>' : esc(p.name); };
    var H1, row, foot;
    if (mode === 'sh') {
      H1 = ['FGM', 'FGA', 'FG%', '3PM', '3PA', '3P%', 'FTM', 'FTA', 'FT%', 'eFG%', 'TS%', '3PA rate', 'FT rate'];
      var rest = function (T) { return [T.fgm, T.fga, pct(T.fgm, T.fga), T.tpm, T.tpa, pct(T.tpm, T.tpa), T.ftm, T.fta, pct(T.ftm, T.fta), efg(T), ts(T),
        T.fga ? (100 * T.tpa / T.fga).toFixed(1) : '—', T.fga ? (100 * T.fta / T.fga).toFixed(1) : '—']; };
      row = function (p) { return '<tr><td class="l nm">' + link(p) + '</td><td>' + p.gp + '</td>' + rest(p.T).map(function (v) { return '<td>' + v + '</td>'; }).join('') + '</tr>'; };
      foot = '<tr><td class="l">Team</td><td>' + g + '</td>' + rest(team).map(function (v) { return '<td>' + v + '</td>'; }).join('') + '</tr>';
      return wrap(['GP'].concat(H1), list.map(row).join(''), foot, false);
    }
    var pg = mode === 'pg';
    H1 = ['GP', 'GS', 'MIN', 'PTS', 'REB', 'OREB', 'DREB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'FG', 'FG%', '3P', '3P%', 'FT', 'FT%'];
    var n = function (v, d) { return pg ? f1(v / d) : String(v); };
    var line = function (T, gp, gs) {
      return [gp, gs, n(T.min, gp), n(T.pts, gp), n(T.reb, gp), n(T.oreb, gp), n(T.dreb, gp), n(T.ast, gp), n(T.stl, gp), n(T.blk, gp), n(T.tov, gp), n(T.pf, gp),
        pg ? f1(T.fgm / gp) + '-' + f1(T.fga / gp) : T.fgm + '-' + T.fga, pct(T.fgm, T.fga),
        pg ? f1(T.tpm / gp) + '-' + f1(T.tpa / gp) : T.tpm + '-' + T.tpa, pct(T.tpm, T.tpa),
        pg ? f1(T.ftm / gp) + '-' + f1(T.fta / gp) : T.ftm + '-' + T.fta, pct(T.ftm, T.fta)];
    };
    row = function (p) { return '<tr><td class="l nm">' + link(p) + '</td>' + line(p.T, p.gp, p.gs).map(function (v, i) { return '<td' + (pg && i >= 3 && i <= 10 ? ' data-v="' + parseFloat(v) + '"' : '') + '>' + v + '</td>'; }).join('') + '</tr>'; };
    // the team row: minutes / points per GAME (not per player), so it reads as the team's own line
    foot = '<tr><td class="l">Team</td>' + line(team, g, '').map(function (v, i) { return '<td>' + (i === 1 ? '' : v) + '</td>'; }).join('') + '</tr>';
    return wrap(H1, list.map(row).join(''), foot, pg);
  }
  function wrap(cols, body, foot, heat) {
    return '<div class="sheet-wrap" style="max-height:none;" data-fit-keep><table class="sheet dense freeze tst-pl"><thead><tr><th class="l">Player</th>' +
      cols.map(function (c, i) { return '<th' + (heat && i >= 3 && i <= 10 ? ' data-heat="' + (c === 'TO' || c === 'PF' ? -1 : 1) + '"' : '') + '>' + c + '</th>'; }).join('') +
      '</tr></thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div>';
  }

  function gameLog(G, by, full) {
    var rows = G.map(function (g) {
      var b = by[g.id]; if (!b) return '';
      var hm = g.home === full, opp = hm ? g.away : g.home, ms = hm ? g.home_score : g.away_score, os = hm ? g.away_score : g.home_score, T = b;
      var site = g.neutral ? 'N' : hm ? 'H' : 'A', d = new Date(g.date + 'T12:00:00');
      var on = window.tdcShortSchool ? tdcShortSchool(opp) : opp.replace(/\s+\S+$/, '');
      return '<tr class="lnk" onclick="location.href=\'game.html?id=' + g.id + '\'"><td class="l dim">' + (d.getMonth() + 1) + '/' + d.getDate() + '</td><td class="l">' + (site === 'A' ? 'at ' : site === 'N' ? 'vs ' : '') + esc(on) + (g.conf_game ? ' <span class="dim">·</span>' : '') + '</td>' +
        '<td class="l"><span class="' + (ms > os ? 'w' : 'x') + '">' + (ms > os ? 'W' : 'L') + '</span> ' + ms + '–' + os + '</td>' +
        [T.fgm + '-' + T.fga, pct(T.fgm, T.fga), T.tpm + '-' + T.tpa, pct(T.tpm, T.tpa), T.ftm + '-' + T.fta, pct(T.ftm, T.fta), T.oreb, T.reb, T.ast, T.stl, T.blk, T.tov, T.pf]
          .map(function (v) { return '<td>' + v + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="sheet-wrap" style="max-height:none;" data-fit-keep><table class="sheet dense freeze"><thead><tr><th class="l">Date</th><th class="l">Opponent</th><th class="l">Result</th>' +
      ['FG', 'FG%', '3P', '3P%', 'FT', 'FT%', 'OREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF'].map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  var _tok = 0;
  window.TDC_TEAMSTATS = {
    show: function (host, o) {
      if (!host) return; css();
      var full = o.full, yr = +o.season || 2027, tok = ++_tok;
      host.innerHTML = '<div class="tst"><div style="padding:24px;color:var(--text3);">Loading team stats…</div></div>';
      Promise.all([rowsFor(full, yr), games(full, yr)]).then(function (res) {
        if (tok !== _tok) return;
        var rows = res[0] || [], G = res[1] || [];
        var me = sum(), op = sum(), P = {}, byGame = {}, gm = {};
        rows.forEach(function (r) {
          var mine = r.team === full;
          if (mine) {
            add(me, r); gm[r.game_id] = 1;
            (byGame[r.game_id] = byGame[r.game_id] || sum()) && add(byGame[r.game_id], r);
            var key = r.espn_id || r.player, p = P[key] = P[key] || { id: r.espn_id, name: r.player, T: sum(), gp: 0, gs: 0, _g: {} };
            add(p.T, r);
            if (!p._g[r.game_id] && (+r.min > 0 || r.min == null)) { p._g[r.game_id] = 1; p.gp++; if (r.starter) p.gs++; }
          } else add(op, r);
        });
        Object.keys(P).forEach(function (k) { if (!P[k].gp) delete P[k]; });
        var g = Object.keys(gm).length;
        if (!g) { host.innerHTML = '<div class="tst"><div style="padding:24px;color:var(--text3);">No ' + lbl(yr) + ' box scores on file for this team yet.</div></div>'; return; }
        var mt = pref('tdc_tst_team', 'pg'), mp = pref('tdc_tst_pl', 'pg');
        var tog = function (id, cur, opts) { return '<span class="tst-tog" data-tog="' + id + '">' + opts.map(function (x) { return '<button type="button" data-m="' + x[0] + '" class="' + (cur === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</span>'; };
        var draw = function () {
          host.innerHTML = '<div class="tst">' +
            '<div class="tst-head"><h2>Team vs opponents</h2><span class="sub">' + lbl(yr) + ' · ' + g + (g === 1 ? ' game' : ' games') + ' · every game on file ' + tog('team', mt, [['pg', 'Per game'], ['tot', 'Totals']]) + '</span></div>' +
            teamTable(me, op, g, mt) +
            '<div class="tst-head"><h2>Players</h2><span class="sub">sorted by minutes ' + tog('pl', mp, [['pg', 'Per game'], ['tot', 'Totals'], ['sh', 'Shooting']]) + '</span></div>' +
            playerTable(P, me, g, mp) +
            '<div class="tst-head"><h2>Game log</h2><span class="sub">the team’s line in each game · tap a row for the box score</span></div>' +
            gameLog(G, byGame, full) +
            '<p class="tst-foot">From the box scores on file (ESPN), every game including ones against non-D-I opponents. eFG% = (FGM + 0.5 × 3PM) / FGA · TS% = PTS / (2 × (FGA + 0.44 × FTA)).</p></div>';
          host.querySelectorAll('.tst-tog button').forEach(function (b) {
            b.onclick = function () { var id = b.parentNode.dataset.tog; if (id === 'team') { mt = b.dataset.m; setPref('tdc_tst_team', mt); } else { mp = b.dataset.m; setPref('tdc_tst_pl', mp); } draw(); };
          });
          if (window.tdcSheetHeat) host.querySelectorAll('table.tst-pl').forEach(function (t) { tdcSheetHeat(t); });
        };
        draw();
      }).catch(function () { if (tok === _tok) host.innerHTML = '<div class="tst"><div style="padding:24px;color:var(--text3);">Could not load team stats.</div></div>'; });
    }
  };
})();
