/* Post: best programs of the last decade — average power rating (Sports-Reference SRS) over the last 10 seasons, with NCAA
 * tournament appearances / Sweet 16s, total wins and the best season. Source: the per-season coach tables data/coach-YYYY.json
 * (one row per school per season: tm, srs, w, l, nc = NCAA result) — JSON, so the browser can load them (team_seasons.jsonl can't via H.json). */
TDC_POSTS.add('programs', {
  group: 'Teams', label: 'Best programs of the last decade',
  note: 'Average power rating 2016-17 through 2025-26 (min. 8 seasons in D-I). No 2020 NCAA tournament (COVID), so 9 possible bids.',
  opts: { conf: true, team: false, dir: true, upLabel: 'Best first', downLabel: 'Worst first' },
  load: async function (d, H) {
    var rs = await H.ratings(), n = Math.max(1, Math.min(20, +d.n || 10)), YRS = [], last = 2026;
    for (var y = last - 9; y <= last; y++) YRS.push(y);
    var tabs = await Promise.all(YRS.map(function (y) { return H.json('data/coach-' + y + '.json').catch(function () { return []; }); }));
    var DEEP = { 'Sweet 16': 1, 'Elite Eight': 1, 'Final Four': 1, 'Runner-Up': 1, 'Champion': 1 };
    var P = {};
    tabs.forEach(function (rows, i) {
      var yr = YRS[i], seen = {};
      (rows || []).forEach(function (x) {
        if (!x || !x.tm || x.srs == null || seen[x.tm]) return; seen[x.tm] = 1;
        var p = P[x.tm] || (P[x.tm] = { tm: x.tm, s: [], w: 0, l: 0, apps: 0, deep: 0, titles: 0, best: null });
        p.s.push(+x.srs); p.w += +x.w || 0; p.l += +x.l || 0;
        if (x.nc) { p.apps++; if (DEEP[x.nc]) p.deep++; if (x.nc === 'Champion') p.titles++; }
        if (!p.best || +x.srs > p.best.srs) p.best = { srs: +x.srs, yr: yr, nc: x.nc };
      });
    });
    var out = [];
    Object.keys(P).forEach(function (k) {
      var p = P[k]; if (p.s.length < 8) return;
      var rt = rs.find(function (t) { return t.full === k; }) || rs.find(function (t) { return H.onTeam(t.full, k) || H.onTeam(t.team, k); });
      if (!rt) return;
      if (d.conf && H.confName(rt.conf) !== d.conf) return;
      var avg = p.s.reduce(function (a, b) { return a + b; }, 0) / p.s.length, b = p.best;
      out.push({ name: H.school(rt.full || rt.team), team: rt.team, tag: H.confName(rt.conf),
        val: H.fmt(avg, 1, true), _v: avg,
        apps: String(p.apps), deep: String(p.deep), titles: String(p.titles), wins: String(p.w),
        best: (b.yr - 1) + '-' + String(b.yr).slice(2) });
    });
    var down = d.dir === 'down';
    out.sort(function (a, b) { return down ? a._v - b._v : b._v - a._v; });
    return {
      title: (d.conf ? d.conf + ': ' : '') + (down ? 'The decade\'s weakest programs' : 'The programs of the decade'),
      subtitle: 'Average power rating, 2016-17 to 2025-26',
      lead: 'Avg power', src: 'The Depth Chart · Sports-Reference SRS + NCAA results, last 10 seasons · current conference',
      cols: [{ k: 'apps', lab: 'NCAAs' }, { k: 'deep', lab: 'Sweet 16s' }, { k: 'titles', lab: 'Titles' }, { k: 'wins', lab: 'Wins' }, { k: 'best', lab: 'Best year' }],
      dist: { best: [] },
      rows: out.slice(0, n), players: false
    };
  }
});
