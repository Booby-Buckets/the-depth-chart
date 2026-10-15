/* Post: top freshmen — 2026-27 true freshmen by projected OVR (scripts/data/fresh_fit.json, the newcomer projection),
   or (dir 'down') the best freshman classes by team, scored like the portal class score. */
TDC_POSTS.add('freshmen', {
  group: 'Players', label: 'Top freshmen',
  note: 'True freshmen (no college season yet) ranked by projected OVR; league-wide lists need 10+ projected mpg (a team filter shows everyone). The second view ranks each team\'s freshman class: OVR above 70 (raised to 1.4), best first, each extra freshman worth 0.7x.',
  opts: { conf: true, team: true, dir: true, upLabel: 'Top freshmen (players)', downLabel: 'Best freshman classes (teams)' },
  load: async function (d, H) {
    var F = await H.json('scripts/data/fresh_fit.json'), rs = await H.ratings(), P = await H.players(), n = Math.max(1, Math.min(20, +d.n || 10));
    var FR = /^(fr\.?|fy\.?|1st( year| yr)?|first[ -]year)$/i, memo = {};
    var rowOf = function (t) { if (t in memo) return memo[t];
      return (memo[t] = rs.find(function (x) { return x.team === t; }) || rs.find(function (x) { return H.onTeam(x.team, t) || H.onTeam(x.full, t); }) || null); };
    var all = [];
    P.forEach(function (p) {
      if (!FR.test(String(p.class_year || '').trim())) return;
      var f = (F[p.team] || {})[p.name]; if (!f || f.ovr == null) return;
      var rt = rowOf(p.team); if (!rt) return;
      all.push({ p: p, f: f, rt: rt });
    });
    var inScope = function (x) { return (!d.conf || H.confName(x.rt.conf) === d.conf) && (!d.team || H.onTeam(x.rt.team, d.team) || H.onTeam(x.rt.full, d.team)); };
    var f1 = function (v) { return v == null ? '' : (+v).toFixed(1); };
    var where = d.team ? H.school(d.team) + ': ' : d.conf ? d.conf + ': ' : '';
    if (d.dir === 'down') {
      var T = {};
      all.filter(inScope).forEach(function (x) { (T[x.rt.team] = T[x.rt.team] || { rt: x.rt, a: [] }).a.push(x); });
      var rows = Object.keys(T).map(function (k) {
        var t = T[k]; t.a.sort(function (a, b) { return b.f.ovr - a.f.ovr; });
        var v = Math.round(t.a.map(function (x) { return Math.max(0, x.f.ovr - 70); }).reduce(function (s, v, i) { return s + Math.pow(v, 1.4) * Math.pow(0.7, i); }, 0));
        return { name: H.school(t.rt.full || t.rt.team), team: t.rt.team, tag: 'Best: ' + t.a[0].p.name + ' (' + t.a[0].f.ovr + ')', _v: v, val: String(v),
          nfr: String(t.a.length), n80: String(t.a.filter(function (x) { return x.f.ovr >= 80; }).length),
          mpg: f1(t.a.reduce(function (s, x) { return s + (x.f.mpg || 0); }, 0)), ppg: f1(t.a.reduce(function (s, x) { return s + (x.f.ppg || 0); }, 0)) };
      }).sort(function (a, b) { return b._v - a._v; });
      return { title: where + 'The best freshman classes', subtitle: 'Each team\'s ' + H.SEASON + ' freshmen, scored on projected OVR',
        lead: 'Class', src: 'The Depth Chart · ' + H.SEASON + ' newcomer projections · class score = OVR above 70, best first',
        cols: [{ k: 'nfr', lab: '# Fr' }, { k: 'n80', lab: '80+ OVR' }, { k: 'mpg', lab: 'Fr MPG' }, { k: 'ppg', lab: 'Fr PPG' }],
        rows: rows.slice(0, n), players: false };
    }
    var pool = all.filter(function (x) { return x.f.mpg >= 10; });
    var dist = {}; ['ppg', 'rpg', 'apg', 'mpg'].forEach(function (k) { dist[k] = pool.map(function (x) { return x.f[k]; }); });
    var rows = all.filter(function (x) { return inScope(x) && (d.team || x.f.mpg >= 10); }).sort(function (a, b) { return b.f.ovr - a.f.ovr || (b.f.mpg || 0) - (a.f.mpg || 0); }).map(function (x) {
      return { name: x.p.name, team: x.rt.team, espn: x.p.espn_id ? String(x.p.espn_id) : '', tag: [x.p.position, x.p.height].filter(Boolean).join(' · '),
        val: String(x.f.ovr), ppg: f1(x.f.ppg), rpg: f1(x.f.rpg), apg: f1(x.f.apg), mpg: f1(x.f.mpg) };
    });
    return { title: where + 'The top freshmen', subtitle: H.SEASON + ' true freshmen by projected overall',
      lead: 'OVR', src: 'The Depth Chart · ' + H.SEASON + ' newcomer projections (projected line + OVR) · heat vs. D-I freshmen at 10+ mpg',
      cols: [{ k: 'ppg', lab: 'PPG' }, { k: 'rpg', lab: 'RPG' }, { k: 'apg', lab: 'APG' }, { k: 'mpg', lab: 'MPG' }],
      dist: dist, rows: rows.slice(0, n), players: true };
  }
});
