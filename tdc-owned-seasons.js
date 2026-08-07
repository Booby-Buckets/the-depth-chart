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

  // Build one bbref-shaped row from a player_advanced row (pa) + optional player_history row (ph).
  function shape(pa, ph) {
    ph = ph || {};
    // GUARD: the 2025-26 player_history load swapped 3P/FT made<->attempted (made>att is
    // impossible). Normalize so made<=att regardless of DB state — idempotent, leaves correct
    // rows untouched. Root fix is scripts/fix_shooting_swap_2026.sql.
    (function(){ function fx(m,a){ var mv=parseFloat(ph[m]),av=parseFloat(ph[a]);
      if(isFinite(mv)&&isFinite(av)&&mv>av){ ph[m]=av; ph[a]=mv; } } fx('tpm','tpa'); fx('ftm','fta'); })();
    var mpg = n(ph.mpg);
    var pergame = {
      games: n(pa.g), games_started: null,
      pts_per_g: n(ph.ppg), trb_per_g: n(ph.rpg), ast_per_g: n(ph.apg), mp_per_g: mpg,
      stl_per_g: n(ph.stl), blk_per_g: n(ph.blk), tov_per_g: n(ph.tovs), pf_per_g: null,
      fg_per_g: n(ph.fgm), fga_per_g: n(ph.fga), fg_pct: frac(ph.fg_pct),
      fg3_per_g: n(ph.tpm), fg3a_per_g: n(ph.tpa), fg3_pct: frac(ph.tp_pct),
      ft_per_g: n(ph.ftm), fta_per_g: n(ph.fta), ft_pct: frac(ph.ft_pct),
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
    var team = ph.team || pa.team;
    return {
      espn_id: pa.espn_id, season_year: pa.season_year, player: pa.name || ph.name,
      school: team, school_slug: slug(team), pos: ph.position || null, height: ph.height || null,
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
    return (paRows || []).map(function (a) { return shape(a, phMap[a.espn_id + '|' + a.season_year]); });
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
  function pageAll(table, sel, where) {
    var out = [];
    function go(frm) {
      var h = {}; for (var k in HD) h[k] = HD[k]; h['Range-Unit'] = 'items'; h['Range'] = frm + '-' + (frm + 999);
      return fetch(SB + table + '?select=' + sel + '&' + where, { headers: h })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (b) { out = out.concat(b || []); return (b && b.length === 1000) ? go(frm + 1000) : out; })
        .catch(function () { return out; });
    }
    return go(0);
  }

  // A whole season (or 'all') as bbref-shaped rows — the percentile-pool path.
  function bySeason(season) {
    var w = (season === 'all') ? 'ppg=not.is.null' : 'season_year=eq.' + season;
    return Promise.all([pageAll('player_advanced', PA, w), pageAll('player_history', PH, w)])
      .then(function (r) { return merge(r[0], r[1]); });
  }

  g.TDCOwnedSeasons = { byEspn: byEspn, byName: byName, bySeason: bySeason, _shape: shape, _merge: merge, _slug: slug };
})(window);
