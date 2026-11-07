/* tdc-teamscout.js — the team Scouting Report tab (Nov 2026, owner's request, free): every stat offense and defense with
   its D-I rank (scripts/data/team_scout_<season>.json, build_team_scout.py) beside the season's schedule.
     TDC_TEAMSCOUT.show(host, {full, season})   full = the ESPN name ("Kansas Jayhawks")
   Sheet kit tables only; a cell's shade comes from its rank, and style stats (not good or bad) stay unshaded. */
(function () {
  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co', KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye', H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  var CSS =
    '.ts-grid{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:24px;align-items:start;}' +
    // the schedule beside the report: the columns a report reader needs; the Schedule tab keeps the rest
    '#tsSched .tsp-sum,#tsSched td.tsp-tm,#tsSched td.tsp-q,#tsSched td.tsp-pr,#tsSched .tsp-timed th:nth-child(2),#tsSched .tsp-timed th:nth-child(7),#tsSched .tsp-timed th:nth-child(8),#tsSched .tsp-table:not(.tsp-timed) th:nth-child(6),#tsSched .tsp-table:not(.tsp-timed) th:nth-child(7){display:none!important;}' +
    '#tsSched .tsp-table{min-width:0!important;width:100%!important;}#tsSched .tsp-table th,#tsSched .tsp-table td{min-width:0!important;padding-left:7px!important;padding-right:7px!important;}' +
    '.ts-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid var(--text);}' +
    '.ts-head h2{font:800 22px "Playfair Display",Georgia,serif;letter-spacing:-.01em;color:var(--text);margin:0;}' +
    '.ts-head .sub{font-size:12px;color:var(--text3);}' +
    '.ts-note{font-size:12px;line-height:1.5;color:var(--text2);margin:0 0 10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);}' +
    '.ts-tbl{width:100%!important;table-layout:fixed;}' +
    '.ts-tbl th,.ts-tbl td{text-align:center!important;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
    '.ts-tbl th.l,.ts-tbl td.l{text-align:left!important;white-space:normal;}' +
    '.ts-tbl th:first-child{width:36%;}.ts-tbl th:last-child{width:15%;}' +
    '.ts-tbl td.sec{font-size:10px!important;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--text3);background:var(--bg2)!important;text-align:left!important;}' +
    '.ts-tbl td b{font-weight:800;}.ts-tbl td .rk{font-size:10.5px;font-weight:600;color:var(--text3);margin-left:5px;}' +
    '.ts-tbl td.c3 .rk,.ts-tbl td.c4 .rk,.ts-tbl td.c0 .rk,.ts-tbl td.c1 .rk{color:inherit;opacity:.7;}' +
    '.ts-tbl td.av{color:var(--text3);}' +
    '.ts-tbl td[title],.ts-tbl td.l[title]{cursor:help;}' +
    '.ts-foot{font-size:11.5px;color:var(--text3);line-height:1.5;margin:8px 2px 0;}' +
    '@media(max-width:1180px){.ts-grid{grid-template-columns:minmax(0,1fr);}}' +
    '@media(max-width:640px){.ts-dp{display:none;}#tsSched .tsp-table th,#tsSched .tsp-table td{padding-left:4px!important;padding-right:4px!important;}.ts-head h2{font-size:19px;}.ts-tbl th,.ts-tbl td{padding-left:5px!important;padding-right:5px!important;}.ts-tbl td .rk{margin-left:3px;font-size:10px;}.ts-tbl th:first-child{width:37%;}}';
  function css() { if (document.getElementById('ts-css')) return; var s = document.createElement('style'); s.id = 'ts-css'; s.textContent = CSS; document.head.appendChild(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function seasonLabel(y) { y = +y; return (y - 1) + '-' + String(y).slice(2); }
  var P1 = function (v) { return v.toFixed(1); }, PC = function (v) { return v.toFixed(1) + '%'; };
  var SG = function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1); };
  var HT = function (v) { var i = Math.floor(v / 12); return i + "'" + (v - i * 12).toFixed(1) + '"'; };
  var YR = function (v) { return v.toFixed(2) + ' yrs'; };
  // [label, offense key, defense key, format, D-I average key, tooltip]; defense null = one value across both columns
  var SECTIONS = [
    ['Efficiency', [
      ['Adj. efficiency', 'adj_o', 'adj_d', P1, 'adj_o', 'Points per 100 possessions, adjusted for the schedule. Lower is better on defense.'],
      ['Efficiency', 'ortg', 'drtg', P1, 'ortg', 'Points scored and allowed per 100 possessions in games against D-I teams, not adjusted for the schedule.'],
      ['Projected efficiency', 'proj_o', 'proj_d', P1, 'proj_o', 'Our projection for this season: points per 100 possessions.'],
      ['Tempo', 'tempo', null, P1, 'tempo', 'Possessions per 40 minutes. Style: neither good nor bad.', 1]]],
    ['Four factors', [
      ['Effective FG%', 'o_efg', 'd_efg', P1, 'o_efg', 'FG% with threes worth 1.5 makes.'],
      ['Turnover %', 'o_tov', 'd_tov', P1, 'o_tov', 'Turnovers per 100 possessions. On defense, higher is better.'],
      ['Off. rebound %', 'o_orb', 'd_orb', P1, 'o_orb', 'Share of a team’s own misses it rebounds. On defense, what opponents get back.'],
      ['FTA / FGA', 'o_ftr', 'd_ftr', P1, 'o_ftr', 'Free-throw attempts per 100 shots.']]],
    ['Shooting and defense', [
      ['3P%', 'o_tp', 'd_tp', P1, 'o_tp'], ['2P%', 'o_two', 'd_two', P1, 'o_two'], ['FT%', 'o_ft', 'd_ft', P1, 'o_ft'],
      ['Block %', 'o_blk', 'd_blk', P1, 'o_blk', 'Share of 2-point tries blocked. Offense: how often it gets blocked. Defense: how often it blocks.'],
      ['Steal %', 'o_stl', 'd_stl', P1, 'o_stl', 'Steals per 100 possessions. Offense: how often it gets stolen from.'],
      ['Non-steal TO %', 'o_nst', 'd_nst', P1, 'o_nst', 'Turnovers per 100 possessions that weren’t steals.']]],
    ['Style', [
      ['3PA / FGA', 'o_tpar', 'd_tpar', P1, 'o_tpar', 'Share of shots from three.'],
      ['Assists / FGM', 'o_astr', 'd_astr', P1, 'o_astr', 'Share of made shots that were assisted.']]],
    ['Where the points come from', [
      ['3-pointers', 'o_p3', 'd_p3', PC, 'o_p3'], ['2-pointers', 'o_p2', 'd_p2', PC, 'o_p2'], ['Free throws', 'o_pf', 'd_pf', PC, 'o_pf']]],
    ['Strength of schedule', [
      ['Opponents', 'sos_o', 'sos_d', P1, 'sos_o', 'Offense column: the average defense it has faced. Defense column: the average offense it has faced.'],
      ['Overall', 'sos', null, SG, 'sos', 'Average net rating of its opponents so far.', 1],
      ['Non-conference', 'ncsos', null, SG, 'ncsos', 'The same, for non-conference games.', 1]]],
    ['Personnel', [
      ['Bench minutes', 'bench', null, PC, 'bench', 'Share of minutes played by non-starters. Style: neither good nor bad.', 1],
      ['Experience', 'exp', null, YR, 'exp', 'Minute-weighted years in college, from class year (freshman 0, senior 3, graduate 4).', 1],
      ['Minutes continuity', 'cont', null, PC, 'cont', 'Share of this season’s minutes played by players who played for this team last season.', 1],
      ['Average height', 'hgt', null, HT, 'hgt', 'Minute-weighted height.', 1]]]
  ];
  function shade(rank, n, styleOnly) {
    if (styleOnly || !rank || !n) return '';
    var p = 1 - (rank - 1) / n;
    return p >= .8 ? 'c4' : p >= .6 ? 'c3' : p >= .4 ? 'c2' : p >= .2 ? 'c1' : 'c0';
  }
  var STYLE = { tempo: 1, o_tpar: 1, d_tpar: 1, o_astr: 1, d_astr: 1, o_p3: 1, d_p3: 1, o_p2: 1, d_p2: 1, o_pf: 1, d_pf: 1, bench: 1 };
  function cell(t, k, f, n, span) {
    var x = t[k];
    if (!x) return '<td class="av"' + (span ? ' colspan="2"' : '') + '>—</td>';
    var c = shade(x[1], n, STYLE[k]);
    return '<td' + (c ? ' class="' + c + '"' : '') + (span ? ' colspan="2"' : '') + '><b>' + f(x[0]) + '</b><span class="rk">' + x[1] + '</span></td>';
  }
  function sheet(D, t) {
    var body = SECTIONS.map(function (S) {
      var rows = S[1].filter(function (r) { return t[r[1]]; }); if (!rows.length) return '';
      return '<tr data-noheat><td class="sec" colspan="4">' + S[0] + '</td></tr>' + rows.map(function (r) {
        var av = D.avg[r[4]], tip = r[5] ? ' title="' + esc(r[5]) + '"' : '';
        return '<tr><td class="l"' + tip + '>' + r[0] + '</td>' + (r[6] ? cell(t, r[1], r[3], D.n, 1) : cell(t, r[1], r[3], D.n) + cell(t, r[2], r[3], D.n)) + '<td class="av">' + (av == null ? '' : r[3](av)) + '</td></tr>';
      }).join('');
    }).join('');
    return '<div class="sheet-wrap" style="max-height:none;" data-fit-keep><table class="sheet dense ts-tbl"><thead><tr><th class="l">Category</th><th>Offense</th><th>Defense</th><th title="Division I average"><span class="ts-dp">D-I </span>avg</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  var _files = {};
  function file(y) {
    if (!_files[y]) _files[y] = fetch('scripts/data/team_scout_' + y + '.json?h=' + Math.floor(Date.now() / 36e5)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return _files[y];
  }
  // the season's schedule, the same grid as the Schedule tab (tdc-schedule.js)
  function schedule(host, sub, full, yr, stale) {
    var q = encodeURIComponent(full);
    host.innerHTML = '<div class="ts-foot">Loading schedule…</div>';
    Promise.all([
      fetch(SB + '/rest/v1/games?season_year=eq.' + yr + '&or=(home.eq.' + q + ',away.eq.' + q + ')&select=*&order=date.asc', { headers: H }).then(function (r) { return r.ok ? r.json() : []; }),
      fetch(SB + '/rest/v1/team_seasons?season_year=eq.' + yr + '&srs=not.is.null&select=team,srs,ncaa_seed&order=srs.desc', { headers: H }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
      fetch(SB + '/rest/v1/postseason_games?or=(home.eq.' + q + ',away.eq.' + q + ')&season_year=eq.' + yr + '&select=id,tournament,round', { headers: H }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
      window.TDC_OT ? TDC_OT.ready() : null
    ]).then(function (res) {
      if (stale()) return;
      var all = res[0] || [], ranks = res[1] || [], post = res[2] || [], rankMap = {}, srsMap = {};
      ranks.forEach(function (t, i) { rankMap[t.team] = i + 1; if (t.srs != null) srsMap[t.team] = +t.srs; });
      var games = all.filter(function (g) { return g.status === 'STATUS_FINAL' && g.home_score != null && g.away_score != null; });
      var w = 0, l = 0, cw = 0, cl = 0, rows = [], postMap = {}, lastTour = null;
      post.forEach(function (p) { postMap[p.id] = p.tournament; });
      var mySeed = (ranks.filter(function (t) { return t.team === full; })[0] || {}).ncaa_seed;
      games.forEach(function (g) {
        var tour = postMap[g.id] || null;
        if (yr < 2027 && tour && tour !== lastTour) { rows.push({ section: tour + ((tour === 'NCAA Tournament' && mySeed) ? ' · #' + mySeed + ' seed' : '') }); lastTour = tour; }
        var hm = g.home === full, ms = hm ? g.home_score : g.away_score, os = hm ? g.away_score : g.home_score, won = ms > os, opp = hm ? g.away : g.home;
        if (won) w++; else l++; if (g.conf_game) { if (won) cw++; else cl++; }
        rows.push({ id: g.id, date: g.date, opp: opp, rank: rankMap[opp], oppSrs: srsMap[opp], site: g.neutral ? 'N' : (hm ? 'H' : 'A'), won: won, ms: ms, os: os, conf: !!g.conf_game, rec: w + '–' + l + (g.conf_game ? ' (' + cw + '–' + cl + ')' : ''), href: 'game.html?id=' + g.id });
      });
      if (yr >= 2027 && window.TDCSched) {
        return TDCSched.project(full, { playedIds: games.map(function (g) { return g.id; }) }).then(function (R) {
          if (stale()) return;
          if (!R) { host.innerHTML = '<div class="ts-foot">The ' + seasonLabel(yr) + ' schedule for ' + esc(full) + ' hasn’t been announced yet.</div>'; return; }
          host.innerHTML = ''; TDCSched.render(host, R, { played: rows });
          var xg = games.filter(function (g) { return !(R.counted && R.counted.has(String(g.id))); });
          var xw = xg.filter(function (g) { var hm = g.home === full; return (hm ? g.home_score : g.away_score) > (hm ? g.away_score : g.home_score); }).length, xl = xg.length - xw;
          var sw = xw + (R.playedW || 0), sl = xl + (R.playedL || 0);
          sub.textContent = (sw + sl ? sw + '–' + sl + ' · ' : '') + 'projected ' + (xw + Math.round(R.expW)) + '–' + (xl + (R.n - Math.round(R.expW)));
        });
      }
      if (!rows.length || !window.TDCSched) { host.innerHTML = '<div class="ts-foot">No games on file for ' + esc(full) + ' in ' + seasonLabel(yr) + '.</div>'; return; }
      host.innerHTML = ''; TDCSched.renderPast(host, rows, { mySrs: srsMap[full] });
      sub.textContent = w + '–' + l + (cw + cl ? ' · ' + cw + '–' + cl + ' conf' : '');
    }).catch(function () { if (!stale()) host.innerHTML = '<div class="ts-foot">Could not load the schedule.</div>'; });
  }
  var _key = null, _tok = 0;
  window.TDC_TEAMSCOUT = {
    show: function (host, o) {
      css();
      var y = +o.season || 2027, k = o.full + '|' + y; if (k === _key) return; _key = k;
      var tok = ++_tok, stale = function () { return tok !== _tok; };
      host.innerHTML = '<div class="ts-grid"><div><div class="ts-head"><h2>Scouting report</h2><span class="sub" id="tsSub"></span></div><div id="tsNote"></div><div id="tsSheet"><div class="ts-foot">Loading…</div></div></div>' +
        '<div><div class="ts-head"><h2>' + seasonLabel(y) + ' schedule</h2><span class="sub" id="tsSchedSub"></span></div><div id="tsSched" data-fit-keep></div></div></div>';
      schedule(document.getElementById('tsSched'), document.getElementById('tsSchedSub'), o.full, y, stale);
      file(y).then(function (D) {
        if (stale()) return;
        var el = document.getElementById('tsSheet'), t = D && D.teams && D.teams[o.full];
        if (!D || !t) { el.innerHTML = '<div class="ts-foot">No ' + seasonLabel(y) + ' games on file for ' + esc(o.full) + (y >= 2027 ? ' yet. The report fills in after its first game against a D-I team.' : '.') + '</div>'; return; }
        var d = D.through ? new Date(D.through + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        document.getElementById('tsSub').textContent = (d ? 'through ' + d + ' · ' : '') + t.g + (t.g === 1 ? ' game' : ' games') + ' · small number = D-I rank';
        if (t.g < 5 && y >= 2027) document.getElementById('tsNote').innerHTML = '<div class="ts-note"><b>Early-season numbers.</b> ' + t.g + (t.g === 1 ? ' game' : ' games') + ' so far, so these will swing a lot. Projected efficiency is the steadier read for now.</div>';
        el.innerHTML = sheet(D, t) + '<p class="ts-foot">Games between D-I teams. Rank 1 is the best for the team (fewest turnovers, lowest opponent shooting); style rows rank highest first and aren’t shaded. Hover a label for what it means.</p>';
      });
    }
  };
})();
