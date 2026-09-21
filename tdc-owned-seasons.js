/* tdc-owned-seasons.js — OWNED replacement for bbref_seasons reads.
 *
 * Returns player-season rows in the SAME shape bbref_seasons returned (pergame /
 * per40 / advanced JSON blobs + bio + tdc_grade), reconstructed from the two owned
 * tables so every existing consumer (bbrefToFlat, the pool/roster builders, etc.)
 * keeps working with only its FETCH swapped:
 *   - player_advanced  → advanced rates (ts/usg/ast%/reb%/stl%/blk%/tov%) + our TI
 *     value metric (ti40/ti100) replacing SR's bpm/ws/per, + pts40/reb40/ast40.
 *   - player_history   → bio (height/weight/pos/class) + tdc_grade + per-game box
 *     counting stats. 2012+ only; pre-2012 rows come back with stats but null bio.
 * No Sports-Reference data is read. See scripts/derived_stats.py for the stat defs.
 */
(function (g) {
  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/';
  var HD = { apikey: 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye',
             Authorization: 'Bearer sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye' };
  var PA = 'espn_id,season_year,name,team,g,min,ppg,rpg,apg,ts_pct,efg_pct,fg_pct,tp_pct,ft_pct,pts40,reb40,ast40,usg_pct,ast_pct,tov_pct,orb_pct,drb_pct,trb_pct,stl_pct,blk_pct,ti40,ti100,owa,dwa';
  var PH = 'espn_id,season_year,name,team,height,weight,position,yr,tdc_grade,gp,mpg,ppg,rpg,apg,stl,blk,tovs,oreb,dreb,fgm,fga,fg_pct,tpm,tpa,tp_pct,ftm,fta,ft_pct';

  function j(url) { return fetch(SB + url, { headers: HD }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }); }
  function n(v) { return (v === null || v === undefined || v === '') ? null : +v; }
  function frac(v) { return (v === null || v === undefined || v === '') ? null : (+v) / 100; }  // player_history stores %s as 55.4; bbref consumers expect .554
  function slug(t) { return (t || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function per40(pgVal, mpg) { pgVal = n(pgVal); mpg = n(mpg); return (pgVal != null && mpg) ? +(pgVal * 40 / mpg).toFixed(1) : null; }

  // ── ONE team name per row: the sheet's short name ("Oregon", "UNLV", "NC-State") ────────
  // player_history carries Sports-Reference spellings ("Nevada-Las Vegas", "Oregon") and
  // player_advanced carries ESPN full names ("UNLV Rebels", "Oregon Ducks"); the site's
  // rosters, team links and hero chips use the sheet's short names. Every row's `school` is
  // resolved to that short name so the season switcher / stat tables / links agree.
  // Map source: predictive_ratings (team = short, full = ESPN) via TDC_RATINGS, else the
  // teams table (short names only); then the SR spelling cleaned up (SR2SHORT), then the ESPN full minus its mascot.
  // Sports-Reference spellings whose short form isn't just the SR name minus a "(XX)" tag
  var SR2SHORT = { 'nevada-las vegas': 'UNLV', 'connecticut': 'UConn', 'brigham young': 'BYU', 'louisiana state': 'LSU',
    'southern california': 'USC', 'texas christian': 'TCU', 'southern methodist': 'SMU', 'virginia commonwealth': 'VCU',
    'north carolina state': 'NC State', 'mississippi': 'Ole Miss', 'central florida': 'UCF', 'alabama-birmingham': 'UAB',
    'massachusetts': 'UMass', 'loyola (il)': 'Loyola Chicago', 'loyola (md)': 'Loyola Maryland', 'texas-san antonio': 'UTSA',
    'maryland-baltimore county': 'UMBC', 'texas-el paso': 'UTEP', 'texas-arlington': 'UT Arlington', 'illinois-chicago': 'UIC',
    'penn': 'Penn', 'southern mississippi': 'Southern Miss', 'louisiana-monroe': 'UL Monroe', 'arkansas-little rock': 'Little Rock',
    'purdue-fort wayne': 'Purdue Fort Wayne', 'iupui': 'IU Indianapolis', 'houston baptist': 'Houston Christian',
    'cal state long beach': 'Long Beach State', 'albany (ny)': 'UAlbany', 'texas-rio grande valley': 'UT Rio Grande Valley',
    'nebraska-omaha': 'Omaha', 'detroit': 'Detroit Mercy', 'st. francis (pa)': 'Saint Francis', 'st. francis (ny)': 'St. Francis Brooklyn',
    'southern illinois-edwardsville': 'SIU Edwardsville', 'tennessee-martin': 'UT Martin', 'appalachian state': 'App State',
    'hawaii': "Hawai'i", 'san jose state': 'San José State', 'pitt': 'Pittsburgh', 'college of charleston': 'Charleston',
    'charleston (sc)': 'Charleston', 'east carolina': 'ECU', 'florida atlantic': 'FAU', 'nc state': 'NC State' };
  // ESPN mascots: strip the last word, then a leading mascot modifier ("Golden Gophers", "Red Storm", "Fighting Illini")
  var MOD = /^(blue|red|golden|fighting|rainbow|ragin'|mean|runnin'|delta|scarlet|crimson|black|green|purple|yellow|demon|horned|big|great|thundering|screaming|sun|tar|river|mountain|wolf|white|orange|silver|flying|lady|mighty|nittany|ramblin'|fightin'|jumbo)$/;
  var MARK = /\b(state|christian|baptist|southern|atlantic|international|wesleyan|a&m|a&t|tech|valley|central|northern|western|eastern|of|st|college)\b/;
  function stripMascot(full) {
    var w = String(full || '').trim().split(/\s+/);
    if (w.length < 2) return full;
    w.pop();
    if (w.length > 1 && MOD.test(w[w.length - 1].toLowerCase())) w.pop();
    return w.join(' ');
  }
  function srShort(sr) {
    if (!sr) return null;
    var lo = String(sr).toLowerCase().trim();
    if (SR2SHORT[lo]) return SR2SHORT[lo];
    return String(sr).replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();   // "Saint Mary's (CA)" -> "Saint Mary's"
  }
  var _tmP = null;
  function teamMap() {
    if (_tmP) return _tmP;
    var viaRatings = (g.TDC_RATINGS && g.TDC_RATINGS.get) ? g.TDC_RATINGS.get().then(function (d) { return (d && d.teams) || []; }).catch(function () { return []; }) : Promise.resolve([]);
    _tmP = viaRatings.then(function (teams) {
      var full2s = {}, shorts = [];
      // only teams with a real sheet short (team != full); the un-rostered carry the full name in both
      teams.forEach(function (t) { if (!t || !t.team || !t.full || t.team === t.full) return; shorts.push(t.team); full2s[String(t.team).toLowerCase()] = t.team; full2s[String(t.full).toLowerCase()] = t.team; });
      if (shorts.length) return { full2s: full2s, shorts: shorts };
      return j('teams?select=name').then(function (rows) { (rows || []).forEach(function (r) { if (r.name) { shorts.push(r.name); full2s[r.name.toLowerCase()] = r.name; } }); return { full2s: full2s, shorts: shorts }; });
    });
    return _tmP;
  }
  // (espnFull from player_advanced, srName from player_history) -> the sheet short name
  function resolveTeam(espnFull, srName, M) {
    M = M || { full2s: {}, shorts: [] };
    var cands = [espnFull, srName].filter(Boolean);
    for (var c = 0; c < cands.length; c++) {                       // 1. a rostered team's sheet short
      var lo = String(cands[c]).toLowerCase().trim();
      if (M.full2s[lo]) return M.full2s[lo];
      var best = null;                                              //    "Oregon Ducks" -> "Oregon", never "Florida Atlantic Owls" -> "Florida"
      M.shorts.forEach(function (s) { var sl = s.toLowerCase(); if (lo.indexOf(sl + ' ') === 0) { var rest = lo.slice(sl.length + 1); if (!MARK.test(rest) && (!best || s.length > best.length)) best = s; } });
      if (best) return best;
    }
    if (srName) return srShort(srName);                            // 2. SR spelling cleaned up ("Nevada-Las Vegas" -> "UNLV")
    if (espnFull) return stripMascot(espnFull);                    // 3. ESPN full minus the mascot
    return null;
  }
  function displayTeam(espnFull, srName) { return teamMap().then(function (M) { return resolveTeam(espnFull, srName, M); }); }

  // Build one bbref-shaped row from a player_advanced row (pa) + optional player_history row (ph).
  function shape(pa, ph, M) {
    ph = ph || {};
    // GUARD: the 2025-26 player_history load swapped 3P/FT made<->attempted (made>att is
    // impossible). Normalize so made<=att regardless of DB state — idempotent, leaves correct
    // rows untouched. Root fix is scripts/fix_shooting_swap_2026.sql.
    (function(){ function fx(m,a){ var mv=parseFloat(ph[m]),av=parseFloat(ph[a]);
      if(isFinite(mv)&&isFinite(av)&&mv>av){ ph[m]=av; ph[a]=mv; } } fx('tpm','tpa'); fx('ftm','fta'); })();
    // Per-game box comes from player_history, but some seasons (pre-2012 freshmen,
    // late-added years like Dillon Jones' 2020-21) exist in player_advanced with NO
    // player_history row — so ph is empty and ppg/rpg/apg/mpg + shooting would show
    // "—". player_advanced carries its OWN ppg/rpg/apg/min/g + fraction shooting %s,
    // so fall back to those; the counting splits (fgm/fta/stl…) it lacks stay null.
    function pick(a, b) { return a != null ? a : b; }
    var mpg = n(ph.mpg);
    if (mpg == null && n(pa.min) != null && n(pa.g)) mpg = +(n(pa.min) / n(pa.g)).toFixed(1);
    var pergame = {
      games: n(pa.g), games_started: null,
      pts_per_g: pick(n(ph.ppg), n(pa.ppg)), trb_per_g: pick(n(ph.rpg), n(pa.rpg)), ast_per_g: pick(n(ph.apg), n(pa.apg)), mp_per_g: mpg,
      stl_per_g: n(ph.stl), blk_per_g: n(ph.blk), tov_per_g: n(ph.tovs), pf_per_g: null,
      fg_per_g: n(ph.fgm), fga_per_g: n(ph.fga), fg_pct: pick(frac(ph.fg_pct), n(pa.fg_pct)),
      fg3_per_g: n(ph.tpm), fg3a_per_g: n(ph.tpa), fg3_pct: pick(frac(ph.tp_pct), n(pa.tp_pct)),
      ft_per_g: n(ph.ftm), fta_per_g: n(ph.fta), ft_pct: pick(frac(ph.ft_pct), n(pa.ft_pct)),
      orb_per_g: n(ph.oreb), drb_per_g: n(ph.dreb), efg_pct: n(pa.efg_pct)  // pa.efg is already a fraction
    };
    // per40 uses SR's odd '_per_min' suffix (that's the key name consumers read)
    var per40o = {
      mp: n(pa.min), games: n(pa.g),
      pts_per_min: n(pa.pts40), trb_per_min: n(pa.reb40), ast_per_min: n(pa.ast40),
      stl_per_min: per40(ph.stl, mpg), blk_per_min: per40(ph.blk, mpg), tov_per_min: per40(ph.tovs, mpg),
      fg_per_min: per40(ph.fgm, mpg), fga_per_min: per40(ph.fga, mpg),
      fg3_per_min: per40(ph.tpm, mpg), fg3a_per_min: per40(ph.tpa, mpg),
      ft_per_min: per40(ph.ftm, mpg), fta_per_min: per40(ph.fta, mpg),
      orb_per_min: per40(ph.oreb, mpg), drb_per_min: per40(ph.dreb, mpg), pf_per_min: null,
      fg_pct: frac(ph.fg_pct), fg3_pct: frac(ph.tp_pct), ft_pct: frac(ph.ft_pct)
    };
    // advanced: real owned rates + our TI value metric. SR's bpm/ws/per intentionally
    // null — consumers read ti40/ti100 (or _winsAdded folds to TI) instead.
    var advanced = {
      ts_pct: n(pa.ts_pct), usg_pct: n(pa.usg_pct), ast_pct: n(pa.ast_pct),
      orb_pct: n(pa.orb_pct), drb_pct: n(pa.drb_pct), trb_pct: n(pa.trb_pct),
      stl_pct: n(pa.stl_pct), blk_pct: n(pa.blk_pct), tov_pct: n(pa.tov_pct),
      mp: n(pa.min), ti40: n(pa.ti40), ti100: n(pa.ti100), owa: n(pa.owa), dwa: n(pa.dwa),
      bpm: null, obpm: null, dbpm: null, ws: null, ows: null, dws: null, per: null
    };
    // ESPN full (player_advanced) resolves cleanly; SR spelling (player_history) is the fallback
    var raw = pa.team || ph.team;
    var team = resolveTeam(pa.team, ph.team, M) || raw;
    return {
      espn_id: pa.espn_id, season_year: pa.season_year, player: pa.name || ph.name,
      school: team, school_raw: raw, school_slug: slug(team), pos: ph.position || null, height: ph.height || null,
      weight: ph.weight || null, "class": ph.yr || null, hometown: null,
      tdc_grade: n(ph.tdc_grade), grade_pillars: null,
      pergame: pergame, per40: per40o, advanced: advanced
    };
  }

  // Merge a player_advanced list + player_history list into bbref-shaped rows,
  // joined on (espn_id, season_year). PA drives the row set (it has full 2010+ coverage).
  function merge(paRows, phRows) {
    var phMap = {};
    (phRows || []).forEach(function (h) { phMap[h.espn_id + '|' + h.season_year] = h; });
    return teamMap().then(function (M) { return (paRows || []).map(function (a) { return shape(a, phMap[a.espn_id + '|' + a.season_year], M); }); });
  }

  // ── public fetchers (mirror the bbref query modes) ──────────────────────────────
  // By espn_id (one or many), all seasons — the player-page career path.
  function byEspn(ids, order) {
    ids = [].concat(ids).filter(function (x) { return x != null; });
    if (!ids.length) return Promise.resolve([]);
    var inl = 'espn_id=in.(' + ids.join(',') + ')';
    var ord = '&order=season_year.' + (order === 'desc' ? 'desc' : 'asc');
    return Promise.all([
      j('player_advanced?select=' + PA + '&' + inl + ord),
      j('player_history?select=' + PH + '&' + inl + ord)
    ]).then(function (r) { return merge(r[0], r[1]); });
  }

  // By exact player name, all seasons — bbref-only / espn-less career fallback.
  function byName(name, order) {
    if (!name) return Promise.resolve([]);
    var eq = 'name=eq.' + encodeURIComponent(name);
    var ord = '&order=season_year.' + (order === 'desc' ? 'desc' : 'asc');
    return Promise.all([
      j('player_advanced?select=' + PA + '&' + eq + ord),
      j('player_history?select=' + PH + '&' + eq + ord)
    ]).then(function (r) { return merge(r[0], r[1]); });
  }

  // Paginate a filtered table 1000 rows at a time (Range headers).
  function pageAll(table, sel, where, order) {
    // A STABLE ORDER BY is mandatory: without it Range-paginated pulls skip/duplicate rows
    // at every 1000-row boundary, which silently dropped per-game rows for players like
    // Cameron Boozer / Bruce Thornton (they showed "—" in the leaderboard). See the
    // supabase-pagination-order note.
    var out = [];
    function go(frm) {
      var h = {}; for (var k in HD) h[k] = HD[k]; h['Range-Unit'] = 'items'; h['Range'] = frm + '-' + (frm + 999);
      return fetch(SB + table + '?select=' + sel + '&' + where + (order ? ('&order=' + order) : ''), { headers: h })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (b) { out = out.concat(b || []); return (b && b.length === 1000) ? go(frm + 1000) : out; })
        .catch(function () { return out; });
    }
    return go(0);
  }

  // A whole season (or 'all') as bbref-shaped rows — the percentile-pool path.
  function bySeason(season) {
    var w = (season === 'all') ? 'ppg=not.is.null' : 'season_year=eq.' + season;
    // order by a stable key per table (player_history has a unique id; player_advanced's
    // natural key is espn_id+season_year) so pagination can't drop rows at page boundaries.
    return Promise.all([
      pageAll('player_advanced', PA, w, 'espn_id.asc,season_year.asc'),
      pageAll('player_history', PH, w, 'id.asc')
    ]).then(function (r) { return merge(r[0], r[1]); });
  }

  g.TDCOwnedSeasons = { byEspn: byEspn, byName: byName, bySeason: bySeason, displayTeam: displayTeam, teamMap: teamMap, _shape: shape, _merge: merge, _slug: slug };
})(window);
