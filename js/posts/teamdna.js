/* Post: Team DNA leaders — net efficiency with the offensive four factors (scripts/data/team_dna.json).
 * d.season '2026'/'2025'/'2024' = that season's actual DNA (built from our box scores); '2027' = the projected 2026-27 DNA
 * (offered via opts.seasonList). Heat = percentile vs. every D-I team that season. */
TDC_POSTS.add('teamdna', {
  group: 'Teams', label: 'Team DNA leaders (four factors)',
  note: 'Net efficiency (points per 100 possessions scored minus allowed) with the offensive four factors. DRtg and TOV%: lower is better (green = low).',
  opts: { conf: true, team: false, dir: true, season: true, upLabel: 'Best net first', downLabel: 'Worst net first',
          seasonList: [['2027', '2026-27 projected'], ['2026', '2025-26'], ['2025', '2024-25'], ['2024', '2023-24']] },
  load: async function (d, H) {
    var all = await H.json('scripts/data/team_dna.json'), rs = await H.ratings(), n = Math.max(1, Math.min(20, +d.n || 10));
    var yr = String(d.season || '2026'), S = all[yr] && all[yr].teams; if (!S) return null;
    var proj = yr === '2027', lbl = (+yr - 1) + '-' + String(yr).slice(2);
    var rows = [], dist = { efg: [], orb: [], ftr: [] };
    Object.keys(S).forEach(function (full) {
      var x = S[full]; if (!x || x.net == null) return;
      dist.efg.push(x.oeFG); dist.orb.push(x.oORB); dist.ftr.push(x.oFTr);
      var rt = rs.find(function (t) { return t.full === full; }) || rs.find(function (t) { return H.onTeam(t.full, full); });
      var team = rt ? rt.team : (H.logoUrl(full) ? full : null); if (!team) return;
      // conference: the 2026-27 league for the projection; for past seasons the team's current league (realignment caveat)
      var conf = rt ? H.confName(rt.conf) : H.confOfFull(full);
      if (d.conf && conf !== d.conf) return;
      rows.push({ name: H.school(rt ? (rt.full || rt.team) : full), team: team,
        tag: proj ? conf : (x.w != null ? x.w + '-' + x.l : conf),
        val: H.fmt(x.net, 1, true), _v: +x.net,
        ortg: H.fmt(x.ORtg, 1), drtg: H.fmt(x.DRtg, 1),
        efg: H.fmt(x.oeFG, 1), tov: H.fmt(x.oTOV, 1), orb: H.fmt(x.oORB, 1), ftr: H.fmt(x.oFTr, 1) });
    });
    var down = d.dir === 'down';
    rows.sort(function (a, b) { return down ? a._v - b._v : b._v - a._v; });
    // ORtg / eFG / ORB / FTr: high = good; DRtg / TOV%: low = good (inv)
    dist.ortg = Object.keys(S).map(function (k) { return S[k].ORtg; }); dist.drtg = Object.keys(S).map(function (k) { return S[k].DRtg; });
    dist.tov = Object.keys(S).map(function (k) { return S[k].oTOV; });
    return {
      title: (d.conf ? d.conf + ': ' : '') + (down ? 'The least efficient teams' : 'The most efficient teams') + (proj ? ' (projected)' : ''),
      subtitle: (proj ? 'Projected ' + H.SEASON : lbl) + ' net efficiency + how they score: the offensive four factors',
      lead: 'Net', src: 'The Depth Chart Team DNA · ' + (proj ? 'projected from 2026-27 rosters + coach pace' : lbl + ' D-I box scores, per 100 possessions') + ' · colours = percentile vs. D-I',
      cols: [{ k: 'ortg', lab: 'ORtg' }, { k: 'drtg', lab: 'DRtg', inv: true }, { k: 'efg', lab: 'eFG%' }, { k: 'tov', lab: 'TOV%', inv: true }, { k: 'orb', lab: 'ORB%' }, { k: 'ftr', lab: 'FT rate' }],
      dist: { ortg: dist.ortg, drtg: dist.drtg, efg: dist.efg, tov: dist.tov, orb: dist.orb, ftr: dist.ftr },
      rows: rows.slice(0, n), players: false
    };
  }
});
