/* tdc-fingerprint.js — the Skill Fingerprint: a player's value split into 15 skills, in points per 100
 * possessions on the floor, schedule-adjusted (scripts/build_fingerprint.py -> scripts/data/fingerprint/<y>.json).
 *
 *   TDCFingerprint.load(2026)                  -> Promise<doc|null>
 *   TDCFingerprint.seasonsFor(espn)            -> Promise<[years the player has a fingerprint]>
 *   TDCFingerprint.render(host, espn, opt)     -> draws the sheet (opt.banner(verdict, sentence) = the read line)
 *   TDCFingerprint.read(doc, row)              -> {verdict, sentence, strengths, weakness}
 *
 * Scale toggle: Percentile (every skill against D-I, all run to 100) or True value (points per 100 above the D-I
 * average on one common axis, so a skill that is worth more draws bigger). Sorts: skill groups, impact spread
 * (the skills that separate players most first) and player strengths.
 */
(function (g) {
  var V = '1', SEASONS = [2026, 2025], cache = {};
  function load(y) {
    return cache[y] || (cache[y] = fetch('scripts/data/fingerprint/' + y + '.json?v=' + V)
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }));
  }
  function seasonsFor(espn) {
    return Promise.all(SEASONS.map(load)).then(function (ds) {
      return SEASONS.filter(function (y, i) { return ds[i] && ds[i].players && ds[i].players[String(espn)]; });
    });
  }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var sgn = function (v, d) { v = +v; return (v > 0.05 ? '+' : v < -0.05 ? '−' : '') + Math.abs(v).toFixed(d == null ? 1 : d); };
  var bucket = function (p) { return p == null ? '' : p >= 80 ? 'c4' : p >= 60 ? 'c3' : p >= 40 ? 'c2' : p >= 20 ? 'c1' : 'c0'; };
  var ord = function (n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  var PLAIN = { rim: 'finishing at the rim', put: 'putbacks', mid: 'mid-range shooting', three: 'three-point shooting', ft: 'free-throw shooting',
    self: 'creating his own shot', pass: 'passing', drawn: 'drawing fouls', tov: 'ball security', oreb: 'offensive rebounding',
    dreb: 'defensive rebounding', stl: 'steals', blk: 'shot blocking', foul: 'avoiding fouls', team: 'team defense' };

  function read(doc, r) {
    var tp = r.tp, verdict = tp >= 95 ? 'Elite impact' : tp >= 80 ? 'High impact' : tp >= 60 ? 'Above-average impact' : tp >= 40 ? 'Average impact' : tp >= 20 ? 'Below-average impact' : 'Struggling';
    var ix = doc.skills.map(function (s, i) { return i; });
    var by = ix.slice().sort(function (a, b) { return r.p[b] - r.p[a]; });
    var strengths = by.slice(0, 2).filter(function (i) { return r.p[i] >= 60; }), weakness = by[by.length - 1];
    var s = strengths.length ? 'Wins with ' + strengths.map(function (i) { return PLAIN[doc.skills[i].k]; }).join(' and ') : 'No skill stands out';
    s += r.p[weakness] <= 25 ? '; ' + PLAIN[doc.skills[weakness].k] + ' costs him (' + ord(r.p[weakness]) + ' percentile).' : '.';
    return { verdict: verdict, sentence: s + ' ' + sgn(r.tot) + ' points per 100 possessions, ' + ord(r.tp) + ' percentile in D-I.', strengths: strengths, weakness: weakness };
  }

  var CSS = '.fp-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px}' +
    '.fp-tog{display:inline-flex;border:1px solid var(--border2,var(--border));border-radius:7px;overflow:hidden}' +
    '.fp-tog button{font:700 11px Inter,system-ui,sans-serif;padding:6px 11px;background:transparent;color:var(--text2);border:0;cursor:pointer}' +
    '.fp-tog button+button{border-left:1px solid var(--border2,var(--border))}' +
    '.fp-tog button.on{background:var(--text);color:var(--bg)}' +
    '.fp-bar select.fp-sel{font:600 12px Inter,system-ui,sans-serif!important;height:auto!important;background:var(--bg);border:1px solid var(--border2,var(--border));color:var(--text);padding:5px 9px!important;border-radius:7px}' +
    '.fp-lab{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)}' +
    '.fp-note{font-size:11px;color:var(--text3);font-weight:600}' +
    '.sheet.fp-tbl td.fp-g{text-align:left;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);background:var(--bg2)}' +
    '.fp-tbl tr.fp-sum td{font-weight:800}' +
    '.fp-tbl td.fp-viz{min-width:180px;width:34%}' +
    '.fp-track{position:relative;height:12px;border-radius:3px;background:var(--bg3,rgba(127,127,127,.12))}' +
    '.fp-fill{position:absolute;top:0;bottom:0;border-radius:3px}' +
    '.fp-mid{position:absolute;top:-2px;bottom:-2px;width:1px;background:var(--text3);opacity:.6}' +
    '.fp-pos{background:hsla(125,55%,42%,.85)}.fp-neg{background:hsla(0,62%,50%,.8)}' +
    '.fp-pc{background:var(--accent,#A8843C);opacity:.85}';
  function css() { if (document.getElementById('fp-css')) return; var s = document.createElement('style'); s.id = 'fp-css'; s.textContent = CSS; document.head.appendChild(s); }

  function render(host, espn, opt) {
    opt = opt || {}; css();
    if (!host) return Promise.resolve();
    host.innerHTML = '<div class="dna-loading">Loading skill fingerprint…</div>';
    return seasonsFor(espn).then(function (ys) {
      if (!ys.length) { host.innerHTML = '<div class="dna-loading">No play-by-play fingerprint for this player yet (it needs a 2024-25 or 2025-26 D-I season).</div>'; return; }
      var st = { y: opt.season && ys.indexOf(+opt.season) > -1 ? +opt.season : ys[0], scale: 'pct', sort: 'group' };
      function draw() {
        load(st.y).then(function (doc) {
          var r = doc.players[String(espn)], S = doc.skills, K = S.length;
          var rd = read(doc, r);
          // true-value axis: every skill on one scale (points per 100 above the D-I average)
          var dev = function (i) { return r.v[i] - S[i].avg; };
          var span = Math.max.apply(null, S.map(function (s) { return Math.max(Math.abs(s.p90 - s.avg), Math.abs(s.p10 - s.avg)); }).concat([Math.abs(dev(0))]));
          span = Math.max(span, Math.max.apply(null, S.map(function (s, i) { return Math.abs(dev(i)); })));
          var viz = function (i, pv, dv) {
            if (st.scale === 'pct') return '<div class="fp-track"><div class="fp-fill fp-pc" style="left:0;width:' + Math.max(1, pv) + '%"></div></div>';
            var w = Math.min(50, 50 * Math.abs(dv) / (span || 1));
            return '<div class="fp-track"><div class="fp-mid" style="left:50%"></div><div class="fp-fill ' + (dv >= 0 ? 'fp-pos' : 'fp-neg') + '" style="' + (dv >= 0 ? 'left:50%' : 'left:' + (50 - w) + '%') + ';width:' + Math.max(.6, w) + '%"></div></div>';
          };
          var row = function (i) {
            var s = S[i], dv = dev(i);
            return '<tr><td class="l">' + esc(s.label) + '</td><td>' + sgn(r.v[i]) + '</td><td>' + sgn(dv) + '</td><td class="' + bucket(r.p[i]) + '">' + r.p[i] + '</td><td class="fp-viz">' + viz(i, r.p[i], dv) + '</td></tr>';
          };
          var ix = []; for (var i = 0; i < K; i++) ix.push(i);
          var body = '';
          if (st.sort === 'group') {
            var last = null;
            ix.forEach(function (i) { if (S[i].group !== last) { last = S[i].group; body += '<tr><td class="fp-g" colspan="5">' + esc(last) + '</td></tr>'; } body += row(i); });
          } else {
            ix.sort(st.sort === 'spread' ? function (a, b) { return S[b].spread - S[a].spread; }
              : st.scale === 'pct' ? function (a, b) { return r.p[b] - r.p[a]; } : function (a, b) { return dev(b) - dev(a); });
            ix.forEach(function (i) { body += row(i); });
          }
          var TA = doc.totals || {};
          var sum = function (lab, v, p, k) { return '<tr class="fp-sum"><td class="l">' + lab + '</td><td>' + sgn(v) + '</td><td>' + sgn(v - (TA[k] || 0)) + '</td><td class="' + bucket(p) + '">' + p + '</td><td class="fp-viz">' + (st.scale === 'pct' ? viz(0, p, 0) : '') + '</td></tr>'; };
          var seasonOpts = ys.map(function (y) { return '<option value="' + y + '"' + (y === st.y ? ' selected' : '') + '>' + (y - 1) + '-' + String(y).slice(2) + '</option>'; }).join('');
          host.innerHTML = (opt.banner ? opt.banner(rd.verdict, rd.sentence) : '') +
            '<div class="fp-bar">' +
            (ys.length > 1 ? '<span class="fp-lab">Season</span><select class="fp-sel" data-fp="y">' + seasonOpts + '</select>' : '<span class="fp-lab">' + (st.y - 1) + '-' + String(st.y).slice(2) + '</span>') +
            '<div class="fp-tog"><button data-fp="pct" class="' + (st.scale === 'pct' ? 'on' : '') + '">Percentile</button><button data-fp="val" class="' + (st.scale === 'val' ? 'on' : '') + '">True value</button></div>' +
            '<span class="fp-lab">Order</span><select class="fp-sel" data-fp="sort">' +
            [['group', 'Skill groups'], ['spread', 'Impact spread'], ['mine', 'Player strengths']].map(function (o) { return '<option value="' + o[0] + '"' + (st.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
            (r.q ? '' : '<span class="fp-note">' + r.min + ' minutes — small sample</span>') +
            '</div>' +
            '<div class="sheet-wrap" style="max-height:none"><table class="sheet dense fp-tbl"><thead><tr>' +
            '<th class="l">Skill</th><th title="Points per 100 possessions on the floor, schedule-adjusted">Pts/100</th><th title="Points per 100 above the D-I average for this skill">vs avg</th><th title="Percentile among D-I players with ' + doc.min_poss + '+ possessions">Pctl</th><th class="l">' + (st.scale === 'pct' ? 'Percentile' : 'Above / below the D-I average') + '</th>' +
            '</tr></thead><tbody>' +
            sum('Overall', r.tot, r.tp, 'tot') + sum('Offense', r.o, r.op, 'o') + sum('Defense', r.d, r.dp, 'd') + body +
            '</tbody></table></div>';
          host.querySelectorAll('[data-fp]').forEach(function (el) {
            var k = el.getAttribute('data-fp');
            el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'click', function () {
              if (k === 'y') st.y = +el.value; else if (k === 'sort') st.sort = el.value; else st.scale = k;
              draw();
            });
          });
        });
      }
      draw();
    });
  }
  g.TDCFingerprint = { load: load, seasonsFor: seasonsFor, render: render, read: read, SEASONS: SEASONS };
})(window);
