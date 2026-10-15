/* Post: toughest schedules — average 2026-27 projected power rating of every listed opponent (scripts/data/schedule_2027.json,
 * the same slate tdc-schedule.js reads; non-D-I opponents count as −8, its FLOOR). Hand-added extras (TBD event games) aren't in it. */
TDC_POSTS.add('schedules', {
  group: 'Teams', label: 'Toughest schedules',
  note: 'Strength of schedule = average projected power rating of the opponents on the announced 2026-27 slate (non-D-I opponents = −8). "Least" shows the softest.',
  opts: { conf: true, team: false, dir: true, upLabel: 'Toughest first', downLabel: 'Softest first' },
  load: async function (d, H) {
    var S = await H.json('scripts/data/schedule_2027.json'), rs = await H.ratings(), n = Math.max(1, Math.min(20, +d.n || 10));
    var FLOOR = -8, T = S.teams || [], byFull = {};
    rs.forEach(function (t) { if (t.full) byFull[t.full] = t; });
    var acc = {}, seen = {};
    (S.games || []).forEach(function (a) {
      if (seen[a[0]]) return; seen[a[0]] = 1;
      var h = T[a[2]], w = T[a[3]], A = byFull[h], B = byFull[w];
      // ESPN doesn't flag league games until the season starts — same 2026-27 league = league game (as tdc-schedule.js does)
      var conf = !!a[5] || !!(A && B && A.conf && A.conf === B.conf);
      [[h, w], [w, h]].forEach(function (pr) {
        var me = byFull[pr[0]]; if (!me) return;
        var op = byFull[pr[1]], r = op ? +op.rating : FLOOR;
        var x = acc[pr[0]] || (acc[pr[0]] = { g: 0, sum: 0, top: 0, nc: 0, ncSum: 0 });
        x.g++; x.sum += r; if (op && +op.rank <= 50) x.top++;
        if (!conf) { x.nc++; x.ncSum += r; }
      });
    });
    var rows = [];
    Object.keys(acc).forEach(function (full) {
      var x = acc[full], t = byFull[full]; if (x.g < 10) return;
      if (d.conf && H.confName(t.conf) !== d.conf) return;
      var sos = x.sum / x.g;
      rows.push({ name: H.school(t.full || t.team), team: t.team, tag: '#' + t.rank, val: H.fmt(sos, 1, true), _v: sos,
        g: String(x.g), top: String(x.top), ncsos: x.nc ? H.fmt(x.ncSum / x.nc, 1, true) : '' });
    });
    var down = d.dir === 'down';
    rows.sort(function (a, b) { return down ? a._v - b._v : b._v - a._v; });
    return {
      title: (d.conf ? d.conf + ': ' : '') + (down ? 'The softest schedules' : 'The toughest schedules'),
      subtitle: 'Average projected power rating of ' + H.SEASON + ' opponents · tag = our projected rank',
      lead: 'SOS', src: 'The Depth Chart · announced ' + H.SEASON + ' schedules (pulled ' + (S.pulled || '') + ') + projected ratings',
      cols: [{ k: 'g', lab: 'Games' }, { k: 'top', lab: 'vs top 50' }, { k: 'ncsos', lab: 'Non-conf SOS' }],
      rows: rows.slice(0, n), players: false
    };
  }
});
