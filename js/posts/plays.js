/* Post: the season's biggest plays by win probability added — the Play Finder standouts precomputed by
 * scripts/build_plays_top.mjs (scripts/data/plays_top/<season>.json). Made shots only: the WP model also credits
 * end-of-game offensive rebounds / fouls that are play-by-play timing artifacts. */
TDC_POSTS.add('plays', {
  group: 'Plays', label: 'Biggest plays of the season (win probability)',
  note: 'Made shots ranked by win probability added (ESPN play-by-play, our live win-probability model). Team = the shooter\'s team.',
  opts: { conf: true, team: true, season: true, seasons: 4 },
  load: async function (d, H) {
    var y = String(d.season || '2026'), j = await H.json('scripts/data/plays_top/' + y + '.json?v=1'), rs = await H.ratings();
    var n = Math.max(1, Math.min(20, +d.n || 10)), cache = {};
    var rowOf = function (name) {
      if (name in cache) return cache[name];
      return (cache[name] = rs.find(function (t) { return t.team === name || t.full === name; }) ||
        rs.find(function (t) { return H.onTeam(t.team, name) || H.onTeam(t.full, name); }) || null);
    };
    var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var rows = [];
    (j.rows || []).forEach(function (x) {
      if (!(x.made === true) || !(x.wpa > 0) || !x.pname) return;
      var g = j.games[x.g]; if (!g || !g.home || !g.away) return;
      var mine = String(g.home.id) === String(x.team) ? g.home : String(g.away.id) === String(x.team) ? g.away : null; if (!mine) return;
      var opp = mine === g.home ? g.away : g.home, rt = rowOf(mine.name);
      var tm = rt ? rt.team : mine.name;
      if (d.team && !H.onTeam(tm, d.team)) return;
      if (d.conf && (!rt || H.confName(rt.conf) !== d.conf)) return;
      var ort = rowOf(opp.name), dt = new Date(g.date), when = isNaN(dt) ? '' : MO[dt.getUTCMonth()] + ' ' + dt.getUTCDate();
      var site = g.neutral ? 'vs ' : mine === g.home ? 'vs ' : 'at ';
      var shot = x.kind === 'three' ? (x.dist != null ? x.dist + '-ft 3' : '3-pointer') : x.kind === 'ft' ? 'Free throw' : x.kind === 'dunk' ? 'Dunk' :
        x.kind === 'tip' ? 'Tip-in' : x.kind === 'layup' ? 'Layup' : x.dist != null ? x.dist + '-ft jumper' : 'Jumper';
      var per = x.per <= 2 ? (x.per === 1 ? '1H' : '2H') : (x.per === 3 ? 'OT' : (x.per - 2) + 'OT');
      var won = mine.score > opp.score;
      rows.push({ name: x.pname, team: tm, espn: x.pid || null, tag: site + H.school(ort ? ort.team : opp.name) + (when ? ' · ' + when : ''),
        val: '+' + (100 * x.wpa).toFixed(1) + '%', _v: x.wpa, shot: shot, clock: x.clock + ' ' + per,
        fin: (won ? 'W ' : 'L ') + mine.score + '-' + opp.score });
    });
    rows.sort(function (a, b) { return b._v - a._v; });
    var lab = MSEASON(y), scope = d.team ? H.school(d.team) + ': ' : d.conf ? d.conf + ': ' : '';
    function MSEASON(s) { s = +s; return (s - 1) + '-' + String(s).slice(2); }
    return {
      title: scope + 'The shots that swung games',
      subtitle: lab + ' · biggest made shots by win probability added',
      lead: 'Win prob. added', src: 'The Depth Chart Play Finder · ESPN play-by-play, ' + lab + ' · our win-probability model' + (d.conf ? ' · current conferences' : ''),
      cols: [{ k: 'shot', lab: 'Shot' }, { k: 'clock', lab: 'Clock' }, { k: 'fin', lab: 'Final' }],
      rows: rows.slice(0, n), players: true
    };
  }
});
