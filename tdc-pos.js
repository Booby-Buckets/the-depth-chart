// Canonical position grouping for The Depth Chart — shared across pages so the
// "Guards / Wings / Bigs" split never drifts between the explorers, distributions,
// and archetype pools.
//
// Handles both vocabularies in the data:
//   - bbref single letters: G / F / C   (forwards are ambiguous → split by height)
//   - roster codes:        PG SG CG SF PF C
// heightIn is optional (inches). Returns 'G' | 'W' | 'B'.
(function(g){
  function tdcPosGroup(pos, heightIn){
    var p = ((pos||'') + '').toUpperCase().split(/[\/,\s]/)[0];
    if(p==='PG' || p==='SG' || p==='CG' || p==='G') return 'G';
    if(p==='SF') return 'W';
    if(p==='PF' || p==='C') return 'B';
    if(p==='F') return (heightIn && heightIn>=80) ? 'B' : 'W';   // ambiguous forward → height
    if(heightIn){ if(heightIn>=80) return 'B'; if(heightIn<74) return 'G'; return 'W'; }
    return 'W';
  }
  g.tdcPosGroup = tdcPosGroup;
})(window);
