/* Post: 2026-27 preseason scrimmage / exhibition PLAYER lines — the box scores in scripts/data/scrimmage_results_2027.json
 * (school-reported), measured against each player's projected line. "Vs our line" = his total in the picked stat (d.pstat:
 * pts/reb/ast/stl/blk/3PM) minus his full-game projection (TDCProjGrade.lineOf per-game line). Unofficial: these games never
 * move records or ratings, and only lightly (Reality-weighted, scrim_reality.py) a player projection. */
TDC_POSTS.add('scrimplayers', {
  group: 'Preseason', label: 'Scrimmage standouts (players)',
  note: 'Player lines from unofficial preseason scrimmages, ranked by how far he beat our full-game projection in the picked stat. "Most" = the raw total. 10+ minutes only.',
  opts: { conf: true, team: true, tier: true, dir: true, upLabel: 'Beat our line', downLabel: 'Most (raw total)',
    statsLabel: 'Stat', stats: [['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['stl', 'Steals'], ['blk', 'Blocks'], ['tpm', '3-pointers made']] },
  load: async function (d, H) {
    // the stat "vs our line" ranks by (owner, Oct 2026: "changeable so I can see who over shot their projections for different stats"):
    // box = his scrimmage total, pj = the projected-line field it's measured against (per minute x his minutes)
    var ST = { pts: { lab: 'Pts', word: 'points', box: function (x) { return +x.pts; }, pj: 'ppg' },
      reb: { lab: 'Reb', word: 'rebounds', box: function (x) { return x.reb != null ? +x.reb : (+x.oreb || 0) + (+x.dreb || 0); }, pj: 'rpg' },
      ast: { lab: 'Ast', word: 'assists', box: function (x) { return +x.ast || 0; }, pj: 'apg' },
      stl: { lab: 'Stl', word: 'steals', box: function (x) { return +x.stl || 0; }, pj: 'stl' },
      blk: { lab: 'Blk', word: 'blocks', box: function (x) { return +x.blk || 0; }, pj: 'blk' },
      tpm: { lab: '3PM', word: '3-pointers made', box: function (x) { return +x.tpm || 0; }, pj: 'tpm' } };
    var sk = ST[d.pstat] ? d.pstat : 'pts', st = ST[sk];
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
        if (d.tier && H.tierOf(me.conf) !== d.tier) return;   // high / mid / low major
        var tag = (g.neutral ? 'vs ' : isHome ? 'vs ' : 'at ') + H.school(op ? op.team : opFull) + ' · ' + when;
        B.players.forEach(function (x) {
          var min = +x.min || 0; if (min < 10 || x.pts == null) return;
          var p = findP(me, x.rn || x.name), L = p ? H.lineOf(p) : null, ov = null, ex = null, bv = st.box(x);
          // owner, Oct 2026: measured against the FULL-GAME projection, not one scaled to his scrimmage minutes
          if (L && L[st.pj] != null) { ex = +L[st.pj]; ov = bv - ex; }
          rows.push({ name: p ? p.name : (x.rn || x.name), team: me.team, espn: p && p.espn_id ? String(p.espn_id) : '', tag: tag,
            _ov: ov, _bv: bv, _d: g.date,
            val: d.dir === 'down' ? String(bv) : (ov != null ? H.fmt(ov, 1, true) : ''),
            pts: String(x.pts), min: String(min), reb: String(x.reb != null ? x.reb : (+x.oreb || 0) + (+x.dreb || 0)), ast: String(x.ast || 0),
            stl: String(x.stl || 0), blk: String(x.blk || 0), tov: String(x.tov || 0), tpm: String(+x.tpm || 0),
            fg: (x.fgm != null && x.fga != null) ? x.fgm + '-' + x.fga : '',
            tp: (x.tpm != null && x.tpa != null) ? x.tpm + '-' + x.tpa : '',
            ft: (x.ftm != null && x.fta != null) ? x.ftm + '-' + x.fta : '', oreb: String(+x.oreb || 0), pf: String(x.pf != null ? x.pf : ''),
            proj: ex != null ? H.fmt(ex, 1) : '',
            real: realSide != null ? String(realSide) : '' });
        });
      });
    });
    if (d.dir === 'down') rows.sort(function (a, b) { return b._bv - a._bv || (b._ov || 0) - (a._ov || 0); });
    else rows.sort(function (a, b) { if ((a._ov == null) !== (b._ov == null)) return a._ov == null ? 1 : -1; return (b._ov || 0) - (a._ov || 0) || b._bv - a._bv; });
    var scope = d.team ? H.school(d.team) + ': ' : d.conf ? d.conf + ': ' : d.tier ? { H: 'High-major ', M: 'Mid-major ', L: 'Low-major ' }[d.tier].replace(/ $/, '') + ': ' : '';
    var up = d.dir !== 'down';
    return {
      title: scope + (up ? (sk === 'pts' ? 'Scrimmage standouts' : 'Scrimmage standouts: ' + st.word) : 'Scrimmage leaders: ' + st.word),
      subtitle: H.SEASON + ' preseason scrimmages & exhibitions · unofficial' + (up ? ' · ' + st.word + ' over our projection' : ''),
      lead: up ? 'Vs our line' : st.lab,
      src: 'The Depth Chart · school-reported scrimmage box scores · vs our line = his ' + st.word + ' minus his projected ' + st.word + ' per game · Reality Meter 0-100 (his team\'s side) · not in records or ratings',
      // the full box line (owner, Oct 2026: "add rebounds and assists and other things"); counting stats heat against these rows
      // the picked stat (+ our line for it) leads; the rest of the box follows (3PM lives in the 3P made-attempted column)
      cols: (up ? [{ k: sk, lab: st.lab }, { k: 'proj', lab: 'Our line', nodist: true }] : [])
        .concat([{ k: 'pts', lab: 'Pts' }, { k: 'reb', lab: 'Reb' }, { k: 'ast', lab: 'Ast' }, { k: 'stl', lab: 'Stl' }, { k: 'blk', lab: 'Blk' }]
          .filter(function (c) { return c.k !== sk; }))   // already the lead (Most) or the first column (Beat our line)
        .concat([{ k: 'fg', lab: 'FG', nodist: true }].concat(sk === 'tpm' ? [] : [{ k: 'tp', lab: '3P', nodist: true }]), [{ k: 'ft', lab: 'FT', nodist: true, off: true }, { k: 'oreb', lab: 'OReb', off: true }, { k: 'tov', lab: 'TOV', inv: true, off: true }, { k: 'pf', lab: 'PF', inv: true, off: true },
          { k: 'min', lab: 'Min', nodist: true }, { k: 'real', lab: 'Reality' }]),
      rows: rows.slice(0, n), players: true
    };
  }
});
