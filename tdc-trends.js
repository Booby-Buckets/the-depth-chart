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
      var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      var stamp = function (date, cls, r) { var d = new Date(date + 'T12:00:00'); return '<div class="tl-stamp ' + cls + '"><div class="m">' + MON[d.getMonth()] + '</div><div class="d">' + d.getDate() + '</div>' + (r ? '<div class="r">' + r + '</div>' : '') + '</div>'; };
      var upNode = function (x) { var opp = x.home === teamFull ? x.away : x.home, lg = logo(opp);
        return '<div class="tl-node">' + stamp(x.date, 'up', 'NEXT') + '<div class="tl-card ghost"><div class="tl-h">' + (lg ? '<img src="' + lg + '" alt="">' : '') + (x.home === teamFull ? 'vs ' : '@ ') + esc(short(opp)) +
          ' <span class="tl-pill">' + (x.neutral ? 'Neutral' : x.home === teamFull ? 'Home' : 'Away') + '</span>' + (x.time ? ' <span class="tl-pill">' + esc(x.time) + '</span>' : '') + '</div><div class="tl-sub">Upcoming scrimmage — his line lands here once the box score posts.</div></div></div>'; };
      if (!P || !P.games || !P.games.length) {
        host.innerHTML = '<div class="tr-empty" style="margin-bottom:18px;"><b>No scrimmage box score for ' + esc(who.name || 'this player') + ' yet.</b><br>Preseason trends come from scrimmages and exhibitions, weighted by how game-like each one was (the Reality Meter).</div>' +
          (upcoming.length ? '<div class="tl">' + upcoming.map(upNode).join('') + '</div>' : '');
        return;
      }
      var tr = P.trend || 0, mv = P.moved || {}, b = P.base || {}, nw = P.now || {};
      var col = tr >= 1 ? 'var(--green,#1a8c3a)' : tr <= -1 ? 'var(--red,#cc2200)' : 'var(--text)';
      var word = tr >= 3 ? 'Trending up' : tr >= 1 ? 'Slightly up' : tr <= -3 ? 'Trending down' : tr <= -1 ? 'Slightly down' : 'Steady';
      var nG = P.games.length, W = P.weight || 0;
      var KV = [['ovr', 'OVR', 0], ['mpg', 'MIN', 1], ['ppg', 'PTS', 1], ['rpg', 'REB', 1], ['apg', 'AST', 1]].filter(function (x) { return b[x[0]] != null; });
      var kv = function (src, withDelta) { return '<div class="tl-kv">' + KV.map(function (x) { var d = mv[x[0]];
        return '<div><div class="k">' + x[1] + '</div><div class="v">' + (+src[x[0]]).toFixed(x[2]) + (withDelta && d ? '<span class="dl" style="color:' + (d > 0 ? 'var(--green,#1a8c3a)' : 'var(--red,#cc2200)') + '">' + sg(d, x[2]) + '</span>' : '') + '</div></div>'; }).join('') + '</div>'; };
      var html = '<div class="tr-hd"><div><div class="tr-l">Preseason trend</div><div class="tr-big" style="color:' + col + '">' + (tr > 0 ? '▲ ' : tr < 0 ? '▼ ' : '') + sg(tr) + '</div></div>' +
        '<div><div class="tr-t">' + word + '</div><div class="tr-s">How his scrimmages compared with what we projected for him (Game Score per 40 minutes), from ' + nG + ' scrimmage' + (nG > 1 ? 's' : '') +
        (nG > 1 ? ' that count as <b>' : ' that counts as <b>') + W.toFixed(2) + ' real game' + (W === 1 ? '' : 's') + '</b> — each weighted by its Reality Meter and his share of a normal night’s minutes.</div></div></div>';
      html += '<div class="tl">';
      // 1. entering the preseason
      html += '<div class="tl-node">' + '<div class="tl-stamp s"><div class="m">PRE</div><div class="d">◆</div><div class="r">SEASON</div></div>' +
        '<div class="tl-card"><div class="tl-h">Entering the preseason <span class="tl-pill">our projection</span></div>' + kv(b, false) +
        '<div class="tl-sub">His 2026-27 projection before any scrimmage counted.</div></div></div>';
      // 2. each scrimmage
      var games = P.games.slice().sort(function (a, b2) { return a.date.localeCompare(b2.date); });
      var cols = [['min', 'MIN', 0], ['pts', 'PTS', 1], ['reb', 'REB', 1], ['ast', 'AST', 1], ['stl', 'STL', 1], ['blk', 'BLK', 1], ['tov', 'TO', 1], ['fg', 'FG', 0], ['tp', '3PT', 0], ['ft', 'FT', 0], ['gmsc', 'GmSc', 1]];
      var cell = function (L, k, dec, isAct) {
        if (k === 'fg' || k === 'tp' || k === 'ft') { var mk = { fg: ['fgm', 'fga'], tp: ['tpm', 'tpa'], ft: ['ftm', 'fta'] }[k], a = L[mk[0]], t = L[mk[1]];
          if (a == null || t == null) return '—'; return isAct ? a + '-' + t : (+a).toFixed(1) + '-' + (+t).toFixed(1); }
        var v = L[k]; if (v == null) return '—'; return isAct && k !== 'gmsc' ? String(v) : (+v).toFixed(dec);
      };
      games.forEach(function (e) {
        var w = e.res.charAt(0) === 'W', lg = logo(e.opp), Pj = e.proj || null, Pc = e.pace || null;
        var act = { min: e.min, pts: e.pts, reb: e.reb, ast: e.ast, stl: e.stl, blk: e.blk, tov: e.tov, fgm: e.fgm, fga: e.fga, tpm: e.tpm, tpa: e.tpa, ftm: e.ftm, fta: e.fta, gmsc: e.gmsc };
        var rmc = e.reality != null ? rmCol(e.reality) : 'var(--text3)';
        var rmw = e.reality >= 75 ? 'Game-like' : e.reality >= 55 ? 'Mostly real' : e.reality >= 35 ? 'Experimental' : 'Practice-like';
        var tbl = '';
        if (Pj && Pc) {
          var diffCell = function (c) { var k = c[0];
            if (k === 'fg' || k === 'tp' || k === 'ft') { var mk = { fg: ['fgm', 'fga'], tp: ['tpm', 'tpa'], ft: ['ftm', 'fta'] }[k]; var d = (act[mk[0]] || 0) - Pc[mk[0]]; return '<td class="' + cls(d, 0.8) + '">' + sg(d) + ' made</td>'; }
            if (k === 'min') { var dm = (act.min || 0) - Pj.min; return '<td class="' + cls(dm, 3) + '">' + sg(dm, 0) + '</td>'; }
            var d2 = (act[k] || 0) - Pc[k]; if (k === 'tov') d2 = -d2;
            return '<td class="' + cls(d2, k === 'gmsc' || k === 'pts' ? 1.5 : 0.8) + '">' + sg(k === 'tov' ? -d2 : d2) + '</td>'; };
          tbl = '<div class="sheet-wrap" style="max-height:none;margin-top:4px;"><table class="sheet dense"><thead><tr><th class="l"></th>' + cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
            '<tr><td class="l dim" title="His 2026-27 projection for one game, at his projected minutes, adjusted for this opponent">Projected for this game</td>' + cols.map(function (c) { return '<td class="dim">' + cell(Pj, c[0], c[2]) + '</td>'; }).join('') + '</tr>' +
            '<tr><td class="l dim" title="The same projection scaled to the minutes he actually played — the fair yardstick">Projected at ' + Math.round(e.min || 0) + ' min</td>' + cols.map(function (c) { return '<td class="dim">' + (c[0] === 'min' ? Math.round(e.min || 0) : cell(Pc, c[0], c[2])) + '</td>'; }).join('') + '</tr>' +
            '<tr class="act"><td class="l">Actual</td>' + cols.map(function (c) { return '<td>' + cell(act, c[0], c[2], true) + '</td>'; }).join('') + '</tr>' +
            '<tr class="vs"><td class="l" title="Actual minus the projection at his minutes (minutes: actual minus projected)">vs projection</td>' + cols.map(diffCell).join('') + '</tr>' +
            '</tbody></table></div>';
        }
        var notes = (e.notes || []).map(function (nn) { var p = nn.charAt(0) === '+'; return '<span class="tl-chip ' + (p ? 'p' : 'm') + '"><b>' + (p ? '+' : '−') + '</b>' + esc(nn.slice(2)) + '</span>'; }).join('');
        var oa = e.opp_adj;
        html += '<div class="tl-node">' + stamp(e.date, w ? 'w' : 'l', e.res) +
          '<div class="tl-card"><div class="tl-h">' + (lg ? '<img src="' + lg + '" alt="">' : '') + (e.site === 'A' ? '@ ' : 'vs ') + esc(short(e.opp)) +
          (e.reality != null ? ' <span class="tl-pill rm" style="background:' + rmc + '">Reality ' + e.reality + ' · ' + rmw + '</span>' : '') +
          (e.gs ? ' <span class="tl-pill">Started</span>' : ' <span class="tl-pill">Bench</span>') +
          ' <a class="tl-pill" style="margin-left:auto;text-decoration:none" href="scrimmage.html?id=' + encodeURIComponent(e.id) + '">Box score →</a></div>' +
          tbl + (notes ? '<div class="tl-chips">' + notes + '</div>' : '<div class="tl-chips"><span class="tl-chip">Right about what we projected.</span></div>') +
          '<div class="tl-foot"><span>Counts as <b>' + (e.w != null ? (+e.w).toFixed(2) : '—') + '</b> of a real game</span>' +
          '<span>vs projection <b style="color:' + (e.d40 > 0 ? 'var(--green,#1a8c3a)' : e.d40 < 0 ? 'var(--red,#cc2200)' : 'inherit') + '">' + sg(e.d40) + '</b> Game Score / 40</span>' +
          '<span>Trend after this game <b>' + sg(e.trend_after) + '</b></span>' +
          (oa != null && Math.abs(oa) >= 1 ? '<span>Opponent adjustment <b>' + sg(oa) + '%</b> (' + esc(short(e.opp)) + ' rated ' + sg(e.opp_rating) + ')</span>' : '') + '</span></div></div></div>';
      });
      // 3. now
      html += '<div class="tl-node"><div class="tl-stamp ' + (tr >= 1 ? 'w' : tr <= -1 ? 'l' : 's') + '"><div class="m">NOW</div><div class="d">' + (tr > 0 ? '▲' : tr < 0 ? '▼' : '●') + '</div><div class="r">' + sg(tr) + '</div></div>' +
        '<div class="tl-card"><div class="tl-h">His projection now <span class="tl-pill">after ' + nG + ' scrimmage' + (nG > 1 ? 's' : '') + '</span></div>' + kv(nw, true) +
        '<div class="tl-sub">Change = what the scrimmages moved: his per-minute rates (capped at 15%), his minutes toward his scrimmage role' + (P.moved && b.ovr != null ? '' : '') + ', and for a newcomer his OVR (±4).' +
        (TM && TM.adj ? ' ' + esc(short(teamFull)) + '’s team rating moved <b style="color:' + (TM.adj > 0 ? 'var(--green,#1a8c3a)' : 'var(--red,#cc2200)') + '">' + sg(TM.adj, 2) + '</b>.' : '') + '</div></div></div>';
      // 4. upcoming
      html += upcoming.map(upNode).join('');
      html += '</div><div class="tr-s" style="margin-top:6px;">Scrimmages are unofficial: they never count in his record or season stats. “Projected for this game” is his 2026-27 projection for one game at his projected minutes, adjusted for the opponent; “Projected at N min” scales it to the minutes he actually played, which is what his production is judged against.</div>';
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
