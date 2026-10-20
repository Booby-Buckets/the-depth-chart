/* Post: best two-man pairings — every pair's possessions together, from the play-by-play stints behind wowy.html
 * (scripts/data/wowy_units_<season>.json → units[team]['2'] = each team's 15 busiest pairs, r = {poss, o, d, net, ol, dl, netl…}).
 * Ranked by luck-adjusted net (netl = opponents' 3-point shooting pulled to average), like the Lineups graphic. */
TDC_POSTS.add('duos', {
  group: 'Lineups', label: 'Best two-man pairings',
  note: 'Net rating with both players on the floor, opponents\' 3-point shooting pulled to average. Each team\'s 15 most-used pairs; 300+ possessions together (150+ for one team).',
  opts: { team: true, conf: true, season: true, seasons: 3, dir: true, upLabel: 'Best pairs first', downLabel: 'Worst pairs first', returning: true },
  load: async function (d, H) {
    var season = String(d.season || '2026'), w = await H.json('scripts/data/wowy_units_' + season + '.json'), rs = await H.ratings();
    var n = Math.max(1, Math.min(20, +d.n || 10)), minP = d.team ? 150 : 300, yr = (+season - 1) + '-' + season.slice(2);
    var rowOf = function (full) { return rs.find(function (t) { return t.full === full; }) || rs.find(function (t) { return H.onTeam(t.team, full) || H.onTeam(t.full, full); }); };
    var last = function (s) { var x = String(s || '').trim().split(/\s+/).filter(function (y) { return !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(y); }); return x.length ? x[x.length - 1] : String(s || ''); };
    // same surname (the Boozers): first names ("Cayden → Cameron Boozer")
    var pairNm = function (a, b, sep) { var x = last(a), y = last(b); if (x === y) { x = String(a).split(/\s+/)[0]; y = String(b).split(/\s+/)[0] + ' ' + y; } return x + sep + y; };
    // returning only (owner, Oct 20 2026): both players are on the same team's 2026-27 roster
    if (d.ret) await H.players();
    var back = function (ids, rt) { return ids.every(function (id) { var t = H.nowTeam(id); return t && (H.onTeam(t, rt.team) || H.onTeam(t, rt.full)); }); };
    var out = [];
    Object.keys(w.units).forEach(function (t) { var rt = rowOf(t); if (!rt) return;
      if (d.team && !(H.onTeam(rt.team, d.team) || H.onTeam(rt.full, d.team) || H.onTeam(t, d.team))) return;
      if (d.conf && H.confName(rt.conf) !== d.conf) return;
      (w.units[t]['2'] || []).forEach(function (x) { var r = x.r; if (!r || r.poss < minP || r.netl == null) return;
        var a = w.names[x.ids[0]] || '', b = w.names[x.ids[1]] || ''; if (!a || !b) return;
        if (d.ret && !back(x.ids, rt)) return;
        out.push({ name: pairNm(a, b, ' & '), team: rt.team, tag: d.team ? '' : H.school(rt.full || rt.team), _v: r.netl, val: H.fmt(r.netl, 1, true),
          poss: String(r.poss), ol: H.fmt(r.ol, 1), dl: H.fmt(r.dl, 1), net: H.fmt(r.net, 1, true),
          pair: [{ name: a, espn: x.ids[0] }, { name: b, espn: x.ids[1] }] }); }); });   // both headshots on the graphic
    if (!out.length) throw new Error('No pairs with ' + minP + '+ possessions for ' + (d.team || d.conf || 'D-I') + ' in ' + yr + '.');
    var down = d.dir === 'down';
    out.sort(function (a, b) { return down ? a._v - b._v : b._v - a._v; });
    var who = d.team ? H.school(d.team) + ': ' : d.conf ? d.conf + ': ' : '';
    return {
      title: who + (down ? 'The Duos That Didn\'t Work' : 'The Best Two-Man Pairings'),
      subtitle: 'Luck-adjusted net rating with both on the floor · ' + minP + '+ possessions together · ' + yr + (d.ret ? ' · both back in ' + H.SEASON : ''),
      lead: 'Adj Net', src: 'Two-man stints rebuilt from play-by-play substitutions · adjusted = opponents\' 3P% pulled to average',
      cols: [{ k: 'poss', lab: 'Poss' }, { k: 'ol', lab: 'Adj ORtg' }, { k: 'dl', lab: 'Adj DRtg' }, { k: 'net', lab: 'Raw net' }],
      dist: { poss: [], dl: [], ol: out.map(function (r) { return r.ol; }), net: out.map(function (r) { return r.net; }) },   // DRtg: lower is better, so it isn't shaded on the high-is-green ramp
      rows: out.slice(0, n), players: true
    };
  }
});
