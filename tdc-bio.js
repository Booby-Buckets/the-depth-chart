// tdc-bio.js — height · weight · class beside player names, site-wide (owner rule, Nov 2026).
// Loaded on every page by tdc-nav.js (team.html also loads it directly). Two jobs:
//  1. tdcWt(p, team) / tdcWtCell(p, team, cls): 2026-27 weight for roster tables that have their own Ht column
//     (scripts/data/player_wt_2027.json, build_player_wt.py: school-roster weights + player_history fallback).
//  2. Decorator: every <a href="player.html?…"> naming a player gets a small "6-5 · 215 · Jr." line under it
//     (scripts/data/player_bio.json, build_player_bio.py: latest height/weight/class per espn id). ?name= links
//     are looked up in player_history in one batched request per page. Skipped: the nav / scores strip / search,
//     charts, buttons, tables that already have a Ht column, rows that already show a bio, and anything inside
//     [data-nobio] / .no-bio. New links (tab switches, live updates) are picked up by a MutationObserver.
(function(g){
  if(g.__tdcBio) return; g.__tdcBio=1;
  const nk=s=>(s||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g,'').replace(/[^a-z]/g,'');
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  // ── 1. weights for the team-page roster tables ──
  let W=null;
  function tdcWt(p, team){
    if(!p) return null;
    const own=parseFloat(p.weight); if(own>=120&&own<=380) return Math.round(own);
    if(!W) return null;
    const t=W[team||p.team]; const w=t&&t[nk(p.name)]; if(w) return w;
    const e=p.espn_id!=null?W._e[String(p.espn_id)]:null; return e||null;
  }
  function tdcWtCell(p, team, cls){
    const w=tdcWt(p, team);
    return `<td class="${cls||'l dim'} tdc-wt" data-wn="${esc(p&&p.name)}" data-wteam="${esc(team||(p&&p.team)||'')}" data-we="${esc(p&&p.espn_id)}">${w||'—'}</td>`;
  }
  function fillWt(){ document.querySelectorAll('td.tdc-wt').forEach(td=>{
    if(td.textContent.trim()!=='—') return;
    const w=tdcWt({name:td.dataset.wn, espn_id:td.dataset.we||null}, td.dataset.wteam); if(w) td.textContent=w; }); }
  g.tdcWt=tdcWt; g.tdcWtCell=tdcWtCell;
  if(document.querySelector('script[src*="tdc-teamhq"]')||/\/team(\.html)?$/.test(location.pathname))
    fetch('scripts/data/player_wt_2027.json?v=1').then(r=>r.ok?r.json():null).then(d=>{
      if(!d) return; d._e=d._e||{}; W=d;
      if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fillWt); else fillWt();
    }).catch(()=>{});

  // ── 2. bio line under player links ──
  const SKIP='.tdn-wrap,.tdt,nav,svg,select,button,[data-nobio],.no-bio,.tdc-pbio,.pc-bio,[role="dialog"] input';
  let B=null, bP=null, byName={}, nameP={};
  function loadB(){ if(bP) return bP;
    bP=fetch('scripts/data/player_bio.json?v=1').then(r=>r.ok?r.json():null).then(d=>{
      B={}; if(!d) return; let id=0; for(let i=0;i<d.d.length;i++){ id+=d.d[i]; B[id]=d.k[d.v[i]]; } }).catch(()=>{ B={}; });
    return bP; }
  const fmt=s=>{ if(!s) return ''; const [h,w,c]=s.split('|'); return [h,w?w+' lb':'',c].filter(Boolean).join(' · '); };
  const hasHtCol=a=>{ const t=a.closest('table'); if(!t) return false;
    if(t.__ht==null){ t.__ht=[...t.querySelectorAll('thead th, tr:first-child th')].some(th=>/^(ht|height)$/i.test(th.textContent.trim())); }
    return t.__ht; };
  // the element that holds the player's name: the link itself, or a name child inside a card-style link
  function nameEl(a){
    const txt=(a.textContent||'').trim();
    if(!a.children.length || [...a.children].every(c=>/^(B|STRONG|SPAN|EM|I)$/.test(c.tagName)&&!c.children.length)) return looksName(txt)?a:null;
    const c=[...a.querySelectorAll('*')].find(x=>!x.children.length&&!/^(IMG|SVG)$/i.test(x.tagName)&&looksName((x.textContent||'').trim()));
    return c||null;
  }
  const looksName=t=>t.length>=4&&t.length<=40&&/[a-z]/i.test(t)&&/\s/.test(t)&&!/\d|›|→|»|vs\.?\s|profile|view|more|compare/i.test(t);
  function params(a){ try{ const u=new URL(a.getAttribute('href'),location.href); if(!/player(\.html)?$/.test(u.pathname)) return null;
    let e=u.searchParams.get('espn')||u.searchParams.get('id'); if(!/^\d+$/.test(e||'')) e=null;
    let n=u.searchParams.get('name'); if(!n&&e){ const el=nameEl(a); n=el?el.textContent.trim():null; }
    return {espn:e, name:n, team:u.searchParams.get('team')}; }catch(e){ return null; } }
  function already(el){ const box=el.parentElement; if(!box) return false;
    // a row/card that already prints a bio (recap, NIL lists, team rosters) keeps its own
    return !!box.querySelector(':scope > .bio, :scope > .tdc-pbio') || !!(box.parentElement&&box.parentElement.querySelector(':scope > .bio')); }
  function put(el, s){
    const t=fmt(s); if(!t) return;
    // a sub-line right after the name ("Vanderbilt · PG · Jr.") takes the bio on its end; class only if it isn't there
    const nx=el.nextElementSibling;
    if(nx&&/(^|[\s_-])(meta|sub|tm|team|info|det|line2)([\s_-]|$)/i.test(nx.className||'')&&!nx.querySelector('.tdc-pbio')&&(nx.textContent||'').length<60){
      const [h,w,c]=s.split('|'), has=c&&new RegExp('(^|\\W)'+c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(\\W|$)').test(nx.textContent);
      const u=[h,w?w+' lb':'',has?'':c].filter(Boolean).join(' · '); if(!u) return;
      const sp=document.createElement('span'); sp.className='tdc-pbio inl in-meta'; sp.textContent=' · '+u; nx.appendChild(sp); return;
    }
    const sp=document.createElement('span'); sp.className='tdc-pbio'; sp.textContent=t;
    const par=el.parentElement, cs=par&&getComputedStyle(par);
    if(cs&&/flex/.test(cs.display)&&!/column/.test(cs.flexDirection)) sp.classList.add('inl');
    el.insertAdjacentElement('afterend', sp);
  }
  let queued=false;
  function scan(){ queued=false;
    const links=[...document.querySelectorAll('a[href*="player.html?"],a[href^="player?"],a[href*="/player?"]')].filter(a=>!a.__bio);
    if(!links.length) return;
    const todo=[];
    links.forEach(a=>{ a.__bio=1;
      if(a.closest(SKIP)||hasHtCol(a)) return;
      const p=params(a); if(!p||(!p.espn&&!p.name)) return;
      const el=nameEl(a); if(!el||already(el)) return;
      todo.push([el,p]); });
    if(!todo.length) return;
    loadB().then(()=>{
      const need=[];
      todo.forEach(([el,p])=>{ const s=p.espn&&B[+p.espn]; if(s) put(el,s); else if(p.name) need.push([el,p]); });
      if(!need.length) return;
      const ask=[...new Set(need.map(([,p])=>p.name))].filter(n=>!(n in nameP));
      const go=ask.length?lookup(ask):Promise.resolve();
      go.then(()=>need.forEach(([el,p])=>{ const rows=byName[nk(p.name)]||[];
        const r=(p.team&&rows.find(x=>nk(x.team).indexOf(nk(p.team))===0))||rows[0];
        if(!r) return; const h=(rows.find(x=>x.height)||{}).height, w=(rows.find(x=>x.weight)||{}).weight;
        const s=(r.espn_id&&B[+r.espn_id])||[r.height||h||'',(r.weight||w)?Math.round(r.weight||w):'',r.yr||''].join('|'); put(el,s); }));
    });
  }
  function lookup(names){
    const SB='https://izlqhnxowdhtdofkwrho.supabase.co', K='sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
    const chunks=[]; for(let i=0;i<names.length;i+=40) chunks.push(names.slice(i,i+40));
    const H={headers:{apikey:K,Authorization:'Bearer '+K}}, get=u=>fetch(SB+u,H).then(r=>r.ok?r.json():[]).catch(()=>[]);
    // current roster first (freshmen have no history yet; class is this season's), then history
    const p=Promise.all(chunks.map(c=>{
      const q='name=in.('+encodeURIComponent(c.map(n=>'"'+n.replace(/"/g,'')+'"').join(','))+')';
      return Promise.all([get('/rest/v1/players?select=name,team,height,weight,yr:class_year,espn_id&'+q+'&limit=400'),
        get('/rest/v1/player_history?select=name,team,season_year,height,weight,yr,espn_id&'+q+'&order=season_year.desc,id.asc&limit=400')])
        .then(([a,b])=>a.concat(b)); }))
      .then(all=>{ all.flat().forEach(r=>{ (byName[nk(r.name)]=byName[nk(r.name)]||[]).push(r); }); });
    names.forEach(n=>{ nameP[n]=p; });
    return p;
  }
  function queue(){ if(queued) return; queued=true; (g.requestIdleCallback||setTimeout)(scan, {timeout:800}); }
  const css=document.createElement('style');
  css.textContent='.tdc-pbio{display:block;font-size:10.5px;line-height:1.25;font-weight:600;color:var(--text3,#8a8a8a);letter-spacing:.01em;white-space:nowrap;margin-top:1px;text-transform:none;font-style:normal;}'
    +'.tdc-pbio.inl{display:inline;margin:0 0 0 6px;}.tdc-pbio.in-meta{margin:0;font:inherit;color:inherit;letter-spacing:inherit;}';
  function start(){ document.head.appendChild(css); queue();
    new MutationObserver(ms=>{ for(const m of ms){ if(m.addedNodes.length){ queue(); break; } } })
      .observe(document.body,{childList:true,subtree:true}); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})(window);
