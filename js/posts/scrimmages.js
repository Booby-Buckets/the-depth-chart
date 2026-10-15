/* Post: 2026-27 preseason scrimmage / exhibition results — schedule in scripts/data/scrimmages_2027.json, final scores
 * (+ the Reality Meter from scrim_reality.py) in scripts/data/scrimmage_results_2027.json. Unofficial: never in records/ratings. */
TDC_POSTS.add('scrimmages', {
  group: 'Preseason', label: 'Scrimmage & exhibition results',
  note: 'Unofficial preseason scrimmages with a reported final, newest first. Row = the winner (or your picked team / conference). Reality = how game-like it looked (0-100, Reality Meter).',
  opts: { conf: true, team: true },
  load: async function (d, H) {
    var S = await H.json('scripts/data/scrimmages_2027.json'), R = await H.json('scripts/data/scrimmage_results_2027.json'), rs = await H.ratings();
    var n = Math.max(1, Math.min(20, +d.n || 10)), res = R.results || {};
    var rowOf = function (full) { return rs.find(function (t) { return t.full === full; }) || rs.find(function (t) { return H.onTeam(t.full, full) || H.onTeam(t.team, full); }) || null; };
    var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var rows = [];
    (S.games || []).forEach(function (g) {
      var r = res[g.id]; if (g.canceled || !r || r.hs == null || r.as == null) return;
      var h = rowOf(g.home), a = rowOf(g.away);
      var side = function (isHome) {
        var me = isHome ? h : a, op = isHome ? a : h;
        return { me: me, op: op, meName: isHome ? g.home : g.away, opName: isHome ? g.away : g.home,
          pf: isHome ? r.hs : r.as, pa: isHome ? r.as : r.hs, home: isHome };
      };
      var inScope = function (x) { if (!x) return false;
        if (d.team && !(H.onTeam(x.team, d.team) || H.onTeam(x.full, d.team))) return false;
        if (d.conf && H.confName(x.conf) !== d.conf) return false; return true; };
      var sH = side(true), sA = side(false), pick;
      if (d.team || d.conf) pick = inScope(h) ? sH : inScope(a) ? sA : null;
      else pick = r.hs >= r.as ? sH : sA;
      if (!pick) return;
      var re = r.reality || {}, p0 = re.pred_full != null ? re.pred_full : re.pred;   // pred_full = the line before who-sat adjustments
      var pred = p0 != null ? (pick.home ? p0 : -p0) : null;
      var dt = new Date(g.date + 'T12:00:00Z'), when = MO[dt.getUTCMonth()] + ' ' + dt.getUTCDate();
      var opShort = pick.op ? pick.op.team : pick.opName;
      var m = pick.pf - pick.pa;
      rows.push({ name: H.school(pick.me ? (pick.me.full || pick.me.team) : pick.meName), team: pick.me ? pick.me.team : pick.meName,
        tag: (g.neutral ? 'vs ' : pick.home ? 'vs ' : 'at ') + H.school(opShort) + ' · ' + when,
        val: (m > 0 ? '+' : '') + m, _d: g.date + (g.time || ''), _m: m,
        score: (m > 0 ? 'W ' : m < 0 ? 'L ' : 'T ') + pick.pf + '-' + pick.pa,
        line: pred != null ? H.fmt(pred, 1, true) : '',
        real: re.score != null ? String(re.score) : '' });
    });
    rows.sort(function (a, b) { return a._d < b._d ? 1 : a._d > b._d ? -1 : b._m - a._m; });
    var scope = d.team ? H.school(d.team) + ' ' : d.conf ? d.conf + ' ' : '';
    return {
      title: d.team ? scope + 'in the preseason' : (scope + 'Scrimmage scoreboard').replace(/^\s+/, ''),
      subtitle: H.SEASON + ' preseason scrimmages & exhibitions · unofficial',
      lead: 'Margin', src: 'The Depth Chart · school-reported scrimmage finals · our line = projected margin · Reality Meter 0-100 · not in records or ratings',
      cols: [{ k: 'score', lab: 'Final' }, { k: 'line', lab: 'Our line' }, { k: 'real', lab: 'Reality' }],
      rows: rows.slice(0, n), players: false
    };
  }
});
