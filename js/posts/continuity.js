/* Post: roster continuity — share of last season's minutes coming back (data/continuity.json). */
TDC_POSTS.add('continuity', {
  group: 'Rosters', label: 'Roster continuity (returning minutes)',
  note: 'Share of last season\'s minutes that return in 2026-27. "Least" shows the teams rebuilding the most.',
  opts: { conf: true, team: false, dir: true },
  load: async function (d, H) {
    var c = await H.json('data/continuity.json'), rs = await H.ratings(), n = Math.max(1, Math.min(20, +d.n || 10));
    var rows = [];
    Object.keys(c).forEach(function (k) {
      var x = c[k]; if (x == null || x.continuity == null) return;
      var rt = rs.find(function (t) { return H.onTeam(t.team, k) || H.onTeam(t.full, k); }); if (!rt) return;
      if (d.conf && H.confName(rt.conf) !== d.conf) return;
      rows.push({ name: H.school(rt.full || rt.team), team: rt.team, tag: H.confName(rt.conf), val: x.continuity.toFixed(1) + '%',
        _v: x.continuity, ret: String(x.returners), pwr: H.fmt(rt.rating, 1, true), pct: x.pct != null ? x.pct + 'th' : '' });
    });
    var least = d.dir === 'down';
    rows.sort(function (a, b) { return least ? a._v - b._v : b._v - a._v; });
    return {
      title: (d.conf ? d.conf + ': ' : '') + (least ? 'The biggest rebuilds' : 'The most continuity'),
      subtitle: 'Share of 2025-26 minutes returning in ' + H.SEASON,
      lead: 'Returning min', src: 'The Depth Chart · 2025-26 minutes of players on 2026-27 rosters',
      cols: [{ k: 'ret', lab: 'Returners' }, { k: 'pwr', lab: 'Proj. power' }],
      rows: rows.slice(0, n), players: false
    };
  }
});
