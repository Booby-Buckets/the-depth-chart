/* tdc-huntgreat.js — "Hunt great" shot clock + "your offense protects your defense" (scripts/build_possession_value.mjs).
 *
 *   TDC_HUNT.load(y) / seasons()          season file / built seasons (newest first)
 *   TDC_HUNT.team(row, ctx)               -> derived team numbers (shot grades, turnover + missed-rim cost)
 *   TDC_HUNT.player(row, ctx)             -> derived player numbers
 *   TDC_HUNT.ctx(pv, mastery)             -> league baselines + lookups shared by the two above
 *   TDC_HUNT.grid(clock, lgClock)         -> html: early / set / late × great / average / bad sheet
 *   TDC_HUNT.renderTeam(host, {teamId})   -> team page panel (also shows the team's green lights)
 *
 * Grades: great = a rim attempt or a shot the shooter has a green light on (1.1+ pts/shot, see tdc-mastery.js);
 * average = a three without a green light; bad = a tough two or pull-up three without one.
 * Clock: early 0-7 s after winning the ball (or an offensive rebound), set 8-20 s, late 21+ s.
 * Cost of a turnover = the points per possession the team gave up, plus what the opponent scores on the next trip
 * beyond what it scores after a made basket (D-I rates, so a team's number isn't noise from its own small sample).
 */
