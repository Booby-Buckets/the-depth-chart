/* tdc-anim.js — shared subtle-premium motion engine.
   - data-anim / data-stagger : fade/slide in (on load if in view, else on scroll)
   - data-countup="N"         : counts 0→N when revealed
   - data-fill                : bar animates 0→its width
   Robust by design: elements in view on load reveal immediately (no reliance on
   IntersectionObserver); off-screen ones reveal on scroll via IO; and a safety
   timeout reveals ANYTHING still hidden — so content can never get stuck invisible
   if IO is unsupported/flaky. Skipped entirely under prefers-reduced-motion
   (content just shows). Load in <head> (no defer) so the pre-reveal state is set
   before first paint — no flash. `?anim=force` overrides reduced-motion (preview). */
(function(){
  'use strict';
  var mm = window.matchMedia;
  var force = /[?&]anim=force/.test(location.search);
  if(!force && mm && mm('(prefers-reduced-motion: reduce)').matches){
    window.TDCAnim = { scan:function(){}, revealAll:function(){} }; return;
  }
  document.documentElement.classList.add('tdc-anim-ready');
  var hasIO = 'IntersectionObserver' in window;

  function raf2(fn){ requestAnimationFrame(function(){ requestAnimationFrame(fn); }); }
  function inView(el){ var r=el.getBoundingClientRect(), h=window.innerHeight||document.documentElement.clientHeight;
    return r.top < h*1.05 && r.bottom > -60; }
  function reveal(el){ el.classList.add('in-view'); }
  function staggerDelays(el){ var step=parseFloat(el.getAttribute('data-stagger'))||55;
    [].forEach.call(el.children, function(c,i){ c.style.transitionDelay=Math.min(i*step,520)+'ms'; }); }

  var io = hasIO ? new IntersectionObserver(function(ents,obs){
    ents.forEach(function(e){ if(e.isIntersecting){ reveal(e.target); obs.unobserve(e.target); } }); },
    {rootMargin:'0px 0px -6% 0px', threshold:0.05}) : null;

  function ease(p){ return 1 - Math.pow(1-p, 3); }
  function countUp(el){
    var target=parseFloat(el.getAttribute('data-countup')); if(isNaN(target)) return;
    var dec=parseInt(el.getAttribute('data-countup-dec')||'0',10);
    var suf=el.getAttribute('data-countup-suffix')||'', pre=el.getAttribute('data-countup-prefix')||'';
    var dur=Math.abs(target)>=200?900:700, t0=null;
    function frame(ts){ if(!t0)t0=ts; var p=Math.min(1,(ts-t0)/dur);
      el.textContent=pre+(target*ease(p)).toFixed(dec)+suf;
      if(p<1) requestAnimationFrame(frame); else el.textContent=pre+target.toFixed(dec)+suf; }
    requestAnimationFrame(frame);
  }
  var ioCount = hasIO ? new IntersectionObserver(function(ents,obs){
    ents.forEach(function(e){ if(e.isIntersecting){ countUp(e.target); obs.unobserve(e.target); } }); },
    {threshold:0.4}) : null;

  function scan(node){
    node=node||document; if(!node.querySelectorAll) return;
    node.querySelectorAll('[data-anim]:not(.in-view),[data-stagger]:not(.in-view),[data-fill]:not(.in-view)').forEach(function(el){
      if(el.hasAttribute('data-stagger')) staggerDelays(el);
      if(el.hasAttribute('data-fill') && !el.style.getPropertyValue('--fill-w'))
        el.style.setProperty('--fill-w', el.style.width || getComputedStyle(el).width);
      if(!io || inView(el)) raf2(function(){ reveal(el); });   // in view now → animate over the next frames
      else io.observe(el);
    });
    node.querySelectorAll('[data-countup]:not([data-cu])').forEach(function(el){
      el.setAttribute('data-cu','1');
      var dec=parseInt(el.getAttribute('data-countup-dec')||'0',10);
      el.textContent=(el.getAttribute('data-countup-prefix')||'')+(0).toFixed(dec)+(el.getAttribute('data-countup-suffix')||'');
      if(!ioCount || inView(el)) raf2(function(){ countUp(el); });
      else ioCount.observe(el);
    });
  }
  function revealAll(){
    document.querySelectorAll('[data-anim]:not(.in-view),[data-stagger]:not(.in-view),[data-fill]:not(.in-view)').forEach(reveal);
    document.querySelectorAll('[data-countup]:not([data-cu])').forEach(function(el){ el.setAttribute('data-cu','1'); countUp(el); });
  }
  window.TDCAnim = { scan: scan, revealAll: revealAll };

  function init(){
    scan();
    if(window.MutationObserver){
      var pending=false;
      new MutationObserver(function(){ if(pending) return; pending=true;
        requestAnimationFrame(function(){ pending=false; scan(); }); }).observe(document.body, {childList:true, subtree:true});
    }
    setTimeout(revealAll, 3200);   // safety net: nothing stays hidden if IO never fires
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
