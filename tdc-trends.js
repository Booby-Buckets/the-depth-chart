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
      fetch('scripts/data/scrim_trends_2027.json?v=3').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/scrimmages_2027.json?v=7').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/scrimmage_results_2027.json?v=9').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    ]).then(function (a) { return { T: a[0] || {}, S: (a[1] && a[1].games) || [], R: (a[2] && a[2].results) || {} }; });
    return _p;
  }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var sg = function (v, d) { if (v == null || !isFinite(v)) return '—'; var x = (+v).toFixed(d == null ? 1 : d); return (v > 0 ? '+' : v < 0 ? '−' : '') + x.replace('-', ''); };
  var logo = function (full) { try { var c = g.tdcTeamColor && g.tdcTeamColor(full); return (c && c.logo) || ''; } catch (e) { return ''; } };
  var short = function (full) { var s = String(full || '').replace(/ [A-Z][a-z]+$/, ''); try { return (g.tdcShortSchool && g.tdcShortSchool(s)) || s; } catch (e) { return s; } };
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
      '.tr-empty{padding:34px;text-align:center;color:var(--text3);border:1px dashed var(--border2);border-radius:12px;line-height:1.7;}';
    document.head.appendChild(st);
  }

  function render(host, who) {
    if (!host) return Promise.resolve();
    css();
    host.innerHTML = '<div class="tr-empty">Loading preseason trends…</div>';
    return load().then(function (D) {
      var T = D.T || {}, P = null;
      if (who.espn_id != null && T.players) P = T.players[String(who.espn_id)];
      if (!P && T.fresh) P = T.fresh[(String(who.team || '') + '|' + String(who.name || '')).toLowerCase()];
      var teamFull = P ? P.full : null, TM = null;
      if (T.teams) for (var f in T.teams) { if ((teamFull && f === teamFull) || (!teamFull && T.teams[f].short === who.team)) { TM = T.teams[f]; teamFull = f; break; } }
      if (!P || !P.games || !P.games.length) {
        var up = D.S.filter(function (x) { return teamFull && (x.home === teamFull || x.away === teamFull); });
        host.innerHTML = '<div class="tr-empty"><b>No scrimmage box score for ' + esc(who.name || 'this player') + ' yet.</b><br>' +
          'Preseason trends come from scrimmages and exhibitions, weighted by how game-like each one was (the Reality Meter).' +
          (up.length ? '<br>' + esc(short(teamFull)) + '’s preseason: ' + up.map(function (x) { var d = new Date(x.date + 'T12:00:00'); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + (x.home === teamFull ? (x.neutral ? 'vs ' : 'vs ') + esc(short(x.away)) : '@ ' + esc(short(x.home))); }).join(' · ') : '') + '</div>';
        return;
      }
      var tr = P.trend || 0, mv = P.moved || {}, b = P.base || {}, nw = P.now || {};
      var col = tr >= 1 ? 'var(--green,#1a8c3a)' : tr <= -1 ? 'var(--red,#cc2200)' : 'var(--text)';
      var word = tr >= 3 ? 'Trending up' : tr >= 1 ? 'Slightly up' : tr <= -3 ? 'Trending down' : tr <= -1 ? 'Slightly down' : 'Steady';
      var nG = P.games.length, W = P.weight || 0;
      var html = '<div class="tr-hd"><div><div class="tr-l">Preseason trend</div><div class="tr-big" style="color:' + col + '">' + (tr > 0 ? '▲ ' : tr < 0 ? '▼ ' : '') + sg(tr) + '</div></div>' +
        '<div><div class="tr-t">' + word + '</div><div class="tr-s">Game Score per 40 minutes vs his projection going in, from ' + nG + ' scrimmage' + (nG > 1 ? 's' : '') +
        (nG > 1 ? ' that count as <b>' : ' that counts as <b>') + W.toFixed(2) + ' real game' + (W === 1 ? '' : 's') + '</b> (each is weighted by its Reality Meter and his share of a normal night’s minutes, then shrunk toward steady).</div></div></div>';
      // what it moved
      var mrow = [['ovr', 'OVR', 0, 1], ['mpg', 'MIN', 1, 1], ['ppg', 'PTS', 1, 0.5], ['rpg', 'REB', 1, 0.5], ['apg', 'AST', 1, 0.5]].filter(function (x) { return b[x[0]] != null; });
      html += '<div class="tr-sec">What it moved in his 2026-27 projection</div><div class="sheet-wrap" style="max-height:none;"><table class="sheet dense"><thead><tr><th class="l"></th>' +
        mrow.map(function (x) { return '<th>' + x[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
        '<tr><td class="l dim">Before scrimmages</td>' + mrow.map(function (x) { return '<td class="dim">' + (+b[x[0]]).toFixed(x[2]) + '</td>'; }).join('') + '</tr>' +
        '<tr><td class="l strong">Now</td>' + mrow.map(function (x) { return '<td class="strong">' + (+nw[x[0]]).toFixed(x[2]) + '</td>'; }).join('') + '</tr>' +
        '<tr><td class="l">Change</td>' + mrow.map(function (x) { var d = mv[x[0]]; return '<td class="' + cls(d, x[3]) + '">' + sg(d, x[2]) + '</td>'; }).join('') + '</tr></tbody></table></div>';
      if (TM && TM.adj) html += '<div class="tr-s" style="margin-top:8px;">' + esc(short(teamFull)) + '’s team rating moved <b style="color:' + (TM.adj > 0 ? 'var(--green,#1a8c3a)' : 'var(--red,#cc2200)') + '">' + sg(TM.adj, 2) + '</b> from how its scrimmages went against our line.</div>';
      // pluses & minuses
      html += '<div class="tr-sec">Pluses &amp; minuses</div><div class="tr-notes">' + P.games.map(function (e) {
        var d = new Date(e.date + 'T12:00:00'), lg = logo(e.opp);
        var notes = (e.notes || []);
        return '<div class="tr-g"><h4>' + (lg ? '<img src="' + lg + '" alt="">' : '') + (e.site === 'A' ? '@ ' : 'vs ') + esc(short(e.opp)) + ' <span class="dim">' + (d.getMonth() + 1) + '/' + d.getDate() + ' · ' + esc(e.res) + ' · Reality ' + (e.reality != null ? e.reality : '—') + '</span></h4>' +
          (notes.length ? notes.map(function (n) { var p = n.charAt(0) === '+'; return '<div class="tr-n ' + (p ? 'p' : 'm') + '"><b>' + (p ? '+' : '−') + '</b> ' + esc(n.slice(2)) + '</div>'; }).join('')
            : '<div class="tr-n">Right about what we projected.</div>') + '</div>';
      }).join('') + '</div>';
      // game table
      var f2 = function (m, a) { return m == null || a == null ? '—' : m + '-' + a; };
      var ex = function (v, e) { return (v == null ? '—' : v) + (e != null ? ' <span class="dim">(' + (+e).toFixed(1) + ')</span>' : ''); };
      html += '<div class="tr-sec">Scrimmage by scrimmage <span style="font-weight:600;text-transform:none;letter-spacing:0;color:var(--text3);">· expected in parentheses, from his pre-scrimmage projection at the minutes he played, adjusted for the opponent</span></div>' +
        '<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense"><thead><tr><th class="l">Date</th><th class="l">Opponent</th><th class="c">Result</th><th>Reality</th><th title="Real-game equivalents this line counts for">Counts</th><th class="c">GS</th>' +
        '<th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>3PT</th><th>FT</th><th title="Hollinger Game Score">Game Score</th><th title="Game Score per 40 above (+) or below (−) expectation">vs exp /40</th></tr></thead><tbody>' +
        P.games.map(function (e) {
          var d = new Date(e.date + 'T12:00:00'), lg = logo(e.opp), X = e.exp || {}, w = e.res.charAt(0) === 'W';
          return '<tr style="cursor:pointer" onclick="location.href=\'scrimmage.html?id=' + encodeURIComponent(e.id) + '\'"><td class="l dim">' + (d.getMonth() + 1) + '/' + d.getDate() + '</td>' +
            '<td class="l nm">' + (lg ? '<img class="tr-lg" src="' + lg + '" alt="">' : '') + (e.site === 'A' ? '@ ' : e.site === 'N' ? 'vs ' : '') + esc(short(e.opp)) + '</td>' +
            '<td class="c ' + (w ? 'c4' : 'c0') + '">' + esc(e.res) + '</td>' +
            '<td>' + (e.reality != null ? e.reality + '<span class="tr-mb"><i style="width:' + e.reality + '%;background:' + rmCol(e.reality) + '"></i></span>' : '—') + '</td>' +
            '<td class="dim">' + (e.w != null ? (+e.w).toFixed(2) + ' g' : '—') + '</td><td class="c dim">' + (e.gs ? '✓' : '') + '</td>' +
            '<td>' + ex(e.min, e.exp_min) + '</td><td class="strong">' + ex(e.pts, X.pts) + '</td><td>' + ex(e.reb, X.reb) + '</td><td>' + ex(e.ast, X.ast) + '</td>' +
            '<td>' + f2(e.fgm, e.fga) + '</td><td>' + f2(e.tpm, e.tpa) + '</td><td>' + f2(e.ftm, e.fta) + '</td>' +
            '<td>' + ex(e.gmsc, X.gmsc) + '</td><td class="' + cls(e.d40, 1.5) + '">' + sg(e.d40) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="tr-s" style="margin-top:12px;">Scrimmages are unofficial: they never count in his record or season stats. A fully game-like scrimmage counts as one real game against roughly ten games of evidence behind his projection, and its pull is capped (15% of his per-minute rates; ±4 OVR for a newcomer; minutes move toward his scrimmage role, then the team is re-balanced to 200).</div>';
      host.innerHTML = html;
    });
  }
  // ── TEAM TRENDS: results vs our line, team box vs projection, risers & fallers, rotation watch ──
  function renderTeam(host, team) {
    if (!host) return Promise.resolve();
    css();
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
      // results vs our line
      var ml = function (v) { return v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1); };
      html += '<div class="tr-sec">Results vs our line</div><div class="sheet-wrap" style="max-height:none;"><table class="sheet dense"><thead><tr><th class="l">Date</th><th class="l">Opponent</th><th class="c">Result</th><th title="Our projected margin going in">Our line</th><th>Actual</th><th title="Actual margin minus our line">vs line</th><th>Reality</th><th class="l">Starters</th></tr></thead><tbody>' +
        G.map(function (e) {
          var d = new Date(e.date + 'T12:00:00'), lg = logo(e.opp), w = e.actual > 0;
          var lastN = function (n) { var w = String(n).replace(/,/g, '').split(/\s+/).filter(function (x) { return !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(x); }); return w[w.length - 1] || n; };
          var gs = e.gs && e.gs.length ? e.gs.map(function (n) { var proj = (e.proj_gs || []).map(function (x) { return x.toLowerCase(); }).indexOf(n.toLowerCase()) >= 0; return proj ? esc(lastN(n)) : '<b style="color:var(--green,#1a8c3a)" title="not a projected starter">' + esc(lastN(n)) + '</b>'; }).join(', ') : '<span class="dim">—</span>';
          return '<tr style="cursor:pointer" onclick="location.href=\'scrimmage.html?id=' + encodeURIComponent(e.id) + '\'"><td class="l dim">' + (d.getMonth() + 1) + '/' + d.getDate() + '</td>' +
            '<td class="l nm">' + (lg ? '<img class="tr-lg" src="' + lg + '" alt="">' : '') + (e.site === 'A' ? '@ ' : e.site === 'N' ? 'vs ' : '') + esc(short(e.opp)) + '</td>' +
            '<td class="c ' + (w ? 'c4' : 'c0') + '">' + (w ? 'W' : 'L') + ' by ' + Math.abs(e.actual) + '</td><td class="dim">' + ml(e.pred) + '</td><td>' + ml(e.actual) + '</td>' +
            '<td class="' + cls(e.resid, 2) + '">' + ml(e.resid) + '</td>' +
            '<td>' + (e.reality != null ? e.reality + '<span class="tr-mb"><i style="width:' + e.reality + '%;background:' + rmCol(e.reality) + '"></i></span>' : '—') + '</td>' +
            '<td class="l" style="white-space:normal;font-size:11.5px">' + gs + '</td></tr>';
        }).join('') + '</tbody></table></div><div class="tr-s" style="margin-top:6px;">Starters in <b style="color:var(--green,#1a8c3a)">green</b> weren’t in our projected starting five.</div>';
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
    });
  }
  g.TDCTrends = { load: load, render: render, renderTeam: renderTeam };
})(window);
