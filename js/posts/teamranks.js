/* Post: one team by the numbers — every Team DNA stat with its D-I rank and percentile (scripts/data/team_dna.json).
 * Completed seasons use the schedule-adjusted ratings (adjO/adjD/adjNet); '2027' = the projected 2026-27 DNA.
 * Percentile is good-for-the-team (lower DRtg / TOV% / opp eFG% = higher percentile); tempo is style, so it gets none. */
TDC_POSTS.add('teamranks', {
  group: 'Teams', label: 'Team by the numbers (D-I ranks)',
  note: 'One team, every efficiency and four-factor stat, with its rank among D-I teams and a good-for-the-team percentile.',
  opts: { team: true, teamRequired: true, conf: false, season: true,
          seasonList: [['2027', '2026-27 projected'], ['2026', '2025-26'], ['2025', '2024-25'], ['2024', '2023-24']] },
  load: async function (d, H) {
    if (!d.team) throw new Error('Pick a team for this post.');
    var all = await H.json('scripts/data/team_dna.json'), rs = await H.ratings();
    var yr = String(d.season || '2027'), S = all[yr] && all[yr].teams; if (!S) return null;
    var rt = rs.find(function (t) { return H.onTeam(t.team, d.team); }), full = rt && rt.full;
    var key = full && S[full] ? full : Object.keys(S).find(function (k) { return H.onTeam(k, d.team); });
    var t = key && S[key]; if (!t) throw new Error('No ' + yr + ' profile for ' + d.team + '.');
    var proj = yr === '2027', lbl = proj ? 'Projected ' + H.SEASON : (+yr - 1) + '-' + yr.slice(2), adj = !proj && t.adjNet != null;
    var keys = Object.keys(S), N = keys.length;
    var STATS = [
      ['Net efficiency', adj ? 'adjNet' : 'net', 1, '+'], ['Offensive rating', adj ? 'adjO' : 'ORtg', 1], ['Defensive rating', adj ? 'adjD' : 'DRtg', -1],
      ['Tempo', 'tempo', 0],
      ['Effective FG%', 'oeFG', 1], ['Turnover rate', 'oTOV', -1], ['Off. rebound rate', 'oORB', 1], ['Free-throw rate', 'oFTr', 1],
      ['Opp. effective FG%', 'deFG', -1], ['Forced turnover rate', 'dTOV', 1], ['Def. rebound rate', 'dDRB', 1], ['Opp. free-throw rate', 'dFTr', -1]];
    var ord = function (n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
    var rows = [];
    STATS.forEach(function (st) {
      var k = st[1], v = t[k]; if (v == null) return;
      var xs = keys.map(function (n) { return S[n][k]; }).filter(function (x) { return x != null; });
      var hi = st[2] >= 0, rank = xs.filter(function (x) { return hi ? x > v : x < v; }).length + 1;
      var avg = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
      rows.push({ name: st[0], team: '', tag: st[2] === 0 ? 'style' : '', v: H.fmt(v, 1, st[3] === '+'), rk: ord(rank), avg: H.fmt(avg, 1, st[3] === '+'),
        pct: st[2] === 0 ? '' : String(Math.round(100 * (xs.length - rank) / Math.max(1, xs.length - 1))) });
    });
    var nm = H.school(rt ? (rt.full || rt.team) : key);
    return {
      title: nm + ' by the numbers', subtitle: lbl + ' · rank among ' + N + ' D-I teams' + (!proj && t.w != null ? ' · ' + t.w + '-' + t.l : '') + (adj ? ' · ratings schedule-adjusted' : ''),
      lead: '', src: 'The Depth Chart Team DNA · ' + (proj ? 'projected from 2026-27 rosters + coach pace' : lbl + ' D-I box scores, per 100 possessions') + ' · percentile = good for ' + nm,
      cols: [{ k: 'v', lab: 'Value', nodist: true }, { k: 'rk', lab: 'D-I rank', nodist: true }, { k: 'avg', lab: 'D-I avg', nodist: true }, { k: 'pct', lab: 'Percentile' }],
      dist: { pct: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] }, rows: rows, players: false
    };
  }
});
