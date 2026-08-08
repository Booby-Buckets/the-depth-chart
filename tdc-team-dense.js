/* ============================================================
   TDC TEAM DENSE JS — hero team logo + grade-tile coloring.
   (Dark-force removed 2026: the clean skin supports both themes,
   so the theme is owned solely by tdc-theme.js.)
============================================================ */
(function(){
  function norm(s){ return (s||'').toLowerCase().replace(/&/g,' ').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
  function logoFor(name){
    var C=window.TDC_TEAM_COLORS; if(!C||!name) return null;
    var n=norm(name); if(C[n]&&C[n].logo) return C[n].logo;
    var p=n.split(' ');
    for(var i=p.length;i>0;i--){ var k=p.slice(0,i).join(' '); if(C[k]&&C[k].logo) return C[k].logo; }
    return null;
  }
  function addLogo(){
    var hero=document.querySelector('.hero-top'); if(!hero) return false;
    if(hero.querySelector('.hero-dlogo')) return true;
    var nm=(document.getElementById('heroName')||{}).textContent||'';
    if(!nm || /loading/i.test(nm)) return false;              // wait for the name to load
    var url=logoFor(nm); if(!url) return true;                 // no logo on file → stop retrying
    var img=document.createElement('img');
    img.className='hero-dlogo'; img.src=url; img.alt=''; img.onerror=function(){ this.remove(); };
    hero.insertBefore(img, hero.firstChild);
    return true;
  }
  /* ---- grade tiles: graphite ink for the value (tier 1 = darkest/best), team color
     for the accent bar. Returns a tier (1..5, drives the ink shade via CSS, theme-aware)
     + a fill% for the bar width. No rainbow — the color signal is the team-colored bar. */
  function gInfo(raw){
    var s=(''+raw).trim();
    if(/^tier/i.test(s)){ var t=parseInt(s.replace(/\D/g,''))||5; var map={1:[1,99],2:[2,90],3:[3,82],4:[3,74],5:[4,66]}; var m=map[t]||[4,55]; return {tier:m[0],fill:m[1]}; }
    if(/^[0-9.]+$/.test(s)){ var v=parseFloat(s); var ti=v>=90?1:v>=80?2:v>=70?3:v>=60?4:5; return {tier:ti,fill:Math.max(20,Math.min(100,v))}; }
    var L={'A+':[1,99],'A':[1,93],'A-':[2,90],'B+':[2,87],'B':[3,83],'B-':[3,80],'C+':[4,77],'C':[4,73],'C-':[4,70],'D':[5,62],'F':[5,42]};
    var k=s.toUpperCase(), m=L[k]||[3,72]; return {tier:m[0],fill:m[1]};
  }
  function styleGrades(){
    var cells=document.querySelectorAll('.hero-grade'); if(!cells.length) return false;
    cells.forEach(function(cell){
      var el=cell.querySelector('.hero-grade-val'); if(!el) return;
      var g=gInfo(el.textContent);
      el.style.color='';                                   // let CSS own the graphite ink (theme-aware)
      cell.style.removeProperty('--hgc');
      cell.dataset.gt=g.tier; cell.style.setProperty('--hgf',g.fill+'%');
    });
    return true;
  }

  function boot(){
    var doneLogo=addLogo(), doneGrades=styleGrades();
    if(doneLogo && doneGrades) { watchGrades(); return; }
    var n=0, iv=setInterval(function(){ var a=addLogo(), b=styleGrades(); if((a&&b) || ++n>50){ clearInterval(iv); watchGrades(); } }, 150);
  }
  function watchGrades(){
    var host=document.getElementById('heroGrades'); if(!host||host.dataset.tw) return; host.dataset.tw='1';
    new MutationObserver(function(){ styleGrades(); }).observe(host,{childList:true,subtree:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
