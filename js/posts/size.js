/* Post: biggest & smallest rosters — minutes-weighted average height of each team's projected rotation.
   Minutes = the projection (stat_overall_projected by espn id, fresh_fit by team+name for newcomers); teams with no
   projected minutes fall back to depth order (top 8, flat weights). */
TDC_POSTS.add('size', {
  group: 'Rosters', label: 'Biggest & smallest rosters',
  note: 'Average height of each team\'s projected rotation, weighted by projected minutes. Also: players 6\'10" and up, and the share of minutes going to PF/C. Teams missing listed heights for 10%+ of their minutes are left out.',
  opts: { conf: true, team: false, dir: true, upLabel: 'Biggest first', downLabel: 'Smallest first' },
  load: async function (d, H) {
    var S = (await H.json('scripts/data/stat_overall_projected.json')).players || {}, F = await H.json('scripts/data/fresh_fit.json');
    var rs = await H.ratings(), P = await H.players(), n = Math.max(1, Math.min(20, +d.n || 10)), memo = {};
    var rowOf = function (t) { if (t in memo) return memo[t];
      return (memo[t] = rs.find(function (x) { return x.team === t; }) || rs.find(function (x) { return H.onTeam(x.team, t) || H.onTeam(x.full, t); }) || null); };
    var inch = function (h) { var m = String(h || '').match(/^\s*(\d)\s*['\-’ ]\s*(\d{1,2})/); return m ? +m[1] * 12 + +m[2] : null; };
    var ft = function (i, dec) { var f = Math.floor(i / 12), r = i - f * 12; return f + "'" + r.toFixed(dec) + '"'; };
    var T = {};
    P.forEach(function (p) {
      var ht = inch(p.height); if (ht != null && (ht < 66 || ht > 90)) ht = null;
      var rt = rowOf(p.team); if (!rt) return;
      var s = p.espn_id != null && S[String(p.espn_id)], f = (F[p.team] || {})[p.name], mpg = s && s.mpg != null ? s.mpg : f ? f.mpg : null;
      (T[rt.team] = T[rt.team] || { rt: rt, a: [] }).a.push({ p: p, ht: ht, mpg: mpg, fc: /^(PF|C|F|FC)$/i.test(String(p.position || '').trim()) });
    });
    var rows = [];
    Object.keys(T).forEach(function (k) {
      var t = T[k], rt = t.rt; if (d.conf && H.confName(rt.conf) !== d.conf) return;
      var rot = t.a.filter(function (x) { return x.mpg >= 5; }), byMin = true;
      if (rot.reduce(function (s, x) { return s + x.mpg; }, 0) < 100) {   // no usable projection: depth order top 8, equal weight
        byMin = false; rot = t.a.slice().sort(function (a, b) { return (a.p.depth_order || 99) - (b.p.depth_order || 99); }).slice(0, 8).map(function (x) { return Object.assign({}, x, { mpg: 25 }); });
      }
      var all = rot.reduce(function (s, x) { return s + x.mpg; }, 0);
      rot = rot.filter(function (x) { return x.ht != null; });             // listed heights only; skip a team missing 10%+ of its minutes
      var w = rot.reduce(function (s, x) { return s + x.mpg; }, 0); if (rot.length < 5 || w < 0.9 * all) return;
      var avg = rot.reduce(function (s, x) { return s + x.ht * x.mpg; }, 0) / w;
      var tall = t.a.filter(function (x) { return x.ht != null; }).sort(function (a, b) { return b.ht - a.ht; })[0];
      rows.push({ name: H.school(rt.full || rt.team), team: rt.team, _v: avg, val: ft(avg, 1),
        tag: 'Tallest: ' + tall.p.name + ' ' + ft(tall.ht, 0) + (byMin ? '' : ' · depth order'),
        big: String(t.a.filter(function (x) { return x.ht >= 82; }).length),
        fc: Math.round(100 * rot.filter(function (x) { return x.fc; }).reduce(function (s, x) { return s + x.mpg; }, 0) / w) + '%',
        rot: String(rot.length) });
    });
    var small = d.dir === 'down';
    rows.sort(function (a, b) { return small ? a._v - b._v : b._v - a._v; });
    return { title: (d.conf ? d.conf + ': ' : '') + (small ? 'The smallest rotations' : 'The biggest rotations'),
      subtitle: 'Average height of the projected rotation, weighted by minutes · ' + H.SEASON,
      lead: 'Avg height', src: 'The Depth Chart · ' + H.SEASON + ' rosters (listed heights) × projected minutes, 5+ mpg rotation',
      cols: [{ k: 'big', lab: '6\'10"+' }, { k: 'fc', lab: 'PF/C min' }, { k: 'rot', lab: 'Rotation' }],
      rows: rows.slice(0, n), players: false };
  }
});