(function () {
  var BASE = 'scripts/data/possession_value/', V = '?v=1';
  var B = ['early', 'set', 'late'], G = ['great', 'avg', 'bad'];
  var BL = { early: 'Early · 0–7 s', set: 'Set · 8–20 s', late: 'Late · 21+ s' }, GL = { great: 'Great', avg: 'Average', bad: 'Bad' };
  var CACHE = {};
  function get(f) { return CACHE[f] || (CACHE[f] = fetch(BASE + f + V).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })); }
  function load(y) { return get(y + '.json'); }
  function seasons() { return get('index.json').then(function (d) { return d ? d.seasons : []; }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function p2(v) { return (v == null || !isFinite(v)) ? '—' : v.toFixed(2); }
  function pc(v) { return (v == null || !isFinite(v)) ? '—' : (100 * v).toFixed(1); }
  function rt(a) { return a && a[0] ? a[1] / a[0] : null; }

  // a flat clock array (bucket × grade × [att, pts]) -> {early:{great:{att,pts,pps}...}, tot, share(b,g)}
  function clock(c) {
    var o = { tot: 0, pts: 0 };
    B.forEach(function (b, bi) { o[b] = {}; G.forEach(function (g, gi) { var k = (bi * 3 + gi) * 2; o[b][g] = { att: c[k], pts: c[k + 1], pps: c[k] ? c[k + 1] / c[k] : null }; o.tot += c[k]; o.pts += c[k + 1]; }); });
    o.by = function (filterB, filterG) { var a = 0, p = 0; B.forEach(function (b) { if (filterB && filterB !== b) return; G.forEach(function (g) { if (filterG && filterG !== g) return; a += o[b][g].att; p += o[b][g].pts; }); }); return { att: a, pts: p, pps: a ? p / a : null, share: o.tot ? a / o.tot : null }; };
    return o;
  }
  // team row: [id, poss, pts, clock×18, toLive×2, toDead×2, rimMiss×2, otherMiss×2, made×2]
  function splitT(r) { return { id: r[0], poss: r[1], pts: r[2], clock: r.slice(3, 21), toLive: r.slice(21, 23), toDead: r.slice(23, 25), rimMiss: r.slice(25, 27), otherMiss: r.slice(27, 29), made: r.slice(29, 31) }; }
  // player row: [id, clock×18, toLive×2, toDead×2, rimMiss×2]
  function splitP(r) { return { id: r[0], clock: r.slice(1, 19), toLive: r.slice(19, 21), toDead: r.slice(21, 23), rimMiss: r.slice(23, 25) }; }

  function ctx(pv, ms) {
    var L = splitT(pv.league), base = rt(L.made);
    var c = { lg: L, ppp: L.pts / L.poss, base: base, livePrem: rt(L.toLive) - base, deadPrem: rt(L.toDead) - base, rimPrem: rt(L.rimMiss) - base, lgClock: clock(L.clock), teams: {}, tgp: {}, players: {}, lgRimFg: null };
    if (ms) {
      c.teams = ms.teams || {};
      (ms.teamRows || []).forEach(function (r) { c.tgp[r[0]] = { gp: r[1], rimAtt: r[4], rimMade: r[5] }; });
      var C = ms.pcols.length;
      ms.players.forEach(function (r) { c.players[r[0]] = { name: r[1], team: r[2], pos: r[3], min: r[4], gp: r[5], rimAtt: r[C], rimMade: r[C + 1] }; });
      c.lgRimFg = ms.league[0][1] / ms.league[0][0];
    }
    return c;
  }
  function team(r, c) {
    var t = splitT(r), k = clock(t.clock), g = (c.tgp[t.id] || {}).gp || null, ppp = t.pts / t.poss;
    var live = t.toLive[0], dead = t.toDead[0];
    var toCost = live * (ppp + c.livePrem) + dead * (ppp + c.deadPrem);
    var tg = c.tgp[t.id] || {};
    var rimLeft = tg.rimAtt ? (c.lgRimFg - tg.rimMade / tg.rimAtt) * tg.rimAtt * 2 : null;   // points vs finishing at the D-I rate
    return {
      id: t.id, meta: c.teams[t.id] || null, gp: g, poss: t.poss, ppp: ppp, clock: k,
      great: k.by(null, 'great').share, bad: k.by(null, 'bad').share, early: k.by('early').share,
      earlyGreat: k.by('early', 'great').share, earlyPps: k.by('early').pps, latePps: k.by('late').pps, badPps: k.by(null, 'bad').pps,
      to: g ? (live + dead) / g : null, livePct: (live + dead) ? live / (live + dead) : null, oppAfterLive: rt(t.toLive),
      toCost: toCost, toCostG: g ? toCost / g : null,
      rimMissG: g ? t.rimMiss[0] / g : null, oppAfterRim: rt(t.rimMiss), rimFg: tg.rimAtt ? tg.rimMade / tg.rimAtt : null, rimPlusG: (g && rimLeft != null) ? -rimLeft / g : null
    };
  }
  function player(r, c) {
    var p = splitP(r), k = clock(p.clock), m = c.players[p.id] || {};
    var live = p.toLive[0], dead = p.toDead[0], toCost = live * (c.ppp + c.livePrem) + dead * (c.ppp + c.deadPrem);
    return {
      id: p.id, name: m.name || '', teamId: m.team, pos: m.pos || '', min: m.min || 0, gp: m.gp || 0, fga: k.tot, clock: k,
      great: k.by(null, 'great').share, avg: k.by(null, 'avg').share, bad: k.by(null, 'bad').share, badN: k.by(null, 'bad').att, earlyBad: k.by('early', 'bad').att,
      earlyPps: k.by('early').pps, badPps: k.by(null, 'bad').pps, pps: k.tot ? k.pts / k.tot : null,
      live: live, dead: dead, toCost: toCost, toCost40: m.min ? 40 * toCost / m.min : null, liveShare: (live + dead) ? live / (live + dead) : null,
      rimAtt: m.rimAtt || 0, rimFg: m.rimAtt ? m.rimMade / m.rimAtt : null, rimPlus: m.rimAtt ? (m.rimMade / m.rimAtt - c.lgRimFg) * m.rimAtt * 2 : null, rimMissEnd: p.rimMiss[0]
    };
  }

  function heat(pps) { return (window.TDC_MASTERY && pps != null) ? TDC_MASTERY.heat(pps - 1.1) : ''; }
  // early / set / late × great / average / bad: share of the team's shots and points per shot, D-I alongside
  function grid(k, lg) {
    var h = '<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">When</th>' +
      G.map(function (g) { return '<th>' + GL[g] + ' · share</th><th>Pts / shot</th>'; }).join('') + '<th>All · share</th><th>Pts / shot</th></tr></thead><tbody>';
    B.forEach(function (b) {
      h += '<tr><td class="l">' + BL[b] + '</td>';
      G.forEach(function (g) {
        var s = k.by(b, g), l = lg ? lg.by(b, g) : null;
        h += '<td>' + pc(s.share) + '%' + (l ? ' <span class="dim">(' + pc(l.share) + ')</span>' : '') + '</td><td class="' + (s.att >= 15 ? heat(s.pps) : '') + '">' + p2(s.pps) + '</td>';
      });
      var a = k.by(b), la = lg ? lg.by(b) : null;
      h += '<td>' + pc(a.share) + '%' + (la ? ' <span class="dim">(' + pc(la.share) + ')</span>' : '') + '</td><td class="' + heat(a.pps) + '"><b>' + p2(a.pps) + '</b></td></tr>';
    });
    var tg = G.map(function (g) { var s = k.by(null, g), l = lg ? lg.by(null, g) : null; return '<td><b>' + pc(s.share) + '%</b>' + (l ? ' <span class="dim">(' + pc(l.share) + ')</span>' : '') + '</td><td class="' + heat(s.pps) + '"><b>' + p2(s.pps) + '</b></td>'; }).join('');
    h += '<tr><td class="l"><b>Every shot</b></td>' + tg + '<td><b>100%</b></td><td class="' + heat(k.tot ? k.pts / k.tot : null) + '"><b>' + p2(k.tot ? k.pts / k.tot : null) + '</b></td></tr>';
    return h + '</tbody></table></div>';
  }

  function css() {
    if (document.getElementById('hg-css')) return;
    var s = document.createElement('style'); s.id = 'hg-css';
    s.textContent = '.hg .dim{color:var(--text3);font-weight:500;}' +
      '.hg-sec{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:2px solid var(--text);padding-bottom:8px;margin:22px 0 8px;}' +
      '.hg-sec span:first-child{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--text);}' +
      '.hg-lede{font-size:15px;line-height:1.5;color:var(--text);margin:0 0 12px;}.hg-lede b{font-weight:800;}' +
      '.hg-ctl select{font:600 13px Inter,system-ui,sans-serif;padding:6px 10px;border:1px solid var(--border2,#C6C0B2);border-radius:8px;background:var(--bg2);color:var(--text);}' +
      '.hg-empty{padding:22px;text-align:center;color:var(--text3);border:1px dashed var(--border2,#C6C0B2);border-radius:12px;font-size:13px;}';
    document.head.appendChild(s);
  }
  function rank(list, key, id, desc) {
    var s = list.filter(function (x) { return x[key] != null; }).sort(function (a, b) { return desc ? b[key] - a[key] : a[key] - b[key]; });
    var i = s.findIndex(function (x) { return x.id === id; });
    return i < 0 ? null : { n: i + 1, of: s.length };
  }
  // "3rd fewest" in the top half, "11th most" in the bottom half
  function place(r, lo, hi) { var n = r.n <= r.of / 2 ? r.n : r.of - r.n + 1, w = r.n <= r.of / 2 ? lo : hi; return n === 1 ? 'the ' + w : ord(n) + ' ' + w; }
  function sgn(v) { return (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2); }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  // ── team page ───────────────────────────────────────────────────────────────────────────────────────────────────
  function renderTeam(host, o) {
    if (!host) return; css();
    if (window.TDC_MASTERY) TDC_MASTERY.css();
    host.innerHTML = '<div class="hg-empty">Loading every possession…</div>';
    seasons().then(function (ys) {
      if (!ys.length) { host.innerHTML = '<div class="hg-empty">No possession data yet.</div>'; return; }
      var y = o.season && ys.indexOf(o.season) >= 0 ? o.season : ys[0];
      Promise.all([load(y), window.TDC_MASTERY ? TDC_MASTERY.load(y) : null]).then(function (res) {
        var pv = res[0], ms = res[1];
        if (!pv) { host.innerHTML = '<div class="hg-empty">Could not load the data.</div>'; return; }
        var c = ctx(pv, ms), id = String(o.teamId);
        var row = pv.teams.filter(function (r) { return String(r[0]) === id; })[0];
        if (!row) { host.innerHTML = '<div class="hg-empty">No D-I play-by-play for this team in ' + TDC_MASTERY.sl(y) + '.</div>'; return; }
        var all = pv.teams.map(function (r) { return team(r, c); }), t = all.filter(function (x) { return x.id === id; })[0];
        var rG = rank(all, 'great', id, true), rB = rank(all, 'bad', id, false), rT = rank(all, 'toCostG', id, false);
        var lede = '<b>' + pc(t.great) + '%</b> of its shots are great looks (' + place(rG, 'most', 'fewest') + ' in D-I) and <b>' + pc(t.bad) + '%</b> are bad ones (' + place(rB, 'fewest', 'most') + '). ' +
          'Turnovers cost it <b>' + p2(t.toCostG) + '</b> points a game (' + place(rT, 'least', 'most') + (t.ppp > c.ppp + 0.05 ? ', partly because each one throws away a ' + t.ppp.toFixed(2) + '-point possession' : '') + ')' + (t.rimPlusG != null ? ', and finishing at the rim ' + (t.rimPlusG >= 0 ? 'adds <b>' + p2(t.rimPlusG) + '</b>' : 'costs <b>' + p2(-t.rimPlusG) + '</b>') + ' points a game against the D-I rate' : '') + '.';
        var sel = '<select id="hgTeamSeason">' + ys.map(function (v) { return '<option value="' + v + '"' + (v === y ? ' selected' : '') + '>' + TDC_MASTERY.sl(v) + '</option>'; }).join('') + '</select>';
        var h = '<div class="hg"><div class="hg-sec"><span>Hunt great · shot clock</span><span class="hg-ctl">' + sel + '</span></div><p class="hg-lede">' + lede + '</p>' + grid(t.clock, c.lgClock) +
          '<div class="hg-sec"><span>Offense protects defense</span><span></span></div>' +
          '<div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l"></th><th>Team</th><th>D-I</th></tr></thead><tbody>' +
          '<tr><td class="l">Points per possession</td><td><b>' + t.ppp.toFixed(3) + '</b></td><td>' + c.ppp.toFixed(3) + '</td></tr>' +
          '<tr><td class="l">Turnovers per game</td><td>' + p2(t.to) + '</td><td>' + p2(avg(all, 'to')) + '</td></tr>' +
          '<tr><td class="l">Live-ball (stolen) share</td><td>' + pc(t.livePct) + '%</td><td>' + pc(avg(all, 'livePct')) + '%</td></tr>' +
          '<tr><td class="l">Opponent pts / poss after a steal</td><td>' + p2(t.oppAfterLive) + '</td><td>' + p2(rt(c.lg.toLive)) + '</td></tr>' +
          '<tr><td class="l">Points lost to turnovers per game</td><td><b>' + p2(t.toCostG) + '</b></td><td>' + p2(avg(all, 'toCostG')) + '</td></tr>' +
          '<tr><td class="l">Rim FG%</td><td>' + pc(t.rimFg) + '%</td><td>' + pc(c.lgRimFg) + '%</td></tr>' +
          '<tr><td class="l">Rim points vs the D-I rate, per game</td><td><b>' + sgn(t.rimPlusG) + '</b></td><td>0.00</td></tr>' +
          '<tr><td class="l">Opponent pts / poss after a missed rim attempt</td><td>' + p2(t.oppAfterRim) + '</td><td>' + p2(rt(c.lg.rimMiss)) + '</td></tr>' +
          '</tbody></table></div>';
        // its players: green lights + grades
        if (ms) {
          var C = ms.pcols.length, pl = pv.players.map(function (r) { return player(r, c); }).filter(function (p) { return String(p.teamId) === id && p.fga >= 40; }).sort(function (a, b) { return b.fga - a.fga; });
          var gl = {}; ms.players.forEach(function (r) { if (String(r[2]) !== id) return; var cn = r.slice(C), g = [];
            TDC_MASTERY.ORDER.forEach(function (k) { var S = TDC_MASTERY.SHOTS[k]; if (!(S.mastery || k === 'three') || (S.tagged && !TDC_MASTERY.hasTags(ms))) return; var s = TDC_MASTERY.sum(cn, k); if (TDC_MASTERY.status(s.pps, s.att, S.floor) === 'green') g.push(S.short); });
            gl[r[0]] = g; });
          h += '<div class="hg-sec"><span>Players · shot grades and green lights</span><span></span></div><div class="sheet-wrap"><table class="sheet dense"><thead><tr><th class="l">Player</th><th class="l">Pos</th><th>FGA</th><th>Great</th><th>Average</th><th>Bad</th><th>Pts / shot</th><th>Early bad</th><th>Turnover cost</th><th>Rim FG%</th><th class="l">Green lights</th></tr></thead><tbody>' +
            pl.map(function (p) { return '<tr><td class="l"><a href="player.html?espn=' + esc(p.id) + '&name=' + encodeURIComponent(p.name) + '&tab=mastery">' + esc(p.name) + '</a></td><td class="l">' + esc(p.pos) + '</td><td>' + p.fga + '</td><td>' + pc(p.great) + '%</td><td>' + pc(p.avg) + '%</td><td>' + pc(p.bad) + '%</td><td class="' + heat(p.pps) + '"><b>' + p2(p.pps) + '</b></td><td>' + p.earlyBad + '</td><td>' + p2(p.toCost) + '</td><td>' + pc(p.rimFg) + '</td><td class="l">' + ((gl[p.id] || []).join(', ') || '—') + '</td></tr>'; }).join('') +
            '</tbody></table></div>';
        }
        host.innerHTML = h + '</div>';
        var s = document.getElementById('hgTeamSeason'); if (s) s.onchange = function () { renderTeam(host, Object.assign({}, o, { season: +s.value })); };
      });
    });
  }
  function avg(list, k) { var v = list.map(function (x) { return x[k]; }).filter(function (x) { return x != null && isFinite(x); }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; }

  window.TDC_HUNT = { B: B, G: G, BL: BL, GL: GL, load: load, seasons: seasons, ctx: ctx, team: team, player: player, clock: clock, grid: grid, renderTeam: renderTeam, avg: avg, css: css, rt: rt };
})();
