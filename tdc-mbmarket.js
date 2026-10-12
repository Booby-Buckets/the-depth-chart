/* tdc-mbmarket.js — Moneyball (Oct 2026 rebuild): real market inefficiencies, not model-vs-model dollars.
 * Data: data/market_inefficiency.json (scripts/build_market_inefficiency.py) — every D-I transfer 2013-2026:
 *   the MARKET's verdict = the rating of the program that took him; the RESULT = his owned BPM after the move.
 *   Each pre-move trait gets a market weight and a result weight (standardized); the gap is the mispricing.
 * TDC_MBMARKET.render('market', host) — what the market pays for vs what produces
 * TDC_MBMARKET.render('class', host, {q, team}) — the 2026-27 transfer class, scored the same way
 */
(function (g) {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var sn = function (t) { return g.tdcShortSchool ? g.tdcShortSchool(t) : t; };
  var _d = null;
  function load() { return _d || (_d = fetch('data/market_inefficiency.json?v=2').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })); }
  // validated pair (dataviz check): blue = what the market rewards, gold = what shows up in the result
  var C_MKT = 'var(--mi-mkt)', C_WIN = 'var(--mi-win)';
  function css() {
    if (document.getElementById('mi-css')) return;
    var s = document.createElement('style'); s.id = 'mi-css';
    s.textContent =
      ':root{--mi-mkt:#2F7FC1;--mi-win:#B07D17;}[data-theme="dark"]{--mi-mkt:#3A8BCB;--mi-win:#B8862A;}' +
      '.mi-key{display:flex;gap:16px;flex-wrap:wrap;font-size:11.5px;color:var(--text2);margin:2px 0 10px;}.mi-key i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:-1px;}' +
      '.mi-db{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums;}' +
      '.mi-db td{padding:7px 8px;border-bottom:1px solid var(--border);}.mi-db th{font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);padding:6px 8px;border-bottom:1px solid var(--border2);text-align:left;}' +
      '.mi-db .lab{font-weight:700;white-space:nowrap;width:27%;}.mi-db .trk{position:relative;height:18px;}' +
      '.mi-db .trk .ax{position:absolute;top:8px;left:0;right:0;height:2px;background:var(--bg3);}.mi-db .trk .z{position:absolute;top:2px;bottom:2px;width:1px;background:var(--text3);}' +
      '.mi-db .trk .ln{position:absolute;top:8px;height:2px;}.mi-db .trk .dt{position:absolute;top:4px;width:10px;height:10px;border-radius:50%;margin-left:-5px;box-shadow:0 0 0 2px var(--bg2);}' +
      '.mi-db .num{text-align:right;width:62px;font-weight:700;}.mi-db .vd{width:150px;font-weight:800;font-size:11.5px;white-space:nowrap;}' +
      '.mi-wrap{border:1px solid var(--border);border-radius:13px;background:var(--bg2);padding:6px 12px 8px;overflow-x:auto;}' +
      '.mi-tools{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px;}.mi-tools input,.mi-tools select{font:inherit;font-size:12.5px;padding:8px 11px;border-radius:9px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);}' +
      '.mi-tools input{flex:1 1 220px;}.mi-2{display:grid;grid-template-columns:1fr 1fr;gap:18px;}@media(max-width:900px){.mi-2{grid-template-columns:1fr;}}' +
      '.mi-more{margin-top:8px;font:700 12px Inter,sans-serif;color:var(--text2);background:none;border:1px solid var(--border2);border-radius:8px;padding:6px 12px;cursor:pointer;}';
    document.head.appendChild(s);
  }
  function band(cells) { return '<div class="mb-band" style="--n:' + cells.length + '">' + cells.map(function (c) { return '<div class="cell"><div class="v">' + c.v + '</div><div class="l">' + c.l + '</div>' + (c.s ? '<div class="s">' + c.s + '</div>' : '') + '</div>'; }).join('') + '</div>'; }
  function verdict(t) { if (!t.sig || !t.stable) return ['Priced about right', 'var(--text3)']; return t.gap > 0 ? ['Undervalued', 'var(--green)'] : ['Overvalued', 'var(--red)']; }

  // ── TAB 1: what the market pays for ─────────────────────────────────────
  function renderMarket(host, D) {
    var T = D.traits.slice();
    // weights as shares: how much of the market's pricing / of the result each trait accounts for
    var sm = T.reduce(function (s, t) { return s + Math.abs(t.market); }, 0), sw = T.reduce(function (s, t) { return s + Math.abs(t.wins); }, 0);
    T.forEach(function (t) { t.ms = 100 * t.market / sm; t.ws = 100 * t.wins / sw; });
    var lo = Math.min(-5, Math.min.apply(null, T.map(function (t) { return Math.min(t.ms, t.ws); }))), hi = Math.max(5, Math.max.apply(null, T.map(function (t) { return Math.max(t.ms, t.ws); })));
    var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    var X = function (v) { return (100 * (v - lo) / (hi - lo)).toFixed(2) + '%'; };
    var under = T.filter(function (t) { return t.sig && t.stable && t.gap > 0; }), over = T.filter(function (t) { return t.sig && t.stable && t.gap < 0; });
    T.sort(function (a, b) { return a.gap - b.gap; });
    var rows = T.map(function (t) {
      var v = verdict(t), a = Math.min(t.ms, t.ws), b = Math.max(t.ms, t.ws);
      return '<tr><td class="lab">' + esc(t.label) + '</td><td><div class="trk"><div class="ax"></div><div class="z" style="left:' + X(0) + '"></div>' +
        '<div class="ln" style="left:' + X(a) + ';width:calc(' + X(b) + ' - ' + X(a) + ');background:' + (v[0] === 'Priced about right' ? 'var(--border2)' : v[1]) + '"></div>' +
        '<div class="dt" style="left:' + X(t.ms) + ';background:' + C_MKT + '" title="Market: ' + t.ms.toFixed(1) + '%"></div>' +
        '<div class="dt" style="left:' + X(t.ws) + ';background:' + C_WIN + '" title="Result: ' + t.ws.toFixed(1) + '%"></div></div></td>' +
        '<td class="num" style="color:' + C_MKT + '">' + (t.ms >= 0 ? '+' : '') + t.ms.toFixed(1) + '</td><td class="num" style="color:' + C_WIN + '">' + (t.ws >= 0 ? '+' : '') + t.ws.toFixed(1) + '</td>' +
        '<td class="vd" style="color:' + v[1] + '">' + v[0] + '</td></tr>';
    }).join('');
    var sheet = '<div class="sheet-wrap" style="margin-top:14px"><table class="sheet dense"><thead><tr><th class="l">Trait</th><th title="Standardized market weight: destination-rating SDs per SD of the trait">Market</th><th title="Standardized result weight: BPM SDs per SD of the trait">Result</th><th title="Result minus market">Gap</th><th class="l" title="95% bootstrap range of the gap">95% range</th><th>' + D.eras.early[0] + '–' + String(D.eras.early[1]).slice(2) + '</th><th>' + D.eras.late[0] + '–' + String(D.eras.late[1]).slice(2) + '</th><th class="l"></th></tr></thead><tbody>' +
      T.slice().reverse().map(function (t) { var v = verdict(t);
        return '<tr><td class="l nm">' + esc(t.label) + '</td><td>' + t.market.toFixed(3) + '</td><td>' + t.wins.toFixed(3) + '</td><td class="big">' + (t.gap >= 0 ? '+' : '') + t.gap.toFixed(3) + '</td><td class="l dim">' + t.lo.toFixed(3) + ' to ' + t.hi.toFixed(3) + '</td><td>' + (t.early_gap >= 0 ? '+' : '') + t.early_gap.toFixed(3) + '</td><td>' + (t.late_gap >= 0 ? '+' : '') + t.late_gap.toFixed(3) + '</td><td class="l" style="font-weight:800;color:' + v[1] + '">' + v[0] + '</td></tr>'; }).join('') + '</tbody></table></div>';
    host.innerHTML = band([
      { v: D.n_moves.toLocaleString(), l: 'Transfers studied', s: D.seasons[0] + '–' + D.seasons[1] + ' · 200+ min before, 150+ after' },
      { v: Math.round(100 * D.r2.market) + '%', l: 'Of the market explained', s: 'by these traits' },
      { v: Math.round(100 * D.r2.wins) + '%', l: 'Of the result explained', s: 'by the same traits' },
      { v: under.length, l: 'Undervalued traits', s: under.map(function (t) { return t.label.split(' (')[0]; }).join(', ') || '—' },
      { v: over.length, l: 'Overvalued traits', s: over.map(function (t) { return t.label.split(' (')[0]; }).join(', ') || '—' }
    ]) +
      '<div class="sec-h" style="margin-top:22px">What the market pays for vs what shows up <span class="hint">share of each side’s weight</span></div>' +
      '<div class="mi-key"><span><i style="background:' + C_MKT + '"></i>Market — how strong a program took him</span><span><i style="background:' + C_WIN + '"></i>Result — his impact (BPM) after the move</span></div>' +
      '<div class="mi-wrap"><table class="mi-db"><thead><tr><th>Trait before the move</th><th></th><th style="text-align:right">Market</th><th style="text-align:right">Result</th><th title="Over/undervalued only when the gap holds in both eras and its 95% range is clear of zero">Verdict</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + sheet;
    if (g.tdcSheetHeat) host.querySelectorAll('table.sheet').forEach(function (t) { g.tdcSheetHeat(t); });
  }

  // ── TAB 2: the 2026-27 transfer class ───────────────────────────────────
  var CS = { q: '', conf: '', n: 25 };
  function renderClass(host, D, o) {
    o = o || {}; if (o.q) CS.q = o.q; if (o.team) CS.q = o.team;
    var P = D.class2027;
    var confs = Array.from(new Set(P.map(function (p) { return p.toConf; }).filter(Boolean))).sort();
    host.innerHTML = band([
      { v: P.length.toLocaleString(), l: 'Transfers scored', s: '2025-26 stats, 200+ minutes, destination known' },
      { v: P.filter(function (p) { return p.gap >= 1.5; }).length, l: 'Strong pickups', s: '1.5+ BPM over a typical transfer to that level' },
      { v: P.filter(function (p) { return p.gap <= -1.5; }).length, l: 'Big bets', s: '1.5+ BPM under a typical transfer to that level' },
      { v: (D.pickup_check != null ? 'r ' + D.pickup_check.toFixed(2) : '—'), l: 'Track record', s: 'this score vs how ' + D.n_moves.toLocaleString() + ' past transfers did' }
    ]) +
      '<div class="mi-tools"><input id="miQ" placeholder="Search a player or school…" value="' + esc(CS.q) + '"><select id="miConf"><option value="">All destination leagues</option>' + confs.map(function (c) { return '<option' + (c === CS.conf ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
      '<div class="sec-h">Best pickups for their new level <span class="hint">expected impact vs a typical transfer to a program that strong</span></div><div id="miUnder"></div>' +
      '<div class="sec-h" style="margin-top:24px">Biggest bets for their new level <span class="hint">a profile that usually produces less than that program’s typical pickup</span></div><div id="miOver"></div>' +
      '<div class="sec-h" style="margin-top:24px">Portal classes <span class="hint">average gap of each program’s incoming transfers · 2+ scored</span></div><div id="miTeams"></div>';
    var paint = function () {
      var q = CS.q.toLowerCase().trim();
      var F = P.filter(function (p) { return (!CS.conf || p.toConf === CS.conf) && (!q || (p.name + ' ' + p.from + ' ' + p.to).toLowerCase().indexOf(q) >= 0); });
      var pl = function (p) { return 'player.html?espn=' + p.espn + '&name=' + encodeURIComponent(p.name); };
      var sheet = function (L) {
        if (!L.length) return '<div class="loading" style="padding:18px">No transfers match.</div>';
        return '<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="rk">#</th><th class="l">Player</th><th class="l">Pos</th><th class="l">From</th><th class="l">To</th><th data-heat="1" title="Owned BPM, 2025-26">BPM</th><th data-heat="1">Pts/40</th><th data-heat="1">TS%</th><th data-heat="1">MPG</th><th title="Rating of his 2025-26 team">From rtg</th><th title="Rating of the program that took him">To rtg</th><th data-heat="1" title="What his profile usually produces at a program of this level (BPM)">Expected BPM</th><th title="What a typical transfer to a program of this level produces (BPM)">Typical</th><th title="Expected minus typical, in BPM">Gap</th></tr></thead><tbody>' +
          L.map(function (p, i) { return '<tr><td class="rk">' + (i + 1) + '</td><td class="l nm"><a href="' + pl(p) + '">' + esc(p.name) + '</a></td><td class="l dim">' + esc(p.pos || '') + '</td><td class="l dim">' + esc(sn(p.from)) + '</td><td class="l">' + esc(sn(p.to)) + '</td><td>' + p.bpm.toFixed(1) + '</td><td>' + p.pts40.toFixed(1) + '</td><td>' + p.ts.toFixed(1) + '</td><td>' + p.mpg.toFixed(1) + '</td><td class="dim">' + p.from_lvl.toFixed(1) + '</td><td class="dim">' + p.to_lvl.toFixed(1) + '</td><td class="big">' + p.exp_bpm.toFixed(1) + '</td><td class="dim">' + p.typ_bpm.toFixed(1) + '</td><td class="big" style="color:' + (p.gap >= 1.5 ? 'var(--green)' : p.gap <= -1.5 ? 'var(--red)' : 'var(--text2)') + '">' + (p.gap >= 0 ? '+' : '') + p.gap.toFixed(1) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      };
      var U = F.filter(function (p) { return p.gap > 0; }).sort(function (a, b) { return b.gap - a.gap; }), Ov = F.filter(function (p) { return p.gap < 0; }).sort(function (a, b) { return a.gap - b.gap; });
      host.querySelector('#miUnder').innerHTML = sheet(U.slice(0, CS.n)) + (U.length > CS.n ? '<button class="mi-more" data-more="1">Show more (' + U.length + ')</button>' : '');
      host.querySelector('#miOver').innerHTML = sheet(Ov.slice(0, CS.n)) + (Ov.length > CS.n ? '<button class="mi-more" data-more="1">Show more (' + Ov.length + ')</button>' : '');
      // programs: average gap of the incoming class
      var by = {}; F.forEach(function (p) { (by[p.to] = by[p.to] || []).push(p); });
      var TM = Object.keys(by).filter(function (k) { return by[k].length >= 2; }).map(function (k) { var L = by[k], m = L.reduce(function (s, p) { return s + p.gap; }, 0) / L.length, b = L.slice().sort(function (a, c) { return c.gap - a.gap; })[0];
        return { to: k, conf: L[0].toConf, n: L.length, m: m, lvl: L[0].to_lvl, best: b }; }).sort(function (a, b) { return b.m - a.m; });
      host.querySelector('#miTeams').innerHTML = TM.length ? '<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="rk">#</th><th class="l">Program</th><th class="l">League</th><th title="Program rating, 2025-26">Rating</th><th>Transfers</th><th data-heat="1" title="Average gap of the incoming transfers, in BPM">Avg gap</th><th class="l">Best pickup</th></tr></thead><tbody>' +
        TM.slice(0, Math.max(CS.n, 25)).map(function (t, i) { return '<tr><td class="rk">' + (i + 1) + '</td><td class="l nm">' + esc(sn(t.to)) + '</td><td class="l dim">' + esc(t.conf || '') + '</td><td class="dim">' + t.lvl.toFixed(1) + '</td><td>' + t.n + '</td><td class="big">' + (t.m >= 0 ? '+' : '') + t.m.toFixed(1) + '</td><td class="l">' + esc(t.best.name) + ' <span class="dim">' + (t.best.gap >= 0 ? '+' : '') + t.best.gap.toFixed(1) + '</span></td></tr>'; }).join('') + '</tbody></table></div>' : '';
      if (g.tdcSheetHeat) host.querySelectorAll('table.sheet').forEach(function (t) { g.tdcSheetHeat(t); });
      host.querySelectorAll('.mi-more').forEach(function (b) { b.onclick = function () { CS.n += 50; paint(); }; });
    };
    host.querySelector('#miQ').addEventListener('input', function (e) { CS.q = e.target.value; CS.n = 25; paint(); });
    host.querySelector('#miConf').addEventListener('change', function (e) { CS.conf = e.target.value; CS.n = 25; paint(); });
    paint();
  }

  function render(which, host, o) {
    if (!host) return; css();
    host.innerHTML = '<div class="loading">Loading every transfer since 2013…</div>';
    return load().then(function (D) {
      if (!D) { host.innerHTML = '<div class="loading">The market study is not available.</div>'; return; }
      if (which === 'class') renderClass(host, D, o); else renderMarket(host, D);
    });
  }
  g.TDC_MBMARKET = { render: render, load: load };
})(window);
