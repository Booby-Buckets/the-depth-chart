/* Post: bracketology — the projected NCAA field from the shared postseason simulation (tdc-postseason.js on top of
 * tdc-schedule.js + tdc-conftourney.js, the same engine bracket.html runs). Seeds = the most likely bracket
 * (TDCPost.pointBracket: S-curve, First Four, conference separation); odds = share of simulated seasons. */
TDC_POSTS.add('bracket', {
  group: 'Postseason', label: 'Bracketology (projected seeds)',
  note: 'The projected NCAA Tournament field in S-curve order (seed = most likely bracket), with odds from 1,000 simulated seasons. "The bubble" = the last 8 at-larges in and the first 8 out. Takes a few seconds.',
  opts: { conf: true, team: true, dir: true, upLabel: 'Top of the S-curve', downLabel: 'The bubble (last in / first out)' },
  load: async function (d, H) {
    await H.needScript('tdc-schedule.js?v=43'); await H.needScript('tdc-conftourney.js?v=5'); await H.needScript('tdc-postseason.js?v=2');
    var rs = await H.ratings(), SIMS = 1000;
    var P = await window.TDCPost.run({ sims: SIMS }); if (!P) throw new Error('The postseason simulation didn’t load.');
    var B = await window.TDCPost.pointBracket(); if (!B) throw new Error('Couldn’t build the projected bracket.');
    var FF = ((P.rules && P.rules.ncaa) || {}).first_four || {}, FFNAME = FF.name || 'First Four', FFN = FF.at_large_teams != null ? FF.at_large_teams : 4;
    var n = Math.max(1, Math.min(20, +d.n || 10)), REG = B.regions || window.TDCPost.REGIONS;
    var pc = function (v) { return v == null ? '' : v >= 0.995 ? '>99%' : v > 0 && v < 0.005 ? '<1%' : Math.round(v * 100) + '%'; };
    var rowOf = function (full, t) { return (t && t.row) || rs.find(function (x) { return x.full === full; }) || null; };
    var mk = function (t, seed, tag) {
      var rt = rowOf(t.team, t), short = (rt && rt.team) || t.team;
      return { name: H.school(short), team: short, tag: tag, val: seed, _rt: rt,
        ncaa: pc(t.ncaa), f4: pc(t.f4), champ: pc(t.champ), avg: t.avgSeed != null ? t.avgSeed.toFixed(1) : '' };
    };
    var inScope = function (r) { if (d.team && !H.onTeam(r.team, d.team)) return false;
      if (d.conf && (!r._rt || H.confName(r._rt.conf) !== d.conf)) return false; return true; };
    var rows = [], bubble = d.dir === 'down' && !d.team;
    if (bubble) {
      // B.lastIn = the 8 lowest at-larges, best first (in a 76-team field all of them play in the Opening Round)
      B.lastIn.forEach(function (t, i) { rows.push(mk(t, 'IN', 'Last ' + B.lastIn.length + ' in' + (FFN >= B.lastIn.length - i ? ' · ' + FFNAME : ''))); });
      B.firstOut.forEach(function (t, i) { rows.push(mk(t, 'OUT', i < 4 ? 'First four out' : 'Next four out')); });
    } else {
      B.entries.forEach(function (e) {
        e.t.forEach(function (t) { rows.push(mk(t, String(e.seed), REG[e.region] + (e.t.length === 2 ? ' · ' + FFNAME : ''))); });
      });
      if (d.team) {   // a team outside the projected field still gets its row
        var have = rows.some(function (r) { return H.onTeam(r.team, d.team); });
        if (!have) { var t = P.teams.find(function (x) { var rt = rowOf(x.team, x); return rt && H.onTeam(rt.team, d.team); });
          if (t) rows.push(mk(t, 'OUT', 'Not in the projected field')); }
      }
    }
    rows = rows.filter(inScope);
    rows.forEach(function (r) { delete r._rt; });
    var scope = d.team ? H.school(d.team) + ': ' : d.conf ? d.conf + ': ' : '';
    return {
      title: scope + (bubble ? 'Bubble watch' : 'Bracketology'),
      subtitle: H.SEASON + ' projected ' + (P.field || 68) + '-team NCAA field · ' + (P.sims || SIMS).toLocaleString() + ' simulated seasons',
      lead: bubble ? 'Status' : 'Seed',
      src: 'The Depth Chart postseason sim · seeds = most likely bracket · odds = share of ' + (P.sims || SIMS).toLocaleString() + ' simulated seasons',
      cols: [{ k: 'ncaa', lab: 'Makes field' }, { k: 'avg', lab: 'Avg seed if in' }, { k: 'f4', lab: 'Final Four' }, { k: 'champ', lab: 'Title' }],
      rows: rows.slice(0, n), players: false
    };
  }
});
