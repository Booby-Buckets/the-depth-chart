/* Post: best & worst against-the-spread teams — real closing lines (scripts/data/bet_trends_teams.json "history" block,
 * merged by build_odds_history.py), summed over the stored seasons. */
TDC_POSTS.add('betting', {
  group: 'Betting', label: 'Best & worst ATS teams',
  note: 'Cover % against the closing spread over the last five seasons (pushes excluded). Min. 60 graded games. "Worst" shows the teams that burned bettors.',
  opts: { conf: true, team: false, dir: true, upLabel: 'Best cover % first', downLabel: 'Worst cover % first' },
  load: async function (d, H) {
    var j = await H.json('scripts/data/bet_trends_teams.json'), rs = await H.ratings(), n = Math.max(1, Math.min(20, +d.n || 10));
    var yrs = ((j.meta && j.meta.seasons) || []).slice().sort();
    var span = yrs.length ? (yrs[0] - 1) + '-' + String(yrs[0]).slice(2) + ' to ' + (yrs[yrs.length - 1] - 1) + '-' + String(yrs[yrs.length - 1]).slice(2) : '';
    var rec = function (s) { var p = String(s || '').split('-').map(Number); return { w: p[0] || 0, l: p[1] || 0, p: p[2] || 0 }; };
    var pool = [];
    Object.keys(j.teams || {}).forEach(function (full) {
      var t = j.teams[full], h = t.history; if (!h || h.atsPct == null) return;
      var a = rec(h.ats); if (a.w + a.l < 60) return;
      var rt = rs.find(function (x) { return x.full === full; }) || rs.find(function (x) { return H.onTeam(x.full, full); }); if (!rt) return;
      pool.push({ rt: rt, a: a, h: h, t: t });
    });
    var rows = [];
    pool.forEach(function (x) {
      if (d.conf && H.confName(x.rt.conf) !== d.conf) return;
      var pct = 100 * x.a.w / (x.a.w + x.a.l);
      rows.push({ name: H.school(x.rt.full || x.rt.team), team: x.rt.team, tag: H.confName(x.rt.conf), val: pct.toFixed(1) + '%', _v: pct,
        ats: x.h.ats, su: x.t.w + '-' + x.t.l, ov: x.h.ovPct != null ? (100 * x.h.ovPct).toFixed(0) + '%' : '', mar: H.fmt(x.t.margin, 1, true) });
    });
    var worst = d.dir === 'down';
    rows.sort(function (a, b) { return worst ? a._v - b._v : b._v - a._v; });
    return {
      title: (d.conf ? d.conf + ': ' : '') + (worst ? 'Fade these teams' : 'The cover kings'),
      subtitle: (worst ? 'Worst' : 'Best') + ' against-the-spread records, ' + span + ' (closing lines)',
      lead: 'Cover %', src: 'The Depth Chart Betting Lab · consensus closing lines, ' + span + ' · pushes excluded · current conferences',
      cols: [{ k: 'ats', lab: 'ATS' }, { k: 'su', lab: 'Straight up' }, { k: 'ov', lab: 'Over %' }, { k: 'mar', lab: 'Avg margin' }],
      dist: { ats: pool.map(function (x) { return x.a.w; }), su: pool.map(function (x) { return x.t.w; }),
        ov: pool.map(function (x) { return x.h.ovPct != null ? 100 * x.h.ovPct : null; }).filter(function (v) { return v != null; }),
        mar: pool.map(function (x) { return x.t.margin; }) },
      rows: rows.slice(0, n), players: false
    };
  }
});
