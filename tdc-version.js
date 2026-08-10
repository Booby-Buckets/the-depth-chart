/* tdc-version.js — single source of truth for the site version.
   Bump TDC_VERSION here and it updates everywhere. Renders a small tag in the
   page footer if one exists, otherwise a subtle fixed pill in the corner. */
window.TDC_VERSION = 'Beta 1.1';
(function () {
  function inject() {
    if (document.getElementById('tdc-ver')) return;
    var ver = window.TDC_VERSION;
    var onLog = /(^|\/)changelog\.html/.test(location.pathname);
    var href = onLog ? '' : ' href="changelog.html"';
    var f = document.querySelector('.footer, footer');
    if (f) {
      var d = document.createElement('div'); d.id = 'tdc-ver';
      d.style.cssText = 'margin-top:12px;';
      d.innerHTML = '<a' + href + ' title="What\'s new" style="display:inline-block;font-family:Inter,system-ui,sans-serif;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3,#8A867A);border:1px solid var(--border2,#C6C0B2);border-radius:20px;padding:3px 11px;opacity:.85;text-decoration:none;transition:border-color .15s,color .15s;" onmouseover="this.style.borderColor=\'var(--accent,#A8843C)\';this.style.color=\'var(--accent,#A8843C)\';" onmouseout="this.style.borderColor=\'var(--border2,#C6C0B2)\';this.style.color=\'var(--text3,#8A867A)\';">' + ver + '</a>';
      f.appendChild(d);
    } else {
      var p = document.createElement('a'); p.id = 'tdc-ver';
      if (!onLog) p.setAttribute('href', 'changelog.html');
      p.textContent = ver; p.title = "The Depth Chart — " + ver + " · What's new";
      p.style.cssText = 'position:fixed;bottom:10px;right:12px;z-index:60;font-family:Inter,system-ui,sans-serif;font-size:9.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--text3,#8A867A);background:color-mix(in srgb,var(--bg,#fff) 80%,transparent);border:1px solid var(--border,#ddd);border-radius:20px;padding:3px 10px;opacity:.5;text-decoration:none;backdrop-filter:blur(4px);transition:opacity .15s;';
      p.onmouseover = function(){ this.style.opacity = '1'; };
      p.onmouseout = function(){ this.style.opacity = '.5'; };
      document.body.appendChild(p);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
