/* tdc-pool.js — one shared fetch of the current-season players pool.
   -------------------------------------------------------------------------
   The percentile color-scaling, player comparisons and distribution charts on
   the player & team pages each used to fetch the FULL players table (~1000
   rows) separately — player.html did it 3× per visit, team.html 2× serially
   before first paint, and nothing was cached, so every navigation re-pulled it.

   This memoizes ONE fetch of a superset of columns, caches it in sessionStorage
   (per tab, short TTL), and hands the same array to every consumer. Fetched
   once → reused across call sites AND across player→player / team navigation.

   Usage:  const pool = await TDCPool.get();          // full array
           const withStats = pool.filter(p => p.ppg != null);
   Only ~1000 rows exist (verified), so the 5000 limit never truncates. */
(function(){
  'use strict';
  var SB  = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1';
  var KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
  var SS_KEY = 'tdc_pool_v1', TTL = 20 * 60 * 1000;   // 20 min per tab session
  // Superset of every column any consumer needs (percentiles + comps + swap modal).
  var COLS = 'id,name,team,position,height,class_year,yr,depth_order,tdc_grade,' +
             'ppg,rpg,apg,mpg,fgm,fga,fg_pct,tpm,tpa,tp_pct,ftm,fta,ft_pct,' +
             'oreb,dreb,stl,blk,tovs,gp';
  var _mem = null, _loading = null;

  function _fromSS(){
    try {
      var c = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null');
      if (c && c.t && (Date.now() - c.t) < TTL && Array.isArray(c.d)) return c.d;
    } catch (e) {}
    return null;
  }
  function get(){
    if (_mem) return Promise.resolve(_mem);
    if (_loading) return _loading;
    var ss = _fromSS();
    if (ss) { _mem = ss; return Promise.resolve(ss); }
    _loading = fetch(SB + '/players?select=' + COLS + '&name=neq.%E2%80%94&limit=5000',
                     { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })
      .then(function(r){ return r.ok ? r.json() : []; })
      .then(function(rows){
        rows = Array.isArray(rows) ? rows.filter(function(p){ return p.name && p.name !== '—'; }) : [];
        _mem = rows;
        try { sessionStorage.setItem(SS_KEY, JSON.stringify({ t: Date.now(), d: rows })); } catch (e) {}
        return rows;
      })
      .catch(function(){ _loading = null; return []; });
    return _loading;
  }

  window.TDCPool = { get: get, cols: COLS };
})();
