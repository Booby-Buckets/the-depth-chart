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
      fetch('scripts/data/scrimmages_2027.json?v=4').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('scripts/data/scrimmage_results_2027.json?v=2', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
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
  // our line for an exhibition (same engine as every other line on the site)
  function price(x, byFull, eff) {
    var H = byFull[x.home], A = byFull[x.away];
    if (!H || !A || H.rating == null || A.rating == null || !g.TDC_RATINGS) return null;
    var tot = effTotal(eff, x.home, x.away);
    var L = g.TDC_RATINGS.lineFor(H, A, x.neutral ? 'neutral' : 'home', tot != null ? tot : undefined);
    return { m: L.margin, probH: L.probA, tot: tot };
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
      var rows = mine.slice().sort(function (p, q) { return p.date.localeCompare(q.date); }).map(function (x) {
        var home = x.home === me, opp = home ? x.away : x.home, site = x.neutral ? 'N' : home ? 'H' : 'A';
        var P = price(x, byFull, S.eff), res = S.results[x.id];
        var my = P ? (home ? P.m : -P.m) : null, wp = P ? (home ? P.probH : 100 - P.probH) : null;
        var line = my == null ? '—' : Math.abs(my) < 0.25 ? 'Pick’em' : (my > 0 ? '−' : '+') + (Math.round(Math.abs(my) * 2) / 2).toFixed(1);
        var dd = new Date(x.date + 'T12:00:00');
        var result = '—';
        if (res && res.hs != null && res.as != null) {
          var ms = x.home === me ? res.hs : res.as, os = x.home === me ? res.as : res.hs;   // listed home team = hs (also on neutral floors)
          var won = ms > os, beat = my != null ? (ms - os) - my : null;
          result = '<b class="' + (won ? 'up' : 'dn') + '">' + (won ? 'W' : 'L') + ' ' + ms + '–' + os + '</b>' +
            (beat != null ? ' <span class="dim" title="Margin vs our line">' + (beat >= 0 ? '+' : '−') + Math.abs(beat).toFixed(1) + ' vs line</span>' : '') +
            (res.note ? '<div class="dim" style="font-size:10.5px;white-space:normal;margin-top:2px;">' + esc(res.note) + (res.src ? ' · <a href="' + esc(res.src) + '" target="_blank" rel="noopener">recap</a>' : '') + '</div>' : '');
        } else if (res && res.note) result = '<span class="dim">' + esc(res.note) + '</span>';
        var ol = logo(opp, byFull), ot = byFull[opp];
        return '<tr' + (x.check ? ' title="Opponent read from a logo; still being confirmed"' : '') + '>' +
          '<td class="l dim">' + dd.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }) + '</td>' +
          '<td class="l dim">' + (x.time ? esc(x.time) : 'TBD') + (x.tv ? ' · ' + esc(x.tv) : '') + '</td>' +
          '<td class="l nm">' + (ol ? '<img class="tsp-lg" src="' + ol + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
            (ot ? '<a href="team.html?team=' + encodeURIComponent(ot.team) + '">' + esc(sn(opp, byFull)) + '</a>' : esc(sn(opp, byFull))) +
            (ot && ot.rank ? ' <span class="dim">#' + ot.rank + '</span>' : (ot ? '' : ' <span class="dim">non-D-I</span>')) + (x.check ? ' <span class="dim">?</span>' : '') + '</td>' +
          '<td class="l dim">' + (site === 'H' ? 'Home' : site === 'A' ? 'Away' : 'Neutral') + '</td>' +
          '<td>' + line + '</td><td>' + (wp != null ? Math.round(wp) + '%' : '—') + '</td>' +
          '<td>' + (P && P.tot != null ? Math.round(P.tot) : '—') + '</td>' +
          '<td class="l">' + result + '</td></tr>';
      }).join('');
      var wrap = document.createElement('div'); wrap.className = 'scrim-wrap';
      wrap.innerHTML = '<div class="sec-head" style="margin:0 0 10px;">Preseason exhibitions <span class="sec-head-sub" style="font-size:11px;font-weight:600;color:var(--text3);text-transform:none;letter-spacing:0;">· scrimmages and exhibitions · not part of the record or projection</span></div>' +
        '<div class="sheet-wrap" style="max-height:none;margin-bottom:22px;"><table class="sheet dense tsp-table"><thead><tr><th class="l">Date</th><th class="l">Time</th><th class="l">Opponent</th><th class="l">Site</th>' +
        '<th title="Our line for this team (− = favored)">Line</th><th title="Our win probability">Win %</th><th title="Projected total points">Total</th><th class="l">Result</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      host.insertBefore(wrap, host.firstChild);
    }).catch(function () {});
  }
  g.TDCScrim = { load: load, price: price, renderFor: renderFor };
})(window);
