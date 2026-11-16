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
    '.tst-foot{font-size:11.5px;color:var(--text3);line-height:1.5;margin:8px 2px 0;}' +
    /* Nov 16 2026 — owner picked mock B "trading card" with the green OVR ring: the card is the team colour (lit top-left),
       a round photo (owner only, else his number), first name + LAST NAME, bio, five stat chips, the OVR ring; ‹ › flip players. */
    '.tsc{position:relative;display:grid;grid-template-columns:132px minmax(0,1fr) 110px;grid-template-areas:"ph id ov" "ph ch ov";column-gap:20px;row-gap:12px;align-items:center;padding:20px 52px 20px 44px;margin:0 0 12px;' +
      'border-radius:16px;overflow:hidden;color:#fff;min-height:172px;' +
      'background:radial-gradient(90% 140% at 15% 0%,color-mix(in srgb,var(--tc-band,#1b2433) 60%,#fff) 0%,var(--tc-band,#1b2433) 45%,color-mix(in srgb,var(--tc-band,#1b2433) 55%,#000) 100%);' +
      'box-shadow:0 14px 34px rgba(0,0,0,.25);}' +
    '.tsc .lgw{position:absolute;right:-36px;bottom:-46px;width:230px;height:230px;object-fit:contain;opacity:.12;filter:brightness(0) invert(1);pointer-events:none;}' +
    '.tsc-ph{position:relative;width:132px;height:132px;border-radius:50%;background:rgba(255,255,255,.14);border:3px solid rgba(255,255,255,.78);overflow:hidden;display:flex;align-items:flex-end;justify-content:center;box-shadow:0 8px 20px rgba(0,0,0,.25);}' +
    '.tsc-ph img{height:96%;width:auto;}' +
    '.tsc-ph .no{align-self:center;font:900 52px/1 Inter,system-ui,sans-serif;letter-spacing:-.03em;color:rgba(255,255,255,.92);}.tsc-ph .no small{font-size:26px;vertical-align:top;opacity:.7;margin-right:1px;}' +
    '.tsc-id{min-width:0;position:relative;grid-area:id;align-self:end;}.tsc-ph{grid-area:ph;}.tsc-ovr{grid-area:ov;}.tsc-chips{grid-area:ch;align-self:start;}' +
    '.tsc-first{font:700 13px Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.82);}' +
    '.tsc-last{font:900 clamp(26px,3vw,38px)/1 Inter,system-ui,sans-serif;text-transform:uppercase;color:#fff;overflow-wrap:anywhere;text-shadow:0 2px 10px rgba(0,0,0,.25);}' +
    '.tsc-last a{color:inherit;text-decoration:none;}.tsc-last a:hover{text-decoration:underline;}' +
    '.tsc-bio{font-size:13px;color:rgba(255,255,255,.85);margin-top:6px;}' +
    '.tsc-chips{display:flex;gap:8px;flex-wrap:wrap;position:relative;}' +
    '.tsc-chips span{background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:6px 10px;text-align:center;min-width:58px;}' +
    '.tsc-chips b{display:block;font:900 20px/1.15 Inter,system-ui,sans-serif;color:#fff;}.tsc-chips i{font-style:normal;font:700 10px Inter,system-ui,sans-serif;letter-spacing:.1em;color:rgba(255,255,255,.75);}' +
    '.tsc-ovr{position:relative;width:110px;height:110px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,.28);}' +
    '.tsc-ovr svg{position:absolute;inset:0;transform:rotate(-90deg);overflow:visible;}.tsc-ovr circle{fill:none;stroke-width:8;}.tsc-ovr .tk{stroke:rgba(255,255,255,.16);}' +
    '.tsc-ovr .ar{stroke:var(--ring,#4fae60);stroke-linecap:round;filter:drop-shadow(0 0 5px var(--ring,#4fae60));}' +
    '.tsc-ovr small{position:relative;font:700 10px Inter,system-ui,sans-serif;letter-spacing:.16em;color:rgba(255,255,255,.75);}.tsc-ovr b{position:relative;font:900 40px/1 Inter,system-ui,sans-serif;color:#fff;}' +
    '.tsc-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:4;width:30px;height:56px;border:0;background:none;color:rgba(255,255,255,.6);font:300 40px/1 Inter,system-ui,sans-serif;cursor:pointer;padding:0;}' +
    '.tsc-nav:hover{color:#fff;}.tsc-nav.prev{left:6px;}.tsc-nav.next{right:6px;}.tsc-nav[disabled]{opacity:.2;cursor:default;}' +
    '@media(max-width:760px){.tsc{grid-template-columns:84px minmax(0,1fr) 78px;grid-template-areas:"ph id ov" "ch ch ch";column-gap:12px;row-gap:10px;padding:14px 34px 14px 28px;min-height:0;}.tsc-id{align-self:center;}.tsc-ph{width:84px;height:84px;}.tsc-ph .no{font-size:34px;}' +
      '.tsc-chips{flex-wrap:nowrap;}.tsc-ovr{width:78px;height:78px;}.tsc-ovr b{font-size:28px;}.tsc-ovr small{font-size:9px;}}' +
    '@media(max-width:480px){.tsc{grid-template-columns:64px minmax(0,1fr) 62px;padding:12px 24px 12px 22px;column-gap:10px;}.tsc-ph{width:64px;height:64px;border-width:2px;}.tsc-ph .no{font-size:26px;}' +
      '.tsc-last{font-size:21px;overflow-wrap:normal;}.tsc-first{font-size:11px;}.tsc-bio{font-size:11.5px;margin-top:3px;}.tsc-ovr{width:62px;height:62px;}.tsc-ovr b{font-size:22px;}' +
      '.tsc-chips{gap:5px;}.tsc-chips span{min-width:0;flex:1;padding:5px 4px;}.tsc-chips b{font-size:15px;}.tsc-chips i{font-size:9px;}.tsc-nav{width:22px;font-size:30px;}}' +
    '.tst table.tst-pl tbody tr{cursor:pointer;}' +
    '.tst table.tst-pl td.nm{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--tc-band,#1b2433) 70%,transparent);}' +
    /* selected row: a light team tint with a team-colour outline (owner pick, Nov 16 2026; gold dropped) */
    '.tst table.tst-pl tbody tr.sel td{background:color-mix(in srgb,var(--tc-band,#1b2433) 14%,var(--bg))!important;color:var(--text)!important;font-weight:800;' +
      'box-shadow:inset 0 1px 0 var(--tc-band,#1b2433),inset 0 -1px 0 var(--tc-band,#1b2433)!important;}' +
    '.tst table.tst-pl tbody tr.sel td.nm{box-shadow:inset 4px 0 0 var(--tc-band,#1b2433),inset 0 1px 0 var(--tc-band,#1b2433),inset 0 -1px 0 var(--tc-band,#1b2433)!important;}' +
    '.tst table.tst-pl tbody tr.sel td a{color:var(--text)!important;}' +
    '.tst table.tst-pl:focus{outline:none;}';
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

  // Every counting stat we keep, in one sheet (owner, Nov 16 2026). Per game or totals; rows are selectable (click, or
  // arrow keys once the table has focus) and drive the player card above it.
  function playerList(P) { return Object.keys(P).map(function (k) { return P[k]; }).sort(function (a, b) { return b.T.min - a.T.min || b.T.pts - a.T.pts; }); }
  function playerTable(list, team, g, mode, selKey) {
    var pg = mode !== 'tot';
    var H1 = ['GP', 'GS', 'MIN', 'PTS', 'FGM', 'FGA', 'FG%', '3PM', '3PA', '3P%', 'FTM', 'FTA', 'FT%', 'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'eFG%', 'TS%'];
    var n = function (v, d) { return pg ? f1(v / Math.max(1, d)) : String(v); };
    var line = function (T, gp, gs) {
      return [gp, gs, n(T.min, gp), n(T.pts, gp), n(T.fgm, gp), n(T.fga, gp), pct(T.fgm, T.fga), n(T.tpm, gp), n(T.tpa, gp), pct(T.tpm, T.tpa),
        n(T.ftm, gp), n(T.fta, gp), pct(T.ftm, T.fta), n(T.oreb, gp), n(T.dreb, gp), n(T.reb, gp), n(T.ast, gp), n(T.stl, gp), n(T.blk, gp),
        n(T.tov, gp), n(T.pf, gp), efg(T), ts(T)];
    };
    var HEAT = { PTS: 1, REB: 1, AST: 1, STL: 1, BLK: 1, TO: -1, 'FG%': 1, '3P%': 1, 'FT%': 1, 'eFG%': 1, 'TS%': 1 };
    var link = function (p) { return p.id ? '<a href="player.html?espn=' + p.id + '&name=' + encodeURIComponent(p.name) + '">' + esc(p.name) + '</a>' : esc(p.name); };
    var body = list.map(function (p) {
      var k = String(p.id || p.name);
      return '<tr data-k="' + esc(k) + '"' + (k === selKey ? ' class="sel"' : '') + '><td class="l nm">' + link(p) + '</td>' +
        line(p.T, p.gp, p.gs).map(function (v, i) { var c = H1[i]; return '<td' + (pg && HEAT[c] && i >= 3 ? ' data-v="' + parseFloat(v) + '"' : '') + '>' + v + '</td>'; }).join('') + '</tr>';
    }).join('');
    var foot = '<tr><td class="l">Team</td>' + line(team, g, '').map(function (v, i) { return '<td>' + (i === 1 ? '' : v) + '</td>'; }).join('') + '</tr>';
    return '<div class="sheet-wrap" style="max-height:none;" data-fit-keep><table class="sheet dense freeze tst-pl" tabindex="0" aria-label="Player stats: arrow keys move the player card"><thead><tr><th class="l">Player</th>' +
      H1.map(function (c) { return '<th' + (pg && HEAT[c] ? ' data-heat="' + HEAT[c] + '"' : '') + '>' + c + '</th>'; }).join('') +
      '</tr></thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div>';
  }
  // the 2K-style card: team tile (headshot for the owner only — tdcShowPhotos — else his number over the logo), name,
  // bio, a box with games played + his line, and the OVR dial
  function card(p, o) {
    if (!p) return '';
    var I = (o.info && o.info(p)) || {}, T = p.T, gp = Math.max(1, p.gp);
    var parts = String(p.name || '').trim().split(/\s+/), first = parts.length > 1 ? parts.slice(0, -1).join(' ') : '', last = parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';
    if (/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(last) && parts.length > 2) { last = parts[parts.length - 2] + ' ' + last; first = parts.slice(0, -2).join(' '); }
    var photo = p.id && window.tdcShowPhotos && window.tdcShowPhotos() ? '<img src="https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/' + p.id + '.png" alt="" onerror="this.remove()">' : '';
    var num = I.num != null && I.num !== '' ? '<span class="no"><small>#</small>' + esc(I.num) + '</span>' : '<span class="no">' + esc((p.name || '').split(/\s+/).map(function (w) { return w[0] || ''; }).slice(0, 2).join('').toUpperCase()) + '</span>';
    var bio = [I.ht, I.wt ? I.wt + (/lb/i.test(I.wt) ? '' : ' lbs') : '', I.yr, I.home, p.gp + (p.gp === 1 ? ' game' : ' games') + (p.gs ? ' · ' + p.gs + ' starts' : '')].filter(Boolean).map(esc).join(' · ');
    var pg = function (v) { return (v / gp).toFixed(1); };
    var chips = [[pg(T.pts), 'PTS'], [pg(T.reb), 'REB'], [pg(T.ast), 'AST'], [pct(T.fgm, T.fga), 'FG%'], [pct(T.tpm, T.tpa), '3P%']]
      .map(function (c) { return '<span><b>' + c[0] + '</b><i>' + c[1] + '</i></span>'; }).join('');
    var ovr = I.ovr != null && isFinite(+I.ovr) ? Math.round(+I.ovr) : null;
    var C = 2 * Math.PI * 44, fr = ovr == null ? 0 : Math.max(0, Math.min(1, (ovr - 40) / 59));
    var ring = ovr >= 85 ? '#4fae60' : ovr >= 78 ? '#7cc47a' : ovr >= 70 ? '#c9b27a' : ovr >= 60 ? '#e09a5c' : '#d9645a';
    var lastH = p.id ? '<a href="player.html?espn=' + p.id + '">' + esc(last) + '</a>' : esc(last);
    return '<div class="tsc" role="region" aria-label="' + esc(p.name) + '">' +
      (o.logo ? '<img class="lgw" src="' + esc(o.logo) + '" alt="">' : '') +
      '<button type="button" class="tsc-nav prev" data-d="-1" aria-label="Previous player"' + (o.first ? ' disabled' : '') + '>‹</button>' +
      '<button type="button" class="tsc-nav next" data-d="1" aria-label="Next player"' + (o.last ? ' disabled' : '') + '>›</button>' +
      '<div class="tsc-ph">' + (photo || num) + '</div>' +
      '<div class="tsc-id"><div class="tsc-first">' + esc(first) + (I.pos ? ' · ' + esc(I.pos) : '') + '</div><div class="tsc-last">' + lastH + '</div>' +
        '<div class="tsc-bio">' + bio + '</div></div><div class="tsc-chips">' + chips + '</div>' +
      '<div class="tsc-ovr" style="--ring:' + ring + '"><svg viewBox="0 0 100 100"><circle class="tk" cx="50" cy="50" r="44"/><circle class="ar" cx="50" cy="50" r="44" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - fr)).toFixed(1) + '"/></svg>' +
      '<small>OVR</small><b>' + (ovr == null ? '—' : ovr) + '</b></div></div>';
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
        var mt = pref('tdc_tst_team', 'pg'), mp = pref('tdc_tst_pl', 'pg'); if (mp === 'sh') mp = 'pg';
        var list = playerList(P), selKey = list.length ? String(list[0].id || list[0].name) : null;
        var tog = function (id, cur, opts) { return '<span class="tst-tog" data-tog="' + id + '">' + opts.map(function (x) { return '<button type="button" data-m="' + x[0] + '" class="' + (cur === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</span>'; };
        var draw = function () {
          host.innerHTML = '<div class="tst">' +
            '<div class="tst-head"><h2>Team vs opponents</h2><span class="sub">' + lbl(yr) + ' · ' + g + (g === 1 ? ' game' : ' games') + ' · every game on file ' + tog('team', mt, [['pg', 'Per game'], ['tot', 'Totals']]) + '</span></div>' +
            teamTable(me, op, g, mt) +
            '<div class="tst-head"><h2>Players</h2><span class="sub">every counting stat · tap a player (or use ↑ ↓) ' + tog('pl', mp, [['pg', 'Per game'], ['tot', 'Totals']]) + '</span></div>' +
            '<div class="tsc-host"></div>' +
            playerTable(list, me, g, mp, selKey) +
            '<div class="tst-head"><h2>Game log</h2><span class="sub">the team’s line in each game · tap a row for the box score</span></div>' +
            gameLog(G, byGame, full) +
            '<p class="tst-foot">From the box scores on file (ESPN), every game including ones against non-D-I opponents. eFG% = (FGM + 0.5 × 3PM) / FGA · TS% = PTS / (2 × (FGA + 0.44 × FTA)).</p></div>';
          host.querySelectorAll('.tst-tog button').forEach(function (b) {
            b.onclick = function () { var id = b.parentNode.dataset.tog; if (id === 'team') { mt = b.dataset.m; setPref('tdc_tst_team', mt); } else { mp = b.dataset.m; setPref('tdc_tst_pl', mp); } draw(); };
          });
          if (window.tdcSheetHeat) host.querySelectorAll('table.tst-pl').forEach(function (t) { tdcSheetHeat(t); });
          var ch = host.querySelector('.tsc-host'), tb = host.querySelector('table.tst-pl');
          var pick = function (k, scroll) {
            selKey = k; var p = list.filter(function (x) { return String(x.id || x.name) === k; })[0];
            var ks = list.map(function (x) { return String(x.id || x.name); }), ix = ks.indexOf(k);
            ch.innerHTML = card(p, { info: o.info, logo: o.logo, season: yr, first: ix <= 0, last: ix >= ks.length - 1 });
            tb.querySelectorAll('tbody tr').forEach(function (r) { var on = r.dataset.k === k; r.classList.toggle('sel', on); if (on && scroll) r.scrollIntoView({ block: 'nearest' }); });
          };
          if (tb && ch) {
            pick(selKey);
            tb.addEventListener('click', function (e) { if (e.target.closest('a')) return; var r = e.target.closest('tbody tr'); if (r) { pick(r.dataset.k); tb.focus({ preventScroll: true }); } });
            ch.addEventListener('click', function (e) {
              var b = e.target.closest('.tsc-nav'); if (!b || b.disabled) return;
              var ks = list.map(function (x) { return String(x.id || x.name); }), i = ks.indexOf(selKey) + (+b.dataset.d);
              if (i >= 0 && i < ks.length) pick(ks[i], false);
            });
            tb.addEventListener('keydown', function (e) {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return; e.preventDefault();
              var ks = list.map(function (x) { return String(x.id || x.name); }), i = ks.indexOf(selKey);
              i = Math.max(0, Math.min(ks.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); pick(ks[i], true);
            });
          }
        };
        draw();
      }).catch(function () { if (tok === _tok) host.innerHTML = '<div class="tst"><div style="padding:24px;color:var(--text3);">Could not load team stats.</div></div>'; });
    }
  };
})();
