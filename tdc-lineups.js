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
  // full-fidelity combos precomputed by build_pbp_analytics.py (all units, not top-12)
  var _c = null, _cp = null;
  function loadCombos() {
    if (_c) return Promise.resolve(_c);
    if (_cp) return _cp;
    _cp = fetch('scripts/data/combos.json').then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { _c = j || {}; return _c; }).catch(function () { _c = {}; return _c; });
    return _cp;
  }
  function combosLookup(cd, season, full) {
    var t = (cd && cd[season]) || {}; if (t[full]) return t[full];
    var nf = norm(full);
    for (var k in t) { var nk = norm(k); if (nk === nf || nk.indexOf(nf) === 0 || nf.indexOf(nk) === 0) return t[k]; }
    return null;
  }
  // player positions for EVERYONE who played the team's season (incl. players who've
  // since left — the current roster only covers returners). From player_history
  // (season_year, team=short name, name, position G/F/C). Cached per team+season.
  var _posCache = {};
  function loadPos(full, season) {
    var key = full + '|' + season;
    if (_posCache[key]) return _posCache[key];
    var team = (window.tdcShortSchool ? window.tdcShortSchool(full) : full) || full;
    var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co', K = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
    var p = fetch(SB + '/rest/v1/player_history?team=eq.' + encodeURIComponent(team) + '&season_year=eq.' + season + '&select=name,position',
      { headers: { apikey: K, Authorization: 'Bearer ' + K } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { var idx = {}; (rows || []).forEach(function (x) { if (x && x.name && x.position) idx[posKey(x.name)] = ('' + x.position).toUpperCase(); }); return idx; })
      .catch(function () { return {}; });
    _posCache[key] = p; return p;
  }
  // client-side FALLBACK deriver (trios size 3, pairs size 2) from the top-12 lineups —
  // used only until combos.json exists; combos.json is the exact, full-fidelity version.
  function combo(lus, size) {
    var agg = {};
    function add(names, l) { var key = names.join('|');
      var a = agg[key] || (agg[key] = { players: names, poss: 0, wnet: 0, units: 0 });
      a.poss += l.poss; a.wnet += l.poss * l.net; a.units++; }
    lus.forEach(function (l) { var ps = l.players.slice().sort();
      if (size === 2) { for (var i = 0; i < ps.length; i++) for (var j = i + 1; j < ps.length; j++) add([ps[i], ps[j]], l); }
      else { for (var i = 0; i < ps.length; i++) for (var j = i + 1; j < ps.length; j++) for (var k = j + 1; k < ps.length; k++) add([ps[i], ps[j], ps[k]], l); } });
    var out = []; for (var key in agg) { var a = agg[key];
      out.push({ players: a.players, poss: Math.round(a.poss), net: Math.round(a.wnet / Math.max(1, a.poss) * 10) / 10, units: a.units }); }
    return out.sort(function (a, b) { return b.net - a.net; });
  }
  function trios(lus) { return combo(lus, 3); }   // back-compat
  function forTeam(full, season) {
    return Promise.all([load(), loadCombos()]).then(function (res) {
      var lus = lookup(res[0], '' + season, full), cc = combosLookup(res[1], '' + season, full);
      return { lineups: lus.slice().sort(function (a, b) { return b.poss - a.poss; }),
               trios: cc && cc.trios ? cc.trios : combo(lus, 3),
               pairs: cc && cc.pairs ? cc.pairs : combo(lus, 2) };
    });
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
  // ── deep five-man table (Hoop-Explorer-style: the four factors per unit, already in
  //    lineups.json) with position badges + subtle per-cell heat vs league baselines ──
  function heat(v, base, spread, hiGood) {
    if (v == null || isNaN(v)) return 'var(--text3)';
    var d = (v - base) / spread; if (!hiGood) d = -d; d = Math.max(-1, Math.min(1, d));
    if (d > 0.15) return d > 0.55 ? '#1f9d57' : '#5bb381';
    if (d < -0.15) return d < -0.55 ? '#e06552' : '#e0885a';
    return 'var(--text2)';
  }
  function cellN(v, dec, color, extra) {
    return '<div style="text-align:right;font-variant-numeric:tabular-nums;font-weight:700;font-size:12px;color:' + color + ';' + (extra || '') + '">'
      + (v == null || isNaN(v) ? '—' : (+v).toFixed(dec == null ? 0 : dec)) + '</div>';
  }
  function posKey(s) { return norm(s).replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim(); }
  function posIndex(map) { var idx = {}; if (map) for (var k in map) { if (map[k]) idx[posKey(k)] = ('' + map[k]).toUpperCase(); } return idx; }
  function posBadge(p) { return p ? '<sup style="font-size:8px;font-weight:800;color:var(--accent);margin-left:1px;letter-spacing:.02em;">' + p + '</sup>' : ''; }
  function lineupNames(players, idx) {
    var sn = shortNames(players);
    return players.map(function (p, i) { return '<span title="' + p.replace(/"/g, '&quot;') + '">' + sn[i] + posBadge(idx && idx[posKey(p)]) + '</span>'; })
      .join('<span style="color:var(--text3);"> · </span>');
  }
  // column layout: LINEUP | POSS · NET | ORtg · DRtg | eFG · TOV · ORB · FTr — three stat
  // groups, hairline-divided; NET pulled up front by POSS as the headline number.
  var LU_GTC = 'minmax(184px,1fr) 40px 62px 46px 46px 48px 46px 46px 46px';
  var LU_DIV = 'border-left:1px solid var(--border);padding-left:9px;';   // group separator
  var LU_MINW = 'min-width:648px;';
  function luHead() {
    var hs = [['', 0], ['POSS', 0], ['NET', 0], ['ORtg', 1], ['DRtg', 0], ['eFG%', 1], ['TOV%', 0], ['ORB%', 0], ['FTr', 0]];
    return '<div style="display:grid;grid-template-columns:' + LU_GTC + ';gap:7px;padding:0 6px 8px;' + LU_MINW + '">'
      + hs.map(function (h, i) { return '<div style="font-size:8.5px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:var(--text3);' + (i ? 'text-align:right;' : '') + (h[1] ? LU_DIV : '') + '">' + h[0] + '</div>'; }).join('')
      + '</div>';
  }
  function luRow(l, idx, i) {
    var tr = tier(l.net), netc = l.net > 0 ? '#2bb673' : l.net < 0 ? '#e06552' : 'var(--text2)';
    var zebra = (i % 2) ? 'background:color-mix(in srgb,var(--text3) 6%,transparent);' : '';
    var netCell = '<div style="text-align:right;line-height:1.05;"><div style="font-variant-numeric:tabular-nums;font-weight:800;font-size:13px;color:' + netc + ';">'
      + (l.net > 0 ? '+' : '') + (+l.net).toFixed(1) + '</div>'
      + (tr ? '<div style="font-size:7.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:' + tr.c + ';margin-top:1px;">' + tr.t + '</div>' : '') + '</div>';
    return '<div style="display:grid;grid-template-columns:' + LU_GTC + ';gap:7px;align-items:center;padding:9px 6px;border-radius:8px;' + zebra + LU_MINW + '">'
      + '<div style="min-width:0;font-weight:700;font-size:12px;line-height:1.4;">' + lineupNames(l.players, idx) + '</div>'
      + cellN(l.poss, 0, 'var(--text2)')
      + netCell
      + cellN(l.off_rtg, 0, heat(l.off_rtg, 77, 20, true), LU_DIV)
      + cellN(l.def_rtg, 0, heat(l.def_rtg, 74, 20, false))
      + cellN(l.efg, 1, heat(l.efg, 47.5, 8, true), LU_DIV)
      + cellN(l.tov_pct, 1, heat(l.tov_pct, 16, 5, false))
      + cellN(l.orb_pct, 1, heat(l.orb_pct, 6, 6, true))
      + cellN(l.ftr, 1, heat(l.ftr, 21, 12, true))
      + '</div>';
  }
  function lineupTable(qL, idx, maxL) {
    return '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding-top:2px;">' + luHead()
      + qL.slice(0, maxL).map(function (l, i) { return luRow(l, idx, i); }).join('') + '</div>';
  }
  function rowC(t) {   // a trio or pair row (both carry .players)
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--border);">'
      + '<div style="min-width:0;"><div style="font-weight:700;font-size:12.5px;" title="' + t.players.join(', ').replace(/"/g, '&quot;') + '">' + shortNames(t.players).join(' · ') + '</div>'
      + '<div style="font-size:10.5px;color:var(--text3);margin-top:2px;">' + t.poss + ' poss together' + (t.units != null ? ' · ' + t.units + ' unit' + (t.units !== 1 ? 's' : '') : '') + '</div></div>'
      + '<div style="white-space:nowrap;flex-shrink:0;">' + nchip(t.net) + '</div></div>';
  }
  function colHdr(label) { return '<div style="font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);margin-bottom:2px;">' + label + '</div>'; }
  function emptyCol() { return '<div style="font-size:12px;color:var(--text3);padding:12px 0;">Not enough tracked possessions.</div>'; }
  // Ready-to-inject section (lineups full-width, then trios | pairs). opt: {minPoss,
  // trioMin, pairMin, maxLineups, maxTrios, maxPairs}
  function section(full, season, opt) {
    opt = opt || {};
    var minP = opt.minPoss || 40, trioMin = opt.trioMin || 150, pairMin = opt.pairMin || 250;
    var maxL = opt.maxLineups || 8, maxT = opt.maxTrios || 8, maxP = opt.maxPairs || 8;
    return Promise.all([load(), loadCombos(), loadPos(full, season)]).then(function (res) {
      var lus = lookup(res[0], '' + season, full), cc = combosLookup(res[1], '' + season, full);
      var posBase = res[2] || {};
      var fullFi = !!(cc && ((cc.trios && cc.trios.length) || (cc.pairs && cc.pairs.length)));
      if (!lus.length && !fullFi) return '';
      var qL = lus.filter(function (l) { return l.poss >= minP; }).sort(function (a, b) { return b.poss - a.poss; });
      var triRows = (cc && cc.trios) ? cc.trios : combo(lus, 3).filter(function (t) { return t.poss >= trioMin; });
      var pairRows = (cc && cc.pairs) ? cc.pairs : combo(lus, 2).filter(function (t) { return t.poss >= pairMin; });
      var yl = (season - 1) + '-' + ('' + season).slice(2);
      var src = fullFi ? 'full play-by-play' : 'reconstructed from the tracked lineups';
      // positions for EVERYONE (player_history base) + the current-roster override
      // (opt.pos, more granular PG/SG for returners) layered on top.
      var pIdx = Object.assign({}, posBase, posIndex(opt.pos));
      var lineupCol = qL.length ? lineupTable(qL, pIdx, maxL) : emptyCol();
      var trioCol = triRows.slice(0, maxT).map(rowC).join('') || emptyCol();
      var pairCol = pairRows.slice(0, maxP).map(rowC).join('') || emptyCol();
      return ''
        + '<div style="font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);margin:26px 0 4px;">Lineups, Trios &amp; Pairs <span style="font-weight:600;letter-spacing:0;text-transform:none;color:var(--text3);font-size:11px;">· ' + yl + ' · ' + src + '</span></div>'
        + '<div style="font-size:12px;color:var(--text3);line-height:1.5;margin-bottom:12px;max-width:820px;">The five-man units this team played and how each performed on the floor, plus the three- and two-man combos inside them. <b style="color:var(--text2);">Net</b> = per-100 scoring margin with that group on. <b style="color:var(--text2);">eFG/TOV/ORB/FTr</b> = the four factors (shooting · ball security · offensive glass · foul-drawing); <span style="color:#5bb381;">green</span>/<span style="color:#e0885a;">red</span> = better/worse than a typical unit. Superscripts are each man&rsquo;s position.</div>'
        + colHdr('Five-man lineups · most-used') + lineupCol
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:18px;">'
        + '<div>' + colHdr('Top trios') + trioCol + '</div>'
        + '<div>' + colHdr('Top pairs') + pairCol + '</div>'
        + '</div>';
    });
  }
  return { load: load, forTeam: forTeam, section: section, trios: trios, combo: combo, short: short, tier: tier };
})();
