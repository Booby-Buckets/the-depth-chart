/* tdc-mindex.js — the phone layout of index.html (rankings home), Oct 2026 mobile
   redesign. Same look as the player page (tdc-mplayer.js): a compact header with one
   season picker and one shaded count cell, one row of controls, and small sheet tables
   only (Top players becomes a table instead of photo cards). It re-arranges what the
   page already renders and drives the page's own controls; no data of its own.
   Phones only (≤640px). */
(function () {
  var MQ = window.matchMedia('(max-width:640px)');
  var CSS = [
    'body.mi #pageHeader .ph-left,body.mi #filterBar,body.mi #whStrip,body.mi #scPlayers,body.mi #scLabel,body.mi #tdc-ver{display:none!important}',
    '.mi-hero,.mi-ctl,.mi-top,.mi-st{display:none}',
    'body.mi #pageHeader{display:block!important;width:auto!important;max-width:none!important;padding:0!important;margin:0!important;min-height:0!important;background:none!important;border:0!important}',
    'body.mi .mi-hero{width:100%;box-sizing:border-box}',
    'body.mi .mi-hero{display:flex;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border)}',
    '.mi-id{flex:1;min-width:0}',
    '.mi-eye{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mi-name{margin:4px 0 8px;font-family:"Playfair Display",Georgia,serif;font-size:28px;font-weight:800;line-height:1.05;color:var(--text)}',
    '.mi-sel,.mi-in{font:700 13px Inter,system-ui,sans-serif;color:var(--text);background:var(--bg2);border:1px solid var(--border2);border-radius:6px;padding:5px 8px;max-width:100%;min-width:0;box-sizing:border-box}',
    '.mi-cell{flex:0 0 76px;border:1px solid var(--border2);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;align-self:stretch}',
    '.mi-cell span{font-size:11px;font-weight:800;letter-spacing:.07em;color:var(--text3);background:var(--bg2);border-bottom:1px solid var(--border2);text-align:center;padding:5px 0}',
    '.mi-cell b{flex:1;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--text);min-height:56px;' +
    'background-image:linear-gradient(hsla(125,70%,48%,.40),hsla(125,70%,48%,.40))}',
    'body.mi .mi-ctl{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px 14px 0}',
    '.mi-ctl .mi-in{grid-column:1 / -1}',
    '.mi-ctl .mi-sel,.mi-ctl .mi-in{width:100%;height:36px}',
    'body.mi .showcase{padding:14px 14px 0!important;gap:0!important}',
    'body.mi .mi-top{display:block}',
    'body.mi .mi-st{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin:0 0 6px}',
    '.mi-st a{font-size:12px;letter-spacing:0;text-transform:none;font-weight:700;color:var(--accent);text-decoration:none}',
    'body.mi .table-section{padding-top:18px!important}',
    'body.mi .mi-st.mi-rk{margin:0 0 6px}'
  ].join('\n');

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms || 60); }; }
  function watch(node, fn, attrs) { if (!node) return; var d = debounce(fn, 80); new MutationObserver(d).observe(node, { childList: true, subtree: true, characterData: true, attributes: !!attrs }); fn(); }
  // a header copy of one of the page's <select>s; the original keeps its own handlers
  function mirror(src, cls) {
    var sel = document.createElement('select'); sel.className = cls || 'mi-sel'; sel.setAttribute('aria-label', src.getAttribute('aria-label') || src.id);
    function sync() { if (sel.innerHTML !== src.innerHTML) sel.innerHTML = src.innerHTML; sel.value = src.value; }
    sync(); new MutationObserver(sync).observe(src, { childList: true, subtree: true, attributes: true });
    src.addEventListener('change', function () { sel.value = src.value; });
    sel.addEventListener('change', function () { src.value = sel.value; src.dispatchEvent(new Event('change', { bubbles: true })); });
    return sel;
  }

  var built = false;
  function build() {
    var hdr = document.getElementById('pageHeader'), season = document.getElementById('seasonSel'), sort = document.getElementById('sortSel');
    if (built || !hdr || !season || !season.options.length || !sort) return;
    built = true;
    if (!document.getElementById('miCss')) { var st = el('style'); st.id = 'miCss'; st.textContent = CSS; document.head.appendChild(st); }

    // header: eyebrow · title · season picker · team-count cell
    var hero = el('div', 'mi-hero',
      '<div class="mi-id"><div class="mi-eye" id="miEye">Division I · Rankings</div><h1 class="mi-name" id="miTitle"></h1><span id="miSeason"></span></div>' +
      '<div class="mi-cell"><span>TEAMS</span><b id="miCount">—</b></div>');
    hdr.appendChild(hero);
    document.getElementById('miSeason').appendChild(mirror(season));
    watch(document.getElementById('heroTitle'), function () {
      var t = (document.getElementById('heroTitle') || {}).textContent || 'Team Analytics';
      document.getElementById('miTitle').textContent = t;
      var e = (document.getElementById('heroEyebrow') || {}).textContent || 'Division I · Rankings';
      document.getElementById('miEye').textContent = e;
    });
    watch(document.getElementById('filterCount'), function () {
      var m = ((document.getElementById('filterCount') || {}).textContent || '').match(/([\d,]+)/);
      document.getElementById('miCount').textContent = m ? m[1] : '—';
    });

    // one row of controls: conference · sort · search
    var ctl = el('div', 'mi-ctl');
    var conf = document.createElement('select'); conf.className = 'mi-sel'; conf.setAttribute('aria-label', 'Conference');
    var pills = document.getElementById('filterPills');
    function syncConf() {
      var btns = pills ? [].slice.call(pills.querySelectorAll('.filter-btn')) : [];
      var html = btns.map(function (b, i) { return '<option value="' + i + '">' + esc(i === 0 ? 'All conferences' : b.textContent.trim()) + '</option>'; }).join('');
      if (conf.__h !== html) { conf.__h = html; conf.innerHTML = html; }
      var on = btns.findIndex(function (b) { return b.classList.contains('active'); });
      conf.value = String(on < 0 ? 0 : on);
    }
    conf.addEventListener('change', function () { var b = pills && pills.querySelectorAll('.filter-btn')[+conf.value]; if (b) b.click(); });
    watch(pills, syncConf, true);
    var srch = document.getElementById('searchInput');
    var q = document.createElement('input'); q.type = 'search'; q.className = 'mi-in'; q.placeholder = 'Find team'; q.setAttribute('aria-label', 'Search teams');
    q.addEventListener('input', function () { if (!srch) return; srch.value = q.value; srch.dispatchEvent(new Event('input', { bubbles: true })); });
    ctl.appendChild(conf); ctl.appendChild(mirror(sort)); ctl.appendChild(q);
    hdr.appendChild(ctl);

    // Top players: a five-row sheet instead of photo cards
    var block = document.getElementById('scPlayersBlock');
    if (block) {
      var top = el('div', 'mi-top'); block.appendChild(top);
      watch(document.getElementById('scPlayers'), function () {
        var cards = [].slice.call(document.querySelectorAll('#scPlayers .sc-player')).slice(0, 5);
        var lbl = ((document.getElementById('scLabel') || {}).textContent || 'Top players').replace(/\s+/g, ' ').trim();
        if (!cards.length) { top.innerHTML = ''; return; }
        var rows = cards.map(function (a, i) {
          var g = (a.querySelector('.sc-badge') || {}).textContent || '';
          return '<tr><td class="rk">' + (i + 1) + '</td><td class="l nm"><a href="' + a.getAttribute('href') + '">' + esc((a.querySelector('.sc-pname') || {}).textContent) + '</a></td>' +
            '<td class="l dim">' + esc((a.querySelector('.sc-pteam') || {}).textContent) + '</td><td class="c4 strong">' + esc(g) + '</td></tr>';
        }).join('');
        var h = '<div class="mi-st"><span>' + esc(lbl) + '</span><a href="player-rankings.html">All players ›</a></div>' +
          '<div class="sheet-wrap" style="max-height:none"><table class="sheet dense" style="width:100%"><thead><tr><th class="rk">#</th><th class="l">Player</th><th class="l">Team</th><th>OVR</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
        if (top.__h !== h) { top.__h = h; top.innerHTML = h; }
      });
    }
    var ts = document.querySelector('.table-section');
    if (ts && !ts.querySelector('.mi-st')) ts.insertBefore(el('div', 'mi-st mi-rk', '<span>Rankings</span>'), ts.firstChild);
  }
  function apply() { document.body.classList.toggle('mi', MQ.matches); if (MQ.matches) build(); }
  function start() {
    apply();
    if (!built) { var tries = 0, iv = setInterval(function () { apply(); if (built || ++tries > 60) clearInterval(iv); }, 250); }
    if (MQ.addEventListener) MQ.addEventListener('change', apply); else if (MQ.addListener) MQ.addListener(apply);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
