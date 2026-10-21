/* Post: game recap — our read of a team's latest final game (tdc-recap.js: the Skill Fingerprint credit model on
 * ESPN's play-by-play). Two views: where the edge came from (the two teams skill by skill), or the players who were
 * furthest above / below their usual. The subtitle is the recap's one-line read. */
TDC_POSTS.add('gamerecap', {
  group: 'Teams', label: 'Game recap (why it went the way it went)',
  note: 'A team\'s latest final game: which skills decided it, or who was furthest above and below his usual. From our play-by-play credit model.',
  opts: { team: true, teamRequired: true, conf: false, n: 7,
          stats: [['skills', 'Where the edge came from'], ['players', 'Above and below their usual']], statsLabel: 'Show' },
  load: async function (d, H) {
    if (!d.team) throw new Error('Pick a team for this post.');
    for (var src of ['tdc-plays.js?v=1', 'tdc-fingerprint.js?v=6', 'tdc-credit.js?v=2', 'tdc-recap.js?v=4']) await H.needScript(src);
    var rs = await H.ratings(), rt = rs.find(function (t) { return H.onTeam(t.team, d.team); }), full = (rt && rt.full) || d.team;
    var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/', K = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
    var q = 'games?select=id,home,away,home_score,away_score,date,season_year&status=eq.STATUS_FINAL&or=(home.eq.' + encodeURIComponent('"' + full + '"') + ',away.eq.' + encodeURIComponent('"' + full + '"') + ')&order=date.desc&limit=1';
    var gm = (await fetch(SB + q, { headers: { apikey: K, Authorization: 'Bearer ' + K } }).then(function (r) { return r.ok ? r.json() : []; }))[0];
    if (!gm) throw new Error('No final game found for ' + H.school(full) + '.');
    var s = await fetch(TDC_RECAP.ESPN + gm.id).then(function (r) { return r.ok ? r.json() : null; });
    var docs = await TDC_RECAP.docsFor(gm.season_year);
    if (!s || !(s.plays || []).length || !docs) throw new Error('ESPN has no play-by-play for that game yet.');
    var R = TDC_RECAP.build(s, docs); if (!R) throw new Error('Could not read that game.');
    var W = R.info[R.win], L = R.info[R.los], n = Math.max(3, Math.min(12, +d.n || 7));
    var title = W.name + ' ' + W.score + ', ' + L.name + ' ' + L.score;
    var sub = TDC_RECAP.lead(R).replace(/<[^>]+>/g, '');
    if (d.pstat === 'players') {
      var ps = R.players.filter(function (x) { return x.vs != null && x.min >= 8; }).sort(function (a, b) { return b.vs - a.vs; });
      var rows = ps.slice(0, Math.ceil(n * 0.6)).concat(ps.slice(-Math.floor(n * 0.4))).map(function (x) {
        return { name: x.name, team: R.info[x.t].full, espn: x.pid, tag: '', _v: x.vs, val: H.fmt(x.vs, 1, true), add: H.fmt(x.tot, 1, true), usu: H.fmt(x.usual, 1, true), min: String(Math.round(x.min)) };
      });
      return { title: title, subtitle: sub, lead: 'vs usual', src: 'The Depth Chart game recap · play-by-play credit model · usual = his season fingerprint over the same possessions',
        cols: [{ k: 'add', lab: 'Added' }, { k: 'usu', lab: 'Usual', nodist: true }, { k: 'min', lab: 'Min', nodist: true, off: true }], rows: rows, players: true };
    }
    var rows2 = R.skills.slice(0, n).map(function (x) {
      return { name: x.label, team: '', tag: x.group, _v: x.edge, val: H.fmt(x.edge, 1, true), w: H.fmt(x.w, 1, true), l: H.fmt(x.l, 1, true) };
    });
    return { title: title, subtitle: sub, lead: 'Edge', src: 'The Depth Chart game recap · points added vs an average possession, by skill',
      cols: [{ k: 'w', lab: W.name, nodist: true }, { k: 'l', lab: L.name, nodist: true }], rows: rows2, players: false };
  }
});
