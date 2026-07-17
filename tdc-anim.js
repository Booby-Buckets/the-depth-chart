/* tdc-anim.js — shared subtle-premium motion engine.
   - scroll-reveal: any [data-anim] / [data-stagger] element fades/slides in when
     it scrolls into view (once).
   - count-up: any [data-countup="N"] element counts from 0 to N when revealed.
   - bar-fill: any [data-fill] element animates from 0 to its --fill-w width.
   Works on dynamically-rendered pages via a debounced MutationObserver, so no
   per-page wiring is needed beyond adding the attributes. Fully skipped under
   prefers-reduced-motion (content just shows, no motion). Load in <head> (no
   defer) so `.tdc-anim-ready` is set before first paint — no content flash. */
(function(){
  'use strict';
  var mm = window.matchMedia;
  if(mm && mm('(prefers-reduced-motion: reduce)').matches){ window.TDCAnim={scan:function(){}}; return; }
  document.documentElement.classList.add('tdc-anim-ready');

  var io = new IntersectionObserver(function(entries, obs){
    entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in-view'); obs.unobserve(e.target); } });
  }, {rootMargin:'0px 0px -6% 0px', threshold:0.06});

  function ease(p){ return 1 - Math.pow(1-p, 3); }
  function countUp(el){
    var target=parseFloat(el.getAttribute('data-countup'));
    if(isNaN(target)) return;
    var dec=parseInt(el.getAttribute('data-countup-dec')||'0',10);
    var suf=el.getAttribute('data-countup-suffix')||'';
    var pre=el.getAttribute('data-countup-prefix')||'';
    var dur=Math.abs(target)>=200?900:700, t0=null;
    function frame(ts){ if(!t0)t0=ts; var p=Math.min(1,(ts-t0)/dur);
      el.textContent=pre+(target*ease(p)).toFixed(dec)+suf;
      if(p<1) requestAnimationFrame(frame); else el.textContent=pre+target.toFixed(dec)+suf;
    }
    requestAnimationFrame(frame);
  }
  var ioCount = new IntersectionObserver(function(entries, obs){
    entries.forEach(function(e){ if(e.isIntersecting){ countUp(e.target); obs.unobserve(e.target); } });
  }, {threshold:0.5});

  function scan(node){
    node=node||document;
    if(node.querySelectorAll){
      node.querySelectorAll('[data-anim]:not(.in-view)').forEach(function(el){ io.observe(el); });
      node.querySelectorAll('[data-stagger]:not(.in-view)').forEach(function(el){
        var step=parseFloat(el.getAttribute('data-stagger'))||55;
        [].forEach.call(el.children, function(c,i){ c.style.transitionDelay=Math.min(i*step,520)+'ms'; });
        io.observe(el);
      });
      node.querySelectorAll('[data-fill]:not(.in-view)').forEach(function(el){
        if(!el.style.getPropertyValue('--fill-w')) el.style.setProperty('--fill-w', el.style.width||getComputedStyle(el).width);
        io.observe(el);
      });
      node.querySelectorAll('[data-countup]:not([data-cu])').forEach(function(el){
        el.setAttribute('data-cu','1');
        var dec=parseInt(el.getAttribute('data-countup-dec')||'0',10);
        el.textContent=(el.getAttribute('data-countup-prefix')||'')+(0).toFixed(dec)+(el.getAttribute('data-countup-suffix')||'');
        ioCount.observe(el);
      });
    }
  }
  window.TDCAnim = { scan: scan };

  function init(){
    scan();
    var pending=false;
    new MutationObserver(function(){ if(pending) return; pending=true;
      requestAnimationFrame(function(){ pending=false; scan(); }); })
      .observe(document.body, {childList:true, subtree:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
