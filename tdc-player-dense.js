/* ============================================================
   TDC PLAYER DENSE JS — force the dark "spreadsheet" theme and
   keep it there (the page's own theme-init defaults to light and
   would otherwise override the dense reskin). Dark-first, like
   the index + team page.
============================================================ */
(function(){
  function dark(){ try{ if(document.documentElement.getAttribute('data-theme')!=='dark') document.documentElement.setAttribute('data-theme','dark'); }catch(e){} }
  dark();
  // Guard against the page's async theme-init / toggle flipping it back to light.
  try{ new MutationObserver(dark).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']}); }catch(e){}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',dark); else dark();
})();
