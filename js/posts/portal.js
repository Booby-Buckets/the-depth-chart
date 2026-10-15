/* Post: transfer portal hauls — each team's incoming (or outgoing) transfer class from data/portal_2027.json.
   Class score = the transfers.html formula: OVR above 70 ^1.4, best player first, each next one ×0.7. */
TDC_POSTS.add('portal', {
  group: 'Rosters', label: 'Transfer portal: biggest hauls',
  note: 'Class score is the Transfer Portal page formula: each player\'s OVR above 70 (raised to 1.4), best first, each extra player worth 0.7x the one before. "Lost" scores what walked out on last season\'s OVR.',
  opts: { conf: true, team: false, dir: true, upLabel: 'Biggest hauls (incoming)', downLabel: 'Biggest losses (outgoing)' },
  load: async function (d, H) {
    var J = await H.json('data/portal_2027.json'), rs = await H.ratings(), n = Math.max(1, Math.min(20, +d.n || 10));
    var lost = d.dir === 'down', T = {}, memo = {};
    var rowOf = function (nm) {
      if (nm in memo) return memo[nm];
      return (memo[nm] = rs.find(function (t) { return t.full === nm; }) || rs.find(function (t) { return H.onTeam(t.full, nm) || H.onTeam(t.team, nm); }) || null);
    };
    var score = function (a, k) { return Math.round(a.map(function (p) { return Math.max(0, (p[k] || 0) - 70); }).sort(function (x, y) { return y - x; })
      .reduce(function (s, v, i) { return s + Math.pow(v, 1.4) * Math.pow(0.7, i); }, 0)); };
    var get = function (rt) { return T[rt.team] || (T[rt.team] = { rt: rt, ins: [], outs: [] }); };
    (J.players || []).forEach(function (p) {
      var a = p.to && rowOf(p.to), b = p.from && rowOf(p.from);
      if (a) get(a).ins.push(p); if (b) get(b).outs.push(p);
    });
    var rows = [];
    Object.keys(T).forEach(function (k) {
      var t = T[k], rt = t.rt; if (d.conf && H.confName(rt.conf) !== d.conf) return;
      t.ins.sort(function (a, b) { return (b.ovr || 0) - (a.ovr || 0); }); t.outs.sort(function (a, b) { return (b.lastOvr || 0) - (a.lastOvr || 0); });
      var side = lost ? t.outs : t.ins; if (!side.length) return;
      var top = side[0], v = lost ? score(t.outs, 'lastOvr') : score(t.ins, 'ovr');
      rows.push({ name: H.school(rt.full || rt.team), team: rt.team, _v: v, val: String(v),
        tag: (lost ? 'Top loss: ' : 'Top add: ') + top.name + ' (' + (lost ? top.lastOvr : top.ovr) + ')',
        nin: String(t.ins.length), nout: String(t.outs.length),
        rot: String(side.filter(function (p) { return ((lost ? p.last : p.proj) || {}).mpg >= 20; }).length),
        best: String((lost ? top.lastOvr : top.ovr) || '') });
    });
    rows.sort(function (a, b) { return b._v - a._v || (+b.best) - (+a.best); });
    return {
      title: (d.conf ? d.conf + ': ' : '') + (lost ? 'Portal losses: who got raided' : 'Portal winners: the biggest hauls'),
      subtitle: (lost ? 'Transfers out, scored on last season\'s OVR' : 'Incoming transfers, scored on projected OVR') + ' · ' + H.SEASON,
      lead: lost ? 'Lost' : 'Class', src: 'The Depth Chart · ' + (J.n || (J.players || []).length) + ' committed D-I transfers for ' + H.SEASON + ' · class score = OVR above 70, best first',
      cols: [{ k: 'nin', lab: '# In' }, { k: 'nout', lab: '# Out' }, { k: 'rot', lab: lost ? '20+ mpg out' : '20+ mpg in' }, { k: 'best', lab: lost ? 'Top loss OVR' : 'Top add OVR' }],
      rows: rows.slice(0, n), players: false
    };
  }
});
