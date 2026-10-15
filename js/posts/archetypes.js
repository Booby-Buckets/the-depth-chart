/* Post: best player at each role — one row per style archetype (archetypes.json, from build_archetypes.py), the top
   projected OVR (scripts/data/stat_overall_projected.json) in that style. Only stats-based styles (no size-only guesses). */
TDC_POSTS.add('archetypes', {
  group: 'Players', label: 'Best players by role (archetype)',
  note: 'One row per playing style (Lead Creator, Rim Protector, 3&D Wing...), the best projected OVR in each. Styles describe how a player plays, not how good he is. Styles guessed from size alone are left out.',
  opts: { conf: true, team: true },
  load: async function (d, H) {
    var A = await H.json('archetypes.json?v=6'), S = (await H.json('scripts/data/stat_overall_projected.json')).players || {}, rs = await H.ratings();
    var P = []; try { P = await H.players(); } catch (e) {}
    var byE = {}; P.forEach(function (p) { if (p.espn_id != null) byE[String(p.espn_id)] = p; });
    var memo = {}, rowOf = function (t) { if (t in memo) return memo[t];
      return (memo[t] = rs.find(function (x) { return x.full === t; }) || rs.find(function (x) { return H.onTeam(x.full, t) || H.onTeam(x.team, t); }) || null); };
    var f1 = function (v) { return v == null ? '' : (+v).toFixed(1); }, best = {}, cnt = {};
    Object.keys(S).forEach(function (id) {
      var v = S[id], a = (A.players || {})[id]; if (!a || !a.a || a.est === 'size' || v.ovr == null || !(v.mpg >= 10)) return;
      var rt = rowOf(v.team); if (!rt) return;
      if (d.conf && H.confName(rt.conf) !== d.conf) return;
      if (d.team && !(H.onTeam(rt.team, d.team) || H.onTeam(rt.full, d.team))) return;
      cnt[a.a] = (cnt[a.a] || 0) + 1;
      var b = best[a.a]; if (!b || v.ovr > b.v.ovr || (v.ovr === b.v.ovr && v.ppg > b.v.ppg)) best[a.a] = { id: id, v: v, rt: rt };
    });
    var rows = Object.keys(best).map(function (k) { var x = best[k], p = byE[x.id] || {};
      return { name: p.name || ('#' + x.id), team: x.rt.team, espn: x.id, tag: k, val: String(x.v.ovr), _v: x.v.ovr,
        ppg: f1(x.v.ppg), rpg: f1(x.v.rpg), apg: f1(x.v.apg), mpg: f1(x.v.mpg) };
    }).sort(function (a, b) { return b._v - a._v; });
    var where = d.team ? H.school(d.team) + ': ' : d.conf ? d.conf + ': ' : '';
    return { title: where + 'The best at every role', subtitle: 'Top projected overall in each playing style · ' + H.SEASON,
      lead: 'OVR', src: 'The Depth Chart · style archetypes (k-means on size, usage, playmaking, spacing, boards, defense) · ' + H.SEASON + ' projections, 10+ mpg',
      cols: [{ k: 'ppg', lab: 'PPG' }, { k: 'rpg', lab: 'RPG' }, { k: 'apg', lab: 'APG' }, { k: 'mpg', lab: 'MPG' }],
      rows: rows.slice(0, Math.max(1, Math.min(20, +d.n || 10))), players: true };
  }
});
