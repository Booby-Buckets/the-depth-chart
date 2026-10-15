/* Post: Stat Line Shift — how a player's own scoring changes when one specific teammate sits
 * (scripts/data/statshift/<season>/<team>.json, built by build_statshift.py from NCAA play-by-play stints, garbage time out).
 * Each vector = 13 player fields + 13 team fields + 13 opponent fields + seconds; "without" = his total minus "with"
 * (so it includes games the teammate missed), same as statshift.html. */
TDC_POSTS.add('statshift', {
  group: 'Players', label: 'Stat Line Shift (with vs without a teammate)',
  note: 'A player\'s points per 40 with a teammate on the floor vs with him off it. "Most" = who scores more when that teammate sits; "Least" = who needs him. Both sides need 200+ minutes. Pick a team or a conference.',
  opts: { team: true, conf: true, season: true, seasons: 2, dir: true, upLabel: 'Scores more without him', downLabel: 'Scores less without him' },
  load: async function (d, H) {
    var season = String(d.season || '2026'); if (season !== '2026' && season !== '2025') throw new Error('Stat Line Shift covers 2024-25 and 2025-26 only.');
    var idx = await H.json('scripts/data/statshift/' + season + '/index.json'), rs = await H.ratings(), n = Math.max(1, Math.min(20, +d.n || 10));
    var F = ['pts', 'fga', 'fgm', 'tpa', 'tpm', 'fta', 'ftm', 'orb', 'drb', 'tov', 'ast', 'stl', 'blk'], N = F.length, I = {};
    F.forEach(function (f, i) { I[f] = i; });
    var MIN = 200 * 60, yr = (+season - 1) + '-' + season.slice(2);
    var rowOf = function (full) { return rs.find(function (t) { return t.full === full; }) || rs.find(function (t) { return H.onTeam(t.team, full) || H.onTeam(t.full, full); }); };
    var teams = (idx.teams || []).map(function (x) { return { x: x, rt: rowOf(x.team) }; }).filter(function (o) {
      if (!o.rt) return false;
      if (d.team) return H.onTeam(o.rt.team, d.team) || H.onTeam(o.rt.full, d.team) || H.onTeam(o.x.team, d.team);
      if (d.conf) return H.confName(o.rt.conf) === d.conf;
      return false; });
    if (!d.team && !d.conf) throw new Error('Pick a team or a conference for this post.');
    if (!teams.length) throw new Error('No Stat Line Shift data for ' + (d.team || d.conf) + ' in ' + yr + '.');
    var p40 = function (v, k) { return v[3 * N] > 0 ? v[I[k]] * 2400 / v[3 * N] : null; };
    var ts = function (v) { var den = 2 * (v[I.fga] + 0.44 * v[I.fta]); return den >= 16 ? 100 * v[I.pts] / den : null; };
    var usg = function (v) { var t = v[N + I.fga] + 0.44 * v[N + I.fta] + v[N + I.tov]; return t > 0 ? 100 * (v[I.fga] + 0.44 * v[I.fta] + v[I.tov]) / t : null; };
    var last = function (s) { var w = String(s || '').trim().split(/\s+/).filter(function (x) { return !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(x); }); return w.length ? w[w.length - 1] : String(s || ''); };
    var all = [];
    var files = await Promise.all(teams.map(function (o) { return H.json('scripts/data/statshift/' + season + '/' + o.x.file).then(function (j) { return { o: o, j: j }; }).catch(function () { return null; }); }));
    files.forEach(function (f) { if (!f || !f.j) return; var D = f.j, byId = {};
      D.players.forEach(function (p) { byId[p.id] = p; });
      D.players.forEach(function (A) { var wm = D.w[A.id] || {};
        Object.keys(wm).forEach(function (bid) { var B = byId[bid]; if (!B || B.all[3 * N] < 300 * 60) return;
          var w = wm[bid], wo = A.all.map(function (x, i) { return x - w[i]; });
          if (w[3 * N] < MIN || wo[3 * N] < MIN) return;
          var a = p40(w, 'pts'), b = p40(wo, 'pts'); if (a == null || b == null) return;
          var t1 = ts(w), t2 = ts(wo), u1 = usg(w), u2 = usg(wo);
          all.push({ name: A.name + ' w/o ' + (last(B.name) === last(A.name) ? B.name : last(B.name)), team: f.o.rt.team, espn: A.id, tag: Math.round(wo[3 * N] / 60) + ' min without',
            _v: b - a, val: H.fmt(b - a, 1, true), wi: a.toFixed(1), wo: b.toFixed(1),
            tsd: (t1 != null && t2 != null) ? H.fmt(t2 - t1, 1, true) : '', usd: (u1 != null && u2 != null) ? H.fmt(u2 - u1, 1, true) : '' }); }); }); });
    if (!all.length) throw new Error('No player pairs with 200+ minutes both ways for ' + (d.team || d.conf) + '.');
    var down = d.dir === 'down';
    all.sort(function (x, y) { return down ? x._v - y._v : y._v - x._v; });
    // one row per player (his biggest swing), so one high-usage star doesn't fill the list
    var seen = {}, rows = all.filter(function (r) { if (seen[r.espn]) return false; seen[r.espn] = 1; return true; });
    var who = d.team ? H.school(teams[0].rt.full || teams[0].rt.team) : d.conf;
    return {
      title: who + ': ' + (down ? 'Who Needs Him on the Floor' : 'Who Scores More When He Sits'),
      subtitle: 'Points per 40 with vs without a teammate on the floor · ' + yr,
      lead: 'Pts/40 swing', src: 'NCAA play-by-play stints, garbage time removed · "without" includes games he missed · 200+ min each way',
      cols: [{ k: 'wi', lab: 'With' }, { k: 'wo', lab: 'Without' }, { k: 'tsd', lab: 'TS% shift' }, { k: 'usd', lab: 'Usage shift' }],
      dist: { wi: [], wo: [], tsd: all.map(function (r) { return r.tsd; }), usd: [] },
      rows: rows.slice(0, n), players: true
    };
  }
});
