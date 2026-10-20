/* Post: passing connections — who assists whom (data/passing_network.json, built by build_passing_network.py from the
 * shots table: assister ast_id → shooter espn_id on every assisted make; 2025-26 only, ~96% of shots located).
 * Per team the file keeps the 11 most-involved players and the 22 busiest lanes between them. */
TDC_POSTS.add('passing', {
  group: 'Lineups', label: 'Passing connections (who assists whom)',
  note: 'Assisted made shots from passer to scorer, 2025-26 (logged shots, ~96% of the season). One team = its busiest lanes; no team = the busiest in the country or a conference.',
  opts: { team: true, conf: true, season: false, returning: true },
  load: async function (d, H) {
    var pn = await H.json('data/passing_network.json'), rs = await H.ratings(), n = Math.max(1, Math.min(20, +d.n || 10));
    var rowOf = function (full) { return rs.find(function (t) { return t.full === full; }) || rs.find(function (t) { return H.onTeam(t.team, full) || H.onTeam(t.full, full); }); };
    var last = function (s) { var x = String(s || '').trim().split(/\s+/).filter(function (y) { return !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(y); }); return x.length ? x[x.length - 1] : String(s || ''); };
    // same surname (the Boozers): first names ("Cayden → Cameron Boozer")
    var pairNm = function (a, b, sep) { var x = last(a), y = last(b); if (x === y) { x = String(a).split(/\s+/)[0]; y = String(b).split(/\s+/)[0] + ' ' + y; } return x + sep + y; };
    // returning only (owner, Oct 20 2026): passer and scorer both on the same team's 2026-27 roster
    if (d.ret) await H.players();
    var back = function (ids, rt) { return ids.every(function (id) { var t = H.nowTeam(id); return t && (H.onTeam(t, rt.team) || H.onTeam(t, rt.full)); }); };
    var out = [];
    Object.keys(pn).forEach(function (t) { var T = pn[t], rt = rowOf(t); if (!rt || !T || !T.nAst) return;
      if (d.team && !(H.onTeam(rt.team, d.team) || H.onTeam(rt.full, d.team) || H.onTeam(t, d.team))) return;
      if (d.conf && H.confName(rt.conf) !== d.conf) return;
      var by = {}; (T.nodes || []).forEach(function (x) { by[x.espn] = x; });
      (T.edges || []).forEach(function (e) { var a = by[e.f], b = by[e.t];
        if (d.ret && !back([e.f, e.t], rt)) return;
        if (!a || !b || String(a.name).length < 3 || String(b.name).length < 3 || a.name === '—' || b.name === '—') return;   // the feed sometimes logs a stray initial as the passer
        out.push({ name: pairNm(a.name, b.name, ' → '), team: rt.team, espn: String(e.f), tag: d.team ? '' : H.school(rt.full || rt.team), _v: e.n, val: String(e.n),
          sh: (100 * e.n / T.nAst).toFixed(1) + '%', ofp: a.cr ? Math.round(100 * e.n / a.cr) + '%' : '', ofs: b.rc ? Math.round(100 * e.n / b.rc) + '%' : '',
          xp: (e.xp / e.n).toFixed(2), pair: [{ name: a.name, espn: String(e.f) }, { name: b.name, espn: String(e.t) }] }); }); });   // both headshots
    if (!out.length) throw new Error('No passing data for ' + (d.team || d.conf || 'D-I') + '.');
    out.sort(function (a, b) { return b._v - a._v || parseFloat(b.sh) - parseFloat(a.sh); });
    var who = d.team ? H.school(d.team) + ': ' : d.conf ? d.conf + ': ' : '';
    return {
      title: who + 'Who Feeds Whom',
      subtitle: 'Passer → scorer, assisted made shots · 2025-26' + (d.ret ? ' · both back in ' + H.SEASON : ''),
      lead: 'Assists', src: 'Assister and shooter on every logged made shot, 2025-26 · xPts/look = D-I make rate of that shot zone × its value',
      cols: [{ k: 'sh', lab: 'Team ast %' }, { k: 'ofp', lab: 'Of his assists' }, { k: 'ofs', lab: 'Of scorer\'s assisted' }, { k: 'xp', lab: 'xPts / look' }],
      dist: { sh: out.map(function (r) { return r.sh; }), ofp: out.map(function (r) { return r.ofp; }), ofs: out.map(function (r) { return r.ofs; }), xp: out.map(function (r) { return r.xp; }) },
      rows: out.slice(0, n), players: true
    };
  }
});
