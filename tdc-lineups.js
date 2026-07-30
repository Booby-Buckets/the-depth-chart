/* tdc-lineups.js — team-specific five-man LINEUPS + TRIOS from reconstructed
   play-by-play (scripts/data/lineups.json). Shared across the Coach's Tier scouting
   pages (scout / self-scout) and the team On/Off tab so a coach can see, for any
   team: which units actually play, how each performs, and which three-man
   combinations move the needle.

   API (all keyed by the team's FULL name, e.g. "Duke Blue Devils"):
     TDC_LINEUPS.load()                    -> Promise (warms the cache)
     TDC_LINEUPS.forTeam(full, season)     -> Promise<{lineups:[...], trios:[...]}>
     TDC_LINEUPS.section(full, season, opt) -> Promise<htmlString>  (a ready section;
                                               '' when the team has no lineup data)
   Styles are inline so it renders consistently on any page. */
window.TDC_LINEUPS = (function () {
  var _d = null, _p = null;
  function load() {
    if (_d) return Promise.resolve(_d);
    if (_p) return _p;
    _p = fetch('scripts/data/lineups.json').then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { _d = j || {}; return _d; }).catch(function () { _d = {}; return _d; });
    return _p;
  }
  function short(p) { var t = ('' + (p || '')).trim().split(/\s+/), last = t[t.length - 1];
    if (t.length >= 2 && /^(jr|sr|ii|iii|iv|v)\.?$/i.test(last)) return t[t.length - 2]; return last; }
  // group-aware: if two players in the same unit share a last name (Cameron & Cayden
  // Boozer), fall back to their full names so the display stays unambiguous.
  function shortNames(players) {
    var last = players.map(short), c = {};
    last.forEach(function (s) { c[s] = (c[s] || 0) + 1; });
    return players.map(function (p, i) { return c[last[i]] > 1 ? p : last[i]; });
  }
  function norm(s) { return ('' + (s || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function tier(v) { if (v == null) return null;
    if (v >= 15) return { t: 'Elite', c: '#1f9d57' }; if (v >= 8) return { t: 'Strong', c: '#2bb673' };
    if (v >= 2) return { t: 'Positive', c: '#6bbf8a' }; if (v > -2) return { t: 'Neutral', c: '#8a93a3' };
    if (v > -8) return { t: 'Soft', c: '#e0885a' }; return { t: 'Bleeds', c: '#e06552' }; }
  function lookup(d, season, full) {
    var t = d[season] || {}; if (t[full]) return t[full];
    var nf = norm(full);
    for (var k in t) { var nk = norm(k); if (nk === nf || nk.indexOf(nf) === 0 || nf.indexOf(nk) === 0) return t[k]; }
    return [];
  }
  function trios(lus) {
    var agg = {};
    lus.forEach(function (l) { var ps = l.players.slice().sort();
      for (var i = 0; i < ps.length; i++) for (var j = i + 1; j < ps.length; j++) for (var k = j + 1; k < ps.length; k++) {
        var key = ps[i] + '|' + ps[j] + '|' + ps[k];
        var a = agg[key] || (agg[key] = { names: [ps[i], ps[j], ps[k]], poss: 0, wnet: 0, units: 0 });
        a.poss += l.poss; a.wnet += l.poss * l.net; a.units++;
      } });
    var out = []; for (var key in agg) { var a = agg[key];
      out.push({ names: a.names, poss: Math.round(a.poss), net: Math.round(a.wnet / Math.max(1, a.poss) * 10) / 10, units: a.units }); }
    return out.sort(function (a, b) { return b.net - a.net; });
  }
  function forTeam(full, season) {
    return load().then(function (d) { var lus = lookup(d, '' + season, full);
      return { lineups: lus.slice().sort(function (a, b) { return b.poss - a.poss; }), trios: trios(lus) }; });
  }
  function nchip(v) { var tr = tier(v);
    return '<span style="font-family:\'Playfair Display\',serif;font-weight:800;font-size:15px;color:' + (v > 0 ? '#2bb673' : v < 0 ? '#e06552' : 'var(--text2)') + ';">' + (v > 0 ? '+' : '') + (+v).toFixed(1) + '</span>'
      + (tr ? '<span style="font-size:8.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:' + tr.c + ';margin-left:6px;">' + tr.t + '</span>' : ''); }
  function row5(l) {
    var names = shortNames(l.players).join(' · ');
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--border);">'
      + '<div style="min-width:0;"><div style="font-weight:700;font-size:12.5px;line-height:1.35;" title="' + l.players.join(', ').replace(/"/g, '&quot;') + '">' + names + '</div>'
      + '<div style="font-size:10.5px;color:var(--text3);margin-top:2px;">' + l.poss + ' poss · ' + (+l.off_rtg).toFixed(0) + ' ORtg · ' + (+l.def_rtg).toFixed(0) + ' DRtg</div></div>'
      + '<div style="white-space:nowrap;flex-shrink:0;">' + nchip(l.net) + '</div></div>';
  }
  function row3(t) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--border);">'
      + '<div style="min-width:0;"><div style="font-weight:700;font-size:12.5px;" title="' + t.names.join(', ').replace(/"/g, '&quot;') + '">' + shortNames(t.names).join(' · ') + '</div>'
      + '<div style="font-size:10.5px;color:var(--text3);margin-top:2px;">' + t.poss + ' poss together · ' + t.units + ' unit' + (t.units !== 1 ? 's' : '') + '</div></div>'
      + '<div style="white-space:nowrap;flex-shrink:0;">' + nchip(t.net) + '</div></div>';
  }
  // Ready-to-inject section. opt: {minPoss, trioMin, maxLineups, maxTrios, worst}
  function section(full, season, opt) {
    opt = opt || {};
    var minP = opt.minPoss || 40, trioMin = opt.trioMin || 150;
    var maxL = opt.maxLineups || 8, maxT = opt.maxTrios || 8;
    return load().then(function (d) {
      var lus = lookup(d, '' + season, full);
      if (!lus.length) return '';
      var qL = lus.filter(function (l) { return l.poss >= minP; }).sort(function (a, b) { return b.poss - a.poss; });
      var tri = trios(lus).filter(function (t) { return t.poss >= trioMin; });
      var yl = (season - 1) + '-' + ('' + season).slice(2);
      var lineupCol = qL.slice(0, maxL).map(row5).join('') ||
        '<div style="font-size:12px;color:var(--text3);padding:12px 0;">Not enough tracked possessions.</div>';
      var trioCol = tri.slice(0, maxT).map(row3).join('') ||
        '<div style="font-size:12px;color:var(--text3);padding:12px 0;">Not enough tracked possessions.</div>';
      return ''
        + '<div style="font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);margin:26px 0 4px;">Lineups &amp; Trios <span style="font-weight:600;letter-spacing:0;text-transform:none;color:var(--text3);font-size:11px;">· ' + yl + ' · reconstructed from play-by-play</span></div>'
        + '<div style="font-size:12px;color:var(--text3);line-height:1.5;margin-bottom:10px;max-width:820px;">The five-man units this team actually played and the three-man combinations inside them. <b style="color:var(--text2);">Net</b> = points per 100 the team out-scored opponents with that group on the floor; trios are possession-weighted across the units they share.</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:26px;">'
        + '<div><div style="font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);">Five-man lineups <span style="color:var(--text3);font-weight:600;">· most-used</span></div>' + lineupCol + '</div>'
        + '<div><div style="font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);">Top trios</div>' + trioCol + '</div>'
        + '</div>';
    });
  }
  return { load: load, forTeam: forTeam, section: section, trios: trios, short: short, tier: tier };
})();
