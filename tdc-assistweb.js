/* tdc-assistweb.js — a team's passing drawn three ways, from scripts/data/assist_web/<season>.json
 * (build_assist_web.py: every assisted basket, passer -> shooter -> shot type).
 *   TDC_ASSISTWEB.load(season)                         -> Promise<doc|null>
 *   TDC_ASSISTWEB.web(host, team, opt)     the web: players on a ring, one line per pair of players (no arrows), width = assists both ways
 *   TDC_ASSISTWEB.matrix(host, team, opt)  passer x shooter sheet (tdc-sheets), shaded by count
 *   TDC_ASSISTWEB.flow(host, team, opt)    passer -> shooter -> shot type ribbons
 * team = one entry of doc.teams; opt = {name (full team name, for colour), minAst}
 */
(function (g) {
  var V = '1', cache = {};
  function load(y) { return cache[y] || (cache[y] = fetch('scripts/data/assist_web/' + y + '.json?v=' + V).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })); }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var ZL = ['Rim', 'Putback', 'Mid-range', 'Three'];
  function color(name) {
    var c = window.tdcTeamColor && tdcTeamColor(name), h = (c && (c.c1 || c.color)) || '#A8843C';
    var n = parseInt(String(h).replace('#', ''), 16), r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255, l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    if (l < 40 || l > 225) { var h2 = c && c.c2; if (h2) { var n2 = parseInt(String(h2).replace('#', ''), 16); r = (n2 >> 16) & 255; gg = (n2 >> 8) & 255; b = n2 & 255; } }
    return [r, gg, b];
  }
  var rgba = function (c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; };
  // "C. Boozer": an initial + last name, so two Boozers stay apart
  var last = function (n) { var w = String(n || '').split(' ').filter(function (x) { return !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(x); }); return w.length > 1 ? w[0][0] + '. ' + w.slice(1).join(' ') : (n || ''); };
  function people(T) {
    var give = {}, get = {};
    T.pairs.forEach(function (p) { give[p[0]] = (give[p[0]] || 0) + p[2]; get[p[1]] = (get[p[1]] || 0) + p[2]; });
    var ids = Object.keys(T.players).filter(function (id) { return (give[id] || 0) + (get[id] || 0) >= 6; });
    ids.sort(function (a, b) { return ((give[b] || 0) + (get[b] || 0)) - ((give[a] || 0) + (get[a] || 0)); });
    // short labels: "C. Boozer"; two the same (Cameron / Cayden Boozer) get more of the first name, "Cam. Boozer"
    var lab = {}, seen = {};
    Object.keys(T.players).forEach(function (id) { var l = last(T.players[id]); (seen[l] = seen[l] || []).push(id); });
    Object.keys(seen).forEach(function (l) {
      seen[l].forEach(function (id) {
        if (seen[l].length < 2) { lab[id] = l; return; }
        var w = String(T.players[id]).split(' '); lab[id] = w[0].slice(0, 3) + '. ' + w.slice(1).filter(function (x) { return !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(x); }).join(' ');
      });
    });
    return { ids: ids.slice(0, 11), give: give, get: get, lab: lab };
  }

  function web(host, T, opt) {
    opt = opt || {};
    var P = people(T), ids = P.ids, n = ids.length, W = 560, H = 480, cx = W / 2, cy = H / 2 + 6, R = 168, col = color(opt.name);
    var pos = {}; ids.forEach(function (id, i) { var a = -Math.PI / 2 + 2 * Math.PI * i / n; pos[id] = [cx + R * Math.cos(a), cy + R * Math.sin(a), a]; });
    var maxV = Math.max.apply(null, ids.map(function (id) { return (P.give[id] || 0) + (P.get[id] || 0); }));
    var rad = function (id) { return 9 + 17 * Math.sqrt(((P.give[id] || 0) + (P.get[id] || 0)) / maxV); };
    // no arrows (owner, Oct 21): each pair of players is ONE line, width = assists both ways; the strongest 16 links only
    // (a deep team has 50+ pairs with 3+ assists, and drawing them all is a hairball)
    var link = {};
    T.pairs.forEach(function (p) {
      if (!pos[p[0]] || !pos[p[1]] || p[0] === p[1]) return;
      var k = p[0] < p[1] ? p[0] + '|' + p[1] : p[1] + '|' + p[0], o = link[k] || (link[k] = { a: p[0] < p[1] ? p[0] : p[1], b: p[0] < p[1] ? p[1] : p[0], n: 0, ab: 0, ba: 0 });
      o.n += p[2]; if (p[0] === o.a) o.ab += p[2]; else o.ba += p[2];
    });
    var links = Object.keys(link).map(function (k) { return link[k]; }).filter(function (o) { return o.n >= (opt.minAst || 3); })
      .sort(function (x, y) { return y.n - x.n; }).slice(0, opt.maxEdges || 16);
    var mx = Math.max.apply(null, links.map(function (o) { return o.n; }).concat([1]));
    var edges = links.slice().reverse().map(function (o) {
      var a = pos[o.a], b = pos[o.b], mxp = (a[0] + b[0]) / 2 * 0.85 + cx * 0.15, myp = (a[1] + b[1]) / 2 * 0.85 + cy * 0.15;   // a slight bow toward the centre
      var w = 1 + 9 * o.n / mx, op = 0.25 + 0.6 * o.n / mx;
      return '<path d="M' + a[0].toFixed(1) + ',' + a[1].toFixed(1) + ' Q' + mxp.toFixed(1) + ',' + myp.toFixed(1) + ' ' + b[0].toFixed(1) + ',' + b[1].toFixed(1) + '" fill="none" stroke="' + rgba(col, op.toFixed(2)) + '" stroke-width="' + w.toFixed(1) + '" stroke-linecap="round"><title>' +
        esc(T.players[o.a]) + ' \u2192 ' + esc(T.players[o.b]) + ': ' + o.ab + ' \u00b7 ' + esc(T.players[o.b]) + ' \u2192 ' + esc(T.players[o.a]) + ': ' + o.ba + '</title></path>';
    }).join('');
    var nodes = ids.map(function (id) {
      var p = pos[id], r = rad(id), lx = cx + (R + r + 16) * Math.cos(p[2]), ly = cy + (R + r + 14) * Math.sin(p[2]), anc = Math.cos(p[2]) > 0.25 ? 'start' : Math.cos(p[2]) < -0.25 ? 'end' : 'middle';
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + rgba(col, 0.92) + '" stroke="var(--bg)" stroke-width="2"><title>' + esc(T.players[id]) + ': ' + (P.give[id] || 0) + ' assists given, ' + (P.get[id] || 0) + ' assisted baskets</title></circle>' +
        '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + anc + '" class="aw-nm">' + esc(P.lab[id]) + '</text>' +
        '<text x="' + lx.toFixed(1) + '" y="' + (ly + 12).toFixed(1) + '" text-anchor="' + anc + '" class="aw-sub">' + (P.give[id] || 0) + ' ast · ' + (P.get[id] || 0) + ' fed</text>';
    }).join('');
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="aw-svg" role="img" aria-label="Assist web">' + edges + nodes + '</svg>';
  }

  function matrix(host, T, opt) {
    var P = people(T), give = Object.keys(P.give).filter(function (id) { return T.players[id]; }).sort(function (a, b) { return P.give[b] - P.give[a]; }).slice(0, 8);
    var get = Object.keys(P.get).filter(function (id) { return T.players[id]; }).sort(function (a, b) { return P.get[b] - P.get[a]; }).slice(0, 8);
    var M = {}; T.pairs.forEach(function (p) { M[p[0] + '>' + p[1]] = p; });
    var mx = Math.max.apply(null, T.pairs.map(function (p) { return p[2]; }).concat([1]));
    var cls = function (v) { if (!v) return ''; var f = v / mx; return f >= 0.6 ? 'c4' : f >= 0.35 ? 'c3' : f >= 0.15 ? 'c2' : ''; };
    host.innerHTML = '<div class="sheet-wrap" style="max-height:none"><table class="sheet dense aw-mx"><thead><tr><th class="l">Passer ↓ · Shooter →</th>' +
      get.map(function (id) { return '<th title="' + esc(T.players[id]) + '">' + esc(P.lab[id]) + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>' +
      give.map(function (a) {
        return '<tr><td class="l"><b>' + esc(T.players[a]) + '</b></td>' + get.map(function (b) { var p = M[a + '>' + b], v = p ? p[2] : 0; return '<td class="' + cls(v) + '"' + (p ? ' title="' + p[3] + ' points: ' + p[4].map(function (z, i) { return z ? z + ' ' + ZL[i].toLowerCase() : ''; }).filter(Boolean).join(', ') + '"' : '') + '>' + (a === b ? '<span class="dim">—</span>' : (v || '')) + '</td>'; }).join('') + '<td><b>' + P.give[a] + '</b></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function flow(host, T, opt) {
    opt = opt || {};
    var col = color(opt.name), P = people(T);
    var give = Object.keys(P.give).filter(function (id) { return T.players[id]; }).sort(function (a, b) { return P.give[b] - P.give[a]; }).slice(0, 7);
    var get = Object.keys(P.get).filter(function (id) { return T.players[id]; }).sort(function (a, b) { return P.get[b] - P.get[a]; }).slice(0, 7);
    var gs = {}, ts = {}; give.forEach(function (x) { gs[x] = 1; }); get.forEach(function (x) { ts[x] = 1; });
    var pairs = T.pairs.filter(function (p) { return gs[p[0]] && ts[p[1]] && p[0] !== p[1]; });
    var W = 640, H = 420, pad = 6, x0 = 150, x1 = 330, x2 = 500, nw = 12;
    var tot = pairs.reduce(function (a, p) { return a + p[2]; }, 0) || 1, k = (H - 20 - pad * 7) / tot;
    var stack = function (keys, val) { var y = 10, o = {}; keys.forEach(function (key) { var h = val[key] * k; o[key] = { y: y, h: h, off: 0, offOut: 0 }; y += h + pad; }); return o; };
    var gv = {}, tv = {}, zv = [0, 0, 0, 0], tz = {};
    pairs.forEach(function (p) { gv[p[0]] = (gv[p[0]] || 0) + p[2]; tv[p[1]] = (tv[p[1]] || 0) + p[2]; tz[p[1]] = tz[p[1]] || [0, 0, 0, 0]; p[4].forEach(function (z, i) { zv[i] += z; tz[p[1]][i] += z; }); });
    give = give.filter(function (x) { return gv[x]; }); get = get.filter(function (x) { return tv[x]; });
    var A = stack(give, gv), B = stack(get, tv), zk = [0, 1, 2, 3].filter(function (i) { return zv[i]; }), zo = {}; zk.forEach(function (i) { zo[i] = zv[i]; });
    var C = stack(zk, zo);
    var rib = function (xa, ya, xb, yb, h, c, t) { var m = (xa + xb) / 2; return '<path d="M' + xa + ',' + ya + ' C' + m + ',' + ya + ' ' + m + ',' + yb + ' ' + xb + ',' + yb + ' L' + xb + ',' + (yb + h) + ' C' + m + ',' + (yb + h) + ' ' + m + ',' + (ya + h) + ' ' + xa + ',' + (ya + h) + ' Z" fill="' + c + '"><title>' + t + '</title></path>'; };
    var out = '';
    pairs.sort(function (a, b) { return give.indexOf(a[0]) - give.indexOf(b[0]) || get.indexOf(a[1]) - get.indexOf(b[1]); }).forEach(function (p) {
      var h = p[2] * k, a = A[p[0]], b = B[p[1]];
      out += rib(x0 + nw, a.y + a.offOut, x1, b.y + b.off, h, rgba(col, 0.32), esc(T.players[p[0]]) + ' → ' + esc(T.players[p[1]]) + ': ' + p[2]);
      a.offOut += h; b.off += h;
    });
    var zc = [[46, 139, 87], [120, 160, 90], [198, 168, 112], [168, 132, 60]];
    get.forEach(function (s) { zk.forEach(function (i) { var v = tz[s][i]; if (!v) return; var h = v * k, b = B[s], c = C[i]; out += rib(x1 + nw, b.y + b.offOut, x2, c.y + c.off, h, rgba(zc[i], 0.42), esc(T.players[s]) + ': ' + v + ' ' + ZL[i].toLowerCase()); b.offOut += h; c.off += h; }); });
    var node = function (x, o, key, lab, side) { return '<rect x="' + x + '" y="' + o.y.toFixed(1) + '" width="' + nw + '" height="' + Math.max(1, o.h).toFixed(1) + '" fill="' + rgba(col, 0.95) + '"/>' + (o.h >= 9 ? '<text x="' + (side === 'l' ? x - 6 : x + nw + 6) + '" y="' + (o.y + o.h / 2 + 4).toFixed(1) + '" text-anchor="' + (side === 'l' ? 'end' : 'start') + '" class="aw-nm">' + esc(lab) + '</text>' : ''); };
    give.forEach(function (x) { out += node(x0, A[x], x, P.lab[x] + ' ' + gv[x], 'l'); });
    get.forEach(function (x) { out += node(x1, B[x], x, '', 'r'); });
    get.forEach(function (x) { var o = B[x]; if (o.h >= 9) out += '<text x="' + (x1 + nw / 2) + '" y="' + (o.y - 2).toFixed(1) + '" text-anchor="middle" class="aw-sub">' + esc(P.lab[x]) + '</text>'; });
    zk.forEach(function (i) { var o = C[i]; out += '<rect x="' + x2 + '" y="' + o.y.toFixed(1) + '" width="' + nw + '" height="' + o.h.toFixed(1) + '" fill="' + rgba(zc[i], 0.95) + '"/><text x="' + (x2 + nw + 6) + '" y="' + (o.y + o.h / 2 + 4).toFixed(1) + '" class="aw-nm">' + ZL[i] + ' ' + zv[i] + '</text>'; });
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="aw-svg" role="img" aria-label="Assist flow"><text x="' + (x0 + nw / 2) + '" y="' + (H - 2) + '" text-anchor="middle" class="aw-h">Passer</text><text x="' + (x1 + nw / 2) + '" y="' + (H - 2) + '" text-anchor="middle" class="aw-h">Shooter</text><text x="' + (x2 + nw / 2) + '" y="' + (H - 2) + '" text-anchor="middle" class="aw-h">Shot</text>' + out + '</svg>';
  }
  var CSS = '.aw-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 10px}' +
    '.aw-sw{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--border);border-radius:9px;background:var(--bg2)}.aw-sw button{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;padding:6px 12px;border:0;border-radius:7px;background:none;color:var(--text3);cursor:pointer}.aw-sw button.on{background:var(--accent);color:var(--accent-on,#221c08)}' +
    '.aw-sel{font:600 12px Inter,system-ui,sans-serif;background:var(--bg);border:1px solid var(--border2,var(--border));color:var(--text);padding:5px 9px;border-radius:7px}' +
    '.aw-stats{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:12px}.aw-st{padding:7px 9px;border-right:1px solid var(--border)}.aw-st:last-child{border-right:0}.aw-st span{display:block;font-size:9.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)}.aw-st b{display:block;font-size:17px;font-weight:800;font-variant-numeric:tabular-nums}.aw-st i{font-style:normal;font-size:10px;color:var(--text3);font-weight:600}' +
    '@media(max-width:820px){.aw-stats{grid-template-columns:repeat(4,minmax(0,1fr))}.aw-st:nth-child(4n){border-right:0}.aw-st:nth-child(-n+4){border-bottom:1px solid var(--border)}}' +
    '.aw-empty{padding:24px;text-align:center;color:var(--text3);font-size:13px}' +
    '.aw-svg{width:100%;max-width:640px;height:auto;display:block}.aw-nm{font:600 11.5px Inter,system-ui,sans-serif;fill:var(--text)}.aw-sub{font:600 9.5px Inter,system-ui,sans-serif;fill:var(--text3)}.aw-h{font:800 9.5px Inter,system-ui,sans-serif;fill:var(--text3);letter-spacing:.08em;text-transform:uppercase}';
  if (typeof document !== 'undefined' && !document.getElementById('aw-css')) { var st = document.createElement('style'); st.id = 'aw-css'; st.textContent = CSS; document.head.appendChild(st); }
  // the component: a Web / Sheet / Flow switch (remembered per browser) + the team's passing numbers with D-I ranks.
  //   render(host, doc, teamKey, {seasons:[...], season, onSeason(y)})
  var VIEWS = [['web', 'Web'], ['sheet', 'Sheet'], ['flow', 'Flow']];
  function render(host, doc, key, opt) {
    opt = opt || {};
    var T = doc && doc.teams[key];
    if (!T) { host.innerHTML = '<div class="aw-empty">No passing data for this team' + (doc ? ' in ' + (doc.season - 1) + '-' + String(doc.season).slice(2) : '') + '.</div>'; return; }
    var view = 'web'; try { view = localStorage.getItem('tdc_aw_view') || 'web'; } catch (e) {}
    var all = Object.keys(doc.teams).map(function (k) { return doc.teams[k]; }), N = all.length;
    var rk = function (k, hi) { return 1 + all.filter(function (x) { return hi ? x[k] > T[k] : x[k] < T[k]; }).length; };
    var ord = function (n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
    var stat = function (lab, v, r, tip) { return '<div class="aw-st" title="' + esc(tip) + '"><span>' + lab + '</span><b>' + v + '</b>' + (r ? '<i>' + ord(r) + ' of ' + N + '</i>' : '') + '</div>'; };
    var stats = '<div class="aw-stats">' +
      stat('Assists', T.ast, 0, 'Assisted baskets this season') +
      stat('Assisted', Math.round(100 * T.assisted_rate) + '%', rk('assisted_rate', 1), 'Share of made field goals that were assisted') +
      stat('Passing combos', T.combos, rk('combos', 1), 'Different passer \u2192 shooter pairs that connected at least once') +
      stat('Effective combos', T.eff_combos, rk('eff_combos', 1), 'How many equally used pairs the passing behaves like (more = spread around)') +
      stat('Shot combos', T.shot_combos, rk('shot_combos', 1), 'Passer \u2192 shooter \u2192 shot type combinations used twice or more') +
      stat('Top passer', Math.round(100 * T.top1) + '%', rk('top1', 1), 'Share of all assists from the busiest passer (1st = the most one-man passing core)') +
      stat('Top two', Math.round(100 * T.top2) + '%', rk('top2', 1), 'Share of all assists from the two busiest passers') +
      stat('Busiest pair', Math.round(100 * T.top_pair) + '%', rk('top_pair', 1), 'Share of all assists from the single most-used passer \u2192 shooter pair') + '</div>';
    var sw = '<div class="aw-sw">' + VIEWS.map(function (v) { return '<button data-aw="' + v[0] + '" class="' + (v[0] === view ? 'on' : '') + '">' + v[1] + '</button>'; }).join('') + '</div>';
    var ss = opt.seasons && opt.seasons.length > 1 ? '<select class="aw-sel" data-aws="1">' + opt.seasons.map(function (y) { return '<option value="' + y + '"' + (+y === +doc.season ? ' selected' : '') + '>' + (y - 1) + '-' + String(y).slice(2) + '</option>'; }).join('') + '</select>' : '';
    host.innerHTML = '<div class="aw-bar">' + sw + ss + '</div>' + stats + '<div class="aw-view"></div>';
    var vh = host.querySelector('.aw-view');
    ({ web: web, sheet: matrix, flow: flow })[view](vh, T, { name: key });
    host.querySelectorAll('[data-aw]').forEach(function (b) { b.addEventListener('click', function () { try { localStorage.setItem('tdc_aw_view', b.getAttribute('data-aw')); } catch (e) {} render(host, doc, key, opt); }); });
    var sel = host.querySelector('[data-aws]'); if (sel && opt.onSeason) sel.addEventListener('change', function () { opt.onSeason(+sel.value); });
  }
  function index() { return fetch('scripts/data/assist_web/index.json?t=' + Math.floor(Date.now() / 3.6e6)).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { return (j && j.seasons) || [2026, 2025, 2024, 2023]; }).catch(function () { return [2026, 2025, 2024, 2023]; }); }
  function keyFor(doc, espnId, name) {
    var ks = Object.keys(doc.teams);
    return ks.find(function (k) { return String(doc.teams[k].id) === String(espnId); }) || ks.find(function (k) { return k === name; }) || null;
  }
  g.TDC_ASSISTWEB = { load: load, web: web, matrix: matrix, flow: flow, people: people, render: render, index: index, keyFor: keyFor };
})(window);
