/* ============================================================
   tdc-a11y.js — site-wide accessibility baseline (additive, defensive).
   - injects a "skip to content" link
   - makes clickable non-native elements keyboard-operable (Enter/Space)
   - gives decorative images an empty alt so AT skips them cleanly
   All guards are idempotent and never change visual/mouse behavior.
   ============================================================ */
(function () {
  var FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]';

  // Keyboard-activate a single clickable element (only if it has no inner focusable
  // element — that keeps big repeated containers like ranking rows, which already hold a
  // team link, from becoming hundreds of extra tab stops).
  function enhanceEl(el) {
    if (!el || el.nodeType !== 1 || el.dataset.tdcKb) return;
    var t = el.tagName;
    if (t === 'A' || t === 'BUTTON' || t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || t === 'LABEL') return;
    if (el.querySelector && el.querySelector(FOCUSABLE)) return;   // already reachable via a child
    el.dataset.tdcKb = '1';
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); el.click(); }
    });
  }

  // Decorative-image default: images on this site sit next to text labels (team logos by
  // team names, headshots by player names), so an empty alt is the correct, quiet choice.
  function fixImg(img) {
    if (img && img.nodeType === 1 && img.tagName === 'IMG' && !img.hasAttribute('alt')) {
      img.setAttribute('alt', '');
    }
  }

  function scan(root) {
    try {
      if (root.querySelectorAll) {
        root.querySelectorAll('[onclick]').forEach(enhanceEl);
        root.querySelectorAll('img:not([alt])').forEach(fixImg);
      }
      if (root.nodeType === 1 && root.matches) {
        if (root.matches('[onclick]')) enhanceEl(root);
        if (root.matches('img:not([alt])')) fixImg(root);
      }
    } catch (e) {}
  }

  function addSkipLink() {
    try {
      if (document.querySelector('.tdc-skip-link')) return;
      var target = document.querySelector('main, [role="main"], .content-wrap, .table-scroll, .cards-wrap, .page, .hero-card');
      if (!target) return;
      if (!target.id) target.id = 'tdc-main';
      var a = document.createElement('a');
      a.className = 'tdc-skip-link';
      a.href = '#' + target.id;
      a.textContent = 'Skip to content';
      document.body.insertBefore(a, document.body.firstChild);
    } catch (e) {}
  }

  function boot() {
    addSkipLink();
    scan(document);
    // Catch content rendered after load (rankings rows, filter chips, cards, images) —
    // only processes ADDED nodes, so it stays cheap on data-heavy pages.
    try {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) scan(added[j]);
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
