/* tdc-lineup-history.js — real lineup history for a team (team page Lineups tab; Compare page).
 * Data: scripts/data/team_lineups/<slug>.json (build_team_lineups.py: every game's starting five +
 * player minutes/points from box_scores, with the game result).
 *   TDCLineupHist.load(full)                → Promise<file|null>
 *   TDCLineupHist.season(file, yr)          → computed tables for one season
 *   TDCLineupHist.render(host, full, opts)  → the Lineups tab
 * The five-man lineup + trio ratings (play-by-play) come from the shared tdc-lineups.js (TDC_LINEUPS.section).
 * Everything is a real count from real games — no ratings, no sliders.
 */
(function (g) {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var slug = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
  var _f = {};
  function load(full) {
    if (!full) return Promise.resolve(null);
    if (_f[full]) return _f[full];
    return (_f[full] = fetch('scripts/data/team_lineups/' + slug(full) + '.json?h=' + Math.floor(Date.now() / 36e5)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }));
  }
  var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // one season's tables, all counted from that season's games
  function season(F, yr, lastN) {
    var G = (F && F.s && F.s[String(yr)]) || []; if (!G.length) return null;
    if (lastN) G = G.slice(-lastN);
    var P = F.p || {};
    var min = {}, gs = {};
    G.forEach(function (x) { (x[7] || []).forEach(function (r) { min[r[0]] = (min[r[0]] || 0) + r[1]; }); x[6].forEach(function (k) { gs[k] = (gs[k] || 0) + 1; }); });
    // a five's key: its players ordered by season minutes (the stars first), so the same five always reads the same
    var order = function (ks) { return ks.slice().sort(function (a, b) { return (min[b] || 0) - (min[a] || 0); }); };
    var fkey = function (ks) { return ks.slice().sort().join('|'); };
    var res = function (x) { return (x[4] != null && x[5] != null) ? x[4] - x[5] : null; };
    function tally(games) {
      var by = {};
      games.forEach(function (x) { if (x[6].length !== 5) return; var k = fkey(x[6]); var t = by[k] || (by[k] = { ks: order(x[6]), n: 0, w: 0, l: 0, m: 0, mn: 0, last: '', first: '' });
        t.n++; var d = res(x); if (d != null) { d > 0 ? t.w++ : t.l++; t.m += d; t.mn++; } if (!t.first) t.first = x[1]; t.last = x[1]; });
      return Object.keys(by).map(function (k) { var t = by[k]; t.avg = t.mn ? t.m / t.mn : null; return t; }).sort(function (a, b) { return b.n - a.n || (b.avg || 0) - (a.avg || 0); });
    }
    var all = tally(G);
    var rec = G.reduce(function (a, x) { var d = res(x); if (d != null) { d > 0 ? a.w++ : a.l++; } return a; }, { w: 0, l: 0 });
    var recent = [['Last game', G.slice(-1)], ['Last 5 games', G.slice(-5)], ['Last 10 games', G.slice(-10)]].map(function (w) { var t = tally(w[1]); return { lbl: w[0], top: t[0], games: w[1].length, distinct: t.length, rec: w[1].reduce(function (a, x) { var d = res(x); if (d != null) { d > 0 ? a.w++ : a.l++; } return a; }, { w: 0, l: 0 }) }; });
    var months = {}; G.forEach(function (x) { var m = (x[1] || '').slice(0, 7); (months[m] = months[m] || []).push(x); });
    var byMonth = Object.keys(months).sort().map(function (m) { var t = tally(months[m]); return { lbl: MO[+m.slice(5, 7) - 1], top: t[0], games: months[m].length, distinct: t.length }; });
    var qual = all.filter(function (t) { return t.n >= 2 && t.mn >= 2; });
    // best and worst never share a five: with few qualifiers, split them down the middle
    var srt = qual.slice().sort(function (a, b) { return b.avg - a.avg; }), half = Math.min(5, Math.ceil(srt.length / 2));
    var best = srt.slice(0, half), worst = srt.slice(half).reverse().slice(0, 5);
    // each player: as a starter vs off the bench (his line, and how the TEAM did)
    var pl = {};
    G.forEach(function (x) { var d = res(x), st = {}; x[6].forEach(function (k) { st[k] = 1; });
      (x[7] || []).forEach(function (r) { var k = r[0], s = st[k] ? 's' : 'b'; var p = pl[k] || (pl[k] = { k: k, s: { g: 0, min: 0, pts: 0, reb: 0, ast: 0 }, b: { g: 0, min: 0, pts: 0, reb: 0, ast: 0 }, sw: 0, sl: 0, sm: 0, sn: 0, nw: 0, nl: 0, nm: 0, nn: 0 });
        var q = p[s]; q.g++; q.min += r[1]; q.pts += r[2]; q.reb += r[3] || 0; q.ast += r[4] || 0; });
      Object.keys(pl).forEach(function (k) { var p = pl[k]; if (d == null) return; if (st[k]) { d > 0 ? p.sw++ : p.sl++; p.sm += d; p.sn++; } else { d > 0 ? p.nw++ : p.nl++; p.nm += d; p.nn++; } });
    });
    var players = Object.keys(pl).map(function (k) { return pl[k]; }).filter(function (p) { return p.s.g + p.b.g >= 3; })
      .sort(function (a, b) { return b.s.g - a.s.g || (b.s.min + b.b.min) - (a.s.min + a.b.min); });
    return { yr: yr, G: G, P: P, all: all, rec: rec, recent: recent, byMonth: byMonth, best: best, worst: worst, players: players, gs: gs, min: min };
  }

  // ---- render ----
  var CSS = '.lu-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:4px 0 18px;}' +
    '.lu-k{border:1px solid var(--border);border-radius:10px;background:var(--bg2);padding:10px 13px;min-width:0;}' +
    '.lu-k b{display:block;font-family:Inter,system-ui,sans-serif;font-size:22px;font-weight:800;line-height:1.1;}' +
    '.lu-k span{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);}' +
    '.lu-k small{display:block;font-size:11px;color:var(--text3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.lu-yrs{display:inline-flex;flex-wrap:wrap;gap:2px;padding:2px;border:1px solid var(--border);border-radius:9px;background:var(--bg2);margin:0 0 14px;}' +
    '.lu-yrs button{border:0;border-radius:7px;background:none;color:var(--text3);font:700 11px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;padding:6px 12px;cursor:pointer;}' +
    '.lu-yrs button.on{background:var(--accent);color:var(--accent-on,#221c08);}.lu-yrs button:disabled{opacity:.35;cursor:default;}' +
    '.lu-bar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px 14px;margin:0 0 4px;}.lu-bar .lu-yrs{margin:0;}.lu-bar button{min-height:30px;}' +
    '.lu-lab-s{display:flex;flex-direction:column;gap:4px;}.lu-lab-s span{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);}' +
    '.lu-lab-s select{font:700 12px Inter,system-ui,sans-serif;color:var(--text);background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:6px 10px;min-height:36px;}' +
    '.lu-h{display:flex;align-items:baseline;gap:10px;margin:26px 0 9px;padding-bottom:7px;border-bottom:1px solid var(--border2);}' +
    '.lu-h h3{font-family:Inter,system-ui,sans-serif;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);}' +
    '.lu-h small{margin-left:auto;font-size:11px;color:var(--text3);}' +
    '.lu-five{white-space:normal;line-height:1.45;} .lu-five a{color:var(--text);text-decoration:none;font-weight:600;} .lu-five a:hover{color:var(--accent);}' +
    '.lu-five i{font-style:normal;color:var(--text3);margin:0 5px;}' +
    '.lu-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;}' +
    '.lu-chg{white-space:normal!important;line-height:1.4;}.lu-chg small{display:block;font-size:11px;font-weight:500;color:var(--text3);margin-top:2px;white-space:normal;}.lu-in{color:#3F8A4B;font-weight:700;margin-right:8px;display:inline-block;}.lu-out{color:#C5533F;font-weight:700;margin-right:8px;display:inline-block;}[data-theme="dark"] .lu-in{color:#7DB57F;}[data-theme="dark"] .lu-out{color:#E08A78;}' +
    '.lu-note{font-size:11px;color:var(--text3);line-height:1.6;margin-top:16px;}' +
    '@media(max-width:820px){.lu-two{grid-template-columns:1fr;}.lu-kpis{grid-template-columns:repeat(2,minmax(0,1fr));}.lu-bar button{min-height:34px;}.lu-h{flex-wrap:wrap;}.lu-h small{margin-left:0;}.lu-tlw table{table-layout:fixed;width:100%!important;min-width:0!important;}.lu-tlw th:nth-child(1){width:54px;}.lu-tlw th:nth-child(3){width:26px;}.lu-tlw th:nth-child(4){width:42px;}.lu-tlw td,.lu-tlw th{padding-left:5px!important;padding-right:5px!important;}.lu-tlw td:first-child{white-space:normal!important;}}';
  function css() { if (document.getElementById('lu-css')) return; var s = document.createElement('style'); s.id = 'lu-css'; s.textContent = CSS; document.head.appendChild(s); }
  var sg = function (v, d) { return v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d == null ? 1 : d); };
  // short = last name, unless two players share it (Cameron & Cayden Boozer) — then the full name
  function last(n) { var p = String(n).split(' '); return p.length > 1 ? p.slice(1).join(' ') : n; }
  function name(S, k, short) { var n = (S.P[k] || k.replace(/^n:/, '')) || '?'; if (!short) return n;
    if (!S._dup) { S._dup = {}; var c = {}; Object.keys(S.min).forEach(function (kk) { var l = last(S.P[kk] || kk); c[l] = (c[l] || 0) + 1; }); Object.keys(c).forEach(function (l) { if (c[l] > 1) S._dup[l] = 1; }); }
    var l = last(n); return S._dup[l] ? n : l; }
  function plink(S, k, short) { var n = esc(name(S, k, short)); return /^\d+$/.test(k) ? '<a href="player.html?espn=' + k + '">' + n + '</a>' : n; }
  function five(S, t) { return t ? '<span class="lu-five">' + t.ks.map(function (k) { return plink(S, k, true); }).join('<i>·</i>') + '</span>' : '—'; }
  var wl = function (r) { return (r.w || r.l) ? r.w + '–' + r.l : '—'; };

  function res5(x) { return (x[4] != null && x[5] != null) ? x[4] - x[5] : null; }
  function html(S) {
    var sheet = function (head, rows) { return '<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>'; };
    var fiveRows = function (list, extra) { return list.map(function (t) { return '<tr><td class="l">' + five(S, t) + '</td><td>' + t.n + '</td><td>' + wl(t) + '</td><td>' + sg(t.avg) + '</td><td class="l dim">' + (extra ? extra(t) : '') + '</td></tr>'; }).join(''); };
    var bw = '<div class="lu-two"><div><div class="lu-h"><h3>Best-performing fives</h3><small>2+ starts · by avg margin</small></div>' +
      (S.best.length ? sheet('<th class="l">Starting five</th><th>GS</th><th>W-L</th><th data-heat="1">Margin</th><th></th>', fiveRows(S.best)) : '<div class="lu-note">No starting five started twice.</div>') + '</div>' +
      '<div><div class="lu-h"><h3>Worst-performing fives</h3><small>2+ starts · by avg margin</small></div>' +
      (S.worst.length ? sheet('<th class="l">Starting five</th><th>GS</th><th>W-L</th><th data-heat="1">Margin</th><th></th>', fiveRows(S.worst)) : '<div class="lu-note">—</div>') + '</div></div>';
    var per = function (q, k) { return q.g ? (q[k] / q.g).toFixed(1) : '—'; };
    var plRows = S.players.map(function (p) {
      var sm = p.sn ? p.sm / p.sn : null, nm = p.nn ? p.nm / p.nn : null;
      return '<tr><td class="l nm">' + plink(S, p.k) + '</td><td>' + p.s.g + '</td><td>' + p.b.g + '</td>' +
        '<td>' + per(p.s, 'min') + '</td><td>' + per(p.s, 'pts') + '</td><td>' + per(p.b, 'min') + '</td><td>' + per(p.b, 'pts') + '</td>' +
        '<td>' + (p.sn ? p.sw + '–' + p.sl : '—') + '</td><td>' + sg(sm) + '</td><td>' + (p.nn ? p.nw + '–' + p.nl : '—') + '</td><td>' + sg(nm) + '</td></tr>';
    }).join('');
    var benchStars = S.players.filter(function (p) { return p.b.g >= 4; }).sort(function (a, b) { return b.b.pts / b.b.g - a.b.pts / a.b.g; }).slice(0, 3);
    var plTable = '<div class="lu-h"><h3>Starters & bench</h3><small>his line as a starter vs off the bench · team result when he starts vs not</small></div>' +
      (benchStars.length ? '<div class="lu-note" style="margin:0 0 8px;">Best off the bench: ' + benchStars.map(function (p) { return '<b>' + esc(name(S, p.k)) + '</b> ' + (p.b.pts / p.b.g).toFixed(1) + ' ppg in ' + (p.b.min / p.b.g).toFixed(0) + ' min (' + p.b.g + ' g)'; }).join(' · ') + '</div>' : '') +
      sheet('<th class="l">Player</th><th title="Games started">GS</th><th title="Games off the bench">Bench G</th><th title="Minutes as a starter">MPG st</th><th data-heat="1" title="Points as a starter">PPG st</th><th title="Minutes off the bench">MPG bn</th><th data-heat="1" title="Points off the bench">PPG bn</th><th title="Team record when he starts">W-L starts</th><th data-heat="1" title="Avg margin when he starts">Margin</th><th title="Team record when he doesn\'t start">W-L other</th><th data-heat="1" title="Avg margin when he doesn\'t start">Margin</th>', plRows);
    // one table for who starts: the most used fives, then any window or month where it was someone else
    var span = function (t) { var d = function (x) { return x ? new Date(x + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; }; return d(t.first) + (t.n > 1 && t.last !== t.first ? ' – ' + d(t.last) : ''); };
    var row = function (lbl, t, of) { return '<tr><td class="l nm">' + lbl + '</td><td class="l">' + five(S, t) + '</td><td>' + (t ? t.n + (of ? '/' + of : '') : '—') + '</td><td>' + (t ? wl(t) : '—') + '</td><td>' + (t ? sg(t.avg) : '—') + '</td></tr>'; };
    var main = S.all[0], same = function (t) { return !!(t && main) && t.ks.slice().sort().join() === main.ks.slice().sort().join(); };
    var rows = S.all.slice(0, 5).map(function (t) { return row(span(t), t); })
      .concat(S.recent.filter(function (r) { return r.games < S.G.length && r.top && !same(r.top); }).map(function (r) { return row(r.lbl, r.top, r.games); }))
      ;
    // the timeline: every change to the five, who came in and out, and the record until the next change
    var eras = [], prev = null;
    S.G.forEach(function (x) {
      if (x[6].length !== 5) return;
      var cur = {}; x[6].forEach(function (k) { cur[k] = 1; });
      var same = prev && x[6].every(function (k) { return prev[k]; });
      if (!same) eras.push({ d: x[1], ks: x[6], inn: prev ? x[6].filter(function (k) { return !prev[k]; }) : [], out: prev ? Object.keys(prev).filter(function (k) { return !cur[k]; }) : [], w: 0, l: 0, n: 0 });
      var e = eras[eras.length - 1], m = res5(x); e.n++; if (m != null) { m > 0 ? e.w++ : e.l++; }
      prev = cur;
    });
    var dfmt = function (x) { return x ? new Date(x + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
    var eraRow = function (e, i) {
      var ch = i === 0 ? '<b>Opening five</b>' : e.inn.map(function (k) { return '<span class="lu-in">+ ' + esc(name(S, k, true)) + '</span>'; }).concat(e.out.map(function (k) { return '<span class="lu-out">− ' + esc(name(S, k, true)) + '</span>'; })).join(' ');
      return '<tr><td class="l nm">' + dfmt(e.d) + '</td><td class="l lu-chg">' + ch + '<small>' + e.ks.map(function (k) { return esc(name(S, k, true)); }).join(' · ') + '</small></td><td>' + e.n + '</td><td class="strong">' + e.w + '–' + e.l + '</td></tr>';
    };
    var timeline = eras.length > 1 ? '<div class="lu-h"><h3>Starting-five timeline</h3><small>' + (eras.length - 1) + (eras.length === 2 ? ' change' : ' changes') + ' · record until the next change</small></div><div data-fit-keep class="lu-tlw">' +
      sheet('<th class="l">From</th><th class="l">Change</th><th title="Games until the next change">G</th><th>W-L</th>', eras.map(eraRow).join('')) + '</div>' : '';
    var starters = sheet('<th class="l">When</th><th class="l">Starting five</th><th title="Games started together">GS</th><th>W-L</th><th data-heat="1" title="Average final margin in those games">Margin</th>', rows.join(''));
    var sum = wl(S.rec) + ' · ' + S.all.length + (S.all.length === 1 ? ' five used' : ' fives used') + (main ? ' · most used ' + main.n + ' of ' + S.G.length + (S.G.length === 1 ? ' game, ' : ' games, ') + wl(main) + ', margin ' + sg(main.avg) : '');
    return '<div class="lu-h"><h3>Starting fives</h3><small>' + sum + '</small></div>' + starters + timeline +
      (S.best.length || S.worst.length ? bw : '') + (S.players.length ? plTable : '') +
      '<div class="lu-note">Counted from real box scores (who started, minutes, points) and final scores. Margin = average final margin in those games.</div>';
  }

  var WINS = [[0, 'Season'], [15, 'Last 15'], [10, 'Last 10'], [5, 'Last 5']];
  // the tab: one control bar (season + window) that drives everything below it
  function render(outer, full, opts) {
    opts = opts || {}; css();
    outer.innerHTML = '<div class="lu-bar"></div><div id="luUsageHost"></div><div id="luHistHost"><div class="empty-note" style="padding:20px;">Loading lineups…</div></div><div id="luFiveHost"></div>';
    var bar = outer.querySelector('.lu-bar'), uh = outer.querySelector('#luUsageHost'), host = outer.querySelector('#luHistHost'), fh = outer.querySelector('#luFiveHost');
    var U = g.TDCLineupUsage;
    return Promise.all([load(full), U ? U.seasons(full) : Promise.resolve([])]).then(function (r) {
      var F = r[0], ys = {};
      Object.keys((F && F.s) || {}).forEach(function (y) { if ((F.s[y] || []).length) ys[y] = 1; }); r[1].forEach(function (y) { ys[y] = 1; });
      var yrs = Object.keys(ys).map(Number).sort(function (x, y) { return y - x; });
      if (!yrs.length) { host.innerHTML = '<div class="empty-note" style="padding:20px;">No lineup history on file for this team yet.</div>'; return; }
      // the team page passes lockSeason: its one season picker drives this tab, so there's no second picker here
      if (opts.lockSeason && opts.season && yrs.indexOf(+opts.season) < 0) { host.innerHTML = '<div class="empty-note" style="padding:20px;">No lineup data for ' + (opts.season - 1) + '-' + String(opts.season).slice(2) + '. Lineups start in ' + (yrs[yrs.length - 1] - 1) + '-' + String(yrs[yrs.length - 1]).slice(2) + '.</div>'; bar.innerHTML = ''; return; }
      var yr = opts.season && yrs.indexOf(+opts.season) >= 0 ? +opts.season : yrs[0], win = 0;
      function lab() {   // the five-man ratings cover whole seasons, so the window doesn't remount them
        fh.innerHTML = '';
        var pro = g.TDC_ONOFFLAB && [2024, 2025, 2026].indexOf(yr) >= 0 && (!g.TDCGate || g.TDCGate.has('pro'));
        if (pro) { fh.innerHTML = '<div class="lu-h"><h3>Best lineups</h3><small>2- to 5-man units from every possession of play-by-play, ranked vs D-I</small></div><div class="lu-lab"></div>';
          g.TDC_ONOFFLAB.mount(fh.querySelector('.lu-lab'), { team: full, season: yr, seasons: [yr], lockTeam: true, modes: ['lineups'], unit: 5 }); }
        else if (g.TDC_LINEUPS && g.TDC_LINEUPS.section) { var y0 = yr; g.TDC_LINEUPS.section(full, yr, {}).then(function (h) { if (h && y0 === yr) fh.innerHTML = '<div class="lu-h"><h3>Five-man lineups & trios</h3><small>every possession from play-by-play</small></div>' + h; }).catch(function () {}); }
      }
      function drawBar(n) {
        bar.innerHTML = (opts.lockSeason ? '' : '<label class="lu-lab-s"><span>Season</span><select aria-label="Season">' + yrs.map(function (y) { return '<option value="' + y + '"' + (y === yr ? ' selected' : '') + '>' + (y - 1) + '-' + String(y).slice(2) + '</option>'; }).join('') + '</select></label>') +
          '<div class="lu-yrs" role="group" aria-label="Games">' + WINS.map(function (w) { return '<button data-w="' + w[0] + '" class="' + (w[0] === win ? 'on' : '') + '"' + (w[0] && n <= w[0] ? ' disabled title="Only ' + n + (n === 1 ? ' game' : ' games') + ' so far"' : '') + '>' + w[1] + '</button>'; }).join('') + '</div>';
        var sel = bar.querySelector('select'); if (sel) sel.onchange = function () { yr = +this.value; win = 0; show(); lab(); };
        bar.querySelectorAll('button').forEach(function (b) { b.onclick = function () { if (b.disabled) return; win = +b.dataset.w; show(); }; });
      }
      function show() {
        var label = (WINS.filter(function (w) { return w[0] === win; })[0] || WINS[0])[1].toLowerCase();
        var S = F ? season(F, yr, win) : null;
        host.innerHTML = S ? html(S) : '';
        if (g.tdcSheetHeat) host.querySelectorAll('table.sheet').forEach(function (t) { g.tdcSheetHeat(t); });
        var drawn = U ? U.draw(uh, full, yr, win, label) : Promise.resolve(0);
        drawn.then(function (nu) { drawBar(Math.max(nu || 0, F && F.s[String(yr)] ? F.s[String(yr)].length : 0)); });
      }
      show(); lab();
    });
  }
  // ---- Compare page: one team's real lineup card + a side-by-side table ----
  function summary(S) {
    if (!S) return null;
    var tot = 0, bench = 0; S.G.forEach(function (x) { var st = {}; x[6].forEach(function (k) { st[k] = 1; }); (x[7] || []).forEach(function (r) { tot += r[2]; if (!st[r[0]]) bench += r[2]; }); });
    var top = S.all[0], last5 = S.recent[2] && S.recent[1] ? S.recent[1] : null;
    return { games: S.G.length, rec: S.rec, fives: S.all.length, top: top, topShare: top ? top.n / S.G.length : null,
      last5: last5, best: S.best[0] || null, benchShare: tot ? bench / tot : null, benchPpg: S.G.length ? bench / S.G.length : null };
  }
  function card(S, label) {
    css(); if (!S) return '<div class="lu-note">No box-score lineup history for this season.</div>';
    var M = summary(S), t = M.top;
    var row = function (k, v, sub) { return '<tr><td class="l nm">' + k + '</td><td class="l">' + v + '</td><td class="l dim">' + (sub || '') + '</td></tr>'; };
    return (label ? '<div class="lu-note" style="margin:0 0 6px;">' + esc(label) + '</div>' : '') +
      '<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense"><tbody>' +
      row('Most common starting five', five(S, t), t ? t.n + ' of ' + M.games + ' starts · ' + wl(t) + ' · ' + sg(t.avg) + ' margin' : '') +
      row('Starters, last 5 games', M.last5 && M.last5.top ? five(S, M.last5.top) : '—', M.last5 ? M.last5.top.n + '/5 starts · ' + M.last5.distinct + ' five' + (M.last5.distinct > 1 ? 's' : '') + ' used' : '') +
      row('Best starting five', M.best ? five(S, M.best) : '—', M.best ? M.best.n + ' starts · ' + wl(M.best) + ' · ' + sg(M.best.avg) : '2+ starts needed') +
      row('Starting fives used', M.fives, wl(M.rec) + ' record') +
      row('Bench scoring', M.benchPpg != null ? M.benchPpg.toFixed(1) + ' ppg' : '—', M.benchShare != null ? Math.round(100 * M.benchShare) + '% of team points' : '') +
      '</tbody></table></div>';
  }
  function compareTable(SA, SB, A, B) {
    css(); var a = summary(SA), b = summary(SB);
    var cell = function (M, f) { return M ? f(M) : '—'; };
    var rows = [
      ['Record', function (M) { return wl(M.rec); }],
      ['Starting fives used', function (M) { return M.fives; }],
      ['Most-used five: starts', function (M) { return M.top ? M.top.n + ' (' + Math.round(100 * M.topShare) + '%)' : '—'; }],
      ['Most-used five: record', function (M) { return M.top ? wl(M.top) : '—'; }],
      ['Most-used five: avg margin', function (M) { return M.top ? sg(M.top.avg) : '—'; }],
      ['Best five: avg margin', function (M) { return M.best ? sg(M.best.avg) : '—'; }],
      ['Bench points per game', function (M) { return M.benchPpg != null ? M.benchPpg.toFixed(1) : '—'; }],
      ['Bench share of points', function (M) { return M.benchShare != null ? Math.round(100 * M.benchShare) + '%' : '—'; }]
    ].map(function (r) { return '<tr><td class="l nm">' + r[0] + '</td><td>' + cell(a, r[1]) + '</td><td>' + cell(b, r[1]) + '</td></tr>'; }).join('');
    return '<div class="sheet-wrap" style="max-height:none;"><table class="sheet dense"><thead><tr><th class="l"></th><th>' + esc(A) + '</th><th>' + esc(B) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="lu-note">Counted from every box score: who started, the final margin, and points from players who came off the bench.</div>';
  }
  g.TDCLineupHist = { load: load, season: season, render: render, summary: summary, card: card, compareTable: compareTable };
})(window);
