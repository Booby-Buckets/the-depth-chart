/* tdc-charttwin.js — SHOT CHART TWINS (owner, Nov 22 2026: "shot chart twins ... so you can see shot chart positions that
 * match up with other similar players").
 *
 * Data: scripts/data/chart_twins.json (scripts/build_chart_twins.py, from ESPN play-by-play shot locations): per
 * player-season attempts + makes in the shot chart's ten spots (tdc-shotchart.js zone10), shot types and assisted makes.
 * A player is matched on WHERE he shoots (share of his shots from each of the ten spots — weighted most), HOW (dunks,
 * floaters/hooks, off-the-dribble jumpers, share of makes assisted), how often (attempts per 40) and, lightly, how well
 * (rim / inside-the-arc / three make rates, shrunk toward the league). Features are z-scored over the whole pool;
 * match = 100·exp(−d²) where d is the weighted RMS gap (closest twins read ~80, a typical player ~60).
 * Each chart is a mosaic of the ten spots: orange = he shoots there more than D-I, blue = less, grey = about the same.
 *
 *   TDC_CHARTTWIN.render(host, {espn, season})      player page: his chart + his closest twins
 *   TDC_CHARTTWIN.duel(host, [{espn,season},{espn,season}])   compare page: two charts + how alike they are
 */
