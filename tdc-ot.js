/* tdc-ot.js — overtime labels for final scores, site-wide.
 *
 *   TDC_OT.ready()        -> Promise; loads data/game_ot.json once ({"<espn game id>": n_ot}, OT games only)
 *   TDC_OT.n(id)          -> 0 (regulation), 1 (OT), 2 (2OT)…   (sync; 0 until ready)
 *   TDC_OT.tag(id)        -> '' | 'OT' | '2OT'
 *   TDC_OT.final(id)      -> 'Final' | 'Final/OT' | 'Final/2OT'
 *   TDC_OT.chip(id)       -> '' | '<span class="tdc-ot">OT</span>' (for score cells)
 *   TDC_OT.fromRow(row)   -> n_ot from a results_2027 row array (index 8) or the lookup
 */
(function () {
  var MAP = null, P = null;
  function n(id) { return MAP && id != null ? (MAP[String(id)] || 0) : 0; }
  function tag(id) { var k = n(id); return k ? (k > 1 ? k + 'OT' : 'OT') : ''; }
  var css = document.createElement('style');
  css.textContent = '.tdc-ot{display:inline-block;margin-left:5px;font-size:.78em;font-weight:800;letter-spacing:.04em;color:var(--text3);vertical-align:baseline;}';
  (document.head || document.documentElement).appendChild(css);
  window.TDC_OT = {
    ready: function () {
      return P || (P = fetch('data/game_ot.json?v=1').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
        .then(function (m) { MAP = m || {}; return MAP; }));
    },
    n: n,
    tag: tag,
    final: function (id) { var t = tag(id); return t ? 'Final/' + t : 'Final'; },
    chip: function (id) { var t = tag(id); return t ? '<span class="tdc-ot">' + t + '</span>' : ''; },
    fromRow: function (g) { return (g && g[8]) || n(g && g[0]); },
    label: function (k) { return k ? (k > 1 ? k + 'OT' : 'OT') : ''; }
  };
  TDC_OT.ready();
})();
