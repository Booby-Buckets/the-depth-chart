/* Posts: the Skill Fingerprint (tdc-fingerprint.js + scripts/data/fingerprint/<season>.json — our play-by-play credit
 * model: 15 skills in points per 100 possessions on the floor, schedule-adjusted).
 *   fingerprint  — one player's 15 skills with value, vs the D-I average and percentile
 *   skillleaders — the D-I leaders in any one skill (or overall / offense / defense), filterable by conference / level */
(function () {
  var SEASONS = [['2026', '2025-26'], ['2025', '2024-25']];
  async function doc(d, H) {
    if (!window.TDCFingerprint) await H.needScript('tdc-fingerprint.js?v=4');
    var y = String(d.season || '2026'), D = await TDCFingerprint.load(+y);
    if (!D) throw new Error('No fingerprint for ' + y + ' yet.');
    return D;
  }
  var lbl = function (y) { return (+y - 1) + '-' + String(y).slice(2); };
  var ord = function (n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  TDC_POSTS.add('fingerprint', {
    group: 'Players', label: 'Skill fingerprint (one player)',
    note: 'One player\'s 15 skills from our play-by-play credit model, in points per 100 possessions on the floor, schedule-adjusted.',
    opts: { player: true, conf: false, team: false, season: true, seasonList: SEASONS, n: 15,
            stats: [['pct', 'Percentile, by skill group'], ['val', 'True value, biggest first']], statsLabel: 'Show' },
    load: async function (d, H) {
      if (!d.player) throw new Error('Pick a player for this post.');
      if ((+d.n || 0) < 15) d.n = 15;   // all 15 skills
      var D = await doc(d, H), nm = String(d.player).split(' — ')[0].trim(), tm = String(d.player).split(' — ')[1] || '';
      await H.players(); var hit = H.findPlayer ? H.findPlayer(nm, tm) : null;
      var id = hit && hit.espn_id && D.players[String(hit.espn_id)] ? String(hit.espn_id)
        : Object.keys(D.players).find(function (k) { return (D.players[k].n || '').toLowerCase() === nm.toLowerCase(); });
      var r = id && D.players[id]; if (!r) throw new Error('No ' + lbl(d.season || '2026') + ' fingerprint for ' + nm + '.');
      var S = D.skills, val = d.pstat === 'val', ix = S.map(function (s, i) { return i; });
      if (val) ix.sort(function (a, b) { return (r.v[b] - S[b].avg) - (r.v[a] - S[a].avg); });
      var rows = ix.map(function (i) {
        var dv = r.v[i] - S[i].avg;
        return { name: S[i].label, team: '', tag: S[i].group, _v: val ? dv : r.p[i], val: val ? H.fmt(dv, 1, true) : String(r.p[i]),
          v: H.fmt(r.v[i], 1, true), dv: H.fmt(dv, 1, true), p: String(r.p[i]) };
      });
      var rd = TDCFingerprint.read(D, r);
      return {
        title: r.n, subtitle: lbl(D.season) + ' · ' + H.school(r.t) + ' · ' + rd.verdict.toLowerCase() + ': ' + H.fmt(r.tot, 1, true) + ' pts/100 (' + ord(r.tp) + ' pctl)',
        lead: val ? 'vs avg' : 'Pctl', src: 'The Depth Chart Skill Fingerprint · ESPN play-by-play credit model · pts per 100 possessions on the floor, schedule-adjusted',
        cols: [{ k: 'v', lab: 'Pts/100', nodist: true }, { k: 'dv', lab: 'vs avg', nodist: true }, { k: 'p', lab: 'Percentile' }],
        dist: { p: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] }, rows: rows, players: false
      };
    }
  });

  TDC_POSTS.add('skillleaders', {
    group: 'Players', label: 'Skill leaders (fingerprint)',
    note: 'The D-I leaders in one skill from our play-by-play credit model (points per 100 possessions, schedule-adjusted, 250+ minutes).',
    opts: { conf: true, team: false, tier: true, dir: true, upLabel: 'Best first', downLabel: 'Worst first', season: true, seasonList: SEASONS, n: 10,
            stats: [['tot', 'Overall'], ['o', 'Offense'], ['d', 'Defense'], ['rim', 'Rim finishing'], ['put', 'Putbacks'], ['mid', 'Mid-range'],
                    ['three', 'Three-point shooting'], ['ft', 'Free throws'], ['self', 'Self-creation'], ['pass', 'Passing'], ['drawn', 'Drawing fouls'],
                    ['tov', 'Ball security'], ['oreb', 'Offensive rebounding'], ['dreb', 'Defensive rebounding'], ['stl', 'Steals'], ['blk', 'Blocks'],
                    ['foul', 'Fouls'], ['team', 'Team defense']], statsLabel: 'Skill' },
    load: async function (d, H) {
      var D = await doc(d, H), n = Math.max(1, Math.min(25, +d.n || 10)), k = d.pstat || 'tot';
      await H.ratings();
      var si = D.skills.findIndex(function (s) { return s.k === k; });
      var name = si > -1 ? D.skills[si].label : { tot: 'Overall', o: 'Offense', d: 'Defense' }[k];
      var get = function (r) { return si > -1 ? r.v[si] : r[k]; }, pc = function (r) { return si > -1 ? r.p[si] : r[{ tot: 'tp', o: 'op', d: 'dp' }[k]]; };
      var out = [];
      Object.keys(D.players).forEach(function (id) {
        var r = D.players[id]; if (!r.q) return;
        var conf = H.confOfFull(r.t);
        if (d.conf && conf !== d.conf) return;
        if (d.tier && H.tierOf(conf) !== d.tier) return;
        out.push({ name: r.n, team: r.t, espn: id, tag: H.school(r.t), _v: get(r), val: H.fmt(get(r), 1, true), p: String(pc(r)),
          tot: H.fmt(r.tot, 1, true), off: H.fmt(r.o, 1, true), def: H.fmt(r.d, 1, true), min: String(r.min) });
      });
      var down = d.dir === 'down';
      out.sort(function (a, b) { return down ? a._v - b._v : b._v - a._v; });
      var scope = d.conf ? d.conf + ': ' : d.tier ? { H: 'High-major ', M: 'Mid-major ', L: 'Low-major ' }[d.tier] : '';
      var all = Object.keys(D.players).map(function (id) { return D.players[id]; }).filter(function (r) { return r.q; });
      var cols = [{ k: 'p', lab: 'Pctl' }, { k: 'tot', lab: 'Overall' }, { k: 'off', lab: 'Offense' }, { k: 'def', lab: 'Defense' }, { k: 'min', lab: 'Minutes', nodist: true, off: true }]
        .filter(function (c) { return !({ tot: 'tot', o: 'off', d: 'def' }[k] === c.k); });
      return {
        title: (scope ? scope : '') + (down ? 'The weakest ' : 'The best ') + name.toLowerCase() + (k === 'tot' || k === 'o' || k === 'd' ? ' impact' : ''),
        subtitle: lbl(D.season) + ' · points per 100 possessions on the floor, schedule-adjusted · 250+ minutes',
        lead: 'Pts/100', src: 'The Depth Chart Skill Fingerprint · ESPN play-by-play credit model',
        cols: cols, rows: out.slice(0, n), players: true,
        dist: { p: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], tot: all.map(function (r) { return r.tot; }), off: all.map(function (r) { return r.o; }), def: all.map(function (r) { return r.d; }) }
      };
    }
  });
})();
