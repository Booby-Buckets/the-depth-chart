/* Post: best game ratings (RTG) across the 2026-27 preseason scrimmages — scripts/data/scrimmage_results_2027.json.
 * RTG = the game recaps' 0-10 box-score rating (game.html playerRating: 5 + 0.135 x Hollinger Game Score, clamped 2-10;
 * scrimmage.html shows the same column). "Average" = his mean RTG over every scrimmage he played 10+ minutes in
 * (d.pstat = minimum scrimmages); "Best single game" = one row per game line. Unofficial games, display only. */
TDC_POSTS.add('scrimrtg', {
  group: 'Preseason', label: 'Scrimmage RTG leaders',
  note: 'Players with the best box-score game rating (RTG, 0-10: 5 ≈ an average game, 6.5 strong, 8+ great) in unofficial preseason scrimmages. Average = across every scrimmage he played 10+ minutes; or the best single games.',
  opts: { conf: true, team: true, tier: true, dir: true, upLabel: 'Average RTG', downLabel: 'Best single game',
    statsLabel: 'Minimum scrimmages', stats: [['1', '1+'], ['2', '2+'], ['3', '3+']] },
  load: async function (d, H) {
    var N = function (x) { return +x || 0; };
    var gameScore = function (p) { return N(p.pts) + 0.4 * N(p.fgm) - 0.7 * N(p.fga) - 0.4 * (N(p.fta) - N(p.ftm)) + 0.7 * N(p.oreb) + 0.3 * N(p.dreb)
      + N(p.stl) + 0.7 * N(p.ast) + 0.7 * N(p.blk) - 0.4 * N(p.pf) - N(p.tov); };
    var rtg = function (p) { return Math.max(2, Math.min(10, Math.round((5 + 0.135 * gameScore(p)) * 10) / 10)); };
    var S = await H.json('scripts/data/scrimmages_2027.json'), R = await H.json('scripts/data/scrimmage_results_2027.json');
    var rs = await H.ratings(), P = await H.players(), res = R.results || {}, n = Math.max(1, Math.min(25, +d.n || 10));
    var minG = Math.max(1, +d.pstat || 1), single = d.dir === 'down';
    var memo = {};
    var rowOf = function (full) { if (full in memo) return memo[full];
      return (memo[full] = rs.find(function (t) { return t.full === full; }) || rs.find(function (t) { return H.onTeam(t.full, full) || H.onTeam(t.team, full); }) || null); };
    var nk = function (s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/(jr|sr|ii|iii|iv)$/, ''); };
    var byTeam = {};
    P.forEach(function (p) { (byTeam[p.team] = byTeam[p.team] || []).push(p); });
    var findP = function (rt, name) { var k = nk(name), L = rt ? (byTeam[rt.team] || []) : [];
      return L.find(function (p) { return nk(p.name) === k; }) || null; };
    var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var lines = [];   // every 10+ minute player line, with its rating
    (S.games || []).forEach(function (g) {
      var r = res[g.id]; if (g.canceled || !r || !r.box) return;
      var dt = new Date(g.date + 'T12:00:00Z'), when = MO[dt.getUTCMonth()] + ' ' + dt.getUTCDate();
      ['home', 'away'].forEach(function (side) {
        var B = r.box[side]; if (!B || !B.players) return;
        var isHome = side === 'home', meFull = B.team || (isHome ? g.home : g.away), opFull = isHome ? g.away : g.home;
        var me = rowOf(meFull), op = rowOf(opFull); if (!me) return;   // D-I teams we rate (the opponent may be anyone)
        // out-of-scope lines still feed the colour pool (owner: shade against D-I, not just the players on the chart)
        var inScope = !(d.team && !(H.onTeam(me.team, d.team) || H.onTeam(me.full, d.team))) && !(d.conf && H.confName(me.conf) !== d.conf) && !(d.tier && H.tierOf(me.conf) !== d.tier);
        var opp = (g.neutral || isHome ? 'vs ' : 'at ') + H.school(op ? op.team : opFull);
        B.players.forEach(function (x) {
          if ((+x.min || 0) < 10 || x.pts == null) return;
          var p = findP(me, x.rn || x.name);
          lines.push({ key: me.team + '|' + nk(p ? p.name : (x.rn || x.name)), name: p ? p.name : (x.rn || x.name), team: me.team,
            espn: p && p.espn_id ? String(p.espn_id) : '', inScope: inScope, opp: opp, when: when, date: g.date, r: rtg(x), x: x,
            res: (r.hs != null && r.as != null) ? ((isHome ? r.hs > r.as : r.as > r.hs) ? 'W ' : 'L ') + (isHome ? r.hs + '-' + r.as : r.as + '-' + r.hs) : '' });
        });
      });
    });
    var f1 = function (v) { return (Math.round(v * 10) / 10).toFixed(1); };
    var rows;
    if (single) {
      rows = lines.slice().sort(function (a, b) { return b.r - a.r || N(b.x.pts) - N(a.x.pts); }).map(function (L) { var x = L.x;
        return { inScope: L.inScope, name: L.name, team: L.team, espn: L.espn, tag: L.opp + ' · ' + L.when, val: f1(L.r), _v: L.r,
          g: '1', min: String(x.min), pts: String(x.pts), reb: String(x.reb != null ? x.reb : N(x.oreb) + N(x.dreb)), ast: String(N(x.ast)),
          stl: String(N(x.stl)), blk: String(N(x.blk)), tov: String(N(x.tov)),
          fg: x.fgm != null ? x.fgm + '-' + x.fga : '', tp: x.tpm != null ? x.tpm + '-' + x.tpa : '', ft: x.ftm != null ? x.ftm + '-' + x.fta : '' }; });
    } else {
      var by = {};
      lines.forEach(function (L) { (by[L.key] = by[L.key] || []).push(L); });
      rows = Object.keys(by).map(function (k) { var A = by[k], g = A.length, sum = function (f) { return A.reduce(function (s, L) { return s + f(L.x); }, 0); };
          var avg = A.reduce(function (s, L) { return s + L.r; }, 0) / g, best = Math.max.apply(null, A.map(function (L) { return L.r; }));
          var pg = function (f) { return f1(sum(f) / g); };
          return { inScope: A[0].inScope, name: A[0].name, team: A[0].team, espn: A[0].espn, _g: g, _v: avg,
            tag: g + ' scrimmage' + (g > 1 ? 's' : ''),   // short: a long note runs into the RTG column
            val: f1(avg), g: String(g), best: f1(best),
            min: pg(function (x) { return N(x.min); }), pts: pg(function (x) { return N(x.pts); }), reb: pg(function (x) { return x.reb != null ? N(x.reb) : N(x.oreb) + N(x.dreb); }),
            ast: pg(function (x) { return N(x.ast); }), stl: pg(function (x) { return N(x.stl); }), blk: pg(function (x) { return N(x.blk); }), tov: pg(function (x) { return N(x.tov); }),
            fg: sum(function (x) { return N(x.fgm); }) + '-' + sum(function (x) { return N(x.fga); }),
            tp: sum(function (x) { return N(x.tpm); }) + '-' + sum(function (x) { return N(x.tpa); }),
            ft: sum(function (x) { return N(x.ftm); }) + '-' + sum(function (x) { return N(x.fta); }) }; })
        .filter(function (r) { return r._g >= minG; })
        .sort(function (a, b) { return b._v - a._v || b._g - a._g || +b.pts - +a.pts; });
    }
    // colour pool = every D-I player in the same view (all teams, all levels), so a strong line is green even
    // next to a 31-point night; the chart shows only the filtered rows
    var dist = {};
    ['best', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov'].forEach(function (k) { dist[k] = rows.map(function (r) { return +r[k]; }).filter(function (v) { return isFinite(v); }); });
    rows = rows.filter(function (r) { return r.inScope; });
    var scope = d.team ? H.school(d.team) + ': ' : d.conf ? d.conf + ': ' : d.tier ? { H: 'High-major', M: 'Mid-major', L: 'Low-major' }[d.tier] + ': ' : '';
    return {
      title: scope + (single ? 'Best scrimmage games' : 'Scrimmage RTG leaders'),
      subtitle: H.SEASON + ' preseason scrimmages · unofficial · ' + (single ? 'single-game rating' : 'average game rating' + (minG > 1 ? ', ' + minG + '+ scrimmages' : '')),
      lead: 'RTG',
      src: 'The Depth Chart · school-reported scrimmage box scores · RTG = 0-10 box-score game rating (Game Score), 5 ≈ average, 8+ great · colours vs every D-I player in scrimmages · 10+ minutes · not in records or ratings',
      cols: (single ? [] : [{ k: 'g', lab: 'G', nodist: true }, { k: 'best', lab: 'Best' }])
        .concat([{ k: 'pts', lab: single ? 'Pts' : 'PPG' }, { k: 'reb', lab: single ? 'Reb' : 'RPG' }, { k: 'ast', lab: single ? 'Ast' : 'APG' },
          { k: 'stl', lab: 'Stl', off: true }, { k: 'blk', lab: 'Blk', off: true }, { k: 'tov', lab: 'TOV', inv: true, off: true },
          { k: 'fg', lab: 'FG', nodist: true }, { k: 'tp', lab: '3P', nodist: true }, { k: 'ft', lab: 'FT', nodist: true, off: true },
          { k: 'min', lab: single ? 'Min' : 'MPG', nodist: true }]),
      rows: rows.slice(0, n), dist: dist, players: true
    };
  }
});
