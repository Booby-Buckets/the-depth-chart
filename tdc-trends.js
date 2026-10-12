/* tdc-trends.js — the player page's Trends tab: what each preseason scrimmage said about him, weighted by
 * the Reality Meter, and exactly how much it moved his 2026-27 projection.
 * Data: scripts/data/scrim_trends_2027.json (scripts/build_scrim_trends.py, rebuilt with the projections).
 *   TDCTrends.render(host, {espn_id, team, name})   — player page Trends tab
 *   TDCTrends.renderTeam(host, shortTeam)          — team page Trends tab
 */
(function (g) {
  'use strict';
  var _p = null;
  function load() {
    if (!_p) _p = Promise.all([
      fetch('scripts/data/scrim_trends_2027.json?v=6').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/scrimmages_2027.json?v=7').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/scrimmage_results_2027.json?v=10').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    ]).then(function (a) { return { T: a[0] || {}, S: (a[1] && a[1].games) || [], R: (a[2] && a[2].results) || {} }; });
    return _p;
  }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var sg = function (v, d) { if (v == null || !isFinite(v)) return '—'; var x = (+v).toFixed(d == null ? 1 : d); return (v > 0 ? '+' : v < 0 ? '−' : '') + x.replace('-', ''); };
  var logo = function (full) { try { var c = g.tdcTeamColor && g.tdcTeamColor(full); return (c && c.logo) || ''; } catch (e) { return ''; } };
  var short = function (full) { var s = String(full || '').replace(/ [A-Z][a-z]+$/, ''); try { return (g.tdcShortSchool && (g.tdcShortSchool(full) || g.tdcShortSchool(s))) || s; } catch (e) { return s; } };
  var cls = function (d, k) { if (d == null || !isFinite(d)) return ''; k = k || 1; return d >= 3 * k ? 'c4' : d >= 1 * k ? 'c3' : d <= -3 * k ? 'c0' : d <= -1 * k ? 'c1' : 'c2'; };
  var rmCol = function (v) { return v >= 75 ? 'var(--green,#1a8c3a)' : v >= 55 ? '#9bbf3a' : v >= 35 ? '#d9a33a' : 'var(--red,#cc2200)'; };
  function css() {
    if (document.getElementById('trends-css')) return;
    var st = document.createElement('style'); st.id = 'trends-css';
    st.textContent = '.tr-hd{display:flex;align-items:flex-end;gap:22px;flex-wrap:wrap;margin:4px 0 14px;}' +
      '.tr-big{font-family:"Playfair Display",serif;font-size:46px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;}' +
      '.tr-l{font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-bottom:4px;}' +
      '.tr-t{font-size:16px;font-weight:800;}.tr-s{font-size:12.5px;color:var(--text3);line-height:1.55;max-width:640px;}' +
      '.tr-sec{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);margin:22px 0 8px;}' +
      '.tr-notes{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;}' +
      '.tr-g{border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--bg2);}' +
      '.tr-g h4{font-size:12px;font-weight:800;margin:0 0 6px;display:flex;align-items:center;gap:7px;}.tr-g h4 img{width:16px;height:16px;object-fit:contain;}' +
      '.tr-g h4 .dim{font-weight:600;color:var(--text3);margin-left:auto;}' +
      '.tr-n{font-size:12.5px;line-height:1.6;color:var(--text2);}.tr-n.p b{color:var(--green,#1a8c3a);}.tr-n.m b{color:var(--red,#cc2200);}' +
      '.tr-mb{display:inline-block;width:40px;height:6px;border-radius:3px;background:var(--bg3);margin-left:6px;vertical-align:1px;overflow:hidden;}.tr-mb i{display:block;height:100%;}' +
      'td img.tr-lg{width:16px!important;height:16px!important;object-fit:contain;vertical-align:middle;margin:-2px 6px 0 0;}' +
      '.trc{position:relative;margin:0 0 6px;}.trc-svg{width:100%;height:auto;display:block;overflow:visible;}' +
      '.trc-grid{stroke:var(--border);stroke-width:1;stroke-dasharray:2 4;}.trc-zero{stroke:var(--border2);stroke-width:1.5;}' +
      '.trc-ax,.trc-x{font:600 11px Inter,system-ui,sans-serif;fill:var(--text3);font-variant-numeric:tabular-nums;}.trc-band{font:600 10.5px Inter,system-ui,sans-serif;fill:var(--text3);}' +
      '.trc-line{fill:none;stroke:var(--text2);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;}' +
      '.trc-dot{stroke:var(--bg);stroke-width:2;}.trc-hit{fill:transparent;cursor:pointer;outline:none;}.trc-lbl{font:800 13px Inter,system-ui,sans-serif;fill:var(--text);font-variant-numeric:tabular-nums;}' +
      '.trc-tip{position:absolute;z-index:5;width:230px;padding:8px 10px;border-radius:8px;background:var(--bg2);border:1px solid var(--border2);box-shadow:0 6px 20px rgba(0,0,0,.18);font-size:12px;line-height:1.5;color:var(--text2);pointer-events:none;}.trc-tip b{color:var(--text);}' +
      'table.trl{width:100%;}table.trl td.nm{white-space:normal;min-width:170px;}.trl-sub{display:block;font-size:11px;font-weight:600;color:var(--text3);margin-top:1px;white-space:normal;}' +
      '.trl-dscroll{overflow-x:auto;}table.trl-d{width:100%;}' +
      'table.trl tr.trl-g{cursor:pointer;}table.trl tr.trl-g:hover td,table.trl tr.trl-g.open td{background-color:var(--bg3);}' +
      '.trl-car{display:inline-block;width:12px;color:var(--text3);transition:transform .15s;}tr.trl-g.open .trl-car{transform:rotate(90deg);}' +
      'table.trl tr.trl-proj td{color:var(--text2);}table.trl tr.trl-now td{border-top:2px solid var(--border2);font-weight:700;color:var(--text);}' +
      '.trl-dl{display:block;font-size:10.5px;font-weight:800;}.trl-tr{font-weight:800;}table.trl tr.trl-up td{color:var(--text3);}' +
      'table.trl tr.trl-det>td{padding:0!important;background:var(--bg2);}.trl-dbox{padding:10px 12px 12px;white-space:normal;}' +
      'table.trl-d{margin:0 0 4px;}table.trl-d tr.act td{font-weight:800;}table.trl-d tr.vs td{border-top:2px solid var(--border2);}' +
      '.tl-foot a{margin-left:auto;font-weight:700;color:var(--text2);text-decoration:none;}.tl-foot a:hover{color:var(--text);}' +
      '.tr-empty{padding:34px;text-align:center;color:var(--text3);border:1px dashed var(--border2);border-radius:12px;line-height:1.7;}';
    document.head.appendChild(st);
  }

  function tlCss() {
    if (document.getElementById('trends-tl-css')) return;
    var st = document.createElement('style'); st.id = 'trends-tl-css';
    st.textContent =
      '.tl{position:relative;padding-left:96px;margin-top:6px;}' +
      '.tl:before{content:"";position:absolute;left:41px;top:8px;bottom:8px;width:2px;background:repeating-linear-gradient(var(--border2) 0 6px,transparent 6px 11px);}' +
      '.tl-node{position:relative;margin:0 0 22px;}' +
      '.tl-stamp{position:absolute;left:-96px;top:2px;width:84px;padding:6px 4px 5px;text-align:center;background:var(--bg);border:2px dashed currentColor;border-radius:6px;transform:rotate(-4deg);line-height:1.1;font-family:Inter,sans-serif;box-shadow:0 0 0 3px var(--bg);}' +
      '.tl-stamp .m{font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;}' +
      '.tl-stamp .d{font-family:"Playfair Display",serif;font-size:24px;font-weight:800;}' +
      '.tl-stamp .r{font-size:10.5px;font-weight:800;margin-top:2px;}' +
      '.tl-stamp.w{color:var(--green,#1a8c3a);}.tl-stamp.l{color:var(--red,#cc2200);}.tl-stamp.s{color:var(--text2);}.tl-stamp.up{color:var(--text3);border-style:dotted;transform:rotate(3deg);}' +
      '.tl-card{border:1px solid var(--border);border-radius:12px;background:var(--bg2);padding:12px 14px 12px;}' +
      '.tl-card.ghost{background:transparent;border-style:dashed;}' +
      '.tl-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px;font-weight:800;margin-bottom:8px;}.tl-h img{width:20px;height:20px;object-fit:contain;}' +
      '.tl-pill{font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:999px;border:1px solid var(--border2);color:var(--text2);}' +
      '.tl-pill.rm{color:#fff;border:none;}' +
      '.tl-sub{font-size:12px;color:var(--text3);line-height:1.55;margin:6px 0 0;}' +
      '.tl-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;}' +
      '.tl-chip{font-size:12px;line-height:1.35;padding:4px 9px;border-radius:8px;background:var(--bg3);color:var(--text2);}' +
      '.tl-chip.p{background:hsla(125,60%,45%,.14);color:var(--text);}.tl-chip.m{background:hsla(0,70%,50%,.12);color:var(--text);}' +
      '.tl-chip b{margin-right:4px;}.tl-chip.p b{color:var(--green,#1a8c3a);}.tl-chip.m b{color:var(--red,#cc2200);}' +
      '.tl-foot{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--text3);}.tl-foot b{color:var(--text);font-variant-numeric:tabular-nums;}' +
      '.tl-kv{display:flex;gap:18px;flex-wrap:wrap;}.tl-kv div{min-width:54px;}.tl-kv .k{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);}.tl-kv .v{font-family:"Playfair Display",serif;font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;}' +
      '.tl-kv .dl{font-size:11px;font-weight:800;margin-left:3px;}' +
      '.tl table.sheet td.l{white-space:nowrap;}.tl tr.act td{font-weight:800;}.tl tr.vs td{border-top:2px solid var(--border2);}' +
      '@media(max-width:640px){.tl{padding-left:0;}.tl:before{display:none;}.tl-stamp{position:static;display:inline-block;transform:none;margin:0 0 8px;width:auto;padding:4px 10px;}.tl-stamp .d{font-size:16px;display:inline;margin:0 4px;}.tl-stamp .m,.tl-stamp .r{display:inline;}}';
    document.head.appendChild(st);
  }

  // ── the trend chart: one line from 0 (entering the preseason) through the value after each scrimmage, on labelled
  // bands; drawn at the host's real width so text stays ~11px on a phone. pts: [{lab, sub, y, tip}]
  function trendChart(host, pts, bands, dec, minM, title) {
    var VW = Math.max(320, Math.min(980, host.clientWidth || 720)), narrow = VW < 520, VH = narrow ? 160 : 180, L = 38, R = narrow ? 18 : 104, Tp = 14, Bt = 40;
    var M = Math.max(minM, Math.max.apply(null, pts.map(function (q) { return Math.abs(q.y); })) * 1.15 + (minM / 10));
    var X = function (i) { return pts.length === 1 ? L : L + i * (VW - L - R) / (pts.length - 1); };
    var Y = function (v) { return Tp + (M - v) * (VH - Tp - Bt) / (2 * M); };
    var hi = bands[1][0];   // the "slightly" threshold colours the dots
    var dotCol = function (v) { return v >= hi ? 'var(--green,#1a8c3a)' : v <= -hi ? 'var(--red,#cc2200)' : 'var(--text2)'; };
    var svg = '<svg class="trc-svg" viewBox="0 0 ' + VW + ' ' + VH + '" role="img" aria-label="' + esc(title) + ': ' + pts.map(function (q) { return q.lab + ' ' + sg(q.y, dec); }).join(', ') + '">';
    bands.concat([[0, 'Steady']]).concat(bands.map(function (b) { return [-b[0], b[2]]; })).forEach(function (gl) {
      var y = Y(gl[0]);
      svg += '<line x1="' + L + '" x2="' + (VW - R + 8) + '" y1="' + y + '" y2="' + y + '" class="' + (gl[0] === 0 ? 'trc-zero' : 'trc-grid') + '"/>' +
        '<text x="' + (L - 8) + '" y="' + (y + 4) + '" class="trc-ax" text-anchor="end">' + (gl[0] ? sg(gl[0], gl[0] % 1 ? 1 : 0) : '0') + '</text>' +
        (narrow ? '' : '<text x="' + (VW - R + 14) + '" y="' + (y + 4) + '" class="trc-band">' + gl[1] + '</text>');
    });
    svg += '<polyline class="trc-line" points="' + pts.map(function (q, i) { return X(i).toFixed(1) + ',' + Y(q.y).toFixed(1); }).join(' ') + '"/>';
    pts.forEach(function (q, i) {
      svg += '<circle cx="' + X(i) + '" cy="' + Y(q.y) + '" r="5.5" class="trc-dot" style="fill:' + dotCol(q.y) + '"/>' +
        '<text x="' + X(i) + '" y="' + (VH - Bt + 18) + '" class="trc-x" text-anchor="middle">' + esc(q.lab) + '</text>' +
        '<circle cx="' + X(i) + '" cy="' + Y(q.y) + '" r="16" class="trc-hit" data-i="' + i + '" tabindex="0"/>';
    });
    var last = pts[pts.length - 1];
    svg += '<text x="' + X(pts.length - 1) + '" y="' + (Y(last.y) - 12) + '" class="trc-lbl" text-anchor="' + (pts.length > 1 ? 'middle' : 'start') + '">' + sg(last.y, dec) + '</text></svg>';
    return '<div class="trc"><div class="tr-sec" style="margin-top:4px">' + esc(title) + '</div>' + svg + '<div class="trc-tip" hidden></div></div>';
  }
  function wireChart(host, pts) {
    var tip = host.querySelector('.trc-tip'), wrap = host.querySelector('.trc'); if (!tip || !wrap) return;
    host.querySelectorAll('.trc-hit').forEach(function (c) {
      var q = pts[+c.dataset.i];
      var show = function () { var bx = c.getBoundingClientRect(), wb = wrap.getBoundingClientRect();
        tip.innerHTML = q.tip; tip.hidden = false;
        tip.style.left = Math.min(wb.width - 230, Math.max(0, bx.left - wb.left - 100)) + 'px'; tip.style.top = (bx.top - wb.top - tip.offsetHeight - 6) + 'px'; };
      c.addEventListener('mouseenter', show); c.addEventListener('focus', show);
      c.addEventListener('mouseleave', function () { tip.hidden = true; }); c.addEventListener('blur', function () { tip.hidden = true; });
    });
  }
  // a sheet row that expands its detail row (game logs)
  function wireRows(host) {
    host.querySelectorAll('tr.trl-g').forEach(function (r) {
      var tog = function () { var d = host.querySelector('tr.trl-det[data-d="' + r.dataset.g + '"]'); if (!d) return; d.hidden = !d.hidden; r.classList.toggle('open', !d.hidden); r.setAttribute('aria-expanded', String(!d.hidden)); };
      r.onclick = function (ev) { if (ev.target.closest('a')) return; tog(); };
      r.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tog(); } };
    });
  }

  function render(host, who) {
    if (!host) return Promise.resolve();
    css(); tlCss();
    host.innerHTML = '<div class="tr-empty">Loading preseason trends…</div>';
    return load().then(function (D) {
      var T = D.T || {}, P = null;
      if (who.espn_id != null && T.players) P = T.players[String(who.espn_id)];
      if (!P && T.fresh) P = T.fresh[(String(who.team || '') + '|' + String(who.name || '')).toLowerCase()];
      var teamFull = P ? P.full : null, TM = null;
      if (T.teams) for (var f in T.teams) { if ((teamFull && f === teamFull) || (!teamFull && T.teams[f].short === who.team)) { TM = T.teams[f]; teamFull = f; break; } }
      var played = {}; (P && P.games || []).forEach(function (e) { played[e.id] = 1; });
      var today = new Date().toISOString().slice(0, 10);
      var upcoming = D.S.filter(function (x) { return teamFull && (x.home === teamFull || x.away === teamFull) && !played[x.id] && x.date >= today; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
      var md = function (date) { var d = new Date(date + 'T12:00:00'); return (d.getMonth() + 1) + '/' + d.getDate(); };
      var upRow = function (x, n) { var opp = x.home === teamFull ? x.away : x.home, lg = logo(opp);
        return '<tr class="trl-up"><td class="l" colspan="' + n + '">' + (lg ? '<img class="tr-lg" src="' + lg + '" alt="">' : '') + 'Next · ' + md(x.date) + ' ' + (x.home === teamFull ? 'vs ' : '@ ') + esc(short(opp)) +
          ' <span class="trl-sub" style="display:inline">· ' + (x.neutral ? 'Neutral' : x.home === teamFull ? 'Home' : 'Away') + (x.time ? ' · ' + esc(x.time) : '') + ' · his line lands here once it’s played</span></td></tr>'; };
      if (!P || !P.games || !P.games.length) {
        host.innerHTML = '<div class="tr-empty" style="margin-bottom:18px;"><b>No scrimmage box score for ' + esc(who.name || 'this player') + ' yet.</b><br>Preseason trends come from scrimmages and exhibitions, weighted by how game-like each one was (the Reality Meter).</div>' +
          (upcoming.length ? '<div class="sheet-wrap" style="max-height:none"><table class="sheet dense trl"><tbody>' + upcoming.map(function (x) { return upRow(x, 2); }).join('') + '</tbody></table></div>' : '');
        return;
      }
      var tr = P.trend || 0, mv = P.moved || {}, b = P.base || {}, nw = P.now || {};
      var col = tr >= 1 ? 'var(--green,#1a8c3a)' : tr <= -1 ? 'var(--red,#cc2200)' : 'var(--text)';
      var word = tr >= 3 ? 'Trending up' : tr >= 1 ? 'Slightly up' : tr <= -3 ? 'Trending down' : tr <= -1 ? 'Slightly down' : 'Steady';
      var nG = P.games.length, W = P.weight || 0;
      var games = P.games.slice().sort(function (a, b2) { return a.date.localeCompare(b2.date); });
      var html = '<div class="tr-hd"><div><div class="tr-l">Preseason trend</div><div class="tr-big" style="color:' + col + '">' + (tr > 0 ? '▲ ' : tr < 0 ? '▼ ' : '') + sg(tr) + '</div></div>' +
        '<div><div class="tr-t">' + word + '</div><div class="tr-s">How his scrimmages compared with what we projected for him (Game Score per 40 minutes), from ' + nG + ' scrimmage' + (nG > 1 ? 's' : '') +
        (nG > 1 ? ' that count as <b>' : ' that counts as <b>') + W.toFixed(2) + ' real game' + (W === 1 ? '' : 's') + '</b> — each weighted by its Reality Meter and his share of a normal night’s minutes.</div></div></div>';

      // ── 1. the trend chart: his trend after each scrimmage, starting from 0 entering the preseason ──
      var pts = [{ lab: 'Pre', y: 0, tip: '<b>Entering the preseason</b><br>Trend: <b>0.0</b>' }].concat(games.map(function (e) {
        return { lab: md(e.date), y: e.trend_after || 0, tip: '<b>' + (e.site === 'A' ? '@ ' : 'vs ') + esc(short(e.opp)) + ' · ' + esc(e.res) + '</b><br>Trend after: <b>' + sg(e.trend_after) + '</b><br>' +
          e.min + ' min · ' + e.pts + ' pts · vs proj ' + sg(e.d40) + ' GmSc/40 · counts ' + (+e.w).toFixed(2) }; }));
      html += trendChart(host, pts, [[3, 'Trending up', 'Trending down'], [1, 'Slightly up', 'Slightly down']], 1, 3.6, 'Trend after each scrimmage');

      // ── 2. the game log: projection → each scrimmage (expandable) → his projection now ──
      var cols = [['min', 'MIN', 0], ['pts', 'PTS', 1], ['reb', 'REB', 1], ['ast', 'AST', 1], ['stl', 'STL', 1], ['blk', 'BLK', 1], ['tov', 'TO', 1], ['fg', 'FG', 0], ['tp', '3PT', 0], ['ft', 'FT', 0], ['gmsc', 'GmSc', 1]];
      var lcols = cols.filter(function (c) { return ['stl', 'blk', 'ft'].indexOf(c[0]) < 0; });   // the log row; the detail shows all
      var NC = lcols.length + 4;
      var cell = function (L2, k, dec, isAct) {
        if (k === 'fg' || k === 'tp' || k === 'ft') { var mk = { fg: ['fgm', 'fga'], tp: ['tpm', 'tpa'], ft: ['ftm', 'fta'] }[k], a = L2[mk[0]], t = L2[mk[1]];
          if (a == null || t == null) return '—'; return isAct ? a + '-' + t : (+a).toFixed(1) + '-' + (+t).toFixed(1); }
        var v = L2[k]; if (v == null) return '—'; return isAct && k !== 'gmsc' ? String(v) : (+v).toFixed(dec);
      };
      var KVc = { min: 'mpg', pts: 'ppg', reb: 'rpg', ast: 'apg' };
      var projRow = function (src, label, sub, withDelta, trendCell) {
        return '<tr class="trl-proj"><td class="l nm">' + label + '<span class="trl-sub">' + sub + '</span></td>' + lcols.map(function (c) {
          var k2 = KVc[c[0]]; if (!k2 || src[k2] == null) return '<td></td>';
          var d = mv[k2]; return '<td>' + (+src[k2]).toFixed(1) + (withDelta && d ? '<span class="trl-dl" style="color:' + (d > 0 ? 'var(--green,#1a8c3a)' : 'var(--red,#cc2200)') + '">' + sg(d) + '</span>' : '') + '</td>';
        }).join('') + '<td></td><td></td>' + trendCell + '</tr>'; };
      var body = projRow(b, 'Entering the preseason', 'our 2026-27 projection' + (b.ovr != null ? ' · OVR ' + b.ovr : ''), false, '<td class="trl-tr">0.0</td>');
      games.forEach(function (e, gi) {
        var lg = logo(e.opp), Pj = e.proj || null, Pc = e.pace || null, w = e.res.charAt(0) === 'W';
        var act = { min: e.min, pts: e.pts, reb: e.reb, ast: e.ast, stl: e.stl, blk: e.blk, tov: e.tov, fgm: e.fgm, fga: e.fga, tpm: e.tpm, tpa: e.tpa, ftm: e.ftm, fta: e.fta, gmsc: e.gmsc };
        var rmw = e.reality >= 75 ? 'Game-like' : e.reality >= 55 ? 'Mostly real' : e.reality >= 35 ? 'Experimental' : 'Practice-like';
        body += '<tr class="trl-g" data-g="' + gi + '" tabindex="0" aria-expanded="false" title="Show projected vs actual"><td class="l nm"><span class="trl-car">▸</span>' + (lg ? '<img class="tr-lg" src="' + lg + '" alt="">' : '') +
          md(e.date) + ' ' + (e.site === 'A' ? '@ ' : 'vs ') + esc(short(e.opp)) +
          '<span class="trl-sub"><b style="color:' + (w ? 'var(--green,#1a8c3a)' : 'var(--red,#cc2200)') + '">' + esc(e.res) + '</b> · ' + (e.gs ? 'Started' : 'Bench') + (e.reality != null ? ' · Reality ' + e.reality + ' (' + rmw + ')' : '') + '</span></td>' +
          lcols.map(function (c) { return '<td>' + cell(act, c[0], c[2], true) + '</td>'; }).join('') +
          '<td class="' + cls(e.d40, 2) + '">' + sg(e.d40) + '</td><td>' + (e.w != null ? (+e.w).toFixed(2) : '—') + '</td><td class="trl-tr">' + sg(e.trend_after) + '</td></tr>';
        // detail: the projection for this game, the same at his minutes, actual, and the difference
        var tbl = '';
        if (Pj && Pc) {
          var diffCell = function (c) { var k = c[0];
            if (k === 'fg' || k === 'tp' || k === 'ft') { var mk = { fg: ['fgm', 'fga'], tp: ['tpm', 'tpa'], ft: ['ftm', 'fta'] }[k]; var d = (act[mk[0]] || 0) - Pc[mk[0]]; return '<td class="' + cls(d, 0.8) + '">' + sg(d) + ' made</td>'; }
            if (k === 'min') { var dm = (act.min || 0) - Pj.min; return '<td class="' + cls(dm, 3) + '">' + sg(dm, 0) + '</td>'; }
            var d2 = (act[k] || 0) - Pc[k]; if (k === 'tov') d2 = -d2;
            return '<td class="' + cls(d2, k === 'gmsc' || k === 'pts' ? 1.5 : 0.8) + '">' + sg(k === 'tov' ? -d2 : d2) + '</td>'; };
          tbl = '<table class="sheet dense trl-d"><thead><tr><th class="l"></th>' + cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
            '<tr><td class="l dim" title="His 2026-27 projection for one game, at his projected minutes, adjusted for this opponent">Projected for this game</td>' + cols.map(function (c) { return '<td class="dim">' + cell(Pj, c[0], c[2]) + '</td>'; }).join('') + '</tr>' +
            '<tr><td class="l dim" title="The same projection scaled to the minutes he actually played: the fair yardstick">Projected at ' + Math.round(e.min || 0) + ' min</td>' + cols.map(function (c) { return '<td class="dim">' + (c[0] === 'min' ? Math.round(e.min || 0) : cell(Pc, c[0], c[2])) + '</td>'; }).join('') + '</tr>' +
            '<tr class="act"><td class="l">Actual</td>' + cols.map(function (c) { return '<td>' + cell(act, c[0], c[2], true) + '</td>'; }).join('') + '</tr>' +
            '<tr class="vs"><td class="l" title="Actual minus the projection at his minutes (minutes: actual minus projected)">vs projection</td>' + cols.map(diffCell).join('') + '</tr></tbody></table>';
        }
        var notes = (e.notes || []).map(function (nn) { var p = nn.charAt(0) === '+'; return '<span class="tl-chip ' + (p ? 'p' : 'm') + '"><b>' + (p ? '+' : '−') + '</b>' + esc(nn.slice(2)) + '</span>'; }).join('');
        var oa = e.opp_adj;
        body += '<tr class="trl-det" data-d="' + gi + '" hidden><td colspan="' + NC + '"><div class="trl-dbox"><div class="trl-dscroll">' + tbl + '</div>' +
          '<div class="tl-chips">' + (notes || '<span class="tl-chip">Right about what we projected.</span>') + '</div>' +
          '<div class="tl-foot"><span>Counts as <b>' + (e.w != null ? (+e.w).toFixed(2) : '—') + '</b> of a real game</span><span>vs projection <b>' + sg(e.d40) + '</b> Game Score / 40</span>' +
          (oa != null && Math.abs(oa) >= 1 ? '<span>Opponent adjustment <b>' + sg(oa) + '%</b> (' + esc(short(e.opp)) + ' rated ' + sg(e.opp_rating) + ')</span>' : '') +
          '<a href="scrimmage.html?id=' + encodeURIComponent(e.id) + '">Box score →</a></div></div></td></tr>';
      });
      body += projRow(nw, 'His projection now', 'after ' + nG + ' scrimmage' + (nG > 1 ? 's' : '') + (nw.ovr != null ? ' · OVR ' + nw.ovr + (mv.ovr ? ' (' + sg(mv.ovr, 0) + ')' : '') : ''), true,
        '<td class="trl-tr" style="color:' + col + '">' + sg(tr) + '</td>').replace('trl-proj', 'trl-proj trl-now');
      body += upcoming.map(function (x) { return upRow(x, NC); }).join('');
      html += '<div class="tr-sec">Game log</div><div class="sheet-wrap" style="max-height:none"><table class="sheet dense trl"><thead><tr><th class="l">Game</th>' +
        lcols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') +
        '<th title="Game Score per 40 minutes vs what we projected for him">vs proj</th><th title="How many real games this scrimmage counts as (Reality Meter × his share of a normal night’s minutes)">Counts</th><th>Trend</th></tr></thead><tbody>' + body + '</tbody></table></div>';
      html += '<div class="tr-s" style="margin-top:8px;">Click a game for projected vs actual. The projection row\'s change is what the scrimmages moved: his per-minute rates (capped at 15%) and, lightly, his minutes' +
        (TM && TM.adj ? '; ' + esc(short(teamFull)) + '’s team rating moved <b style="color:' + (TM.adj > 0 ? 'var(--green,#1a8c3a)' : 'var(--red,#cc2200)') + '">' + sg(TM.adj, 2) + '</b>' : '') +
        '. Scrimmages are unofficial: they never count in his record or season stats.</div>';
      host.innerHTML = html;
      wireRows(host); wireChart(host, pts);
      if (games.length === 1) { var r0 = host.querySelector('tr.trl-g'); if (r0) r0.click(); }   // one game: show its detail
    });
  }

  // ── TEAM TRENDS: results vs our line, team box vs projection, risers & fallers, rotation watch ──
  function renderTeam(host, team) {
    if (!host) return Promise.resolve();
    css(); tlCss();
    host.innerHTML = '<div class="tr-empty">Loading preseason trends…</div>';
    return load().then(function (D) {
      var T = D.T || {}, full = null, TM = null;
      for (var f in (T.teams || {})) if (T.teams[f].short === team) { full = f; TM = T.teams[f]; break; }
      if (!full) { var gx = D.S.filter(function (x) { return short(x.home) === team || short(x.away) === team; })[0]; if (gx) full = short(gx.home) === team ? gx.home : gx.away; }
      var mine = D.S.filter(function (x) { return full && (x.home === full || x.away === full); }).sort(function (a, b) { return a.date.localeCompare(b.date); });
      if (!TM || !TM.games || !TM.games.length) {
        host.innerHTML = '<div class="tr-empty"><b>No scrimmage results for ' + esc(team) + ' yet.</b><br>Team trends come from preseason scrimmages and exhibitions, weighted by how game-like each one was (the Reality Meter).' +
          (mine.length ? '<br>Preseason: ' + mine.map(function (x) { var d = new Date(x.date + 'T12:00:00'); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + (x.home === full ? 'vs ' + esc(short(x.away)) : '@ ' + esc(short(x.home))); }).join(' · ') : '') + '</div>';
        return;
      }
      var adj = TM.adj || 0, col = adj >= 0.3 ? 'var(--green,#1a8c3a)' : adj <= -0.3 ? 'var(--red,#cc2200)' : 'var(--text)';
      var word = adj >= 1 ? 'Trending up' : adj >= 0.3 ? 'Slightly up' : adj <= -1 ? 'Trending down' : adj <= -0.3 ? 'Slightly down' : 'Steady';
      var G = TM.games, nG = G.length;
      var html = '<div class="tr-hd"><div><div class="tr-l">Preseason trend</div><div class="tr-big" style="color:' + col + '">' + (adj > 0 ? '▲ ' : adj < 0 ? '▼ ' : '') + sg(adj, 2) + '</div></div>' +
        '<div><div class="tr-t">' + word + '</div><div class="tr-s">Rating points added to ' + esc(team) + '’s 2026-27 power rating from ' + nG + ' scrimmage' + (nG > 1 ? 's' : '') +
        ': each result against our line, weighted by its Reality Meter and shrunk toward zero (a full season of evidence still outweighs October), capped at ±2.5.</div></div></div>';
      // ── rating trend after each scrimmage (same Σ reality·(actual − line) / (Σ reality + 10), capped ±2.5 as the builder) ──
      var Gs = G.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }), rn = 0, rd = 0;
      var built = Gs.every(function (e) { return e.adj_after != null; });
      Gs.forEach(function (e) { rn += (e.reality || 0) / 100 * (e.resid || 0); rd += (e.reality || 0) / 100;
        if (!built) e.adj_after = Math.max(-2.5, Math.min(2.5, rn / (rd + 10))); });
      if (!built && Gs.length) { var k = Gs[Gs.length - 1].adj_after ? adj / Gs[Gs.length - 1].adj_after : 1; Gs.forEach(function (e) { e.adj_after *= k; }); }   // end on the published number
      var ml = function (v) { return v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1); };
      var md = function (date) { var d = new Date(date + 'T12:00:00'); return (d.getMonth() + 1) + '/' + d.getDate(); };
      var vsTxt = function (e) { return (e.site === 'A' ? '@ ' : 'vs ') + esc(short(e.opp)); };
      var pts = [{ lab: 'Pre', y: 0, tip: '<b>Entering the preseason</b><br>Rating trend: <b>0.00</b>' }].concat(Gs.map(function (e) {
        return { lab: md(e.date), y: e.adj_after, tip: '<b>' + vsTxt(e) + ' · ' + (e.actual > 0 ? 'W' : 'L') + ' by ' + Math.abs(e.actual) + '</b><br>Our line ' + ml(e.pred) + ' · vs line <b>' + ml(e.resid) + '</b> · Reality ' + e.reality + '<br>Rating trend after: <b>' + sg(e.adj_after, 2) + '</b>' }; }));
      html += trendChart(host, pts, [[1, 'Trending up', 'Trending down'], [0.3, 'Slightly up', 'Slightly down']], 2, 1.4, 'Rating trend after each scrimmage');
      // ── game log: preseason → each scrimmage (expandable) → rating trend now ──
      var lastN = function (n) { var w = String(n).replace(/,/g, '').split(/\s+/).filter(function (x) { return !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(x); }); return w[w.length - 1] || n; };
      var NC = 6, PB = (TM.box && TM.box.proj) || {};
      var body = '<tr class="trl-proj"><td class="l nm">Entering the preseason<span class="trl-sub">our 2026-27 power rating, before any scrimmage</span></td><td></td><td></td><td></td><td></td><td class="trl-tr">0.00</td></tr>';
      Gs.forEach(function (e, gi) {
        var lg = logo(e.opp), w = e.actual > 0;
        var rmw = e.reality >= 75 ? 'Game-like' : e.reality >= 55 ? 'Mostly real' : e.reality >= 35 ? 'Experimental' : 'Practice-like';
        body += '<tr class="trl-g" data-g="' + gi + '" tabindex="0" aria-expanded="false" title="Show starters and the team line"><td class="l nm"><span class="trl-car">▸</span>' + (lg ? '<img class="tr-lg" src="' + lg + '" alt="">' : '') + md(e.date) + ' ' + vsTxt(e) +
          '<span class="trl-sub"><b style="color:' + (w ? 'var(--green,#1a8c3a)' : 'var(--red,#cc2200)') + '">' + (w ? 'W' : 'L') + ' by ' + Math.abs(e.actual) + '</b> · ' + rmw + (e.site === 'N' ? ' · neutral' : '') + '</span></td>' +
          '<td class="dim">' + ml(e.pred) + '</td><td>' + ml(e.actual) + '</td><td class="' + cls(e.resid, 2) + '">' + ml(e.resid) + '</td>' +
          '<td>' + (e.reality != null ? e.reality + '<span class="tr-mb"><i style="width:' + e.reality + '%;background:' + rmCol(e.reality) + '"></i></span>' : '—') + '</td>' +
          '<td class="trl-tr">' + sg(e.adj_after, 2) + '</td></tr>';
        // detail: starters vs our projected five, who the opponent was missing, the team line vs the projected per-game line
        var projGs = (e.proj_gs || []).map(function (x) { return x.toLowerCase(); });
        var st = e.gs && e.gs.length ? e.gs.map(function (n) { return projGs.indexOf(n.toLowerCase()) >= 0 ? esc(n) : '<b style="color:var(--green,#1a8c3a)" title="not in our projected starting five">' + esc(n) + '</b>'; }).join(', ') : 'not listed in the box';
        var benched = (e.proj_gs || []).filter(function (n) { return (e.gs || []).map(function (x) { return x.toLowerCase(); }).indexOf(n.toLowerCase()) < 0; });
        var t = e.tot, tl = '';
        if (t) {
          var pc = function (m, a) { return t[a] ? (100 * t[m] / t[a]).toFixed(1) : '—'; };
          var bc = [['PTS', t.pts, PB.ppg, 1], ['FG%', pc('fgm', 'fga'), PB.fg_pct, 1], ['3P%', pc('tpm', 'tpa'), PB.tp_pct, 1], ['3PA', t.tpa, PB.tpa, 0], ['FT%', pc('ftm', 'fta'), PB.ft_pct, 1], ['REB', t.reb, PB.rpg, 1], ['AST', t.ast, PB.apg, 1], ['TO', t.tov, PB.tov, -1], ['STL', t.stl, PB.stl, 1], ['BLK', t.blk, PB.blk, 1]];
          tl = '<table class="sheet dense trl-d"><thead><tr><th class="l"></th>' + bc.map(function (c) { return '<th>' + c[0] + '</th>'; }).join('') + '</tr></thead><tbody>' +
            '<tr class="act"><td class="l">This game</td>' + bc.map(function (c) { return '<td>' + (c[1] == null ? '—' : c[1]) + '</td>'; }).join('') + '</tr>' +
            '<tr><td class="l dim">Projected per game</td>' + bc.map(function (c) { return '<td class="dim">' + (c[2] == null ? '—' : (+c[2]).toFixed(1)) + '</td>'; }).join('') + '</tr>' +
            '<tr class="vs"><td class="l">Difference</td>' + bc.map(function (c) { var a = parseFloat(c[1]), b = c[2]; if (!isFinite(a) || b == null) return '<td>—</td>'; var d = a - b; return '<td class="' + (c[3] ? cls(d * c[3], c[0].indexOf('%') > 0 ? 1.5 : 1) : '') + '">' + sg(d) + '</td>'; }).join('') + '</tr></tbody></table>';
        }
        body += '<tr class="trl-det" data-d="' + gi + '" hidden><td colspan="' + NC + '"><div class="trl-dbox">' +
          '<div class="tr-s" style="max-width:none;margin:0 0 8px"><b style="color:var(--text2)">Starters:</b> ' + st + (benched.length ? ' <span style="color:var(--text3)">· projected starters who didn’t start: ' + benched.map(function (n) { return esc(lastN(n)); }).join(', ') + '</span>' : '') +
          ((e.opp_missing || []).length ? '<br><b style="color:var(--text2)">' + esc(short(e.opp)) + ' played without</b> ' + e.opp_missing.map(esc).join(', ') + (e.opp_miss_pts ? ' (≈' + (+e.opp_miss_pts).toFixed(1) + ' pts, already taken off our line)' : '') : '') + '</div>' +
          (tl ? '<div class="trl-dscroll">' + tl + '</div>' : '') +
          '<div class="tl-foot"><span>Counts <b>' + ((e.reality || 0) / 100).toFixed(2) + '</b> of a real game toward the rating</span><span>Rating trend after <b>' + sg(e.adj_after, 2) + '</b></span><a href="scrimmage.html?id=' + encodeURIComponent(e.id) + '">Box score →</a></div></div></td></tr>';
      });
      body += '<tr class="trl-proj trl-now"><td class="l nm">Rating trend now<span class="trl-sub">after ' + nG + ' scrimmage' + (nG > 1 ? 's' : '') + ' · added to the 2026-27 power rating</span></td><td></td><td></td><td></td><td></td><td class="trl-tr" style="color:' + col + '">' + sg(adj, 2) + '</td></tr>';
      var playedIds = {}; Gs.forEach(function (e) { playedIds[e.id] = 1; });
      var today = new Date().toISOString().slice(0, 10);
      mine.filter(function (x) { return !playedIds[x.id] && x.date >= today; }).forEach(function (x) { var opp = x.home === full ? x.away : x.home, lg = logo(opp);
        body += '<tr class="trl-up"><td class="l" colspan="' + NC + '">' + (lg ? '<img class="tr-lg" src="' + lg + '" alt="">' : '') + 'Next · ' + md(x.date) + ' ' + (x.home === full ? 'vs ' : '@ ') + esc(short(opp)) +
          ' <span class="trl-sub" style="display:inline">· ' + (x.neutral ? 'Neutral' : x.home === full ? 'Home' : 'Away') + (x.time ? ' · ' + esc(x.time) : '') + '</span></td></tr>'; });
      html += '<div class="tr-sec">Game log</div><div class="sheet-wrap" style="max-height:none"><table class="sheet dense trl"><thead><tr><th class="l">Game</th>' +
        '<th title="Our projected margin going in (after any players the opponent was missing)">Our line</th><th>Actual</th><th title="Actual margin minus our line">vs line</th><th>Reality</th><th title="Rating points the scrimmages have added so far">Rating trend</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
        '<div class="tr-s" style="margin-top:6px;">Click a game for starters and the team line. Starters in <b style="color:var(--green,#1a8c3a)">green</b> weren’t in our projected starting five.</div>';
      // team box vs projection
      var B = TM.box;
      if (B && B.scrim) {
        var cols = [['ppg', 'PTS', 1, 1], ['fg_pct', 'FG%', 1, 1], ['tp_pct', '3P%', 1, 1], ['ft_pct', 'FT%', 1, 1], ['tpa', '3PA', 1, 0], ['rpg', 'REB', 1, 1], ['apg', 'AST', 1, 1], ['tov', 'TO', 1, -1], ['stl', 'STL', 1, 1], ['blk', 'BLK', 1, 1]]
          .filter(function (c) { return B.scrim[c[0]] != null && B.proj && B.proj[c[0]] != null; });
        if (cols.length) html += '<div class="tr-sec">Team box vs projection <span style="font-weight:600;text-transform:none;letter-spacing:0;color:var(--text3);">· Reality-weighted average of ' + B.n + ' scrimmage box score' + (B.n > 1 ? 's' : '') + ' next to the projected per-game line</span></div>' +
          '<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense"><thead><tr><th class="l"></th>' + cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
          '<tr><td class="l strong">Scrimmages</td>' + cols.map(function (c) { return '<td class="strong">' + (+B.scrim[c[0]]).toFixed(c[2]) + '</td>'; }).join('') + '</tr>' +
          '<tr><td class="l dim">Projected</td>' + cols.map(function (c) { return '<td class="dim">' + (+B.proj[c[0]]).toFixed(c[2]) + '</td>'; }).join('') + '</tr>' +
          '<tr><td class="l">Difference</td>' + cols.map(function (c) { var d = B.scrim[c[0]] - B.proj[c[0]]; return '<td class="' + (c[3] ? cls(d * c[3], c[0].indexOf('pct') > 0 ? 1.5 : 1) : '') + '">' + sg(d, c[2]) + '</td>'; }).join('') + '</tr></tbody></table></div>';
      }
      // risers & fallers
      var P = [];
      [['players', 1], ['fresh', 0]].forEach(function (k) { var M = T[k[0]] || {}; for (var key in M) if (M[key].full === full) P.push({ key: key, ret: k[1], p: M[key] }); });
      P.sort(function (a, b) { return (b.p.trend || 0) - (a.p.trend || 0); });
      if (P.length) {
        var link = function (x) { return x.ret ? 'player.html?espn=' + encodeURIComponent(x.key) + '&tab=trends' : 'player.html?name=' + encodeURIComponent(x.p.name) + '&team=' + encodeURIComponent(x.p.team) + '&tab=trends'; };
        html += '<div class="tr-sec">Risers &amp; fallers</div><div class="sheet-wrap" style="max-height:none;"><table class="sheet dense"><thead><tr><th class="l">Player</th><th title="Game Score per 40 vs his pre-scrimmage projection, Reality-weighted">Trend</th><th>OVR</th><th>MIN</th><th>PTS</th><th>REB</th><th title="Real-game equivalents his scrimmage lines count for">Counts</th><th class="l">Biggest note</th></tr></thead><tbody>' +
          P.map(function (x) {
            var m = x.p.moved || {}, notes = [].concat.apply([], (x.p.games || []).map(function (e) { return e.notes || []; }));
            var top = notes.filter(function (n) { return n.indexOf('pts') >= 0 || n.indexOf('min') >= 0; })[0] || notes[0] || '';
            return '<tr style="cursor:pointer" onclick="location.href=\'' + link(x) + '\'"><td class="l nm">' + esc(x.p.name) + (x.ret ? '' : ' <span class="dim" style="font-size:10px">NEW</span>') + '</td>' +
              '<td class="' + cls(x.p.trend, 1) + ' strong">' + sg(x.p.trend) + '</td>' +
              '<td class="' + cls(m.ovr, 0.6) + '">' + sg(m.ovr, 0) + '</td><td class="' + cls(m.mpg, 0.8) + '">' + sg(m.mpg) + '</td>' +
              '<td class="' + cls(m.ppg, 0.4) + '">' + sg(m.ppg) + '</td><td class="' + cls(m.rpg, 0.3) + '">' + sg(m.rpg) + '</td>' +
              '<td class="dim">' + (x.p.weight != null ? (+x.p.weight).toFixed(2) + ' g' : '—') + '</td>' +
              '<td class="l" style="white-space:normal;font-size:11.5px;color:' + (top.charAt(0) === '+' ? 'var(--green,#1a8c3a)' : top ? 'var(--red,#cc2200)' : 'inherit') + '">' + esc(top) + '</td></tr>';
          }).join('') + '</tbody></table></div><div class="tr-s" style="margin-top:6px;">OVR / MIN / PTS / REB = how much the scrimmages moved his 2026-27 projection. Click a player for his full Trends tab.</div>';
      }
      // played but not on our roster
      var extra = {};
      TM.games.forEach(function (e) { var r = D.R[e.id]; if (!r || !r.box) return; ['home', 'away'].forEach(function (sd) { var b = r.box[sd]; if (!b || b.team !== full || b.partial) return;
        (b.players || []).forEach(function (q) { if (!q.rn && (q.min || 0) > 0) extra[q.name] = Math.max(extra[q.name] || 0, q.min); }); }); });
      var ex = Object.keys(extra).sort(function (a, b) { return extra[b] - extra[a]; });
      if (ex.length) html += '<div class="tr-sec">Played, but not on our roster</div><div class="tr-s">' + ex.map(function (n) { return '<b>' + esc(n) + '</b> (' + extra[n] + ' min)'; }).join(' · ') +
        ' — their lines can’t count toward a projection until they’re added to the ' + esc(team) + ' roster.</div>';
      html += '<div class="tr-s" style="margin-top:14px;">Scrimmages are unofficial: they never count in the record or season stats. How far they move ratings, minutes and player projections is set by each game’s Reality Meter.</div>';
      host.innerHTML = html;
      wireRows(host); wireChart(host, pts);
      if (Gs.length === 1) { var r0 = host.querySelector('tr.trl-g'); if (r0) r0.click(); }
    });
  }
  g.TDCTrends = { load: load, render: render, renderTeam: renderTeam };
})(window);
