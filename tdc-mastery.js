/* tdc-mastery.js — points per shot against the 1.1 bar, and "mastery shots" (scripts/build_mastery.mjs).
 *
 * Josh Schertz (SLU): rim shots, free throws and catch-and-shoot threes are the efficient shots. Anything else is a
 * mastery shot — a player earns the green light on it by showing, over time, that he makes it at 1.1+ points per
 * shot (55% on a two, 36.7% on a three).
 *
 *   TDC_MASTERY.SHOTS                       shot options {key: {label, fams, floor, k, tagged}}
 *   TDC_MASTERY.load(y) / seasons()         season file / list of built seasons (newest first)
 *   TDC_MASTERY.sum(counts, key, extra)     -> {att, made, ast, pts, pps} for one shot option
 *   TDC_MASTERY.status(pps, att, floor)     -> 'green' | 'close' | 'small' | ''
 *   TDC_MASTERY.ladder(data)                -> html: what every shot is worth in D-I vs the 1.1 bar
 *   TDC_MASTERY.renderPlayer(host, {espn})  -> player page panel
 *
 * Counts arrays are FAM×[att, made, assistedMade]; the feed names an assister on makes only.
 */
(function () {
  var BASE = 'scripts/data/mastery/', V = '?v=1', BAR = 1.1;
  var FAM = ['rim', 'float', 'post', 'pull2', 'short', 'long', 'mid', 'pull3', 'three'];
  var SV = { pull3: 3, three: 3 };
  var JUMP2 = ['float', 'post', 'pull2', 'short', 'long', 'mid'];
  // floor = attempts needed before a green light counts; k = shrinkage (attempts of D-I average) behind "Reliable PPS"
  var SHOTS = {
    jump2: { label: 'Two-point jumpers', short: 'Mid-range', fams: JUMP2, floor: 75, k: 40, mastery: true },
    float: { label: 'Floaters & runners', short: 'Floaters', fams: ['float'], floor: 30, k: 30, tagged: true, mastery: true },
    post:  { label: 'Hooks, turnarounds & fadeaways', short: 'Post', fams: ['post'], floor: 30, k: 30, tagged: true, mastery: true },
    pull2: { label: 'Pull-up & step-back twos', short: 'Pull-up 2s', fams: ['pull2'], floor: 30, k: 30, tagged: true, mastery: true },
    pull3: { label: 'Pull-up & step-back threes', short: 'Pull-up 3s', fams: ['pull3'], floor: 25, k: 30, tagged: true, mastery: true },
    three: { label: 'Threes', short: 'Threes', fams: ['three', 'pull3'], floor: 100, k: 60 },
    rim:   { label: 'At the rim', short: 'Rim', fams: ['rim'], floor: 60, k: 40 },
    all:   { label: 'Every field goal', short: 'All FGA', fams: FAM, floor: 150, k: 60 },
    true_: { label: 'Every shot incl. free throws', short: 'Incl. FTs', fams: FAM, floor: 150, k: 60, ft: true }
  };
  var ORDER = ['jump2', 'float', 'post', 'pull2', 'three', 'pull3', 'rim', 'all', 'true_'];
  var CACHE = {};
  function get(f) { return CACHE[f] || (CACHE[f] = fetch(BASE + f + V).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })); }
  function load(y) { return get(y + '.json'); }
  function seasons() { return get('index.json').then(function (d) { return d ? d.seasons : []; }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sl(y) { return (y - 1) + '–' + String(y).slice(2); }
  function p3(v) { return (v == null || !isFinite(v)) ? '—' : v.toFixed(2); }
  function sg(v) { return (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2); }
  function pc(v) { return (v == null || !isFinite(v)) ? '—' : (100 * v).toFixed(1); }

  // counts: flat FAM×3 array starting at `off`; extra = {fta, ftm} for the free-throw-inclusive option
  function sum(counts, key, extra, off) {
    var o = SHOTS[key], s = { att: 0, made: 0, ast: 0, pts: 0 }; off = off || 0;
    o.fams.forEach(function (f) { var i = off + FAM.indexOf(f) * 3; s.att += counts[i]; s.made += counts[i + 1]; s.ast += counts[i + 2]; s.pts += counts[i + 1] * (SV[f] || 2); });
    if (o.ft && extra) { s.pts += extra.ftm; s.den = s.att + 0.44 * extra.fta; } else s.den = s.att;
    s.pps = s.den ? s.pts / s.den : null;
    s.fg = s.att ? s.made / s.att : null;
    s.astp = s.made ? s.ast / s.made : null;
    return s;
  }
  function leagueOf(d) {
    var flat = [].concat.apply([], d.league), fta = 0, ftm = 0;
    (d.teamRows || []).forEach(function (r) { fta += r[2]; ftm += r[3]; });
    return { flat: flat, fta: fta, ftm: ftm };
  }
  function lgSum(d, key) { var L = leagueOf(d); return sum(L.flat, key, { fta: L.fta, ftm: L.ftm }); }
  function rel(s, lgPps, k) { return s.den ? (s.pts + k * lgPps) / (s.den + k) : null; }
  function status(pps, att, floor) {
    if (pps == null) return '';
    if (att >= floor) return pps >= BAR ? 'green' : pps >= 1.0 ? 'close' : '';
    return (att >= floor / 2 && pps >= BAR) ? 'small' : '';
  }
  var STATUS = { green: 'Green light', close: 'Close', small: 'Small sample' };
  // vs-1.1 shading on the sheet kit's absolute scale (not relative to the table, so a short list never paints red by rank)
  function heat(v) { return v == null ? '' : v >= 0.1 ? 'c4' : v >= 0 ? 'c3' : v >= -0.1 ? 'c2' : v >= -0.25 ? 'c1' : 'c0'; }
  function hasTags(d) { return SHOTS.pull2.fams.concat(SHOTS.float.fams, SHOTS.post.fams, SHOTS.pull3.fams).some(function (f) { return d.league[FAM.indexOf(f)][0] > 500; }); }

  function css() {
    if (document.getElementById('mst-css')) return;
    var s = document.createElement('style'); s.id = 'mst-css';
    s.textContent =
      '.mst{--mst-pos:#B07D17;--mst-neg:#2F7FC1;}[data-theme="dark"] .mst{--mst-pos:#B8862A;--mst-neg:#3A8BCB;}' +
      '.mst-lad{display:grid;grid-template-columns:minmax(150px,220px) 1fr 64px;gap:0 12px;align-items:center;}' +
      '.mst-lad .lb{font-size:13px;font-weight:700;color:var(--text2);text-align:right;line-height:1.15;padding:7px 0;}' +
      '.mst-lad .lb small{display:block;font-size:11px;font-weight:500;color:var(--text3);}' +
      '.mst-lad .tr{position:relative;height:22px;}' +
      '.mst-lad .bar{position:absolute;left:0;top:3px;height:16px;border-radius:0 4px 4px 0;}' +
      '.mst-lad .ln{position:absolute;top:-6px;bottom:-6px;width:0;border-left:2px dashed var(--text);}' +
      '.mst-lad .v{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--text);}' +
      '.mst-lad .axis{grid-column:2;position:relative;height:18px;font-size:11px;color:var(--text3);}' +
      '.mst-lad .axis span{position:absolute;transform:translateX(-50%);}' +
      '.mst-key{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--text2);margin:8px 0 2px;}' +
      '.mst-key i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:6px;vertical-align:-1px;}' +
      '.mst-lede{font-size:15px;line-height:1.5;color:var(--text);margin:0 0 14px;}' +
      '.mst-lede b{font-weight:800;}' +
      '.mst-sec{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:2px solid var(--text);padding-bottom:8px;margin:22px 0 8px;}' +
      '.mst-sec span:first-child{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--text);}' +
      '.mst-ctl select{font:600 13px Inter,system-ui,sans-serif;padding:6px 10px;border:1px solid var(--border2,#C6C0B2);border-radius:8px;background:var(--bg2);color:var(--text);}' +
      '.mst-empty{padding:22px;text-align:center;color:var(--text3);border:1px dashed var(--border2,#C6C0B2);border-radius:12px;font-size:13px;}';
    document.head.appendChild(s);
  }

  // What each shot is worth in D-I: one bar per family, the 1.1 bar drawn across
  function ladder(d) {
    css();
    var keys = ['rim', 'three', 'float', 'post', 'pull2', 'pull3', 'jump2'].filter(function (k) { return !SHOTS[k].tagged || hasTags(d); });
    var L = leagueOf(d), ft = L.fta ? 2 * L.ftm / L.fta : null;   // a two-shot trip, per trip
    var rows = keys.map(function (k) { var s = lgSum(d, k); return { lb: SHOTS[k].label, sub: s.att.toLocaleString() + ' attempts · ' + pc(s.fg) + '%', v: s.pps }; });
    if (ft) rows.splice(1, 0, { lb: 'Free-throw trip', sub: 'two shots · ' + pc(L.ftm / L.fta) + '% · per trip', v: ft });
    rows.sort(function (a, b) { return b.v - a.v; });
    var max = Math.max(1.6, Math.max.apply(null, rows.map(function (r) { return r.v; })) * 1.04), X = function (v) { return (100 * v / max).toFixed(2) + '%'; };
    var h = '<div class="mst"><div class="mst-lad">';
    rows.forEach(function (r) {
      h += '<div class="lb">' + esc(r.lb) + '<small>' + esc(r.sub) + '</small></div><div class="tr"><div class="bar" style="width:' + X(r.v) + ';background:' + (r.v >= BAR ? 'var(--mst-pos)' : 'var(--mst-neg)') + '"></div><div class="ln" style="left:' + X(BAR) + '"></div></div><div class="v">' + p3(r.v) + '</div>';
    });
    h += '<div></div><div class="axis">' + [0, 0.5, 1, BAR, 1.5].filter(function (v) { return v <= max; }).map(function (v) { return '<span style="left:' + X(v) + ';' + (v === BAR ? 'font-weight:800;color:var(--text)' : '') + '">' + (v === BAR ? '1.1' : v.toFixed(1)) + '</span>'; }).join('') + '</div><div></div>';
    h += '</div><div class="mst-key"><span><i style="background:var(--mst-pos)"></i>Clears 1.1 points per shot</span><span><i style="background:var(--mst-neg)"></i>Below 1.1</span><span><i style="background:none;border-left:2px dashed var(--text);border-radius:0;width:0;height:12px"></i>The 1.1 bar</span></div></div>';
    return h;
  }

  // ── player page ─────────────────────────────────────────────────────────────────────────────────────────────────
  function playerRows(all, espn) {
    var out = [];
    all.forEach(function (d) {
      if (!d) return;
      var C = d.pcols.length;
      for (var i = 0; i < d.players.length; i++) {
        var r = d.players[i];
        if (String(r[0]) !== String(espn)) continue;
        out.push({ y: d.season, d: d, team: (d.teams[r[2]] || [''])[0], min: r[4], gp: r[5], fta: r[6], ftm: r[7], c: r.slice(C) });
        break;
      }
    });
    return out.sort(function (a, b) { return b.y - a.y; });
  }
  function combine(rows) {
    var c = null, fta = 0, ftm = 0, min = 0, gp = 0;
    rows.forEach(function (r) { if (!c) c = r.c.slice(); else r.c.forEach(function (v, i) { c[i] += v; }); fta += r.fta; ftm += r.ftm; min += r.min; gp += r.gp; });
    return { c: c, fta: fta, ftm: ftm, min: min, gp: gp };
  }
  function lgCombined(rows) {
    var flat = null, fta = 0, ftm = 0;
    rows.forEach(function (r) { var L = leagueOf(r.d); if (!flat) flat = L.flat.slice(); else L.flat.forEach(function (v, i) { flat[i] += v; }); fta += L.fta; ftm += L.ftm; });
    return { flat: flat, fta: fta, ftm: ftm };
  }

  function renderPlayer(host, o) {
    if (!host) return; css();
    host.innerHTML = '<div class="mst-empty">Loading every shot he has taken…</div>';
    seasons().then(function (ys) {
      return Promise.all(ys.map(load)).then(function (all) {
        var rows = playerRows(all, o.espn);
        if (!rows.length) { host.innerHTML = '<div class="mst-empty">No D-I play-by-play shots on file for this player.</div>'; return; }
        var pick = o.span || 'y' + rows[0].y;
        var sel = rows.filter(function (r) { return pick === 'last3' ? r.y >= rows[0].y - 2 : pick === 'career' ? true : 'y' + r.y === pick; });
        var tags = sel.some(function (r) { return hasTags(r.d); });
        var P = combine(sel), L = lgCombined(sel);
        var opts = '<option value="career"' + (pick === 'career' ? ' selected' : '') + '>Career</option>' + (rows.length > 1 ? '<option value="last3"' + (pick === 'last3' ? ' selected' : '') + '>Last 3 seasons</option>' : '') +
          rows.map(function (r) { return '<option value="y' + r.y + '"' + (pick === 'y' + r.y ? ' selected' : '') + '>' + sl(r.y) + ' · ' + esc(r.team) + '</option>'; }).join('');
        var list = ORDER.filter(function (k) { return !SHOTS[k].tagged || tags; }).map(function (k) {
          var s = sum(P.c, k, { fta: P.fta, ftm: P.ftm }), lg = sum(L.flat, k, { fta: L.fta, ftm: L.ftm });
          return { k: k, s: s, lg: lg.pps, st: status(s.pps, s.att, SHOTS[k].floor) };
        });
        // the lede: green lights first, then the best mastery shot he is close on
        var greens = list.filter(function (x) { return SHOTS[x.k].mastery && x.st === 'green'; });
        var all3 = list.filter(function (x) { return x.k === 'three'; })[0];
        var lede;
        if (greens.length) lede = '<b>Green light:</b> ' + greens.map(function (x) { return esc(SHOTS[x.k].label.toLowerCase()) + ' (' + p3(x.s.pps) + ' points per shot on ' + x.s.att + ')'; }).join(', ') + '.';
        else {
          var best = list.filter(function (x) { return SHOTS[x.k].mastery && x.s.att >= SHOTS[x.k].floor / 2; }).sort(function (a, b) { return b.s.pps - a.s.pps; })[0];
          lede = '<b>No mastery shot yet.</b> ' + (best ? 'Closest: ' + esc(SHOTS[best.k].label.toLowerCase()) + ' at ' + p3(best.s.pps) + ' points per shot on ' + best.s.att + ' attempts.' : 'Not enough tough shots to judge.');
        }
        if (all3 && all3.st === 'green') lede += ' Threes clear the bar too (' + pc(all3.s.fg) + '%).';
        var t = '<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Shot</th><th>Att</th><th>Made</th><th>FG%</th><th>Pts / shot</th><th>D-I</th><th>vs 1.1</th><th>Assisted</th><th class="l">Status</th></tr></thead><tbody>' +
          list.map(function (x) {
            var s = x.s, v = s.pps == null ? null : s.pps - BAR;
            return '<tr><td class="l">' + esc(SHOTS[x.k].label) + '</td><td>' + s.att + '</td><td>' + s.made + '</td><td>' + pc(s.fg) + '</td><td><b>' + p3(s.pps) + '</b></td><td>' + p3(x.lg) + '</td><td class="' + (s.att >= SHOTS[x.k].floor / 2 ? heat(v) : '') + '">' + sg(v) + '</td><td>' + (s.astp == null ? '—' : Math.round(100 * s.astp) + '%') + '</td><td class="l">' + (STATUS[x.st] || '') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
        // season by season: the two mastery questions (jumpers, threes) and overall
        var hist = '<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Season</th><th class="l">Team</th><th>FGA</th><th>Pts / shot</th><th>2-pt jumpers</th><th>Pts / shot</th><th>Threes</th><th>3P%</th><th class="l">Green lights</th></tr></thead><tbody>' +
          rows.map(function (r) {
            var a = sum(r.c, 'all'), j = sum(r.c, 'jump2'), th = sum(r.c, 'three'), tg = hasTags(r.d);
            var g = ORDER.filter(function (k) { return SHOTS[k].mastery && (!SHOTS[k].tagged || tg) || k === 'three'; }).filter(function (k) { var s = sum(r.c, k); return status(s.pps, s.att, SHOTS[k].floor) === 'green'; }).map(function (k) { return SHOTS[k].short; });
            return '<tr><td class="l">' + sl(r.y) + '</td><td class="l">' + esc(r.team) + '</td><td>' + a.att + '</td><td>' + p3(a.pps) + '</td><td>' + j.att + '</td><td class="' + (j.att >= SHOTS.jump2.floor / 2 ? heat(j.pps - BAR) : '') + '">' + p3(j.pps) + '</td><td>' + th.att + '</td><td>' + pc(th.fg) + '</td><td class="l">' + (g.join(', ') || '—') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
        host.innerHTML = '<div class="mst"><div class="mst-sec"><span>Mastery shots</span><span class="mst-ctl"><select id="mstPlSpan">' + opts + '</select></span></div>' +
          '<p class="mst-lede">' + lede + '</p>' + t +
          '<div class="mst-sec"><span>Season by season</span><span></span></div>' + hist + '</div>';
        var s = document.getElementById('mstPlSpan'); if (s) s.onchange = function () { renderPlayer(host, Object.assign({}, o, { span: s.value })); };
      });
    });
  }

  window.TDC_MASTERY = { BAR: BAR, FAM: FAM, SHOTS: SHOTS, ORDER: ORDER, STATUS: STATUS, load: load, seasons: seasons, sum: sum, lgSum: lgSum, leagueOf: leagueOf, rel: rel, status: status, heat: heat, hasTags: hasTags, ladder: ladder, renderPlayer: renderPlayer, css: css, sl: sl };
})();
