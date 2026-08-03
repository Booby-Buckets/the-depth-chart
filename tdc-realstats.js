/* tdc-realstats.js — link roster rows to their REAL career stats.
   ---------------------------------------------------------------------------
   The roster sheet only reliably carries a player's NAME; its stat columns are
   partial/stale. This resolves each row to its canonical player_history by
   espn_id (the reliable id match) and overwrites the box-stat fields with the
   player's LATEST actual season line, so every page shows real STL/BLK/TO/FG%/
   3P%/FT%/MPG/GP instead of whatever was on the sheet.

   The OVR/grade is unaffected — it already comes from espn_id (stat overall).
   Freshmen / players with no player_history keep whatever they had (usually
   blank → shown as "—").

   Usage:  await TDCRealStats.enrich(rows);   // mutates rows in place
   Options: {season: 2026}  to pin a specific season instead of "latest actual".
*/
(function(){
  'use strict';
  var SB  = 'https://izlqhnxowdhtdofkwrho.supabase.co';
  var KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
  var H   = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  var COLS = 'espn_id,season_year,ppg,rpg,apg,mpg,stl,blk,tovs,fg_pct,tp_pct,ft_pct,oreb,dreb,fga,fgm,fta,ftm,tpa,tpm,gp';
  var FIELDS = ['ppg','rpg','apg','mpg','stl','blk','tovs','fg_pct','tp_pct','ft_pct',
                'oreb','dreb','fga','fgm','fta','ftm','tpa','tpm','gp'];
  var _cache = {};   // espn_id -> latest row (session-lived)

  function _num(v){ return (v == null || v === '') ? null : v; }

  async function _fetchByEspn(ids){
    var need = ids.filter(function(id){ return _cache[id] === undefined; });
    for(var i = 0; i < need.length; i += 100){
      var chunk = need.slice(i, i + 100);
      chunk.forEach(function(id){ _cache[id] = null; });   // mark attempted
      try{
        var url = SB + '/rest/v1/player_history?espn_id=in.(' + chunk.join(',') +
                  ')&select=' + COLS + '&order=season_year.asc&limit=5000';
        var rows = await fetch(url, { headers: H }).then(function(r){ return r.ok ? r.json() : []; });
        (rows || []).forEach(function(r){
          var id = r.espn_id; if(id == null) return;
          // keep the LATEST season row per player (rows arrive season asc)
          _cache[id] = r;
        });
      }catch(e){ /* leave as null */ }
    }
  }

  // Enrich rows in place. Returns the rows.
  async function enrich(rows, opts){
    if(!Array.isArray(rows) || !rows.length) return rows;
    opts = opts || {};
    var ids = [];
    rows.forEach(function(p){
      var id = p && p.espn_id;
      if(id != null && id !== '' && ids.indexOf(id) < 0) ids.push(id);
    });
    if(!ids.length) return rows;
    await _fetchByEspn(ids);
    rows.forEach(function(p){
      var id = p && p.espn_id; if(id == null) return;
      var real = _cache[id];
      if(!real) return;
      if(opts.season && +real.season_year !== +opts.season) return;   // season pin miss → leave sheet
      p._realStatsSeason = real.season_year;
      FIELDS.forEach(function(f){ var v = _num(real[f]); if(v != null) p[f] = v; });
    });
    return rows;
  }

  window.TDCRealStats = { enrich: enrich };
})();
