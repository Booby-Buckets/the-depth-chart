/* Post: team hot zones — one team's shot profile, zone by zone, against the D-I average that season.
 * 2025-26: ESPN play-by-play zones (scripts/data/shot_aftermath/2026.json — rim / short 2 / long 2 / three, all D-I games,
 *   points per shot include second chances off offensive rebounds).
 * 2024-25 and earlier: the 10-zone located-shot profiles (scripts/data/shot_team_profiles.json, CBBD shot locations),
 *   grouped into rim / paint / mid-range / corner 3 / wing 3 / top 3. That file has no 2025-26 yet, hence the two sources. */
TDC_POSTS.add('shotzones', {
  group: 'Shooting', label: 'Hot zones (team shot profile)',
  note: 'One team, every shot zone: share of its shots, FG% and points per shot, against the D-I average that season. 2025-26 uses play-by-play zones (points include second chances); earlier seasons use located shots (10 zones, grouped).',
  opts: { team: true, teamRequired: true, conf: false, season: true, seasons: 4 },
  load: async function (d, H) {
    if (!d.team) throw new Error('Pick a team for this post.');
    var lg = H.logoUrl(d.team), m = lg && lg.match(/\/(\d+)\.png/), tid = m ? m[1] : null;
    if (!tid) throw new Error('Unknown team: ' + d.team);
    var season = String(d.season || '2026'), yr = (+season - 1) + '-' + season.slice(2), nm = H.school(d.team);
    var pct = function (v) { return v == null ? '' : (100 * v).toFixed(1) + '%'; };
    var pp = function (v) { return v == null ? '' : ((v > 0 ? '+' : '') + (100 * v).toFixed(1)); };
    var Z = [], L = {}, T = {}, src = '';

    if (season === '2026') {
      // play-by-play zones: {teamId: {G|F|C: {zone: cols}}}
      var a = await H.json('scripts/data/shot_aftermath/2026.json'), C = a.cols, ix = function (k) { return C.indexOf(k); };
      if (!a.data[tid]) throw new Error('No 2025-26 shot data for ' + nm + '.');
      var addTo = function (acc, byPos) { Object.keys(byPos).forEach(function (pos) { var z = byPos[pos]; Object.keys(z).forEach(function (zn) {
        var v = z[zn]; acc[zn] = acc[zn] || C.map(function () { return 0; }); v.forEach(function (x, i) { acc[zn][i] += x; }); }); }); };
      Object.keys(a.data).forEach(function (id) { addTo(L, a.data[id]); }); addTo(T, a.data[tid]);
      var stat = function (acc) { var all = 0, o = {}; Object.keys(acc).forEach(function (k) { all += acc[k][ix('att')]; });
        Object.keys(acc).forEach(function (k) { var t = acc[k], at = t[ix('att')], oppN = t[ix('oppMakeN')] + t[ix('oppDRN')];
          o[k] = { att: at, share: at / all, fg: at ? t[ix('made')] / at : null, pps: at ? (t[ix('madePts')] + t[ix('scPts')]) / at : null,
            opp: oppN ? (t[ix('oppMakePts')] + t[ix('oppDRPts')]) / oppN : null }; }); return o; };
      var lS = stat(L), tS = stat(T), LBL = { rim: 'At the rim', short: 'Short 2 (paint)', long: 'Long 2', three: '3-pointers', mid: 'Other 2s' };
      Z = ['rim', 'short', 'long', 'three', 'mid'].filter(function (k) { return tS[k] && tS[k].att >= 15; }).map(function (k) {
        return { name: LBL[k], t: tS[k], l: lS[k] || {} }; });
      src = 'ESPN play-by-play, every ' + nm + ' shot ' + yr + ' · points per shot include second chances · opp next = their next trip (PPP)';
    } else {
      var p = await H.json('scripts/data/shot_team_profiles.json'), F = p.fields, fi = function (k) { return F.indexOf(k); };
      var row = p.teams[tid] && p.teams[tid].seasons[season];
      if (!row) throw new Error('No ' + yr + ' located-shot data for ' + nm + '.');
      var G = [['At the rim', ['rim'], 2], ['Paint (non-rim)', ['paint'], 2], ['Mid-range', ['midl', 'midc', 'midr'], 2],
               ['Corner 3', ['c3l', 'c3r'], 3], ['Wing 3', ['w3l', 'w3r'], 3], ['Top of the key 3', ['t3'], 3]];
      // D-I average = every team with a full season of located shots that year (drops non-D-I opponents' handful of shots)
      var lg2 = G.map(function () { return [0, 0]; }), lgN = 0;
      var grp = function (r) { return G.map(function (g) { var at = 0, md = 0; g[1].forEach(function (z) { at += r[fi(z + '_a')]; md += r[fi(z + '_m')]; }); return [at, md]; }); };
      Object.keys(p.teams).forEach(function (id) { var r = p.teams[id].seasons[season]; if (!r || r[0] < 1000) return; lgN += r[0];
        grp(r).forEach(function (x, i) { lg2[i][0] += x[0]; lg2[i][1] += x[1]; }); });
      var tg = grp(row), tN = tg.reduce(function (s, x) { return s + x[0]; }, 0);
      Z = G.map(function (g, i) { var at = tg[i][0], la = lg2[i][0];
        return { name: g[0], t: { att: at, share: at / tN, fg: at ? tg[i][1] / at : null, pps: at ? g[2] * tg[i][1] / at : null },
          l: { share: la / lgN, fg: la ? lg2[i][1] / la : null, pps: la ? g[2] * lg2[i][1] / la : null } }; }).filter(function (z) { return z.t.att >= 25; });
      src = 'Located shots (CollegeBasketballData), every ' + nm + ' shot ' + yr + ' · points per shot = made FG value, no free throws';
    }
    if (!Z.length) throw new Error('No shot zones for ' + nm + ' in ' + yr + '.');

    var rows = Z.map(function (z) { var t = z.t, l = z.l;
      var r = { name: z.name, team: '', tag: t.att.toLocaleString() + ' shots', val: t.pps == null ? '' : t.pps.toFixed(2), _v: t.pps,
        share: pct(t.share), shd: l.share != null ? pp(t.share - l.share) : '', fg: pct(t.fg), fgd: (t.fg != null && l.fg != null) ? pp(t.fg - l.fg) : '' };
      if (season === '2026') r.opp = t.opp == null ? '' : t.opp.toFixed(2);
      return r; });
    var cols = [{ k: 'share', lab: 'Shot share' }, { k: 'shd', lab: 'vs D-I' }, { k: 'fg', lab: 'FG%' }, { k: 'fgd', lab: 'FG% vs D-I' }];
    if (season === '2026') cols.push({ k: 'opp', lab: 'Opp next' });
    // heat only where it means something across zones: the gaps to D-I (raw shares / FG% / opp PPP differ by zone by nature)
    var dist = { share: [], fg: [], opp: [], shd: [-8, -4, -2, 0, 2, 4, 8], fgd: [-10, -5, -2.5, 0, 2.5, 5, 10] };
    var best = rows.slice().sort(function (a, b) { return parseFloat(b.fgd || -99) - parseFloat(a.fgd || -99); })[0];
    return {
      title: nm + ': Where the Points Come From',
      subtitle: 'Shot profile by zone vs the D-I average · ' + yr + (best && parseFloat(best.fgd) > 0 ? ' · hottest: ' + best.name.toLowerCase() : ''),
      lead: 'Pts/shot', src: src, cols: cols, dist: dist, rows: rows, players: false
    };
  }
});
