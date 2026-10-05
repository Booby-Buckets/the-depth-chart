/* tdc-scrim.js — preseason exhibitions / secret scrimmages (2026-27).
 * Data: scripts/data/scrimmages_2027.json (owner-supplied list; "vs" = neutral site) and
 * scripts/data/scrimmage_results_2027.json (scores/notes as they leak — {id: {hs, as, note, src}}).
 * Exhibitions are NOT part of the season projection or the record; they get their own section
 * on the team Schedule tab and their own days on the Betting Cheat Sheet slate picker.
 *   TDCScrim.load()                → Promise<{games, results}>
 *   TDCScrim.price(g, D, eff)      → {m (home margin), probH, tot} from TDC_RATINGS.lineFor
 *   TDCScrim.renderFor(host, full) → prepends the team's exhibitions table to host
 */
(function (g) {
  'use strict';
  var _p = null;
  function load() {
    if (_p) return _p;
    _p = Promise.all([
      fetch('scripts/data/scrimmages_2027.json?v=5').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/scrimmage_results_2027.json?v=4', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/team_pace_eff.json?v=7').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    ]).then(function (a) {
      return { games: (a[0] && a[0].games) || [], results: (a[1] && a[1].results) || {}, eff: a[2] };
    });
    return _p;
  }
  function effTotal(eff, a, b) {
    if (!eff || !eff.teams) return null; var A = eff.teams[a], B = eff.teams[b]; if (!A || !B) return null;
    var pace = A.t + B.t - eff.avgT, k = pace / 100, avg = (eff.avgO + eff.avgD) / 2;
    return (A.o + B.d - avg) * k + (B.o + A.d - avg) * k;
  }
  function effPace(eff, a, b) { if (!eff || !eff.teams) return null; var A = eff.teams[a], B = eff.teams[b]; return A && B ? A.t + B.t - eff.avgT : null; }
  // our line for an exhibition (same engine as every other line on the site)
  function price(x, byFull, eff) {
    var H = byFull[x.home], A = byFull[x.away];
    if (!H || !A || H.rating == null || A.rating == null || !g.TDC_RATINGS) return null;
    var tot = effTotal(eff, x.home, x.away);
    var L = g.TDC_RATINGS.lineFor(H, A, x.neutral ? 'neutral' : 'home', tot != null ? tot : undefined);
    return { m: L.margin, probH: L.probA, tot: tot, pace: effPace(eff, x.home, x.away) };
  }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function sn(full, byFull) { var t = byFull[full]; var s = (t && t.team) || full.replace(/ [A-Z][a-z]+$/, ''); try { if (g.tdcShortSchool) return g.tdcShortSchool(s) || s; } catch (e) {} return s; }
  function logo(full, byFull) { var t = byFull[full]; var c = g.tdcTeamColor && (g.tdcTeamColor((t && t.team) || full) || g.tdcTeamColor(full)); return (c && c.logo) || ''; }

  function renderFor(host, me) {
    if (!host || !me) return Promise.resolve();
    return Promise.all([load(), g.TDC_RATINGS ? g.TDC_RATINGS.get() : null]).then(function (a) {
      var S = a[0], D = a[1]; var mine = S.games.filter(function (x) { return x.home === me || x.away === me; });
      var old = host.querySelector('.scrim-wrap'); if (old) old.remove();
      if (!mine.length) return;
      var byFull = {}; ((D && D.teams) || []).slice().sort(function (p, q) { return q.rating - p.rating; })
        .forEach(function (t, i) { if (t.rank == null) t.rank = i + 1; byFull[t.full] = t; });
      var DW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      var sg = function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1); };
      var quad = function (rank, site) { if (!rank) return null; var c = site === 'H' ? [30, 75, 160] : site === 'A' ? [75, 135, 240] : [50, 100, 200];
        return rank <= c[0] ? 1 : rank <= c[1] ? 2 : rank <= c[2] ? 3 : 4; };
      var enc = function (v) { return encodeURIComponent(v).replace(/'/g, '%27'); };
      // the SAME columns, formats and click-through as the season table (tdc-schedule.js render)
      var rows = mine.slice().sort(function (p, q) { return p.date.localeCompare(q.date); }).map(function (x) {
        var home = x.home === me, opp = home ? x.away : x.home, site = x.neutral ? 'N' : home ? 'H' : 'A';
        var P = price(x, byFull, S.eff), res = S.results[x.id], ot = byFull[opp];
        var my = P ? (home ? P.m : -P.m) : null, wp = P ? (home ? P.probH : 100 - P.probH) : null;
        var dd = new Date(x.date + 'T12:00:00'), q = quad(ot && ot.rank, site);
        var played = res && res.hs != null && res.as != null;
        var ms = played ? (home ? res.hs : res.as) : null, os = played ? (home ? res.as : res.hs) : null;
        var score = played ? (ms > os ? 'W ' : 'L ') + ms + '–' + os
          : (P && P.tot != null && my != null) ? Math.round((P.tot + my) / 2) + '–' + Math.round((P.tot - my) / 2) : '—';
        var href = played ? 'scrimmage.html?id=' + encodeURIComponent(x.id)
          : 'preview.html?team=' + enc(me) + '&opp=' + enc(opp) + '&date=' + x.date;
        var ol = logo(opp, byFull);
        return '<tr data-noheat class="scrim-row ' + (played ? (ms > os ? 'w' : 'x') : '') + '" style="cursor:pointer" onclick="location.href=\'' + href + '\'" title="' + (played ? 'open the box score' : 'open the game preview') + '">' +
          '<td class="l dim tsp-d">' + DW[dd.getDay()] + ' ' + (dd.getMonth() + 1) + '/' + dd.getDate() + '</td>' +
          '<td class="dim tsp-rk">' + (ot && ot.rank ? ot.rank : '') + '</td>' +
          '<td class="l nm tsp-o">' + (ol ? '<img class="tsp-lg" src="' + ol + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<i class="tsp-lg"></i>') +
            (ot ? '<a href="team.html?team=' + encodeURIComponent(ot.team) + '" onclick="event.stopPropagation()">' + esc(sn(opp, byFull)) + '</a>' : esc(sn(opp, byFull))) + '</td>' +
          '<td class="c ' + (played ? 'strong ' : '') + 'tsp-sc">' + score + '</td>' +
          '<td class="c tsp-site">' + site + '</td>' +
          '<td class="c tsp-q">' + (q ? 'Q' + q : '') + '</td>' +
          '<td class="tsp-pr">' + (!played && ot && isFinite(ot.rating) ? sg(ot.rating) : '') + '</td>' +
          '<td class="tsp-p">' + (!played && wp != null ? Math.round(wp) + '%' : '') + '</td>' +
          '<td class="tsp-line">' + (played || my == null ? '' : (my >= 0 ? '−' : '+') + Math.abs(my).toFixed(1)) + '</td></tr>';
      }).join('');
      // one table with the season: the scrimmages are its first section, so every column, width and
      // colour matches; a section row carries the "unofficial" label. Shaded on the season rows'
      // scale (data-noheat) so they never move it. No season table yet → their own table.
      var main = [].slice.call(host.querySelectorAll('table.tsp-table')).filter(function (x) { return !x.closest('.scrim-wrap'); })[0];
      host.querySelectorAll('tr.scrim-row,tr.scrim-sec').forEach(function (r) { r.remove(); });
      if (main && main.tBodies[0]) {
        var n = main.tHead.rows[0].cells.length, body = main.tBodies[0];
        var sec = function (txt) { return '<tr class="sec scrim-sec"><td class="l" colspan="' + n + '">' + txt + '</td></tr>'; };
        body.insertAdjacentHTML('afterbegin', sec('Preseason scrimmages · unofficial · not counted in the record, stats, ratings or projections') + rows +
          sec('2026-27 season'));
        if (g.tdcSheetHeat) g.tdcSheetHeat(main);
        return;
      }
      var wrap = document.createElement('div'); wrap.className = 'scrim-wrap';
      wrap.innerHTML = '<div class="sheet-wrap tsp-wrap" style="max-height:none;margin-bottom:22px;"><table class="sheet dense tsp-table"><thead><tr>' +
        '<th class="l">Date</th><th>Rk</th><th class="l">Opponent</th><th class="c">Score</th><th class="c">Site</th><th class="c">Quad</th><th>Opp PRtg</th><th data-heat="1">Win %</th><th data-heat="-1">Line</th>' +
        '</tr></thead><tbody><tr class="sec scrim-sec"><td class="l" colspan="9">Preseason scrimmages · unofficial · not counted in the record, stats, ratings or projections</td></tr>' + rows + '</tbody></table></div>';
      var tiles = host.querySelector('.tsp-sum');
      if (tiles && tiles.parentNode) tiles.parentNode.insertBefore(wrap, tiles.nextSibling); else host.insertBefore(wrap, host.firstChild);
    }).catch(function () {});
  }
  (function css() { if (document.getElementById('scrim-css')) return; var st = document.createElement('style'); st.id = 'scrim-css';
    st.textContent = '.scrim-chip{display:inline-block;margin-left:7px;padding:0 6px;border:1px dashed var(--border2);border-radius:4px;font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);vertical-align:1px;line-height:1.7;}.scrim-wrap td{color:var(--text2);}.scrim-wrap img.scrim-lg{width:16px!important;height:16px!important;max-width:16px;object-fit:contain;vertical-align:middle;margin:-2px 7px 0 0;display:inline-block;}.scrim-boxes{padding:6px 2px 10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:14px;}.scrim-boxes .dim:first-child{grid-column:1/-1;}.scrim-bth{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text2);margin-bottom:4px;}tr.scrim-box>td{background:var(--bg2)!important;white-space:normal;}';
    (document.head || document.documentElement).appendChild(st); })();
  g.TDCScrim = { load: load, price: price, renderFor: renderFor };
})(window);
