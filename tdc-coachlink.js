/* tdc-coachlink.js — every coach name on the site links to his coach page (owner, Oct 15 2026).
 *
 * Pages mark a name with  TDCCoach.html(name, school)  — a <span class="tdc-coach"> that this script upgrades to
 * <a href="coach.html?slug=…"> once the name → slug index (data/coach_slugs.json, scripts/build_coach_slugs.py) loads.
 * Names rendered later are picked up by a MutationObserver, so a page only has to emit the span.
 * Namesakes resolve to the coach who led `school`, else the most recent one; nicknames ("Mike"/"Michael") fall back
 * to first initial + last name. A name with no coach page stays plain text.
 */
(function () {
  if (window.TDCCoach) return;
  var IDX = null, loading = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function key(n) { return String(n || '').toLowerCase().replace(/[^a-z]/g, ''); }
  function ilKey(n) { var w = String(n || '').toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(function (x) { return x && !/^(jr|sr|ii|iii|iv)$/.test(x); }); return w.length >= 2 ? w[0][0] + '|' + w[w.length - 1] : ''; }
  function load() {
    if (IDX) return Promise.resolve(IDX);
    return loading || (loading = fetch('data/coach_slugs.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (j) { IDX = j || {}; return IDX; }));
  }
  function schoolHit(row, school) {
    var s = String(school || '').toLowerCase().trim(); if (!s) return false;
    return String(row[1] || '').toLowerCase().split('|').some(function (x) { return x && (s === x || s.indexOf(x + ' ') === 0 || x.indexOf(s) === 0); });
  }
  // slug for a name (+ school), or null
  function slug(name, school) {
    if (!IDX || !name) return null;
    var L = IDX[key(name)] || (IDX._il && IDX._il[ilKey(name)]); if (!L || !L.length) return null;
    var hit = L.filter(function (r) { return schoolHit(r, school); })[0] || L[0];
    return hit[0];
  }
  function href(name, school) { var s = slug(name, school); return s ? 'coach.html?slug=' + encodeURIComponent(s) : null; }
  // markup for a coach name: a link when the index is loaded, else a span the observer upgrades
  function html(name, school, cls) {
    if (!name) return '';
    var h = href(name, school), c = 'tdc-coach' + (cls ? ' ' + cls : '');
    if (h) return '<a class="' + c + '" href="' + h + '">' + esc(name) + '</a>';
    return '<span class="' + c + '" data-coach="' + esc(name) + '" data-school="' + esc(school || '') + '">' + esc(name) + '</span>';
  }
  function upgrade(root) {
    if (!IDX) return;
    var els = (root && root.querySelectorAll ? root : document).querySelectorAll('span.tdc-coach[data-coach]');
    for (var i = 0; i < els.length; i++) {
      var e = els[i], h = href(e.getAttribute('data-coach'), e.getAttribute('data-school'));
      e.removeAttribute('data-coach'); if (!h) continue;
      var a = document.createElement('a'); a.className = e.className; a.href = h; a.textContent = e.textContent;
      if (e.parentNode) e.parentNode.replaceChild(a, e);
    }
  }
  function css() {
    if (document.getElementById('tdcCoachCss')) return;
    var st = document.createElement('style'); st.id = 'tdcCoachCss';
    st.textContent = 'a.tdc-coach{color:inherit;text-decoration:underline;text-decoration-color:currentColor;text-decoration-thickness:1px;text-underline-offset:2px;text-decoration-style:dotted;}a.tdc-coach:hover{text-decoration-style:solid;}';
    (document.head || document.documentElement).appendChild(st);
  }
  function start() {
    css();
    load().then(function () {
      upgrade(document);
      var pend = false;
      new MutationObserver(function () { if (pend) return; pend = true; requestAnimationFrame(function () { pend = false; upgrade(document); }); })
        .observe(document.body, { childList: true, subtree: true });
    });
  }
  window.TDCCoach = { html: html, href: href, slug: slug, load: load, upgrade: upgrade, esc: esc };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