(function (g) {
  if (g.TDC_CHARTTWIN) return;
  var SRC = 'scripts/data/chart_twins.json?d=' + new Date().toISOString().slice(0, 10);
  var Z = ['rim', 'paint', 'midl', 'midc', 'midr', 'c3l', 'c3r', 'w3l', 'w3r', 't3'];
  var ZL = { rim: 'At the rim', paint: 'Paint (non-rim)', midl: 'Left mid-range', midc: 'Middle mid-range', midr: 'Right mid-range',
    c3l: 'Left corner 3', c3r: 'Right corner 3', w3l: 'Left wing 3', w3r: 'Right wing 3', t3: 'Top-of-the-key 3' };
  var W = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.6, 0.6, 0.6, 0.6, 0.8, 0.4, 0.4, 0.4];
  var P = null, loadP = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function load() {
    if (loadP) return loadP;
    loadP = fetch(SRC).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.rows) return null;
      var ix = {}; d.cols.forEach(function (c, i) { ix[c] = i; });
      var rows = d.rows.map(function (r) {
        var o = { espn: String(r[ix.espn]), name: r[ix.name], team: r[ix.team], season: r[ix.season], min: r[ix.min], g: r[ix.g], fga: r[ix.fga],
          made: r[ix.made], astM: r[ix.astM], a: Z.map(function (z) { return r[ix['a_' + z]]; }), m: Z.map(function (z) { return r[ix['m_' + z]]; }),
          t: d.meta.types.map(function (k) { return r[ix['t_' + k]]; }) };
        var L = (d.lg[String(o.season)] || d.lg['2026']).fg, f = o.fga, sh = function (M, A, p, k) { return (M + p * k) / (A + k); };
        var rimA = o.a[0], midA = o.a[1] + o.a[2] + o.a[3] + o.a[4], thA = f - rimA - midA;
        var rimM = o.m[0], midM = o.m[1] + o.m[2] + o.m[3] + o.m[4], thM = o.m.reduce(function (s, x) { return s + x; }, 0) - rimM - midM;
        o.x = o.a.map(function (x) { return x / f; }).concat([o.t[0] / f, o.t[3] / f, o.t[4] / f, o.astM / Math.max(1, o.made),
          Math.log(f / Math.max(1, o.min) * 40), sh(rimM, rimA, L[0], 20), sh(midM, midA, 0.42, 40), sh(thM, thA, 0.34, 60)]);
        return o;
      });
      var n = rows[0].x.length, mu = [], sd = [];
      for (var j = 0; j < n; j++) {
        var s = 0; rows.forEach(function (o) { s += o.x[j]; }); mu[j] = s / rows.length;
        var v = 0; rows.forEach(function (o) { v += (o.x[j] - mu[j]) * (o.x[j] - mu[j]); }); sd[j] = Math.sqrt(v / rows.length) || 1;
      }
      rows.forEach(function (o) { o.z = o.x.map(function (x, j) { return (x - mu[j]) / sd[j]; }); });
      var by = {}; rows.forEach(function (o) { (by[o.espn] = by[o.espn] || []).push(o); });
      P = { rows: rows, by: by, lg: d.lg, meta: d.meta };
      return P;
    }).catch(function () { return null; });
    return loadP;
  }
  var SW = W.reduce(function (a, b) { return a + b; }, 0);
  function score(a, b) { var s = 0; for (var j = 0; j < a.z.length; j++) { var d = a.z[j] - b.z[j]; s += W[j] * d * d; } var dd = Math.sqrt(s / SW); return Math.round(100 * Math.exp(-dd * dd)); }
  function rowOf(espn, season) {
    var L = P && P.by[String(espn)]; if (!L || !L.length) return null;
    if (season) { var e = L.filter(function (o) { return o.season === +season; })[0]; if (e) return e; }
    // default: this season once it has a real sample (100+ shots), else the season with the most shots
    var cur = L.filter(function (o) { return o.fga >= 100; }).sort(function (a, b) { return b.season - a.season; })[0];
    return cur || L.slice().sort(function (a, b) { return b.fga - a.fga; })[0];
  }
  function twins(me, n) {
    var best = {};
    P.rows.forEach(function (o) { if (o.espn === me.espn) return; var s = score(me, o); if (!best[o.espn] || s > best[o.espn].s) best[o.espn] = { o: o, s: s }; });
    return Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) { return b.s - a.s; }).slice(0, n || 6);
  }
  function sLbl(y) { y = +y; return (y - 1) + '-' + String(y).slice(2); }
  function share(o, k) { return o.a[k] / o.fga; }
  function ratio(o, k) { var lg = (P.lg[String(o.season)] || P.lg['2026']).share[k] || 0.01; return share(o, k) / lg; }
  // standout spots: the two biggest "more than D-I" spots that carry real volume
  function spots(o, n) {
    return Z.map(function (z, k) { return { z: z, k: k, r: ratio(o, k), s: share(o, k) }; }).filter(function (x) { return x.s >= 0.05 && x.r >= 1.2; })
      .sort(function (a, b) { return b.r - a.r; }).slice(0, n || 2);
  }

  // ── the mosaic court ──
  var HX = 25, HY = 5.25, R3 = 22.15, CX = 3.35, CY = HY + Math.sqrt(R3 * R3 - (HX - CX) * (HX - CX)), YM = 31;
  function zoneAt(x, y) {
    var three = y <= CY ? (x < CX || x > 50 - CX) : Math.hypot(x - HX, y - HY) > R3;
    if (three) return y <= CY - 0.4 ? (x < HX ? 'c3l' : 'c3r') : (x < 19 ? 'w3l' : (x > 31 ? 'w3r' : 't3'));
    if (Math.hypot(x - HX, y - HY) <= 4) return 'rim';
    if (x >= 19 && x <= 31 && y <= 19) return 'paint';
    return x < 19 ? 'midl' : (x > 31 ? 'midr' : 'midc');
  }
  var UID = 0;
  // the ten spots as real shapes (clip paths): threes outside the arc, the mid-range inside it, then the paint and the rim
  function court(o, opts) {
    opts = opts || {}; var S = 10, u = 'ctw' + (++UID);
    var col = Z.map(function (z, k) {
      var r = o.a[k] ? ratio(o, k) : 0.2, t = Math.max(-1, Math.min(1, Math.log(r) / Math.log(2.5)));
      if (Math.abs(t) < 0.12) return 'var(--ctw-mid)';
      return (t > 0 ? 'rgba(224,122,46,' : 'rgba(59,130,196,') + (0.18 + 0.72 * Math.abs(t)).toFixed(2) + ')';
    });
    var C = function (z) { return col[Z.indexOf(z)]; };
    var Y = function (y) { return (YM - y) * S; }, X = function (x) { return x * S; };
    var arc = 'M ' + X(CX) + ' ' + Y(-1) + ' L ' + X(CX) + ' ' + Y(CY) + ' A ' + R3 * S + ' ' + R3 * S + ' 0 0 1 ' + X(50 - CX) + ' ' + Y(CY) + ' L ' + X(50 - CX) + ' ' + Y(-1) + ' Z';
    var box = 'M 0 0 H ' + X(50) + ' V ' + Y(-1) + ' H 0 Z';
    var rect = function (x0, y0, x1, y1, f) { return '<rect x="' + X(x0) + '" y="' + Y(y1) + '" width="' + X(x1 - x0) + '" height="' + (Y(y0) - Y(y1)) + '" fill="' + f + '"/>'; };
    var g = '<svg class="ctw-svg" viewBox="0 0 ' + 50 * S + ' ' + YM * S + '" role="img" aria-label="' + esc(o.name) + ' shot chart by spot">' +
      '<defs><clipPath id="' + u + 'i"><path d="' + arc + '"/></clipPath><clipPath id="' + u + 'o"><path fill-rule="evenodd" clip-rule="evenodd" d="' + box + ' ' + arc + '"/></clipPath></defs>' +
      '<rect width="' + 50 * S + '" height="' + YM * S + '" fill="var(--ctw-floor)"/>' +
      '<g clip-path="url(#' + u + 'o)">' + rect(0, -1, 19, YM, C('w3l')) + rect(19, -1, 31, YM, C('t3')) + rect(31, -1, 50, YM, C('w3r')) +
        rect(0, -1, CX, CY - 0.4, 'var(--ctw-floor)') + rect(0, -1, CX, CY - 0.4, C('c3l')) + rect(50 - CX, -1, 50, CY - 0.4, 'var(--ctw-floor)') + rect(50 - CX, -1, 50, CY - 0.4, C('c3r')) + '</g>' +
      '<g clip-path="url(#' + u + 'i)">' + rect(0, -1, 19, YM, C('midl')) + rect(19, -1, 31, YM, C('midc')) + rect(31, -1, 50, YM, C('midr')) +
        rect(19, -1, 31, 19, 'var(--ctw-floor)') + rect(19, -1, 31, 19, C('paint')) +
        '<circle cx="' + X(HX) + '" cy="' + Y(HY) + '" r="' + 4 * S + '" fill="var(--ctw-floor)"/><circle cx="' + X(HX) + '" cy="' + Y(HY) + '" r="' + 4 * S + '" fill="' + C('rim') + '"/></g>';
    g += '<g fill="none" stroke="var(--ctw-line)" stroke-width="2.2">' +
      '<path d="M ' + X(CX) + ' ' + Y(0) + ' L ' + X(CX) + ' ' + Y(CY) + ' A ' + R3 * S + ' ' + R3 * S + ' 0 0 1 ' + X(50 - CX) + ' ' + Y(CY) + ' L ' + X(50 - CX) + ' ' + Y(0) + '"/>' +
      '<rect x="' + X(19) + '" y="' + Y(19) + '" width="' + X(12) + '" height="' + X(19) + '"/>' +
      '<circle cx="' + X(HX) + '" cy="' + Y(HY) + '" r="' + 4 * S + '"/>' +
      '<circle cx="' + X(HX) + '" cy="' + Y(HY) + '" r="7" stroke="#E07A2E" stroke-width="3"/>' +
      '<line x1="' + X(22) + '" y1="' + Y(4) + '" x2="' + X(28) + '" y2="' + Y(4) + '" stroke-width="3"/>' +
      '<line x1="0" y1="' + Y(CY - 0.4) + '" x2="' + X(CX) + '" y2="' + Y(CY - 0.4) + '" stroke-dasharray="4 5" stroke-width="1.4"/>' +
      '<line x1="' + X(50 - CX) + '" y1="' + Y(CY - 0.4) + '" x2="' + X(50) + '" y2="' + Y(CY - 0.4) + '" stroke-dasharray="4 5" stroke-width="1.4"/></g>';
    if (opts.labels) {
      var AT = { rim: [25, 2.2], paint: [25, 13.5], midl: [11.5, 12], midc: [25, 22.5], midr: [38.5, 12], c3l: [1.7, 4.5], c3r: [48.3, 4.5], w3l: [6.5, 24.5], w3r: [43.5, 24.5], t3: [25, 29] };
      Z.forEach(function (z, k) { if (!o.a[k]) return; var p = AT[z];
        g += '<text x="' + p[0] * S + '" y="' + Y(p[1]) + '" text-anchor="middle" dominant-baseline="middle" class="ctw-lab">' + Math.round(share(o, k) * 100) + '%</text>'; });
    }
    return g + '</svg>';
  }
  function css() {
    if (document.getElementById('ctw-css')) return;
    var s = document.createElement('style'); s.id = 'ctw-css';
    s.textContent = '.ctw{--ctw-floor:var(--bg2);--ctw-mid:color-mix(in srgb,var(--text3) 22%,var(--bg2));--ctw-line:color-mix(in srgb,var(--text) 55%,transparent);font-family:Inter,system-ui,sans-serif;}' +
      '.ctw-svg{display:block;width:100%;height:auto;border-radius:8px;}' +
      '.ctw-lab{font:800 22px Inter,system-ui,sans-serif;fill:var(--text);paint-order:stroke;stroke:var(--bg);stroke-width:5px;}' +
      '.ctw-top{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:18px;align-items:start;}' +
      '.ctw-me{border:1px solid var(--border);border-radius:12px;background:var(--panel,var(--bg));padding:12px;}' +
      '.ctw-me h4,.ctw-c h4{margin:0 0 2px;font:800 14px/1.25 Inter,system-ui,sans-serif;color:var(--text);}' +
      '.ctw-sub{font:600 11.5px/1.35 Inter,system-ui,sans-serif;color:var(--text3);margin:0 0 8px;}' +
      '.ctw-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}' +
      '.ctw-c{display:block;border:1px solid var(--border);border-radius:12px;background:var(--panel,var(--bg));padding:10px;text-decoration:none;color:inherit;}' +
      '.ctw-c:hover{border-color:var(--accent);}' +
      '.ctw-c h4{display:flex;justify-content:space-between;gap:8px;align-items:baseline;}' +
      '.ctw-c h4 b{font:800 15px Inter,system-ui,sans-serif;color:var(--accent);white-space:nowrap;}' +
      '.ctw-c .ctw-sp{font:600 11px/1.35 Inter,system-ui,sans-serif;color:var(--text2);margin-top:6px;}' +
      '.ctw-key{display:flex;gap:14px;flex-wrap:wrap;font:600 11px Inter,system-ui,sans-serif;color:var(--text3);margin:10px 0 0;}' +
      '.ctw-key i{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:5px;}' +
      '.ctw-chips{display:flex;gap:4px;margin:0 0 8px;flex-wrap:wrap;}.ctw-chips button{font:700 11px Inter,system-ui,sans-serif;border:1px solid var(--border2);background:var(--bg);color:var(--text2);border-radius:999px;padding:3px 10px;cursor:pointer;}.ctw-chips button.on{background:var(--text);color:var(--bg);border-color:var(--text);}' +
      '.ctw-duel .ctw-svg{max-width:440px;margin:0 auto;}' +
      '.ctw-duel{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;}' +
      '.ctw-score{font:800 13px Inter,system-ui,sans-serif;color:var(--text);margin:0 0 12px;}.ctw-score b{font-size:22px;color:var(--accent);margin-right:6px;}' +
      '.ctw-none{padding:18px;color:var(--text3);font-size:13px;border:1px dashed var(--border2);border-radius:12px;}' +
      '@media(max-width:900px){.ctw-top{grid-template-columns:1fr;}.ctw-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}' +
      '@media(max-width:520px){.ctw-grid,.ctw-duel{grid-template-columns:1fr 1fr;gap:8px;}.ctw-c{padding:8px;}.ctw-c h4{font-size:12.5px;}.ctw-c h4 b{font-size:13px;}}';
    document.head.appendChild(s);
  }
  var KEY = '<div class="ctw-key"><span><i style="background:rgba(224,122,46,.8)"></i>shoots there more than D-I</span><span><i style="background:var(--ctw-mid)"></i>about the same</span><span><i style="background:rgba(59,130,196,.8)"></i>less</span></div>';
  function line(o) { return esc(o.team) + ' · ' + sLbl(o.season) + ' · ' + o.fga + ' shots'; }
  function spotTxt(o) { var s = spots(o, 2); return s.length ? s.map(function (x) { return ZL[x.z] + ' ' + Math.round(x.s * 100) + '%'; }).join(' · ') : 'Balanced, close to the D-I spread'; }
  function href(o) { return 'player.html?espn=' + encodeURIComponent(o.espn); }

  function render(host, opts) {
    if (!host) return Promise.resolve();
    css(); host.classList.add('ctw'); host.innerHTML = '<div class="ctw-none">Loading shot charts…</div>';
    return load().then(function () {
      var me = P && rowOf(opts && opts.espn, opts && opts.season);
      if (!me) { host.innerHTML = '<div class="ctw-none">No shot chart twin yet — he needs about ' + ((P && P.meta.min_fga['2026']) || 100) + ' logged shots in a season with shot locations (2025-26 onward; ' + ((P && P.meta.min_fga['2027']) || 35) + ' this season).</div>'; return; }
      var T = twins(me, 6), mine = (P.by[me.espn] || []).slice().sort(function (a, b) { return b.season - a.season; });
      var chips = mine.length > 1 ? '<div class="ctw-chips">' + mine.map(function (o) { return '<button type="button" data-s="' + o.season + '" class="' + (o === me ? 'on' : '') + '">' + sLbl(o.season) + '</button>'; }).join('') + '</div>' : '';
      host.innerHTML = '<div class="ctw-top"><div class="ctw-me"><h4>' + esc(me.name) + '</h4><div class="ctw-sub">' + line(me) + '</div>' + chips + court(me, { labels: true }) + KEY + '</div>' +
        '<div><div class="ctw-sub" style="margin-bottom:10px">Players whose shot charts look most like his: the same spots on the floor, the same kinds of shots, similar volume. Match is out of 100.</div><div class="ctw-grid">' +
        T.map(function (x) { var o = x.o; return '<a class="ctw-c" href="' + href(o) + '" data-nobio><h4><span>' + esc(o.name) + '</span><b>' + x.s + '</b></h4><div class="ctw-sub">' + line(o) + '</div>' + court(o) + '<div class="ctw-sp">' + esc(spotTxt(o)) + '</div></a>'; }).join('') +
        '</div></div></div>';
      host.querySelectorAll('.ctw-chips button').forEach(function (b) { b.onclick = function () { render(host, { espn: me.espn, season: +b.dataset.s }); }; });
    });
  }
  function duel(host, list) {
    if (!host) return Promise.resolve();
    css(); host.classList.add('ctw'); host.innerHTML = '<div class="ctw-none">Loading shot charts…</div>';
    return load().then(function () {
      var A = P && rowOf(list[0] && list[0].espn, list[0] && list[0].season), B = P && rowOf(list[1] && list[1].espn, list[1] && list[1].season);
      if (!A || !B) { host.innerHTML = '<div class="ctw-none">Shot chart twins need both players to have a season with shot locations (2025-26 onward).</div>'; return; }
      var s = score(A, B), all = twins(A, 1e9), rk = 1 + all.filter(function (x) { return x.o.espn !== B.espn && x.s > s; }).length;
      var card = function (o) { var tw = twins(o, 3); return '<div class="ctw-me"><h4>' + esc(o.name) + '</h4><div class="ctw-sub">' + line(o) + '</div>' + court(o, { labels: true }) +
        '<div class="ctw-sp" style="font:600 11.5px/1.4 Inter,system-ui,sans-serif;color:var(--text2);margin-top:8px">Shoots like: ' + tw.map(function (x) { return '<a href="' + href(x.o) + '" data-nobio>' + esc(x.o.name) + '</a> ' + x.s; }).join(' · ') + '</div></div>'; };
      host.innerHTML = '<div class="ctw-score"><b>' + s + '</b>shot chart match · ' + esc(B.name) + ' is ' + esc(A.name) + '\u2019s #' + rk + ' closest of ' + all.length.toLocaleString() + ' players</div>' +
        '<div class="ctw-duel">' + card(A) + card(B) + '</div>' + KEY;
    });
  }
  g.TDC_CHARTTWIN = { render: render, duel: duel, load: load };
})(window);
