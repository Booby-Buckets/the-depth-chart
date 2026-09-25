/* tdc-anim.js — entrance motion, switched OFF (Sept 2026) to match The Depth Chart CFB.

   This used to hide every [data-anim] / [data-stagger] block before first paint and fade/slide
   it in (counting numbers up from 0 and growing bars from 0 as they appeared). On a real load
   that read as flicker: content painted, vanished as the engine armed, then drifted back in,
   and anything a script re-rendered animated again. CFB simply paints the page, so this does too.

   The attributes stay in the markup and the public API stays, so callers keep working:
   every element already carries its final text / inline width, and nothing is ever hidden.
   Delete the attributes page by page later if wanted; they are inert now. */
(function(){
  'use strict';
  function noop(){}
  window.TDCAnim = { scan: noop, revealAll: noop };
})();
