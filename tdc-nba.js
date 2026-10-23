/* tdc-nba.js — the College ⇄ NBA bridge on player pages.
   TDCNba.index()            → Promise<{players, by_college, teams}> (nba/index.json, loaded once)
   TDCNba.forCollege(espn)   → Promise<nba_id|null>: the NBA page for a college espn_id
   TDCNba.mount(el, opts)    renders the League switch. opts = {active:'college'|'nba',
                             collegeId, nbaId, name}. Renders only when BOTH pages exist:
                             a college player with an NBA career, or an NBA player whose
                             college page we have (final college season 2010+).
   TDCNba.logo(abbr)         ESPN NBA team logo URL (a team mark, not a player photo).
   Built by scripts/build_nba_pages.py. */
(function(g){
  var IDX = null;
  function index(){
    if(!IDX) IDX = fetch('nba/index.json').then(function(r){ return r.ok ? r.json() : {players:[], by_college:{}, teams:{}}; })
                    .catch(function(){ return {players:[], by_college:{}, teams:{}}; });
    return IDX;
  }
  function forCollege(espn){
    if(!espn) return Promise.resolve(null);
    return index().then(function(i){ return (i.by_college || {})[String(espn)] || null; });
  }
  function css(){
    if(document.getElementById('tdcNbaCss')) return;
    var s = document.createElement('style'); s.id = 'tdcNbaCss';
    s.textContent =
      '.lg-switch{display:inline-flex;gap:2px;background:var(--bg2);border:1px solid var(--border2);border-radius:9px;padding:2px;margin:0 0 10px;vertical-align:middle}' +
      '.lg-switch a{font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--text3);text-decoration:none;padding:5px 12px;border-radius:7px;white-space:nowrap}' +
      '.lg-switch a.on{background:var(--accent);color:#221c08}' +
      '.lg-switch a:not(.on):hover{color:var(--text);background:var(--bg3)}';
    document.head.appendChild(s);
  }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function mount(el, o){
    if(!el) return Promise.resolve();
    o = o || {};
    var go = o.nbaId ? Promise.resolve(o.nbaId) : forCollege(o.collegeId);
    return go.then(function(nba){
      if(!nba || !o.collegeId) { el.innerHTML = ''; return; }    // a switch needs both sides
      css();
      var nm = o.name ? '&name=' + encodeURIComponent(o.name) : '';
      var col = o.collegeId ? 'player.html?espn=' + encodeURIComponent(o.collegeId) + nm : null;
      el.innerHTML = '<nav class="lg-switch" aria-label="League">' +
        (col ? '<a href="' + col + '"' + (o.active === 'college' ? ' class="on" aria-current="page"' : '') + '>College</a>' : '') +
        '<a href="nba.html?id=' + encodeURIComponent(nba) + '"' + (o.active === 'nba' ? ' class="on" aria-current="page"' : '') +
        ' title="' + esc(o.name || 'Player') + ' in the NBA">NBA</a></nav>';
    });
  }
  function logo(abbr){ return abbr ? 'https://a.espncdn.com/i/teamlogos/nba/500/' + String(abbr).toLowerCase() + '.png' : ''; }
  g.TDCNba = {index: index, forCollege: forCollege, mount: mount, logo: logo};
})(window);
