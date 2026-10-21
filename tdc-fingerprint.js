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
  var V = '5', SEASONS = [2026, 2025, 2024, 2023], cache = {};
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
    '.fp-tbl tr.fp-click{cursor:pointer}' +
    '.fp-sl{display:inline-flex;align-items:center;gap:6px}.fp-sl input{width:90px;accent-color:var(--accent,#A8843C)}.fp-sl b{font-size:11px;min-width:20px;font-variant-numeric:tabular-nums}' +
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

  // ── SPLITS ("How he plays when…", scripts/build_fingerprint_splits.py) ─────────────────────────────────────
  // each side = [poss, off, def, total, 15 skills]; league[split] = the typical player's two sides (no poss)
  var scache = {};
  function loadSplits(y) {
    return scache[y] || (scache[y] = fetch('scripts/data/fingerprint/splits_' + y + '.json?v=' + V)
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }));
  }
  var SPLIT_READ = {
    close: ['Gets better when it is close and late', 'Fades when it is close and late'],
    opp: ['Raises his game against top-50 teams', 'Drops off against top-50 teams'],
    pace: ['Thrives when the game speeds up', 'Better when the game slows down'],
    venue: ['Bigger home edge than most players', 'Travels better than most players']
  };
  var MIN_SIDE = { close: 60, opp: 250, pace: 250, venue: 250 };
  function splitRows(sd, r) {
    // per split: [A total, B total, change, typical change, vs typical]
    return sd.splits.map(function (sp) {
      var a = r[sp.k][0], b = r[sp.k][1], la = sd.league[sp.k][0], lb = sd.league[sp.k][1];
      var ch = a[3] - b[3], ty = (la[2] - lb[2]);
      return { sp: sp, a: a, b: b, ch: ch, ty: ty, vs: ch - ty, ok: a[0] >= MIN_SIDE[sp.k] && b[0] >= MIN_SIDE[sp.k] };
    });
  }
  function splitsRead(rows) {
    var sig = rows.filter(function (x) { return x.ok; }).sort(function (a, b) { return Math.abs(b.vs) - Math.abs(a.vs); });
    if (!sig.length || Math.abs(sig[0].vs) < 1.5) return { verdict: 'Steady in every situation', sentence: 'No situation moves him more than about 1.5 points per 100 beyond what it does to a typical player.' };
    var t = sig[0], w = SPLIT_READ[t.sp.k][t.vs > 0 ? 0 : 1];
    var s = w + ' \u2014 ' + t.sp.a + ' ' + sgn(t.a[3]) + ', ' + t.sp.b.replace(/^vs /, 'vs ') + ' ' + sgn(t.b[3]) + ' points per 100 (a typical player moves ' + sgn(t.ty) + ').';
    var t2 = sig[1];
    if (t2 && Math.abs(t2.vs) >= 1.5) s += ' Also: ' + SPLIT_READ[t2.sp.k][t2.vs > 0 ? 0 : 1].toLowerCase() + ' (' + sgn(t2.vs) + ' beyond typical).';
    return { verdict: w, sentence: s };
  }
  var vcls = function (v) { return v >= 3 ? 'c4' : v >= 1.5 ? 'c3' : v <= -3 ? 'c0' : v <= -1.5 ? 'c1' : ''; };
  function renderSplits(host, espn, opt) {
    opt = opt || {}; css();
    if (!host) return Promise.resolve();
    host.innerHTML = '<div class="dna-loading">Loading splits…</div>';
    return seasonsFor(espn).then(function (ys) {
      return Promise.all(ys.map(loadSplits)).then(function (sds) {
        ys = ys.filter(function (y, i) { return sds[i] && sds[i].players[String(espn)]; });
        if (!ys.length) { host.innerHTML = '<div class="dna-loading">No situation splits for this player yet (they need 250+ minutes in a 2024-25 or 2025-26 D-I season).</div>'; return; }
        var st = { y: ys[0], sp: null };
        function draw() {
          Promise.all([loadSplits(st.y), load(st.y)]).then(function (x) {
            var sd = x[0], doc = x[1], r = sd.players[String(espn)], rows = splitRows(sd, r), rd = splitsRead(rows);
            if (!st.sp) { var big = rows.filter(function (z) { return z.ok; }).sort(function (a, b) { return Math.abs(b.vs) - Math.abs(a.vs); })[0]; st.sp = (big || rows[0]).sp.k; }
            var cur = rows.find(function (z) { return z.sp.k === st.sp; });
            var head = '<tr><th class="l">Situation</th><th class="l">Side</th><th>Poss</th><th title="Points per 100 possessions">Pts/100</th><th class="l">Other side</th><th>Poss</th><th>Pts/100</th><th title="This side minus the other side">Change</th><th title="How much the typical D-I player changes in the same situation">Typical</th><th title="His change beyond the typical player\'s">vs typical</th></tr>';
            var body = rows.map(function (z) {
              return '<tr' + (z.sp.k === st.sp ? ' style="outline:2px solid var(--accent);outline-offset:-2px"' : '') + ' data-sp="' + z.sp.k + '" class="fp-click"><td class="l"><b>' + esc({ close: 'Close and late', opp: 'Opponent', pace: 'Pace', venue: 'Venue' }[z.sp.k]) + '</b></td>' +
                '<td class="l">' + esc(z.sp.a) + '</td><td class="dim">' + z.a[0] + '</td><td>' + sgn(z.a[3]) + '</td>' +
                '<td class="l">' + esc(z.sp.b) + '</td><td class="dim">' + z.b[0] + '</td><td>' + sgn(z.b[3]) + '</td>' +
                '<td><b>' + sgn(z.ch) + '</b></td><td class="dim">' + sgn(z.ty) + '</td><td class="' + (z.ok ? vcls(z.vs) : '') + '">' + (z.ok ? sgn(z.vs) : '<span class="dim" title="Small sample">' + sgn(z.vs) + '*</span>') + '</td></tr>';
            }).join('');
            // skill detail for the picked split
            var la = sd.league[st.sp][0], lb = sd.league[st.sp][1], last = null, det = '';
            var lab = function (i) { return doc.skills[i].label; };
            var drow = function (name, a, b, ta, tb, strong) {
              var ch = a - b, ty = ta - tb, vs = ch - ty;
              return '<tr' + (strong ? ' class="fp-sum"' : '') + '><td class="l">' + esc(name) + '</td><td>' + sgn(a) + '</td><td>' + sgn(b) + '</td><td><b>' + sgn(ch) + '</b></td><td class="dim">' + sgn(ty) + '</td><td class="' + vcls(vs) + '">' + sgn(vs) + '</td></tr>';
            };
            det += drow('Overall', cur.a[3], cur.b[3], la[2], lb[2], 1) + drow('Offense', cur.a[1], cur.b[1], la[0], lb[0], 1) + drow('Defense', cur.a[2], cur.b[2], la[1], lb[1], 1);
            for (var i = 0; i < doc.skills.length; i++) {
              if (doc.skills[i].group !== last) { last = doc.skills[i].group; det += '<tr><td class="fp-g" colspan="6">' + esc(last) + '</td></tr>'; }
              det += drow(lab(i), cur.a[4 + i], cur.b[4 + i], la[3 + i], lb[3 + i]);
            }
            var seasonSel = ys.length > 1 ? '<span class="fp-lab">Season</span><select class="fp-sel" data-fs="y">' + ys.map(function (y) { return '<option value="' + y + '"' + (y === st.y ? ' selected' : '') + '>' + (y - 1) + '-' + String(y).slice(2) + '</option>'; }).join('') + '</select>' : '<span class="fp-lab">' + (st.y - 1) + '-' + String(st.y).slice(2) + '</span>';
            host.innerHTML = (opt.banner ? opt.banner(rd.verdict, rd.sentence) : '') +
              '<div class="fp-bar">' + seasonSel + (st.y === 2025 ? '<span class="fp-note">Close-and-late uses only the ~25% of 2024-25 games that log substitutions</span>' : '') + '</div>' +
              '<div class="sheet-wrap" style="max-height:none;margin-bottom:18px"><table class="sheet dense fp-tbl"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
              '<div class="fp-bar"><span class="fp-lab">Skill by skill</span><select class="fp-sel" data-fs="sp">' + sd.splits.map(function (sp) { return '<option value="' + sp.k + '"' + (sp.k === st.sp ? ' selected' : '') + '>' + esc(sp.a) + ' vs ' + esc(sp.b.replace(/^vs /, '')) + '</option>'; }).join('') + '</select></div>' +
              '<div class="sheet-wrap" style="max-height:none"><table class="sheet dense fp-tbl"><thead><tr><th class="l">Skill</th><th>' + esc(cur.sp.a) + '</th><th>' + esc(cur.sp.b) + '</th><th>Change</th><th>Typical</th><th>vs typical</th></tr></thead><tbody>' + det + '</tbody></table></div>';
            host.querySelectorAll('[data-fs]').forEach(function (el) {
              el.addEventListener('change', function () { if (el.getAttribute('data-fs') === 'y') { st.y = +el.value; st.sp = null; } else st.sp = el.value; draw(); });
            });
            host.querySelectorAll('tr[data-sp]').forEach(function (tr) { tr.addEventListener('click', function () { st.sp = tr.getAttribute('data-sp'); draw(); }); });
          });
        }
        draw();
      });
    });
  }

  // ── SKILL COMPS ─────────────────────────────────────────────────────────────────────────────────────────────
  // Closest player-seasons across every fingerprint season, blending three distances in percentile space:
  //   skills  the 15 skill percentiles, each weighted by how much that skill separates players (its impact spread)
  //   impact  overall / offense / defense percentiles
  //   role    position, possessions used, minutes, share of makes assisted, three-point rate (percentiles in-season)
  // The owner slides the weights. A comp from an earlier season also shows what that player did the NEXT season,
  // and the read averages it: where players with this fingerprint went.
  var POSN = { G: 1, PG: 1, SG: 1.5, F: 3, SF: 2.5, PF: 3.5, C: 5, FC: 4, GF: 2 };
  var rolePrep = {};
  function prep(doc) {
    if (rolePrep[doc.season]) return rolePrep[doc.season];
    var q = Object.keys(doc.players).map(function (k) { return doc.players[k]; }).filter(function (r) { return r.q; });
    var srt = function (f) { return q.map(f).filter(function (v) { return v != null && isFinite(v); }).sort(function (a, b) { return a - b; }); };
    var S = { use: srt(function (r) { return r.use; }), mpg: srt(function (r) { return r.min / Math.max(1, r.g); }),
      astd: srt(function (r) { return r.astd; }), tpar: srt(function (r) { return r.tpar; }) };
    var pc = function (arr, v) { if (v == null || !arr.length) return 50; var lo = 0, hi = arr.length; while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return 100 * lo / Math.max(1, arr.length - 1); };
    var wsum = doc.skills.reduce(function (a, s) { return a + s.spread; }, 0);
    return (rolePrep[doc.season] = { w: doc.skills.map(function (s) { return s.spread / wsum; }),
      role: function (r) { return [((POSN[r.pos] || 3) - 1) * 25, pc(S.use, r.use), pc(S.mpg, r.min / Math.max(1, r.g)), pc(S.astd, r.astd), pc(S.tpar, r.tpar)]; } });
  }
  function comps(docs, espn, season, wts, n) {
    var me = docs[season] && docs[season].players[String(espn)]; if (!me) return [];
    var P0 = prep(docs[season]), myRole = P0.role(me);
    var out = [];
    Object.keys(docs).forEach(function (y) {
      var d = docs[y], P = prep(d);
      Object.keys(d.players).forEach(function (id) {
        if (id === String(espn)) return;
        var r = d.players[id]; if (!r.q) return;
        var ds = 0; for (var i = 0; i < r.p.length; i++) ds += P0.w[i] * Math.abs(r.p[i] - me.p[i]);
        var di = (Math.abs(r.tp - me.tp) + Math.abs(r.op - me.op) + Math.abs(r.dp - me.dp)) / 3;
        var ro = P.role(r), dr = 0; for (var j = 0; j < 5; j++) dr += Math.abs(ro[j] - myRole[j]) / 5;
        var W = wts[0] + wts[1] + wts[2] || 1, dist = (wts[0] * ds + wts[1] * di + wts[2] * dr) / W;
        out.push({ id: id, y: +y, r: r, dist: dist });
      });
    });
    out.sort(function (a, b) { return a.dist - b.dist; });
    var seen = {}, top = [];
    for (var k = 0; k < out.length && top.length < n; k++) { if (seen[out[k].id]) continue; seen[out[k].id] = 1; top.push(out[k]); }
    top.forEach(function (c) { c.match = Math.max(0, Math.round(100 - 1.6 * c.dist)); var nx = docs[c.y + 1] && docs[c.y + 1].players[c.id]; c.next = nx && nx.q ? nx : null; });
    return top;
  }
  function renderComps(host, espn, opt) {
    opt = opt || {}; css();
    if (!host) return Promise.resolve();
    host.innerHTML = '<div class="dna-loading">Finding skill comps…</div>';
    return Promise.all(SEASONS.map(load)).then(function (ds) {
      var docs = {}; SEASONS.forEach(function (y, i) { if (ds[i]) docs[y] = ds[i]; });
      var ys = SEASONS.filter(function (y) { return docs[y] && docs[y].players[String(espn)] && docs[y].players[String(espn)].q; });
      if (!ys.length) { host.innerHTML = '<div class="dna-loading">Skill comps need a season with 250+ D-I minutes.</div>'; return; }
      var st = { y: ys[0], w: [34, 33, 33] };
      function draw() {
        var wide = comps(docs, espn, st.y, st.w, 30), top = wide.slice(0, 10), me = docs[st.y].players[String(espn)];
        var withNext = wide.filter(function (c) { return c.next; });   // the forecast reads the closest 30, not just the 10 shown
        var avg = withNext.length ? withNext.reduce(function (a, c) { return a + (c.next.tot - c.r.tot); }, 0) / withNext.length : null;
        var up = withNext.filter(function (c) { return c.next.tot > c.r.tot; }).length;
        if (withNext.length < 3) avg = null;
        var verdict = avg == null ? 'Closest skill fingerprints' : avg >= 1.5 ? 'Comps tend to take a step up' : avg <= -1.5 ? 'Comps tend to step back' : 'Comps tend to hold steady';
        var sentence = 'Closest match: ' + top[0].r.n + ' (' + (top[0].y - 1) + '-' + String(top[0].y).slice(2) + ', ' + top[0].match + '% match).' +
          (avg == null ? ' Too few of his closest comps have a following season in the data to say where this profile goes next.' : ' Of his 30 closest comps, ' + withNext.length + ' have a following season: '  + up + ' improved, and on average they moved ' + sgn(avg) + ' points per 100.');
        var rows = top.map(function (c) {
          var r = c.r, nx = c.next, ch = nx ? nx.tot - r.tot : null;
          return '<tr><td class="l"><b>' + esc(r.n) + '</b></td><td>' + (c.y - 1) + '-' + String(c.y).slice(2) + '</td><td class="l dim">' + esc(r.t || '') + '</td><td class="dim">' + esc(r.pos || '') + '</td>' +
            '<td class="' + (c.match >= 85 ? 'c4' : c.match >= 75 ? 'c3' : c.match >= 65 ? 'c2' : 'c1') + '"><b>' + c.match + '%</b></td><td>' + sgn(r.tot) + '</td>' +
            '<td>' + (nx ? sgn(nx.tot) : '<span class="dim">—</span>') + '</td><td class="' + (ch == null ? '' : ch >= 2 ? 'c4' : ch >= 0.5 ? 'c3' : ch <= -2 ? 'c0' : ch <= -0.5 ? 'c1' : '') + '">' + (ch == null ? '' : sgn(ch)) + '</td>' +
            '<td class="l dim">' + (nx && nx.t !== r.t ? 'moved to ' + esc(nx.t) : nx ? 'same school' : '') + '</td></tr>';
        }).join('');
        var sl = function (i, lab) { return '<label class="fp-sl"><span class="fp-lab">' + lab + '</span><input type="range" min="0" max="100" value="' + st.w[i] + '" data-fw="' + i + '"><b>' + st.w[i] + '</b></label>'; };
        host.innerHTML = (opt.banner ? opt.banner(verdict, sentence) : '') +
          '<div class="fp-bar">' + (ys.length > 1 ? '<span class="fp-lab">His season</span><select class="fp-sel" data-fc="y">' + ys.map(function (y) { return '<option value="' + y + '"' + (y === st.y ? ' selected' : '') + '>' + (y - 1) + '-' + String(y).slice(2) + '</option>'; }).join('') + '</select>' : '') +
          sl(0, 'Skills') + sl(1, 'Impact') + sl(2, 'Role') + '</div>' +
          '<div class="sheet-wrap" style="max-height:none"><table class="sheet dense fp-tbl"><thead><tr><th class="l">Player</th><th>Season</th><th class="l">School</th><th>Pos</th><th>Match</th><th title="Overall points per 100 that season">Pts/100</th><th title="The same player the following season">Next year</th><th>Change</th><th class="l"></th></tr></thead><tbody>' +
          '<tr class="fp-sum"><td class="l">' + esc(me.n) + ' (him)</td><td>' + (st.y - 1) + '-' + String(st.y).slice(2) + '</td><td class="l dim">' + esc(me.t || '') + '</td><td class="dim">' + esc(me.pos || '') + '</td><td></td><td>' + sgn(me.tot) + '</td><td></td><td></td><td></td></tr>' +
          rows + '</tbody></table></div>';
        host.querySelectorAll('[data-fw]').forEach(function (el) { el.addEventListener('change', function () { st.w[+el.getAttribute('data-fw')] = +el.value; draw(); }); el.addEventListener('input', function () { el.nextElementSibling.textContent = el.value; }); });
        var ysel = host.querySelector('[data-fc="y"]'); if (ysel) ysel.addEventListener('change', function () { st.y = +ysel.value; draw(); });
      }
      draw();
    });
  }
  g.TDCFingerprint = { load: load, seasonsFor: seasonsFor, render: render, read: read, loadSplits: loadSplits, renderSplits: renderSplits, splitRows: splitRows, splitsRead: splitsRead, comps: comps, renderComps: renderComps, SEASONS: SEASONS };
})(window);
