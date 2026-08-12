/* tdc-archetypes.js — shared player STYLE-archetype lookup (from build_archetypes.py).
   Loads archetypes.json once and exposes:
     TDC_ARCH.ready              -> promise (resolves when loaded)
     TDC_ARCH.of(espn_id, name)  -> {name, desc, color} | null   (espn_id first, then name)
     TDC_ARCH.info(name)         -> {name, desc, color, count} | null
     TDC_ARCH.list()             -> [archetype dicts]
     TDC_ARCH.breakout(name)     -> {rate, n, star, avg_gain, color, examples, meta} | null
                                    (how often young non-stars of this style grow into stars)
   Style = how a player plays (size/usage/playmaking/spacing/rebounding/defense), never quality. */
window.TDC_ARCH = (function () {
  var A = { _players:{}, _byName:{}, _dict:{}, _list:[], _break:null, _breakMeta:null, loaded:false };
  function norm(s){ return (''+(s||'')).toLowerCase().replace(/[^a-z0-9]/g,''); }
  A.ready = Promise.all([
    fetch('archetypes.json', { cache:'no-cache' }).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; }),
    fetch('breakout.json',   { cache:'no-cache' }).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; })
  ]).then(function(res){
      var j=res[0], b=res[1];
      if (j){ A._players=j.players||{}; A._byName=j.by_name||{}; A._list=j.archetypes||[];
        A._list.forEach(function(a){ A._dict[a.name]=a; }); A.loaded=true; }
      if (b){ A._break=b.archetypes||{}; A._breakMeta=b.meta||{}; }
      return A;
    }).catch(function(){ return A; });
  A.of = function(espn, name){
    var r = null;
    if (espn!=null && A._players) r = A._players[String(espn)];
    if (!r && name && A._byName) r = A._byName[norm(name)];
    if (!r) return null;
    var d = A._dict[r.a] || {};
    return { name:r.a, desc:d.desc||'', color:d.color||'var(--accent)' };
  };
  A.info = function(name){ return A._dict[name] || null; };
  A.list = function(){ return A._list.slice(); };
  A.breakout = function(name){ if(!A._break||!A._break[name]) return null; var b=A._break[name]; b.meta=A._breakMeta||{}; return b; };
  return A;
})();
