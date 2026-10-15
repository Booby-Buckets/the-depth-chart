/* Post: breakout candidates — players whose projected 2026-27 OVR climbs most over last season's demonstrated OVR
   (scripts/data/stat_overall_projected.json: ovr vs demo_ovr, proj mpg vs last_mpg). Returners by default; dir 'down' = transfers. */
TDC_POSTS.add('breakouts', {
  group: 'Players', label: 'Breakout candidates',
  note: 'Projected 2026-27 OVR minus the OVR a player showed last season. Needs 10+ mpg last year and 15+ projected mpg. "Transfers" shows players changing schools instead of returners.',
  opts: { conf: true, team: true, dir: true, upLabel: 'Returners (same school)', downLabel: 'Transfers (new school)' },
  load: async function (d, H) {
    var S = (await H.json('scripts/data/stat_overall_projected.json')).players || {}, rs = await H.ratings(), n = Math.max(1, Math.min(20, +d.n || 10));
    var P = []; try { P = await H.players(); } catch (e) {}
    var byE = {}; P.forEach(function (p) { if (p.espn_id != null) byE[String(p.espn_id)] = p; });
    var xf = d.dir === 'down', memo = {};
    var rowOf = function (t) { if (t in memo) return memo[t];
      return (memo[t] = rs.find(function (x) { return x.full === t; }) || rs.find(function (x) { return H.onTeam(x.full, t) || H.onTeam(x.team, t); }) || null); };
    var f1 = function (v) { return v == null ? '' : (+v).toFixed(1); };
    var all = [];
    Object.keys(S).forEach(function (id) {
      var v = S[id]; if (v.demo_ovr == null || v.ovr == null || !(v.last_mpg >= 10) || !(v.mpg >= 15)) return;
      var rt = rowOf(v.team); if (!rt) return;
      all.push({ id: id, v: v, rt: rt, p: byE[id], j: v.ovr - v.demo_ovr });
    });
    var dist = { ovr: all.map(function (x) { return x.v.ovr; }), ppg: all.map(function (x) { return x.v.ppg; }), dmin: all.map(function (x) { return x.v.mpg - x.v.last_mpg; }) };
    var rows = all.filter(function (x) { return !!x.v._xfer === xf && (!d.conf || H.confName(x.rt.conf) === d.conf) && (!d.team || H.onTeam(x.rt.team, d.team) || H.onTeam(x.rt.full, d.team)); })
      .sort(function (a, b) { return b.j - a.j || b.v.ovr - a.v.ovr; }).map(function (x) {
        var p = x.p || {};
        return { name: p.name || x.v.name || ('#' + x.id), team: x.rt.team, espn: x.id,
          tag: [p.class_year, xf && x.v.xfer_from ? 'from ' + H.school(x.v.xfer_from) : ''].filter(Boolean).join(' · '),
          val: H.fmt(x.j, 0, true), ovr: String(x.v.ovr), last: String(x.v.demo_ovr), ppg: f1(x.v.ppg), dmin: H.fmt(x.v.mpg - x.v.last_mpg, 1, true) };
      });
    var where = d.team ? H.school(d.team) + ': ' : d.conf ? d.conf + ': ' : '';
    return { title: where + (xf ? 'Transfers set to break out' : 'Breakout candidates'),
      subtitle: 'Biggest projected OVR jumps, 2025-26 to ' + H.SEASON + (xf ? ' (new schools)' : ' (same school)'),
      lead: 'OVR +', src: 'The Depth Chart · ' + H.SEASON + ' projections vs. 2025-26 demonstrated OVR · 10+ mpg last season, 15+ projected',
      cols: [{ k: 'ovr', lab: 'Proj OVR' }, { k: 'last', lab: '25-26 OVR' }, { k: 'ppg', lab: 'Proj PPG' }, { k: 'dmin', lab: 'MPG +/-' }],
      dist: dist, rows: rows.slice(0, n), players: true };
  }
});
