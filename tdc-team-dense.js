/* ============================================================
   TDC TEAM DENSE JS — force dark + drop the team logo into the hero.
============================================================ */
(function(){
  try{ document.documentElement.setAttribute('data-theme','dark'); }catch(e){}
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
  /* ---- color the grade tiles by grade + set the accent bar width ---- */
  var GC={mint:'#2DE0A6',violet:'#8B7CFF',blue:'#5B8DEF',amber:'#FBBF24',red:'#F87171'};
  function gInfo(raw){
    var s=(''+raw).trim();
    if(/^tier/i.test(s)){ var t=parseInt(s.replace(/\D/g,''))||5; var map={1:[GC.violet,99],2:[GC.blue,90],3:[GC.mint,82],4:[GC.mint,74],5:[GC.amber,66]}; var m=map[t]||[GC.amber,55]; return {c:m[0],fill:m[1]}; }
    if(/^[0-9.]+$/.test(s)){ var v=parseFloat(s); var c=v>=90?GC.blue:v>=80?GC.mint:v>=70?GC.amber:GC.red; return {c:c,fill:Math.max(20,Math.min(100,v))}; }
    var L={'A+':[GC.violet,99],'A':[GC.blue,93],'A-':[GC.blue,90],'B+':[GC.mint,87],'B':[GC.mint,83],'B-':[GC.mint,80],'C+':[GC.amber,77],'C':[GC.amber,73],'C-':[GC.amber,70],'D':[GC.red,62],'F':[GC.red,42]};
    var k=s.toUpperCase(), m=L[k]||[GC.mint,72]; return {c:m[0],fill:m[1]};
  }
  function styleGrades(){
    var cells=document.querySelectorAll('.hero-grade'); if(!cells.length) return false;
    cells.forEach(function(cell){
      var el=cell.querySelector('.hero-grade-val'); if(!el) return;
      var g=gInfo(el.textContent);
      el.style.color=g.c; cell.style.setProperty('--hgc',g.c); cell.style.setProperty('--hgf',g.fill+'%');
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
