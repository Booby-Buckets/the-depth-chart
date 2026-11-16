/* tdc-mhome.js — phone layout of the home page (index.html), Nov 16 2026.
   Owner: "minimal data before the rankings". On a phone the page is: title → season picker + one Filters button →
   the rankings. Real/Projected, level, sort, movement, search and the conference pills sit behind Filters; live
   scores, a biggest-movers row (read from the table), Top players and "New here" move BELOW the rankings.
   No data of its own. Phones only (≤640px); renderPod() (top-3 podium) is kept but not shown. */
(function () {
  var MQ = window.matchMedia('(max-width:640px)');
  var CSS = [
    '.mh-pod,.mh-mv,.mh-more{display:none}',
    'body.mh .mh-pod{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:14px 14px 0}',
    '.mh-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:12px 6px 10px;border:1px solid var(--border);border-top:4px solid var(--mh-tc,var(--border2));border-radius:12px;background:var(--card,var(--bg));text-decoration:none;color:var(--text);min-width:0}',
    '.mh-card.n1{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));border-top-color:var(--mh-tc,var(--accent))}',
    '.mh-rk{position:absolute;left:7px;top:5px;font:800 11px Inter,system-ui,sans-serif;color:var(--text3)}',
    '.mh-card.n1 .mh-rk{color:var(--accent)}',
    '.mh-card img{width:38px;height:38px;object-fit:contain;margin:2px 0 3px}',
    '.mh-nm{font:700 13px Inter,system-ui,sans-serif;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mh-rt{font:800 20px Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums;line-height:1.1}',
    '.mh-sub{font:600 11px Inter,system-ui,sans-serif;color:var(--text3)}',
    'body.mh .mh-mv{display:block;margin:14px 0 0 14px}','.mh-row{padding-right:14px!important}','.mh-mv .mh-st{padding-right:14px}',
    '.mh-st{display:flex;justify-content:space-between;align-items:baseline;font:800 11px Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin:0 0 6px}',
    '.mh-st em{font-style:normal;font-weight:600;letter-spacing:0;text-transform:none}',
    '.mh-row{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-bottom:2px}',
    '.mh-row::-webkit-scrollbar{display:none}',
    '.mh-chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;padding:6px 10px 6px 7px;border:1px solid var(--border);border-radius:999px;background:var(--card,var(--bg));text-decoration:none;color:var(--text);font:600 13px Inter,system-ui,sans-serif;white-space:nowrap}',
    '.mh-chip img{width:20px;height:20px;object-fit:contain}',
    '.mh-chip b{font-weight:800;font-variant-numeric:tabular-nums}',
    '.mh-chip.up b{color:var(--green,#2e8b57)}.mh-chip.dn b{color:var(--red,#c0392b)}',
    'body.mh #filterBar .filter-controls{grid-template-columns:minmax(0,1fr) auto!important;align-items:center!important}',
    'body.mh #filterBar .filter-controls > .f-lead{grid-column:1!important}',
    'body.mh #filterBar .filter-controls > .mh-x{grid-column:1 / -1!important}',
    'body.mh #filterBar.mh-open #filterPills{margin-top:10px!important}',
    'body.mh .mh-after{margin-top:22px}',
    'body.mh .mh-more{display:flex;grid-column:2;align-items:center;justify-content:space-between;gap:8px;height:38px;padding:0 12px;border:1px solid var(--border2);border-radius:8px;background:var(--bg2);color:var(--text2);font:700 13px Inter,system-ui,sans-serif;cursor:pointer}',
    '.mh-more span{font-weight:600;color:var(--text3)}',
    'body.mh #filterBar:not(.mh-open) .mh-x{display:none!important}',
    'body.mh #filterBar.mh-open .mh-more{border-color:var(--text3)}'
  ].join('\n');

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms || 80); }; }
  function tc(name) { var c = window.tdcTeamColor && window.tdcTeamColor(name); return (c && c.c1) || ''; }

  // the table's columns by header label (the column set changes with the sort / season)
  function col(label) {
    var ths = [].slice.call(document.querySelectorAll('#rankHead th'));
    for (var i = 0; i < ths.length; i++) if (ths[i].textContent.replace(/[▲▼]/g, '').trim().toLowerCase() === label) return i;
    return -1;
  }
  function rows() {
    return [].slice.call(document.querySelectorAll('#rankingsList tr')).filter(function (tr) { return tr.querySelector('td.nm a') && tr.offsetParent !== null; });
  }
  function team(tr) {
    var a = tr.querySelector('td.nm a'), img = a && a.querySelector('img'), sp = a && a.querySelector('span');
    return { href: a ? a.getAttribute('href') : '#', name: sp ? sp.textContent.trim() : (a ? a.textContent.trim() : ''), logo: img ? img.getAttribute('src') : '' };
  }
  function cell(tr, i) { var c = i >= 0 ? tr.children[i] : null; if (!c) return ''; var t = c.cloneNode(true); t.querySelectorAll('.ix-rk').forEach(function (x) { x.remove(); }); return t.textContent.trim(); }

  function renderPod() {
    var host = document.getElementById('mhPod'); if (!host) return;
    var rs = rows().slice(0, 3);
    var iR = col('rating'), iWL = col('w-l'), iConf = col('conf');
    var sortSel = document.getElementById('sortSel');
    var sortLbl = sortSel && sortSel.selectedOptions[0] ? sortSel.selectedOptions[0].textContent.trim() : '';
    // the big number is whatever the table is sorted by when that column is there, else the Power Rating
    var iS = -1; [].slice.call(document.querySelectorAll('#rankHead th')).forEach(function (th, i) { if (/[▲▼]/.test(th.textContent) && th.cellIndex > 1) iS = i; });
    var iBig = iS >= 0 ? iS : iR;
    var h = rs.map(function (tr, k) {
      var t = team(tr), rk = (tr.querySelector('td.rk') || {}).textContent || (k + 1);
      var c = tc(t.name);
      return '<a class="mh-card n' + (k + 1) + '" href="' + esc(t.href) + '"' + (c ? ' style="--mh-tc:' + c + '"' : '') + '>' +
        '<span class="mh-rk">#' + esc(String(rk).trim().split(/\s/)[0]) + '</span>' +
        (t.logo ? '<img src="' + esc(t.logo) + '" alt="" onerror="this.remove()">' : '') +
        '<span class="mh-nm">' + esc(t.name) + '</span>' +
        '<span class="mh-rt">' + esc(cell(tr, iBig)) + '</span>' +
        '<span class="mh-sub">' + esc([cell(tr, iWL), cell(tr, iConf)].filter(Boolean).join(' · ')) + '</span></a>';
    }).join('');
    if (host.__h !== h) { host.__h = h; host.innerHTML = h; }
    host.title = sortLbl ? 'Top 3 by ' + sortLbl : '';
  }

  function renderMovers() {
    var host = document.getElementById('mhMv'); if (!host) return;
    // movers inside the current top 75 (low-major teams jump 100+ spots and drown out the teams people follow)
    var list = rows().slice(0, 75).map(function (tr) {
      var m = tr.querySelector('.ix-mv'); if (!m) return null;
      var n = parseInt(m.textContent.replace(/[^\d]/g, ''), 10); if (!n) return null;
      var t = team(tr); t.n = n; t.up = m.classList.contains('up'); t.title = m.getAttribute('title') || ''; return t;
    }).filter(Boolean);
    if (!list.length) { host.innerHTML = ''; host.style.display = 'none'; return; }
    host.style.display = '';
    var up = list.filter(function (x) { return x.up; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 6);
    var dn = list.filter(function (x) { return !x.up; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 4);
    var mv = document.getElementById('mvSel');
    var win = mv && mv.selectedOptions[0] ? mv.selectedOptions[0].textContent.replace(/[▲▼]/g, '').trim() : '';
    var chip = function (x) {
      return '<a class="mh-chip ' + (x.up ? 'up' : 'dn') + '" href="' + esc(x.href) + '" title="' + esc(x.title) + '">' +
        (x.logo ? '<img src="' + esc(x.logo) + '" alt="" onerror="this.remove()">' : '') + esc(x.name) + ' <b>' + (x.up ? '▲' : '▼') + x.n + '</b></a>';
    };
    var h = '<div class="mh-st"><span>Biggest movers · top 75</span><em>' + esc(win) + '</em></div><div class="mh-row">' + up.concat(dn).map(chip).join('') + '</div>';
    if (host.__h !== h) { host.__h = h; host.innerHTML = h; }
  }

  // Sort / Movement / Team search behind one button; Season, Real/Projected and Level stay out
  // everything but the season picker goes behind one Filters button (conference pills included)
  function foldFilters() {
    var fb = document.getElementById('filterBar'), fc = fb && fb.querySelector('.filter-controls'); if (!fc || fc.querySelector('.mh-more')) return;
    var lead = fc.querySelector('.f-lead'); if (!lead) return;
    [].slice.call(fc.children).forEach(function (e) { if (e !== lead) e.classList.add('mh-x'); });
    var pills = document.getElementById('filterPills'); if (pills) pills.classList.add('mh-x');
    var b = el('button', 'mh-more'); b.type = 'button';
    // how many filters differ from the defaults, so a narrowed table is never a surprise
    var sum = function () {
      var n = 0;
      var lv = document.querySelector('#levelSw button.on'); if (lv && lv.dataset.lv) n++;
      var cp = pills && pills.querySelector('.filter-btn.active'); if (cp && pills.querySelector('.filter-btn') !== cp) n++;
      var q = document.getElementById('searchInput'); if (q && q.value.trim()) n++;
      b.innerHTML = 'Filters' + (n ? ' <span>(' + n + ')</span>' : '') + ' <span>' + (fb.classList.contains('mh-open') ? '▴' : '▾') + '</span>';
    };
    b.onclick = function () { fb.classList.toggle('mh-open'); sum(); };
    lead.parentNode.insertBefore(b, lead.nextSibling);
    var q = document.getElementById('searchInput'); if (q) q.addEventListener('input', sum);
    new MutationObserver(debounce(sum, 60)).observe(fb, { subtree: true, attributes: true, attributeFilter: ['class'] });
    sum();
  }
  // live scores, movers, Top players and "New here" go below the rankings
  function moveBelow(mv) {
    var ts = document.querySelector('.table-section'); if (!ts) return;
    var after = ts;
    [document.getElementById('tdcLive'), mv, document.getElementById('showcase'), document.getElementById('whStrip')].forEach(function (n) {
      if (!n) return; n.classList.add('mh-after'); after.parentNode.insertBefore(n, after.nextSibling); after = n;
    });
  }

  var built = false;
  function build() {
    if (built) return;
    var fb = document.getElementById('filterBar'), tb = document.getElementById('rankingsList');
    if (!fb || !tb || !tb.querySelector('td.nm a')) return;
    built = true;
    if (!document.getElementById('mhCss')) { var st = el('style'); st.id = 'mhCss'; st.textContent = CSS; document.head.appendChild(st); }
    var mv = el('div', 'mh-mv'); mv.id = 'mhMv';
    foldFilters(); moveBelow(mv);
    var go = debounce(renderMovers, 120);
    new MutationObserver(go).observe(tb, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    var head = document.getElementById('rankHead'); if (head) new MutationObserver(go).observe(head, { childList: true, subtree: true, characterData: true });
    go();
  }
  function apply() { document.body.classList.toggle('mh', MQ.matches); if (MQ.matches) build(); }
  function start() {
    apply();
    if (!built) { var n = 0, iv = setInterval(function () { apply(); if (built || ++n > 80) clearInterval(iv); }, 250); }
    if (MQ.addEventListener) MQ.addEventListener('change', apply); else if (MQ.addListener) MQ.addListener(apply);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
