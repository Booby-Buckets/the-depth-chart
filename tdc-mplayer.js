/* tdc-mplayer.js — the phone layout of player.html (Oct 2026 mobile redesign, "F").
   One look on a phone: a compact header (eyebrow, name, season picker, one shaded
   OVR cell), small sheet tables only, and a Google-Sheets style tab strip pinned to
   the bottom. It re-arranges what player.html already renders; it does not fetch or
   compute stats of its own, so desktop and phone always show the same numbers.
   Phones only (≤640px): above that the page is untouched. */
(function () {
  var MQ = window.matchMedia('(max-width:640px)');
  var GROUPS = [
    { key: 'overview', label: 'Overview', tabs: ['overview'] },
    { key: 'stats', label: 'Stats', tabs: ['stats'] },
    { key: 'shots', label: 'Shots', tabs: ['shotcharts', 'shotflow', 'percentiles'] },
    { key: 'dna', label: 'DNA', tabs: ['playerdna'] },
    { key: 'scouting', label: 'Scouting', tabs: ['mscout', 'scout', 'dossier', 'role', 'devpath', 'scheme', 'portalfit'] },
    { key: 'nil', label: 'NIL', tabs: ['nil'] },
    { key: 'betting', label: 'Betting', tabs: ['betting'] },
    { key: 'buzz', label: 'Buzz', tabs: ['buzz'] }
  ];
  var SHOTS = [['shotcharts', 'Charts'], ['shotflow', 'Flow'], ['percentiles', 'Percentiles']];
  var SCOUT = [['scout', 'Scouting report', 'Grades, floor, ceiling'], ['dossier', 'Player dossier', 'Situational splits'],
    ['role', 'Role & fit', 'His role on this roster'], ['devpath', 'Development', 'Grade path by year'],
    ['scheme', 'Scheme lab', 'Same player, other systems'], ['portalfit', 'Portal fit', 'Best-fit programs']];

  var CSS = [
    'body.mp .pa-hero,body.mp .tab-row-wrap,body.mp #tdcSeasonSlot,body.mp .ovc-accent,body.mp .pa-legacy{display:none!important}',
    'body.mp{padding-bottom:calc(60px + env(safe-area-inset-bottom))}',
    '.mp-hero,.mp-strip,.mp-sub,#panel-mscout{display:none}',
    'body.mp .mp-hero{display:flex;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border);margin:0 0 14px}',
    'body.mp .tdc-explain{bottom:calc(62px + env(safe-area-inset-bottom))!important}body.mp #tdc-ver{display:none!important}',
    '.mp-id{flex:1;min-width:0}',
    /* team band: the team colour, darkened only as far as white text needs (--tc-band from applyTeamTheme) */
    'body.mp .mp-band{background:var(--tc-band,#1d2433);color:#fff;border-bottom:0;margin:0 0 14px;padding:14px;position:relative;overflow:hidden}',
    '.mp-band .mp-eye,.mp-band .mp-eye a{color:rgba(255,255,255,.78)}',
    '.mp-band .mp-name{color:#fff}',
    '.mp-band .mp-sel{background:rgba(0,0,0,.22);border-color:rgba(255,255,255,.35);color:#fff}',
    '.mp-band .mp-sel option{color:#111;background:#fff}',
    '.mp-band .mp-ovr{border-color:rgba(255,255,255,.45);background:#fff}',
    '.mp-band .mp-ovr span{background:rgba(0,0,0,.06);color:#555;border-bottom-color:rgba(0,0,0,.12)}',
    '.mp-band .mp-ovr b{color:#111}',
    '.mp-logo{flex:0 0 46px;height:46px;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;align-self:flex-start;margin-top:2px}',
    '.mp-logo img{width:36px;height:36px;object-fit:contain}',
    '.mp-eye{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mp-eye a{color:inherit;text-decoration:none}',
    '.mp-name{margin:4px 0 8px;font-family:"Playfair Display",Georgia,serif;font-size:28px;font-weight:800;line-height:1.05;color:var(--text)}',
    '.mp-sel{font:700 13px Inter,system-ui,sans-serif;color:var(--text);background:var(--bg2);border:1px solid var(--border2);border-radius:6px;padding:5px 8px;max-width:100%}',
    '.mp-ovr{flex:0 0 76px;border:1px solid var(--border2);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;align-self:stretch}',
    '.mp-ovr span{font-size:11px;font-weight:800;letter-spacing:.07em;color:var(--text3);background:var(--bg2);border-bottom:1px solid var(--border2);text-align:center;padding:5px 0}',
    '.mp-ovr b{flex:1;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--text);min-height:56px}',
    '.mp-c0{background-image:linear-gradient(hsla(0,70%,48%,.34),hsla(0,70%,48%,.34))}',
    '.mp-c1{background-image:linear-gradient(hsla(30,70%,48%,.15),hsla(30,70%,48%,.15))}',
    '.mp-c2{background-image:linear-gradient(hsla(95,70%,48%,.15),hsla(95,70%,48%,.15))}',
    '.mp-c3{background-image:linear-gradient(hsla(115,70%,48%,.26),hsla(115,70%,48%,.26))}',
    '.mp-c4{background-image:linear-gradient(hsla(125,70%,48%,.40),hsla(125,70%,48%,.40))}',
    /* bottom sheet tabs */
    'body.mp .mp-strip{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:60;height:calc(52px + env(safe-area-inset-bottom));padding-bottom:env(safe-area-inset-bottom);background:var(--bg2);border-top:1px solid var(--border2);overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}',
    '.mp-strip::-webkit-scrollbar{display:none}',
    '.mp-strip button{flex:0 0 auto;border:0;background:none;font:600 13px Inter,system-ui,sans-serif;color:var(--text2);padding:0 14px;margin:12px 0;border-right:1px solid var(--border);white-space:nowrap;cursor:pointer}',
    '.mp-strip button.on{background:var(--bg);color:var(--text);font-weight:800;border-top:3px solid var(--accent);border-right:0;margin:-1px 0 0}',
    /* sub-switch (Shots) and back row (Scouting tools) */
    'body.mp .mp-sub.show{display:flex}',
    '.mp-sub{border:1px solid var(--border2);border-radius:8px;overflow:hidden;margin:0 14px 14px}',
    '.mp-sub button{flex:1;border:0;border-right:1px solid var(--border);background:none;font:700 13px Inter,system-ui,sans-serif;color:var(--text2);padding:9px 0;cursor:pointer}',
    '.mp-sub button:last-child{border-right:0}',
    '.mp-sub button.on{background:var(--text);color:var(--bg)}',
    '.mp-sub.back{border:0;margin:0 0 10px}',
    '.mp-sub.back button{flex:0 0 auto;text-align:left;padding:4px 0;color:var(--accent)}',
    /* overview: one column of small sheets, in a fixed order */
    'body.mp #panel-overview[style*="block"],body.mp #panel-overview.active{display:flex!important;flex-direction:column;gap:18px}',
    'body.mp #panel-overview .pa-row3,body.mp #panel-overview .ovc{display:contents}',
    'body.mp #panel-overview .ovc-box{margin:0;padding:0;background:none;border:0;border-radius:0}',
    'body.mp #panel-overview .ovc-sl{font-size:11px;letter-spacing:.06em;margin:0 0 6px}',
    'body.mp #panel-overview .ovc-sl .sub{font-size:11px}',
    'body.mp #panel-overview .sheet-wrap{margin:0!important}',
    'body.mp [data-mp="read"],body.mp [data-mp="bottom"],body.mp [data-mp="shot"],body.mp [data-mp="fit"],body.mp [data-mp="jump"],body.mp [data-mp="trend"],body.mp #ovcFoot{display:none!important}',
    'body.mp [data-mp="stats"]{order:1}body.mp .mp-standing{order:2}body.mp [data-mp="skill"]{order:3}body.mp [data-mp="form"]{order:4}',
    'body.mp [data-mp="impact"]{order:5}body.mp [data-mp="amp"]{order:6}body.mp [data-mp="comps"]{order:7}',
    '.mp-standing{display:none}body.mp .mp-standing{display:block}',
    '.mp-bar{display:block;height:8px;border-radius:2px;background:var(--bg2);overflow:hidden;min-width:60px}',
    '.mp-bar i{display:block;height:100%;border-radius:2px}',
    '.mp-row{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px;font-weight:650;color:var(--text);text-decoration:none;background:var(--bg)}',
    '.mp-tag{font-size:11px;font-weight:800;color:var(--text2);border:1px solid var(--border2);border-radius:4px;padding:1px 6px;white-space:nowrap}',
    'body.mp [data-mp="comps"] .ovc-complink{display:flex;width:100%;justify-content:space-between;border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--bg);font:650 13px Inter,system-ui,sans-serif;color:var(--text)}',
    /* scouting menu */
    'body.mp #panel-mscout[style*="block"]{display:block!important}',
    '.mp-list{border:1px solid var(--border);border-radius:10px;overflow:hidden}',
    '.mp-list button{display:grid;grid-template-columns:1fr auto;gap:2px 10px;width:100%;text-align:left;border:0;border-bottom:1px solid var(--border);background:var(--bg);padding:10px 12px;cursor:pointer;font-family:Inter,system-ui,sans-serif}',
    '.mp-list button:nth-child(even){background:color-mix(in srgb,var(--text) 3.5%,var(--bg))}',
    '.mp-list button:last-child{border-bottom:0}',
    '.mp-list b{font-size:13.5px;font-weight:700;color:var(--text)}',
    '.mp-list small{grid-column:1;font-size:12px;color:var(--text3)}',
    '.mp-list .mp-tag{grid-row:1/span 2;grid-column:2;align-self:center}',
    '.mp-st{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin:0 0 6px}',
    /* every other tab: no explainer prose or legends — the tables carry the information */
    'body.mp .dna-read,body.mp .sheet-legend,body.mp .pd-legend,body.mp .ct-note,body.mp .bet-sub,body.mp .bet-cap,body.mp .buzz-note,' +
    'body.mp .nv-read,body.mp .nv-track-read,body.mp .sg-verdict,body.mp .sg-desc,body.mp .hc-foot,body.mp .si-detail,body.mp .statmode-bar label,' +
    'body.mp .statmode-bar [class*="pctl"],body.mp .statmode-bar [class*="toggle"],body.mp .gl-tier-head,body.mp .gl-chart-head{display:none!important}',
    /* one heading style */
    'body.mp .tab-panel .skill-section-title,body.mp .tab-panel .sec-title,body.mp .tab-panel .sg-title,body.mp .tab-panel .nilc-cmp-h,body.mp .tab-panel .gl-tier-head,' +
    'body.mp .tab-panel .gl-chart-head,body.mp .tab-panel .nil-chart-h{font:800 11px/1.3 Inter,system-ui,sans-serif!important;letter-spacing:.06em!important;text-transform:uppercase!important;' +
    'color:var(--text3)!important;margin:20px 0 6px!important;padding:0!important;border:0!important;background:none!important}',
    'body.mp .tab-panel .sec-title::after,body.mp .tab-panel .skill-section-title::after{display:none!important}',
    /* one toggle style */
    'body.mp .tab-panel .seg.sm,body.mp .statmode-row{display:flex!important;width:100%;border:1px solid var(--border2);border-radius:8px;overflow:hidden;padding:0!important;gap:0!important;background:none!important;margin:0 0 12px}',
    'body.mp .tab-panel .seg.sm button,body.mp .statmode-row button{flex:1;border:0!important;border-right:1px solid var(--border)!important;border-radius:0!important;background:none!important;' +
    'font:700 13px Inter,system-ui,sans-serif!important;color:var(--text2)!important;padding:8px 4px!important;margin:0!important;box-shadow:none!important}',
    'body.mp .tab-panel .seg.sm button:last-child,body.mp .statmode-row button:last-child{border-right:0!important}',
    'body.mp .tab-panel .seg.sm button.on,body.mp .statmode-row button.active{background:var(--text)!important;color:var(--bg)!important}',
    /* stat tiles read as one grid of cells, not separate cards */
    'body.mp .dd-band,body.mp :has(> .si-card){gap:0!important;border:1px solid var(--border);border-radius:10px;overflow:hidden}',
    'body.mp .dd-band > *,body.mp .si-card{border-radius:0!important;border:0!important;border-right:1px solid var(--border)!important;border-bottom:1px solid var(--border)!important;' +
    'box-shadow:none!important;margin:0!important;background:var(--bg)!important}',
    /* shot genome + consistency: rows of a sheet, not stacked cards */
    'body.mp .sg-card{padding:0!important;background:none!important;border:0!important;box-shadow:none!important;margin:0 0 18px!important}',
    'body.mp .sg-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 6px}',
    'body.mp .sg-head .sg-title{font:800 11px Inter,system-ui,sans-serif!important;letter-spacing:.06em!important;text-transform:uppercase;color:var(--text3)!important;margin:0!important}',
    'body.mp .sg-type{font-size:11px!important;padding:2px 7px!important}',
    'body.mp .sg-grid{display:block!important;border:1px solid var(--border);border-radius:10px;overflow:hidden}',
    'body.mp .sg-metric{display:grid!important;grid-template-columns:1fr auto auto;gap:12px;align-items:center;padding:8px 10px!important;margin:0!important;border:0!important;border-bottom:1px solid var(--border)!important;border-radius:0!important;background:var(--bg)!important}',
    'body.mp .sg-metric:nth-child(even){background:color-mix(in srgb,var(--text) 3.5%,var(--bg))!important}',
    'body.mp .sg-metric:last-child{border-bottom:0!important}',
    'body.mp .sg-mlbl{font:650 13px Inter,system-ui,sans-serif!important;text-transform:none!important;letter-spacing:0!important;color:var(--text)!important;text-decoration:none!important}',
    'body.mp .sg-mval{font:800 13.5px Inter,system-ui,sans-serif!important;text-align:right}',
    'body.mp .sg-pctl{font-size:12px!important;text-align:right;white-space:nowrap;color:var(--text2)!important;margin:0!important}',
    'body.mp .sg-msub,body.mp .sg-bar,body.mp .heat-mini-track,body.mp .heat-mini-scale,body.mp .hc-track{display:none!important}',
    'body.mp .hc-body{display:grid!important;grid-template-columns:1fr 1fr;border:1px solid var(--border);border-radius:10px;overflow:hidden;gap:0!important}',
    'body.mp .hc-gauge,body.mp .hc-range{padding:10px!important;margin:0!important;background:var(--bg)!important;border:0!important}',
    'body.mp .hc-gauge{border-right:1px solid var(--border)!important}',
    'body.mp .hc-num{font-size:26px!important}',
    /* folded charts */
    '.mp-fold{display:none!important}',
    'body.mp .mp-unfold{display:flex;width:100%;margin:10px 0;cursor:pointer;font-family:Inter,system-ui,sans-serif}'
  ].join('\n');

  // charts that fold behind one row on a phone: [selector, label]
  var FOLDS = [['.ct-wrap', 'Career trajectory chart'], ['.gl-chart', 'Game rating chart'], ['.gl-tier-grid', 'By opponent tier'],
    ['.nil-chart', 'Value curve chart']];
  function foldCharts() {
    if (!document.body.classList.contains('mp')) return;
    FOLDS.forEach(function (f) {
      document.querySelectorAll('.tab-panel ' + f[0]).forEach(function (n) {
        if (n.__mpFold) return; n.__mpFold = true;
        // the chart's own title and legend fold with it; the row names it instead
        var group = [n], prev = n.previousElementSibling;
        while (prev && prev.matches('.ct-legend,.sec-title,.nil-chart-h')) { group.push(prev); prev = prev.previousElementSibling; }
        group.forEach(function (g) { g.classList.add('mp-fold'); });
        var b = el('button', 'mp-row mp-unfold', '<span>' + f[1] + '</span><span class="mp-tag">Show</span>'); b.type = 'button';
        b.onclick = function () {
          var open = n.classList.contains('mp-fold');
          group.forEach(function (g) { g.classList.toggle('mp-fold', !open); });
          b.querySelector('.mp-tag').textContent = open ? 'Hide' : 'Show';
        };
        n.parentNode.insertBefore(b, group[group.length - 1]);
      });
    });
  }

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ovrBucket(g) { g = parseFloat(g); if (isNaN(g)) return ''; return g >= 85 ? 'mp-c4' : g >= 80 ? 'mp-c3' : g >= 75 ? 'mp-c2' : g >= 70 ? 'mp-c1' : 'mp-c0'; }
  function pctBucket(p) { return p >= 80 ? 4 : p >= 60 ? 3 : p >= 40 ? 2 : p >= 20 ? 1 : 0; }
  var BAR = ['hsla(0,70%,48%,.75)', 'hsla(30,70%,48%,.6)', 'hsla(95,60%,45%,.6)', 'hsla(115,60%,42%,.7)', 'hsla(125,65%,40%,.8)'];
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms || 60); }; }
  function watch(node, fn) { if (!node) return; var d = debounce(fn, 80); new MutationObserver(d).observe(node, { childList: true, subtree: true, characterData: true }); fn(); }
  function gateOf(t) { try { return (window.TAB_GATE || {})[t] || (typeof TAB_GATE !== 'undefined' ? TAB_GATE[t] : null); } catch (e) { return null; } }
  function entitled(t) { var g = gateOf(t); if (!g || !window.TDCGate || !TDCGate.has) return true; try { return TDCGate.has(g.tier); } catch (e) { return true; } }
  function planLabel(t) { var g = gateOf(t); return g ? ({ premium: 'Premium', pro: 'Pro', coach: "Coach's Tier" }[g.tier] || g.tier) : ''; }
  var LOCK = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" style="vertical-align:-1px;margin-right:4px"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 018 0v4"></path></svg>';

  var built = false, current = 'overview';

  function groupOf(t) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].tabs.indexOf(t) >= 0) return GROUPS[i]; return GROUPS[0]; }

  /* ── header ─────────────────────────────────────────────── */
  function buildHero() {
    var hs = document.getElementById('heroSection'); if (!hs || hs.querySelector('.mp-hero')) return;
    var p = (typeof player !== 'undefined') ? player : null; if (!p) return;
    var td = (typeof teamData !== 'undefined') ? teamData : null;
    var fromEl = hs.querySelector('.pa-from');
    var bits = [];
    bits.push('<a href="team.html?team=' + encodeURIComponent(p.team || '') + '">' + esc(p.team || '—') + '</a>');
    if (td && td.conf) bits.push(esc(td.conf));
    if (p.position) bits.push(esc(p.position));
    var yr = p.yr || p.class_year; if (yr) bits.push(esc(yr));
    if (fromEl) bits.push(esc(fromEl.textContent.trim()));
    var tc = (window.tdcTeamColor && window.tdcTeamColor(p.team)) || {};
    var hero = el('div', 'mp-hero mp-band',
      (tc.logo ? '<a class="mp-logo" href="team.html?team=' + encodeURIComponent(p.team || '') + '"><img src="' + tc.logo + '" alt="" onerror="this.parentNode.remove()"></a>' : '') +
      '<div class="mp-id"><div class="mp-eye">' + bits.join(' · ') + '</div>' +
      '<h1 class="mp-name">' + esc(p.name) + '</h1><span class="mp-selhost"></span></div>' +
      '<div class="mp-ovr"><span>OVR</span><b id="mpOvr">—</b></div>');
    hs.insertBefore(hero, hs.firstChild);
    watch(document.getElementById('heroGrade'), function () {
      var g = (document.getElementById('heroGrade') || {}).textContent || '—';
      var b = document.getElementById('mpOvr'); if (!b) return;
      b.textContent = g.trim(); b.className = ovrBucket(g);
    });
    mirrorSeason();
  }
  // mirror the page's season <select> into the header (the original keeps its listeners)
  function mirrorSeason() {
    var host = document.querySelector('.mp-selhost'); var src = document.getElementById('ovrSeasonSel');
    if (!host) return;
    if (!src) { setTimeout(mirrorSeason, 400); return; }
    var sel = document.createElement('select'); sel.className = 'mp-sel'; sel.setAttribute('aria-label', 'Select season');
    function sync() { sel.innerHTML = src.innerHTML; sel.value = src.value; }
    sync(); new MutationObserver(sync).observe(src, { childList: true, subtree: true, attributes: true });
    src.addEventListener('change', function () { sel.value = src.value; });
    sel.addEventListener('change', function () { src.value = sel.value; src.dispatchEvent(new Event('change', { bubbles: true })); if (typeof src.onchange === 'function' && !src.__mpFired) { } });
    host.innerHTML = ''; host.appendChild(sel);
  }

  /* ── bottom strip + sub nav ─────────────────────────────── */
  function buildStrip() {
    if (document.querySelector('.mp-strip')) return;
    var nav = el('nav', 'mp-strip'); nav.setAttribute('aria-label', 'Player sections');
    GROUPS.forEach(function (g) {
      var b = el('button', '', esc(g.label)); b.type = 'button'; b.dataset.g = g.key;
      b.onclick = function () { openGroup(g.key); };
      nav.appendChild(b);
    });
    document.body.appendChild(nav);
    var row = document.querySelector('.tab-row-wrap');
    var sub = el('div', 'mp-sub'); sub.id = 'mpSub';
    if (row && row.parentNode) row.parentNode.insertBefore(sub, row.nextSibling);
    // the scouting menu panel lives with the other panels
    var ov = document.getElementById('panel-overview');
    if (ov && !document.getElementById('panel-mscout')) {
      var pn = el('div', 'tab-panel'); pn.id = 'panel-mscout'; pn.style.display = 'none';
      var h = '<div class="mp-st">Scouting reports</div><div class="mp-list">';
      SCOUT.forEach(function (s) {
        var tag = entitled(s[0]) ? '<span class="mp-tag">Open ›</span>' : '<span class="mp-tag">' + LOCK + planLabel(s[0]) + '</span>';
        h += '<button type="button" data-t="' + s[0] + '"><b>' + esc(s[1]) + '</b>' + tag + '<small>' + esc(s[2]) + '</small></button>';
      });
      pn.innerHTML = h + '</div>';
      pn.addEventListener('click', function (e) { var b = e.target.closest('button[data-t]'); if (b) window.switchTab(b.dataset.t); });
      ov.parentNode.insertBefore(pn, ov.nextSibling);
    }
  }
  function openGroup(key) {
    var g = GROUPS.filter(function (x) { return x.key === key; })[0]; if (!g) return;
    if (key === 'scouting') { showScoutMenu(); return; }
    window.switchTab(g.tabs[0]);
    window.scrollTo({ top: 0 });
  }
  function showScoutMenu() {
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active', 'entering', 'leaving'); p.style.display = 'none'; });
    var pn = document.getElementById('panel-mscout'); if (pn) { pn.style.display = 'block'; pn.classList.add('active'); }
    setActive('mscout'); window.scrollTo({ top: 0 });
  }
  function setActive(t) {
    current = t;
    var g = groupOf(t);
    document.querySelectorAll('.mp-strip button').forEach(function (b) {
      var on = b.dataset.g === g.key; b.classList.toggle('on', on);
      if (on && b.scrollIntoView) { var s = b.parentNode, r = b.getBoundingClientRect(); if (r.left < 0 || r.right > window.innerWidth) s.scrollLeft += r.left - 40; }
    });
    var sub = document.getElementById('mpSub'); if (!sub) return;
    if (g.key === 'shots') {
      sub.className = 'mp-sub show';
      sub.innerHTML = SHOTS.map(function (s) { return '<button type="button" data-t="' + s[0] + '" class="' + (s[0] === t ? 'on' : '') + '">' + s[1] + '</button>'; }).join('');
    } else if (g.key === 'scouting' && t !== 'mscout') {
      sub.className = 'mp-sub back show';
      sub.innerHTML = '<button type="button" data-back="1">‹ All scouting reports</button>';
    } else { sub.className = 'mp-sub'; sub.innerHTML = ''; }
    sub.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.back) showScoutMenu(); else if (b.dataset.t) window.switchTab(b.dataset.t);
    };
  }
  function hookSwitch() {
    if (window.switchTab && window.switchTab.__mp) return;
    var orig = window.switchTab; if (typeof orig !== 'function') return;
    var w = function (t) {
      var pn = document.getElementById('panel-mscout'); if (pn) { pn.style.display = 'none'; pn.classList.remove('active'); }
      var r = orig.apply(this, arguments);
      setActive(t === 'rankings' ? 'percentiles' : t);
      return r;
    };
    w.__mp = true; window.switchTab = w;
  }

  /* ── overview: tag the boxes, add Standing, tidy the rest ── */
  var BOX = { ovcRead: 'read', ovcComps: 'comps', ovcBottom: 'bottom', ovrCards: 'stats', ovcShot: 'shot', ovcForm: 'form', ovcFit: 'fit',
    skillSheet: 'skill', ovcJump: 'jump', ovcTrend: 'trend', impactSection: 'impact', ovcAmplifier: 'amp' };
  function tagBoxes() {
    Object.keys(BOX).forEach(function (id) { var e = document.getElementById(id); var b = e && e.closest('.ovc-box'); if (b) b.setAttribute('data-mp', BOX[id]); });
    var sk = document.querySelector('[data-mp="skill"] .ovc-sl'); if (sk && sk.firstChild && sk.firstChild.nodeType === 3) sk.firstChild.textContent = 'Strengths & weaknesses ';
    var ip = document.querySelector('[data-mp="impact"] .ovc-sl'); if (ip && ip.firstChild && ip.firstChild.nodeType === 3) ip.firstChild.textContent = 'Impact ';
    var ov = document.getElementById('panel-overview');
    if (ov && !ov.querySelector('.mp-standing')) { var s = el('div', 'mp-standing'); s.id = 'mpStanding'; ov.appendChild(s); }
  }
  function txt(sel) { var e = document.querySelector(sel); return e ? e.textContent.trim() : ''; }
  function renderStanding() {
    var host = document.getElementById('mpStanding'); if (!host) return;
    var rank = txt('#paRankPlayer b'), rankOf = (txt('#paRankPlayer').match(/of ([\d,]+)/) || [])[1];
    var last = txt('#paRankLast b');
    var wa = ''; var w = document.querySelector('#impactSection tbody tr td.strong'); if (w) wa = w.textContent.trim();
    var bb = (txt('#ovcFoot .bb').match(/#(\d+)/) || [])[1];
    var nil = window._ovcNil || '';
    var cols = [];
    if (rank) cols.push(['Rank', rank, rankOf ? 'of ' + rankOf : '']);
    if (last) cols.push(['Last OVR', last, '', ovrBucket(last)]);
    if (wa) cols.push(['Wins add.', wa, '']);
    if (bb) cols.push(['Big Board', '#' + bb, '']);
    if (nil) cols.push(['NIL', nil, '']);
    if (!cols.length) { host.innerHTML = ''; return; }
    var h = '<div class="ovc-sl">Standing</div><div class="sheet-wrap" style="max-height:none"><table class="sheet dense" style="width:100%"><thead><tr>' +
      cols.map(function (c) { return '<th class="c">' + c[0] + '</th>'; }).join('') + '</tr></thead><tbody><tr>' +
      cols.map(function (c) { return '<td class="c strong ' + (c[3] ? c[3].replace('mp-c', 'c') : '') + '">' + esc(c[1]) + '</td>'; }).join('') + '</tr></tbody></table></div>';
    if (host.__h !== h) { host.__h = h; host.innerHTML = h; }
  }
  // percentile table → add an in-cell bar column (the only "chart" on the page)
  function barSkill() {
    var t = document.querySelector('#skillSheet table'); if (!t || t.dataset.mpBars) return;
    t.dataset.mpBars = '1';
    var hr = t.querySelector('thead tr'); if (hr && hr.children.length === 2) { var th = document.createElement('th'); th.className = 'l'; hr.insertBefore(th, hr.children[1]); }
    t.querySelectorAll('tbody tr').forEach(function (tr) {
      if (tr.children.length !== 2) return;
      var p = parseFloat(tr.children[1].textContent); var td = document.createElement('td'); td.className = 'l'; td.style.width = '45%';
      if (!isNaN(p)) td.innerHTML = '<span class="mp-bar"><i style="width:' + Math.max(2, Math.min(100, p)) + '%;background:' + BAR[pctBucket(p)] + '"></i></span>';
      tr.insertBefore(td, tr.children[1]);
    });
  }
  // locked Lineup Amplifier: one row with a plan tag instead of a paragraph
  function tidyAmp() {
    var a = document.getElementById('ovcAmplifier'); if (!a) return;
    var lock = a.querySelector('a[href*="pricing.html"]');
    if (lock && !a.querySelector('.mp-row')) {
      a.innerHTML = '<a class="mp-row" href="' + lock.getAttribute('href') + '"><span>Lineup amplifier</span><span class="mp-tag">' + LOCK + "Coach's Tier</span></a>";
      var sl = a.closest('.ovc-box') && a.closest('.ovc-box').querySelector('.ovc-sl'); if (sl) sl.style.display = 'none';
    }
  }

  function build() {
    if (built) return;
    var hs = document.getElementById('heroSection');
    if (!hs || !hs.querySelector('.pa-hero') || !document.getElementById('panel-overview')) return;
    built = true;
    if (!document.getElementById('mpCss')) { var st = el('style'); st.id = 'mpCss'; st.textContent = CSS; document.head.appendChild(st); }
    buildHero(); buildStrip(); hookSwitch(); tagBoxes();
    watch(document.getElementById('skillSheet'), barSkill);
    watch(document.getElementById('ovcAmplifier'), tidyAmp);
    var st2 = debounce(renderStanding, 120);
    ['paRanks', 'impactSection', 'ovcFoot'].forEach(function (id) { watch(document.getElementById(id), st2); });
    var act = document.querySelector('.tab-panel.active'); setActive(act ? act.id.replace('panel-', '') : 'overview');
    var ov = document.getElementById('panel-overview'); if (ov && ov.parentNode) watch(ov.parentNode, debounce(foldCharts, 150));
  }
  function apply() { document.body.classList.toggle('mp', MQ.matches); if (MQ.matches) build(); }

  function start() {
    var hs = document.getElementById('heroSection');
    if (hs) new MutationObserver(function () { if (MQ.matches && !built) build(); }).observe(hs, { childList: true });
    apply();
    if (MQ.addEventListener) MQ.addEventListener('change', apply); else if (MQ.addListener) MQ.addListener(apply);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
