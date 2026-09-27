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
// neutral card "back" behind each table so it reads as a panel, not floating on the team tint
var LU_CARD='overflow-x:auto;-webkit-overflow-scrolling:touch;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:8px 14px 12px;box-shadow:0 1px 3px rgba(0,0,0,.12);';
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
  // Canonical team match. The data is keyed by FULL ESPN names ("Florida Gators");
  // the caller may pass a full OR a short name ("Florida"). A loose startsWith()
  // conflated sibling programs that share a name prefix — Florida vs Florida
  // Atlantic vs Florida State, Utah vs Utah State, Colorado vs Colorado State —
  // arbitrarily returning whichever appeared first (FAU under Florida). Resolve
  // both sides to their canonical SHORT school via tdcShortSchool and require an
  // exact short-school match; only fall back to a loose prefix when it identifies
  // exactly one team (never guess among siblings).
  function _shortSchool(s) { try { return (window.tdcShortSchool ? window.tdcShortSchool(s) : s) || s; } catch (e) { return s; } }
  function _pickTeam(t, full) {
    if (t[full]) return t[full];                                    // exact full-name key
    var nf = norm(full), k;
    for (k in t) { if (norm(k) === nf) return t[k]; }               // exact (normalized)
    var sf = norm(_shortSchool(full));
    if (sf) { for (k in t) { if (norm(_shortSchool(k)) === sf) return t[k]; } }  // canonical short school
    var hits = [];                                                  // last resort: UNIQUE loose prefix only
    for (k in t) { var nk = norm(k); if (nk.indexOf(nf) === 0 || nf.indexOf(nk) === 0) hits.push(k); }
    return hits.length === 1 ? t[hits[0]] : null;
  }
  function lookup(d, season, full) {
    var t = d[season] || {};
    return _pickTeam(t, full) || [];
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
    var t = (cd && cd[season]) || {};
    return _pickTeam(t, full);   // canonical short-school match (see _pickTeam) — no sibling-prefix mixups
  }
  // team_dna → team-level schedule strength. adjust_team_dna.py stores an opponent-
  // adjusted team net (adjNet); the schedule delta (adjNet − raw net) is the team's SoS
  // in net-rating points (+ = tougher schedule). Applied uniformly to the team's lineups
  // (per-lineup opponents would need a pbp re-scrape); Adj Net = a row's net + this delta.
  var _dna = null, _dnap = null;
  function loadDna() {
    if (_dna) return Promise.resolve(_dna);
    if (_dnap) return _dnap;
    _dnap = fetch('scripts/data/team_dna.json').then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { _dna = j || {}; return _dna; }).catch(function () { _dna = {}; return _dna; });
    return _dnap;
  }
  function sosDeltaFor(dna, season, full) {
    var t = (dna && dna['' + season] && dna['' + season].teams) || {};
    var e = _pickTeam(t, full);   // same canonical match, so SoS lands on the right sibling
    return (e && e.adjNet != null && e.net != null) ? Math.round((e.adjNet - e.net) * 10) / 10 : null;
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
    // aggregate over the five-man units a combo appears in, possession-weighting every
    // rate (net/ORtg/DRtg + the four factors) — an approximation of the combo's on-floor
    // profile blended from the tracked lineups (exact counts aren't stored per unit).
    var agg = {}, WK = ['net', 'off_rtg', 'def_rtg', 'efg', 'tov_pct', 'orb_pct', 'ftr'];
    function add(names, l) { var key = names.join('|'), p = l.poss || 0;
      var a = agg[key] || (agg[key] = { players: names, poss: 0, units: 0, w: {} });
      a.poss += p; a.units++;
      WK.forEach(function (k) { if (l[k] != null) a.w[k] = (a.w[k] || 0) + p * l[k]; }); }
    lus.forEach(function (l) { var ps = l.players.slice().sort();
      if (size === 2) { for (var i = 0; i < ps.length; i++) for (var j = i + 1; j < ps.length; j++) add([ps[i], ps[j]], l); }
      else { for (var i = 0; i < ps.length; i++) for (var j = i + 1; j < ps.length; j++) for (var k = j + 1; k < ps.length; k++) add([ps[i], ps[j], ps[k]], l); } });
    var r1 = function (x) { return Math.round(x * 10) / 10; };
    var out = []; for (var key in agg) { var a = agg[key], d = Math.max(1, a.poss), o = { players: a.players, poss: Math.round(a.poss), units: a.units };
      WK.forEach(function (k) { o[k] = a.w[k] != null ? r1(a.w[k] / d) : null; }); out.push(o); }
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
  // normalize any position label to a consistent G / F / C (player_history is already
  // G/F/C; the current roster is granular PG/SG/SF/PF/C — collapse it so the whole
  // column reads the same all the way down).
  function toGFC(p) { p = ('' + (p || '')).toUpperCase().trim(); if (!p) return '';
    if (p.indexOf('C') >= 0 && p.indexOf('G') < 0 && p.indexOf('F') < 0) return 'C';
    if (p.indexOf('F') >= 0) return 'F'; return 'G'; }
  function posKey(s) { return norm(s).replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim(); }
  function posIndex(map) { var idx = {}; if (map) for (var k in map) { if (map[k]) idx[posKey(k)] = ('' + map[k]).toUpperCase(); } return idx; }
  function posBadge(p) { return p ? '<sup style="font-size:8px;font-weight:700;color:var(--text3);margin-left:1px;">' + p + '</sup>' : ''; }
  function lineupNames(players, idx) {
    var sn = shortNames(players);
    return players.map(function (p, i) { return '<span title="' + p.replace(/"/g, '&quot;') + '">' + sn[i] + posBadge(idx && idx[posKey(p)]) + '</span>'; })
      .join('<span style="color:var(--text3);"> · </span>');
  }
  // personnel archetype from a five-man unit's G/F/C makeup (needs all 5 positions known)
  function archetypeOf(players, idx) {
    var g = 0, f = 0, c = 0, unk = 0;
    players.forEach(function (p) { var pos = idx && idx[posKey(p)]; if (pos === 'G') g++; else if (pos === 'F') f++; else if (pos === 'C') c++; else unk++; });
    if (unk > 0 || players.length !== 5) return null;
    var lab = g >= 4 ? '4-Guard' : c >= 2 ? 'Twin Towers' : g === 3 ? '3-Guard' : g <= 1 ? 'Jumbo' : c === 0 ? 'Small Ball' : 'Balanced';
    return { lab: lab, mk: g + 'G · ' + f + 'F · ' + c + 'C' };
  }
  function archTag(a) { return a ? '<span title="' + a.mk + '">' + a.lab + '</span>' : ''; }
  // ── the site sheet (tdc-sheets.css .sheet.dense): gridlines, zebra, sticky header,
  //    frozen lineup column. Three stat groups (POSS·NET | ORtg·DRtg | four factors) split
  //    by a heavier vertical rule; numbers are shaded red-to-green within the table by
  //    tdcSheetHeat (tdc-sheets.js) via data-heat on the headers. ──
  var LU_DIVB = 'border-left:2px solid var(--border2);';   // group separator
  function td(v, dec, cls, extra) {
    return '<td' + (cls ? ' class="' + cls + '"' : '') + (extra ? ' style="' + extra + '"' : '') + '>'
      + (v == null || isNaN(v) ? '—' : (+v).toFixed(dec == null ? 0 : dec)) + '</td>';
  }
  function sgn(v) { return v == null || isNaN(v) ? '—' : (v > 0 ? '+' : '') + (+v).toFixed(1); }
  // adjusted-net cell (row net + team SoS delta) + a SoS cell (the team constant)
  function adjCell(net, sos) { return '<td>' + sgn((+net || 0) + (sos || 0)) + '</td>'; }
  function sosCell(sos) { return '<td class="dim">' + sgn(sos) + '</td>'; }
  // hover descriptions for every stat column (self-contained so tooltips work on every
  // page this module renders on, whether or not tdc-glossary.js is loaded).
  var TT = {
    poss: 'The number of possessions this group played together (offense + defense). A bigger number is a more reliable sample.',
    net: 'Points scored minus points allowed per 100 possessions with this group on the floor — the bottom-line scoring margin.',
    adj: 'Net adjusted for schedule: this group’s net plus the team’s schedule strength (SoS), so the number is comparable across teams.',
    sos: 'Strength of schedule in net-rating points — how much tougher (+) or weaker (−) than average the team’s opponents were. Team-level: the same for every one of its lineups.',
    ortg: 'Points scored per 100 possessions with this group on the floor — offensive efficiency, independent of pace.',
    drtg: 'Points allowed per 100 possessions with this group on the floor — defensive efficiency. Lower is better.',
    efg: 'Effective field-goal %: shooting that credits threes as worth more (a made 3 counts like 1.5 made 2s). A better read on shooting than raw FG%.',
    tov: 'Turnover rate — the share of possessions that end in a turnover. Lower is better.',
    orb: 'Offensive-rebound rate — the share of its own missed shots this group rebounded for another chance.',
    ftr: 'Free-throw rate — free throws attempted per field-goal attempt; how much this group gets to the line.',
    units: 'How many distinct five-man lineups this combo appeared in together. More units and possessions make the numbers more trustworthy.'
  };
  var TT_ID = { 'POSS': 'poss', 'NET': 'net', 'Adj': 'adj', 'SoS': 'sos', 'ORtg': 'ortg', 'DRtg': 'drtg', 'eFG%': 'efg', 'TOV%': 'tov', 'ORB%': 'orb', 'FTr': 'ftr', 'Units': 'units' };
  // header column specs + click-to-sort machinery
  // [label, align, isGroupStart, data-heat]
  var FIVE_HS = [['Lineup', 'l', 0, 0], ['Type', 'l', 0, 0], ['POSS', '', 0, 0], ['NET', '', 0, 1], ['Tier', 'l', 0, 0], ['Adj', '', 0, 1], ['SoS', '', 0, 0], ['ORtg', '', 1, 1], ['DRtg', '', 0, -1], ['eFG%', '', 1, 1], ['TOV%', '', 0, -1], ['ORB%', '', 0, 1], ['FTr', '', 0, 1]];
  var COMBO_HS = [['Players', 'l', 0, 0], ['POSS', '', 0, 0], ['NET', '', 0, 1], ['Tier', 'l', 0, 0], ['Adj', '', 0, 1], ['SoS', '', 0, 0], ['ORtg', '', 1, 1], ['DRtg', '', 0, -1], ['eFG%', '', 1, 1], ['TOV%', '', 0, -1], ['ORB%', '', 0, 1], ['FTr', '', 0, 1], ['Units', '', 1, 0]];
  var SORT_KEY = { 'POSS': 'poss', 'NET': 'net', 'Adj': 'net', 'ORtg': 'off_rtg', 'DRtg': 'def_rtg', 'eFG%': 'efg', 'TOV%': 'tov_pct', 'ORB%': 'orb_pct', 'FTr': 'ftr', 'Units': 'units' };
  var LOWER_BETTER = { def_rtg: 1, tov_pct: 1 };
  var _reg = {}, _rn = 0;
  function thCell(h, sc) {   // h = [label, align, isGroupStart, heat]; sc = sort context (or null)
    var t = TT[TT_ID[h[0]]] || (h[0] === 'Type' ? 'Personnel archetype from the unit\'s G/F/C makeup (hover a cell for the count).' : h[0] === 'Tier' ? 'How the unit\'s net rating grades against a typical unit.' : '');
    var sk = sc && SORT_KEY[h[0]], active = sk && sc.sortKey === sk;
    var cls = [h[1], sk ? 'sort' : '', active ? 'on' : ''].filter(Boolean).join(' ');
    var onclick = sk ? ' onclick="window.TDC_LINEUPS&&TDC_LINEUPS._sort(\'' + sc.id + '\',\'' + h[0] + '\')"' : '';
    return '<th' + (cls ? ' class="' + cls + '"' : '') + (h[3] ? ' data-heat="' + h[3] + '"' : '') + (t ? ' title="' + t.replace(/"/g, '&quot;') + '"' : '') + onclick
      + (h[2] ? ' style="' + LU_DIVB + '"' : '') + '>' + h[0] + (sk ? '<span class="ar">' + (active ? (sc.sortDir === 'desc' ? '▼' : '▲') : '') + '</span>' : '') + '</th>';
  }
  function luRow(l, idx, i, sos) {
    var tr = tier(l.net);
    return '<tr>'
      + '<td class="l nm">' + lineupNames(l.players, idx) + '</td>'
      + '<td class="l dim">' + archTag(archetypeOf(l.players, idx)) + '</td>'
      + td(l.poss, 0, 'dim')
      + '<td class="strong">' + sgn(l.net) + '</td>'
      + '<td class="l dim">' + (tr ? tr.t : '') + '</td>'
      + adjCell(l.net, sos)
      + sosCell(sos)
      + td(l.off_rtg, 0, '', LU_DIVB)
      + td(l.def_rtg, 0)
      + td(l.efg, 1, '', LU_DIVB)
      + td(l.tov_pct, 1)
      + td(l.orb_pct, 1)
      + td(l.ftr, 1)
      + '</tr>';
  }
  // min-possessions filter chips
  function filterBar(s) {
    var opts = s.kind === 'five' ? [0, 40, 100, 200] : [0, 150, 400, 700];
    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;flex-wrap:wrap;">'
      + '<span style="font-size:9px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);">Min poss</span>'
      + opts.map(function (v) { var on = (s.minPoss || 0) === v;
        return '<button onclick="window.TDC_LINEUPS&&TDC_LINEUPS._filter(\'' + s.id + '\',' + v + ')" style="font-size:10px;font-weight:700;padding:2px 10px;border-radius:20px;border:1px solid ' + (on ? 'var(--text2)' : 'var(--border)') + ';background:' + (on ? 'var(--bg3)' : 'transparent') + ';color:' + (on ? 'var(--text)' : 'var(--text3)') + ';cursor:pointer;font-family:inherit;">' + (v === 0 ? 'All' : v + '+') + '</button>'; }).join('')
      + '</div>';
  }
  // render one table (filter + sort applied) from registry state
  function renderBlock(s) {
    var key = s.sortKey, dir = s.sortDir;
    var rows = s.rows.filter(function (r) { return (r.poss || 0) >= (s.minPoss || 0); })
      .slice().sort(function (a, b) { var av = a[key], bv = b[key]; av = (av == null ? -1e9 : av); bv = (bv == null ? -1e9 : bv); return dir === 'desc' ? bv - av : av - bv; })
      .slice(0, s.max);
    var sc = { id: s.id, sortKey: s.sortKey, sortDir: s.sortDir };
    var hs = s.kind === 'five' ? FIVE_HS : COMBO_HS;
    var head = '<thead><tr>' + hs.map(function (h) { return thCell(h, sc); }).join('') + '</tr></thead>';
    var body = rows.length ? rows.map(function (r, i) { return s.kind === 'five' ? luRow(r, s.idx, i, s.sos) : comboRow(r, s.idx, i, s.sos); }).join('')
      : '<tr><td colspan="' + hs.length + '" class="c dim">No units at this possession cutoff.</td></tr>';
    return filterBar(s)
      + '<div class="sheet-wrap"><table class="sheet dense freeze">' + head + '<tbody>' + body + '</tbody></table></div>';
  }
  // red-to-green column shading (tdc-sheets.js) — the section HTML is inserted by the caller
  // after the promise resolves, so wait for the block to reach the page before shading it
  function shade(id, tries) {
    var el = document.getElementById(id), t = el && el.querySelector('table.sheet');
    if (t) { if (window.tdcSheetHeat) window.tdcSheetHeat(t); return; }
    if ((tries || 0) < 40) setTimeout(function () { shade(id, (tries || 0) + 1); }, 100);
  }
  function rerender(id) { var s = _reg[id], el = document.getElementById(id); if (s && el) { el.innerHTML = renderBlock(s); shade(id, 40); } }
  function _sort(id, label) { var s = _reg[id]; if (!s) return; var key = SORT_KEY[label]; if (!key) return;
    if (s.sortKey === key) s.sortDir = s.sortDir === 'desc' ? 'asc' : 'desc';
    else { s.sortKey = key; s.sortDir = LOWER_BETTER[key] ? 'asc' : 'desc'; } rerender(id); }
  function _filter(id, v) { var s = _reg[id]; if (!s) return; s.minPoss = +v || 0; rerender(id); }
  // register a table's state + return its wrapper HTML (sortable + filterable in place)
  function block(kind, rows, idx, sos, max, minPoss, sortKey, sortDir) {
    var id = 'tdclu' + (++_rn);
    _reg[id] = { id: id, kind: kind, rows: rows || [], idx: idx, sos: sos, max: max, minPoss: minPoss || 0, sortKey: sortKey, sortDir: sortDir };
    setTimeout(function () { shade(id, 0); }, 0);
    return '<div id="' + id + '">' + renderBlock(_reg[id]) + '</div>';
  }
  // trios / pairs — SAME spreadsheet grid + full stat set as the five-man table (net,
  // ORtg, DRtg + four factors, blended from the units they share), plus a Units column.
  function comboRow(t, idx, i, sos) {
    var tr = tier(t.net);
    return '<tr>'
      + '<td class="l nm">' + lineupNames(t.players, idx) + '</td>'
      + td(t.poss, 0, 'dim')
      + '<td class="strong">' + sgn(t.net) + '</td>'
      + '<td class="l dim">' + (tr ? tr.t : '') + '</td>'
      + adjCell(t.net, sos)
      + sosCell(sos)
      + td(t.off_rtg, 0, '', LU_DIVB)
      + td(t.def_rtg, 0)
      + td(t.efg, 1, '', LU_DIVB)
      + td(t.tov_pct, 1)
      + td(t.orb_pct, 1)
      + td(t.ftr, 1)
      + td(t.units, 0, 'dim', LU_DIVB)
      + '</tr>';
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
    return Promise.all([load(), loadCombos(), loadPos(full, season), loadDna()]).then(function (res) {
      var lus = lookup(res[0], '' + season, full), cc = combosLookup(res[1], '' + season, full);
      var posBase = res[2] || {};
      var sos = sosDeltaFor(res[3], season, full);   // team schedule delta (adjNet − net)
      var fullFi = !!(cc && ((cc.trios && cc.trios.length) || (cc.pairs && cc.pairs.length)));
      if (!lus.length && !fullFi) return '';
      // pass the UNFILTERED sets to the sortable/filterable table blocks (the min-poss
      // chips do the filtering in-place, defaulting to minP/trioMin so the first view is
      // unchanged). use combos.json only when it already carries the four factors.
      var comboHasFactors = !!(cc && cc.trios && cc.trios.length && cc.trios[0] && cc.trios[0].efg != null);
      var triRows = comboHasFactors ? cc.trios : combo(lus, 3);
      var pairRows = (comboHasFactors && cc.pairs) ? cc.pairs : combo(lus, 2);
      var yl = (season - 1) + '-' + ('' + season).slice(2);
      var src = fullFi ? 'full play-by-play' : 'reconstructed from the tracked lineups';
      // positions for EVERYONE, consistent G/F/C down the whole column: player_history
      // (posBase) primary, current roster (opt.pos) only fills gaps — both normalized so
      // it never mixes granular PG/SG with G/F.
      var pIdx = {}, _ri = posIndex(opt.pos);
      for (var _k in posBase) pIdx[_k] = toGFC(posBase[_k]);
      for (var _k2 in _ri) if (!pIdx[_k2]) pIdx[_k2] = toGFC(_ri[_k2]);
      var lineupCol = lus.length ? block('five', lus, pIdx, sos, maxL, minP, 'poss', 'desc') : emptyCol();
      var trioCol = (triRows && triRows.length) ? block('combo', triRows, pIdx, sos, maxT, trioMin, 'net', 'desc') : emptyCol();
      var pairCol = (pairRows && pairRows.length) ? block('combo', pairRows, pIdx, sos, maxP, trioMin, 'net', 'desc') : emptyCol();
      return ''
        + '<div style="font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text2);margin:26px 0 4px;">Lineups, Trios &amp; Pairs <span style="font-weight:600;letter-spacing:0;text-transform:none;color:var(--text3);font-size:11px;">· ' + yl + ' · ' + src + '</span></div>'
        + '<div style="font-size:12px;color:var(--text3);line-height:1.5;margin-bottom:12px;">The five-man units this team played, plus the trios and pairs inside them. <b style="color:var(--text2);">Net</b> = per-100 margin with that group on; each stat column is shaded red (worst) to green (best) within its table. Hover a header for its definition; click to sort.</div>'
        + '<div style="' + LU_CARD + '">' + colHdr('Five-man lineups · most-used') + lineupCol + '</div>'
        + '<div style="' + LU_CARD + 'margin-top:20px;">' + colHdr('Top trios') + trioCol + '</div>'
        + '<div style="' + LU_CARD + 'margin-top:20px;">' + colHdr('Top pairs') + pairCol + '</div>';
    });
  }
  return { load: load, forTeam: forTeam, section: section, trios: trios, combo: combo, short: short, tier: tier, _sort: _sort, _filter: _filter };
})();
