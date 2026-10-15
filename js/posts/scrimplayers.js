/* Post: 2026-27 preseason scrimmage / exhibition PLAYER lines — the box scores in scripts/data/scrimmage_results_2027.json
 * (school-reported), measured against each player's projected line. "Vs our line" = his points minus what his projection
 * (TDCProjGrade.lineOf: projected ppg per minute) expects at the minutes he actually played. Unofficial: these games never
 * move records or ratings, and only lightly (Reality-weighted, scrim_reality.py) a player projection. */
TDC_POSTS.add('scrimplayers', {
  group: 'Preseason', label: 'Scrimmage standouts (players)',
  note: 'Player lines from unofficial preseason scrimmages, ranked by points over our projection at the minutes he played. Top scorers = raw points. 10+ minutes only.',
  opts: { conf: true, team: true, dir: true, upLabel: 'Beat our line', downLabel: 'Top scorers' },
  load: async function (d, H) {
    var S = await H.json('scripts/data/scrimmages_2027.json'), R = await H.json('scripts/data/scrimmage_results_2027.json');
    var rs = await H.ratings(), P = await H.players(), res = R.results || {}, n = Math.max(1, Math.min(20, +d.n || 10));
    var memo = {};
    var rowOf = function (full) { if (full in memo) return memo[full];
      return (memo[full] = rs.find(function (t) { return t.full === full; }) || rs.find(function (t) { return H.onTeam(t.full, full) || H.onTeam(t.team, full); }) || null); };
    var nk = function (s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/(jr|sr|ii|iii|iv)$/, ''); };
    var byTeam = {};
    P.forEach(function (p) { (byTeam[p.team] = byTeam[p.team] || []).push(p); });
    var findP = function (rt, name) { var k = nk(name), L = rt ? (byTeam[rt.team] || []) : [];
      return L.find(function (p) { return nk(p.name) === k; }) || null; };
    var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var rows = [];
    (S.games || []).forEach(function (g) {
      var r = res[g.id]; if (g.canceled || !r || !r.box) return;
      var dt = new Date(g.date + 'T12:00:00Z'), when = MO[dt.getUTCMonth()] + ' ' + dt.getUTCDate(), real = r.reality && r.reality.score;
      ['home', 'away'].forEach(function (side) {
        var B = r.box[side]; if (!B || !B.players) return;
        var sd = r.reality && r.reality[side], realSide = sd && sd.score != null ? sd.score : real;   // his team's own side score, not the game average
        var isHome = side === 'home', meFull = B.team || (isHome ? g.home : g.away), opFull = isHome ? g.away : g.home;
        var me = rowOf(meFull), op = rowOf(opFull); if (!me) return;   // only D-I teams we rate (the opponent may be anyone)
        if (d.team && !(H.onTeam(me.team, d.team) || H.onTeam(me.full, d.team))) return;
        if (d.conf && H.confName(me.conf) !== d.conf) return;
        var tag = (g.neutral ? 'vs ' : isHome ? 'vs ' : 'at ') + H.school(op ? op.team : opFull) + ' · ' + when;
        B.players.forEach(function (x) {
          var min = +x.min || 0; if (min < 10 || x.pts == null) return;
          var p = findP(me, x.rn || x.name), L = p ? H.lineOf(p) : null, ov = null;
          if (L && +L.mpg > 0 && L.ppg != null) ov = x.pts - (+L.ppg) / (+L.mpg) * min;
          rows.push({ name: p ? p.name : (x.rn || x.name), team: me.team, espn: p && p.espn_id ? String(p.espn_id) : '', tag: tag,
            _ov: ov, _pts: +x.pts, _d: g.date,
            val: d.dir === 'down' ? String(x.pts) : (ov != null ? H.fmt(ov, 1, true) : ''),
            pts: String(x.pts), min: String(min), reb: String(x.reb != null ? x.reb : (+x.oreb || 0) + (+x.dreb || 0)), ast: String(x.ast || 0),
            stl: String(x.stl || 0), blk: String(x.blk || 0), tov: String(x.tov || 0),
            fg: (x.fgm != null && x.fga != null) ? x.fgm + '-' + x.fga : '',
            tp: (x.tpm != null && x.tpa != null) ? x.tpm + '-' + x.tpa : '',
            proj: L && +L.mpg > 0 ? H.fmt((+L.ppg) / (+L.mpg) * min, 1) : '',
            real: realSide != null ? String(realSide) : '' });
        });
      });
    });
    if (d.dir === 'down') rows.sort(function (a, b) { return b._pts - a._pts || (b._ov || 0) - (a._ov || 0); });
    else rows.sort(function (a, b) { if ((a._ov == null) !== (b._ov == null)) return a._ov == null ? 1 : -1; return (b._ov || 0) - (a._ov || 0) || b._pts - a._pts; });
    var scope = d.team ? H.school(d.team) + ': ' : d.conf ? d.conf + ': ' : '';
    var up = d.dir !== 'down';
    return {
      title: scope + (up ? 'Scrimmage standouts' : 'Scrimmage top scorers'),
      subtitle: H.SEASON + ' preseason scrimmages & exhibitions · unofficial' + (up ? ' · points over our projection' : ''),
      lead: up ? 'Vs our line' : 'Points',
      src: 'The Depth Chart · school-reported scrimmage box scores · vs our line = points minus his projected points at those minutes · Reality Meter 0-100 (his team\'s side) · not in records or ratings',
      // the full box line (owner, Oct 2026: "add rebounds and assists and other things"); counting stats heat against these rows
      cols: (up ? [{ k: 'pts', lab: 'Pts' }, { k: 'proj', lab: 'Our line', nodist: true }] : [])
        .concat([{ k: 'reb', lab: 'Reb' }, { k: 'ast', lab: 'Ast' }, { k: 'stl', lab: 'Stl' }, { k: 'blk', lab: 'Blk' },
          { k: 'fg', lab: 'FG', nodist: true }, { k: 'tp', lab: '3P', nodist: true }, { k: 'min', lab: 'Min', nodist: true }, { k: 'real', lab: 'Reality' }]),
      rows: rows.slice(0, n), players: true
    };
  }
});
