// tdc-bio.js — player weight for roster tables (the players table has height + class, no weight).
// Data: scripts/data/player_wt_2027.json (scripts/build_player_wt.py): official school roster weights by
// team + normalized name, then "_e" {espn_id: lb} from player_history as the fallback.
//   tdcWt(p, team)        → pounds or null (sync; null until the file loads)
//   tdcWtCell(p, team, c) → a <td class="tdc-wt …"> that fills itself in when the file arrives
// Only meaningful for the current (2026-27) roster; older seasons pass the row's own p.weight.
(function(g){
  let W=null;
  const nk=s=>(s||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g,'').replace(/[^a-z]/g,'');
  function tdcWt(p, team){
    if(!p) return null;
    const own=parseFloat(p.weight); if(own>=120&&own<=380) return Math.round(own);
    if(!W) return null;
    const t=W[team||p.team]; const w=t&&t[nk(p.name)]; if(w) return w;
    const e=p.espn_id!=null?W._e[String(p.espn_id)]:null; return e||null;
  }
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function tdcWtCell(p, team, cls){
    const w=tdcWt(p, team);
    return `<td class="${cls||'l dim'} tdc-wt" data-wn="${esc(p&&p.name)}" data-wteam="${esc(team||(p&&p.team)||'')}" data-we="${esc(p&&p.espn_id)}">${w||'—'}</td>`;
  }
  function fill(){ document.querySelectorAll('td.tdc-wt').forEach(td=>{
    if(td.textContent.trim()!=='—') return;
    const w=tdcWt({name:td.dataset.wn, espn_id:td.dataset.we||null}, td.dataset.wteam); if(w) td.textContent=w; }); }
  g.tdcWt=tdcWt; g.tdcWtCell=tdcWtCell;
  fetch('scripts/data/player_wt_2027.json?v=1').then(r=>r.ok?r.json():null).then(d=>{
    if(!d) return; d._e=d._e||{}; W=d;
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fill); else fill();
    // tables rendered later (tab switches) get their cells filled at render time via tdcWt
  }).catch(()=>{});
})(window);
