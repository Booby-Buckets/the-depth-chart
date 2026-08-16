/* tdc-season.js — ONE clean, consistent season selector for every page.
   Replaces per-page pill rows / bespoke <select>s so the control looks and behaves the same
   site-wide (matches the team page's season dropdown). Theme-aware (uses the site's CSS tokens).

   Usage:
     const ctl = TDCSeason.mount('#seasonSlot', {
       min: 2008, max: 2027, current: 2027,
       title: 'Season',              // uppercase label before the dropdown (pass false to hide)
       currentLabel: ' · Current',   // suffix appended to the max (newest) year
       labelFn: (y, max) => '…',     // full option-label override (optional)
       hintFn:  (y)      => '…',     // small italic hint shown next to the dropdown (optional)
       onChange:(year)   => { … }    // fired when the user picks a season
     });
     ctl.set(2019);   // move it programmatically (updates the hint, does NOT fire onChange)
     ctl.get();       // → current selected year (number)
*/
(function (g) {
  function defLabel(y, max, curSuffix) {
    return y >= max
      ? (max - 1) + '-' + ('' + max).slice(2) + (curSuffix || ' · Current')
      : (y - 1) + '-' + ('' + y).slice(2);
  }
  function injectCSS() {
    if (document.getElementById('tdc-season-css')) return;
    var s = document.createElement('style');
    s.id = 'tdc-season-css';
    s.textContent =
      ".tdc-season-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}" +
      ".tdc-season-bar .tdc-season-label{font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--text3,#888);}" +
      ".tdc-season-select{font-family:inherit;font-size:13px;font-weight:700;color:var(--text,#111);background:var(--bg2,#f4f4f6);border:1px solid var(--border2,#ccc);border-radius:9px;padding:7px 32px 7px 13px;cursor:pointer;appearance:none;-webkit-appearance:none;font-variant-numeric:tabular-nums;transition:border-color .15s;background-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>\");background-repeat:no-repeat;background-position:right 11px center;}" +
      ".tdc-season-select:hover,.tdc-season-select:focus{border-color:var(--accent,#4a7d5f);outline:none;}" +
      ".tdc-season-hint{font-size:11px;color:var(--text3,#888);font-style:italic;}";
    document.head.appendChild(s);
  }
  function mount(target, opts) {
    opts = opts || {};
    injectCSS();
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return null;
    var min = opts.min != null ? +opts.min : 2008;
    var max = opts.max != null ? +opts.max : 2027;
    var cur = opts.current != null ? +opts.current : max;
    var lf = opts.labelFn || function (y) { return defLabel(y, max, opts.currentLabel); };
    var bar = document.createElement('div');
    bar.className = 'tdc-season-bar';
    if (opts.title !== false) {
      var lbl = document.createElement('span');
      lbl.className = 'tdc-season-label';
      lbl.textContent = opts.title || 'Season';
      bar.appendChild(lbl);
    }
    var sel = document.createElement('select');
    sel.className = 'tdc-season-select';
    sel.setAttribute('aria-label', 'Select season');
    for (var y = max; y >= min; y--) {
      var o = document.createElement('option');
      o.value = y;
      o.textContent = lf(y, max);
      if (y === cur) o.selected = true;
      sel.appendChild(o);
    }
    // extra non-year entries (e.g. { value:'all', label:'All seasons' }) appended after the years
    if (Array.isArray(opts.extras)) opts.extras.forEach(function (ex) {
      var o = document.createElement('option');
      o.value = ex.value;
      o.textContent = ex.label;
      if (String(ex.value) === String(cur)) o.selected = true;
      sel.appendChild(o);
    });
    bar.appendChild(sel);
    // years coerce to Number; non-year extras (e.g. 'all') pass through as their raw string
    var coerce = function (v) { var n = +v; return (v === '' || isNaN(n)) ? v : n; };
    var hint = null;
    if (opts.hintFn) {
      hint = document.createElement('span');
      hint.className = 'tdc-season-hint';
      hint.textContent = opts.hintFn(cur) || '';
      bar.appendChild(hint);
    }
    sel.addEventListener('change', function () {
      var v = coerce(sel.value);
      if (hint && opts.hintFn) hint.textContent = opts.hintFn(v) || '';
      if (opts.onChange) opts.onChange(v);
    });
    el.innerHTML = '';
    el.appendChild(bar);
    return {
      set: function (v) { sel.value = String(v); if (hint && opts.hintFn) hint.textContent = opts.hintFn(coerce(v)) || ''; },
      get: function () { return coerce(sel.value); },
      select: sel
    };
  }
  g.TDCSeason = { mount: mount, defLabel: defLabel };
})(window);
