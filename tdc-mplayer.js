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
    { key: 'dna', label: 'DNA', tabs: ['playerdna'] },
    { key: 'shots', label: 'Shots', tabs: ['shotcharts', 'shotgenome', 'shotflow', 'percentiles'] },
    { key: 'scouting', label: 'Scouting', tabs: ['mscout', 'scout', 'dossier', 'role', 'devpath', 'scheme', 'portalfit'] },
    { key: 'nil', label: 'NIL', tabs: ['nil'] },
    { key: 'betting', label: 'Betting', tabs: ['betting'] },
    { key: 'buzz', label: 'Buzz', tabs: ['buzz'] }
  ];
  var SHOTS = [['shotcharts', 'Charts'], ['shotgenome', 'Genome'], ['shotflow', 'Flow'], ['percentiles', 'Percentiles']];
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
    /* header, design C1 "profile split": faint crest watermark, logo eyebrow, name + shaded OVR seal,
       labelled bio, a 3-cell rank row, the season picker, then a 4-stat line with +/- vs the season before */
    'body.mp .mp-hero{display:block;position:relative;overflow:hidden;padding:16px 14px 0;border-bottom:1px solid var(--border);margin:0 0 16px;background:var(--card,var(--bg))}',
    '.mp-wm{position:absolute;right:-34px;top:-34px;width:180px;height:180px;object-fit:contain;opacity:.07;pointer-events:none}',
    ':root[data-theme="dark"] .mp-wm{opacity:.06}',
    '.mp-eye{position:relative;display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mp-eye img{width:17px;height:17px;object-fit:contain;flex:none}',
    '.mp-eye a{color:var(--tc-readable,var(--text2));text-decoration:none}',
    '.mp-t2{position:relative;display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-top:6px}',
    '.mp-id{flex:1;min-width:0}',
    '.mp-name{margin:0 0 8px;font-family:"Playfair Display",Georgia,serif;font-size:30px;font-weight:800;line-height:1;letter-spacing:-.02em;color:var(--text)}',
    '.mp-bio{display:flex;flex-wrap:wrap;gap:4px 14px}',
    '.mp-bio div{font-size:12.5px;font-weight:600;color:var(--text)}',
    '.mp-bio b{display:block;font-size:8.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text3)}',
    '.mp-ovr{flex:none;min-width:72px;border:1px solid var(--border2);border-radius:9px;padding:6px 10px;text-align:center;background-color:var(--card,var(--bg))}',
    '.mp-ovr b{display:block;font-size:32px;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums;color:var(--text)}',
    '.mp-ovr span{font-size:8.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text3)}',
    '.mp-rk{position:relative;display:flex;border:1px solid var(--border2);border-radius:8px;overflow:hidden;margin-top:12px;background:var(--card,var(--bg))}',
    '.mp-rk:empty{display:none}',
    '.mp-rk div{flex:1;text-align:center;padding:6px 4px;border-left:1px solid var(--border2);font-size:11px;color:var(--text2);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mp-rk div:first-child{border-left:0}',
    '.mp-rk b{display:block;font-size:15px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums}',
    '.mp-selrow{position:relative;margin-top:10px}.mp-selrow .mp-sel{width:100%;padding:8px 10px;font-size:14px}',
    '.mp-sel{font:700 13px Inter,system-ui,sans-serif;color:var(--text);background:var(--bg2);border:1px solid var(--border2);border-radius:6px;padding:5px 8px;max-width:100%}',
    '.mp-line{position:relative;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:12px -14px 0;border-top:1px solid var(--border);background:var(--bg2)}',
    '.mp-line div{padding:8px 10px 9px;border-left:1px solid var(--border);min-width:0;white-space:nowrap}',
    '.mp-line div:first-child{border-left:0}',
    '.mp-line span{display:block;font-size:8.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text3)}',
    '.mp-line b{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--text)}',
    '.mp-line em{font-style:normal;font-size:10.5px;font-weight:700;margin-left:3px}',
    '.mp-c0{background-image:linear-gradient(hsla(0,70%,48%,.34),hsla(0,70%,48%,.34))}',
    '.mp-c1{background-image:linear-gradient(hsla(30,70%,48%,.15),hsla(30,70%,48%,.15))}',
    '.mp-c2{background-image:linear-gradient(hsla(95,70%,48%,.15),hsla(95,70%,48%,.15))}',
    '.mp-c3{background-image:linear-gradient(hsla(115,70%,48%,.26),hsla(115,70%,48%,.26))}',
    '.mp-c4{background-image:linear-gradient(hsla(125,70%,48%,.40),hsla(125,70%,48%,.40))}',
    /* header, "team band" (Oct 2026, owner picked mockup 1 of _mockups/player-header-mobile.html): team colour only in
       the band, name in Playfair, every bio fact on one line, OVR in a white tile with last season under it; then a
       five-stat strip shaded by the player's D-I rank, one swipeable row of context chips, the season as a pill */
    'body.mp .mp-hero.mpb{padding:0;border:0;margin:0 0 14px;background:none;overflow:visible}',
    '.mpb .mpb-band{position:relative;overflow:hidden;background:var(--mpb-band,#1a1814);color:#fff;padding:14px 100px 16px 14px;min-height:118px}',
    '.mpb .mp-wm{right:-28px;top:-24px;width:170px;height:170px;opacity:.13!important;filter:brightness(0) invert(1)}',
    '.mpb .mp-eye{color:rgba(255,255,255,.86);font-size:10.5px}.mpb .mp-eye a{color:#fff}',
    '.mpb .mp-eye img{width:20px;height:20px;background:#fff;border-radius:50%;padding:2px}',
    '.mpb .mp-name{color:#fff;font-size:29px;line-height:1.02;margin:7px 0 5px}',
    '.mpb-meta{position:relative;font-size:12.5px;line-height:1.4;color:rgba(255,255,255,.9)}',
    '.mpb-ovr{position:absolute;right:14px;top:30px;width:76px;text-align:center;background:#fff;color:#14120f;border-radius:10px;padding:7px 0 6px;box-shadow:0 2px 10px rgba(0,0,0,.18)}',
    '.mpb-ovr b{display:block;font:800 34px/1 "Playfair Display",Georgia,serif;color:#14120f}',
    '.mpb-ovr span{font:800 8.5px Inter,system-ui,sans-serif;letter-spacing:.14em;color:#8a867a}',
    '.mpb-ovr em{display:block;font:700 10px Inter,system-ui,sans-serif;font-style:normal;margin-top:2px;color:#8a867a}',
    '.mpb-ovr em.dn{color:#c0392b}.mpb-ovr em.up{color:#1f8a45}',
    '.mpb-sub{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px 7px}',
    '.mpb-sub b{font:800 10px Inter,system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:var(--text3)}',
    '.mpb-sub .mp-sel{flex:none;width:auto;min-width:170px;max-width:62%;font:700 12px Inter,system-ui,sans-serif;border-radius:999px;padding:5px 26px 5px 11px;background-color:var(--bg)}',
    '.mpb .mp-line{grid-template-columns:repeat(5,minmax(0,1fr));margin:0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--bg)}',
    '.mpb .mp-line div{padding:8px 3px 7px;text-align:center}',
    '.mpb .mp-line span{font-size:9px;letter-spacing:.09em}',
    '.mpb .mp-line b{display:block;font-size:18.5px;margin-top:1px}',
    '.mpb .mp-line i{display:block;font:700 10px Inter,system-ui,sans-serif;font-style:normal;color:var(--text2);margin-top:1px}',
    '.mpb .mp-line em{display:block;margin:1px 0 0;font-size:10px}',
    '.mpb-chips{display:flex;gap:6px;overflow-x:auto;padding:10px 14px;border-bottom:1px solid var(--border);scrollbar-width:none}',
    '.mpb-chips::-webkit-scrollbar{display:none}.mpb-chips:empty{display:none}',
    '.mpb-chips span{flex:none;font:600 11.5px Inter,system-ui,sans-serif;border:1px solid var(--border2);border-radius:999px;padding:5px 10px;color:var(--text2);white-space:nowrap}',
    '.mpb-chips b{color:var(--text);font-weight:800}',
    /* bottom sheet tabs */
    'body.mp .mp-strip{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:60;height:calc(64px + env(safe-area-inset-bottom));padding:0 0 env(safe-area-inset-bottom);background:var(--bg2);border-top:1px solid var(--border2);overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;box-shadow:0 -4px 14px rgba(0,0,0,.08)}',
    '.mp-strip::-webkit-scrollbar{display:none}',
    '.mp-strip button{flex:1 0 78px;min-width:78px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:0;border-top:3px solid transparent;background:none;font:600 12.5px Inter,system-ui,sans-serif;color:var(--text2);padding:6px 8px 4px;white-space:nowrap;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.mp-strip button svg{width:22px;height:22px;flex:none}',
    '.mp-strip button.on{background:color-mix(in srgb,var(--accent) 16%,var(--bg2));color:var(--text);font-weight:800;border-top-color:var(--accent)}',
    'body.mp{padding-bottom:calc(72px + env(safe-area-inset-bottom))!important}',
    'body.mp .tdc-explain{bottom:calc(74px + env(safe-area-inset-bottom))!important}',
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
    '.mp-standing{display:none!important}',
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
    'body.mp .dna-read,body.mp .sheet-legend,body.mp .pd-legend,body.mp .bet-sub,body.mp .bet-cap,body.mp .buzz-note,' +
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
  var FOLDS = [['.gl-chart', 'Game rating chart'], ['.gl-tier-grid', 'By opponent tier'],
    ['.nil-chart', 'Value curve chart']];
  function foldCharts() {
    if (!document.body.classList.contains('mp')) return;
    FOLDS.forEach(function (f) {
      document.querySelectorAll('.tab-panel ' + f[0]).forEach(function (n) {
        if (n.__mpFold) return; n.__mpFold = true;
        // the chart's own title and legend fold with it; the row names it instead
        var group = [n], prev = n.previousElementSibling;
        while (prev && prev.matches('.sec-title,.nil-chart-h')) { group.push(prev); prev = prev.previousElementSibling; }
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

  var TAB_ICON = {"overview": "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", "stats": "M5 20V11M12 20V5M19 20v-7M3 20h18", "shots": "M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8zM12 11.5v1", "dna": "M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12M8 7h8M8 17h8", "scouting": "M9 4h6v3H9zM7 5H5v16h14V5h-2M8 12h8M8 16h5", "nil": "M12 3v18M16 7.5c0-1.9-1.8-3-4-3s-4 1.1-4 3 1.8 2.6 4 3 4 1.1 4 3-1.8 3-4 3-4-1.1-4-3", "betting": "M4 7h16v3a2 2 0 000 4v3H4v-3a2 2 0 000-4zM14 7v10", "buzz": "M4 10v4h3l6 4V6L7 10zM17 9a4 4 0 010 6"};
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
    var tc = (window.tdcTeamColor && window.tdcTeamColor(p.team)) || {};
    var href = 'team.html?team=' + encodeURIComponent(p.team || '');
    var eye = '<a href="' + href + '">' + esc(p.team || '—') + '</a>' + (td && td.conf ? ' · ' + esc(td.conf) : '') +
      (fromEl ? ' · <span class="mp-from">' + esc(fromEl.textContent.trim()) + '</span>' : '');
    var bio = [];
    if (p.position) bio.push(['Pos', p.position2 ? p.position + '/' + p.position2 : p.position]);
    var yr = p.yr || p.class_year; if (yr) bio.push(['Class', yr]);
    if (p.height) bio.push(['Ht', p.height]);
    var meta = bio.map(function (x) { return esc(x[1]); });
    if (fromEl) meta.push('<span class="mp-from">' + esc(fromEl.textContent.trim()) + '</span>');
    var band = (window.tdcBandColor && tc.c1) ? window.tdcBandColor(tc.c1) : (tc.c1 || '#1a1814');
    var hero = el('div', 'mp-hero mpb',
      '<div class="mpb-band" style="--mpb-band:' + band + '">' +
      (tc.logo ? '<img class="mp-wm" src="' + tc.logo + '" alt="" aria-hidden="true" onerror="this.remove()">' : '') +
      '<div class="mp-eye">' + (tc.logo ? '<img src="' + tc.logo + '" alt="" onerror="this.remove()">' : '') +
      '<span><a href="' + href + '">' + esc(p.team || '—') + '</a>' + (td && td.conf ? ' · ' + esc(td.conf) : '') + '</span></div>' +
      '<h1 class="mp-name">' + esc(p.name) + '</h1><div class="mpb-meta">' + meta.join(' · ') + '</div>' +
      '<div class="mpb-ovr" id="mpOvr"><b>—</b><span>OVR</span><em id="mpOvrD"></em></div></div>' +
      '<div class="mpb-sub"><b id="mpLineLbl">D-I rank</b><span class="mp-selhost"></span></div>' +
      '<div class="mp-line" id="mpLine"></div><div class="mpb-chips" id="mpChips"></div>');
    hero.setAttribute('data-type-keep', '');   // tdc-mobile.js snaps text sizes; the band sets its own
    hs.insertBefore(hero, hs.firstChild);
    var upd = debounce(renderLine, 80);
    watch(document.getElementById('heroGrade'), upd);
    watch(document.getElementById('paProj'), upd);
    watch(document.getElementById('paRanks'), upd);
    renderLine();
    mirrorSeason();
  }
  // OVR seal, ranks and the line for the selected season, read from the desktop hero the page keeps updating
  // D-I rank of a projected stat among rotation players (10+ projected minutes) — the same pool the OVR rank uses
  var POOL = null, POOLP = null;
  function loadPool() {
    if (POOLP) return POOLP;
    POOLP = fetch('scripts/data/stat_overall_projected.json?v=93').then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { var P = (j && j.players) || {}; POOL = Object.keys(P).map(function (k) { return P[k]; }).filter(function (v) { return v && (+v.mpg || 0) >= 10; }); renderLine(); })
      .catch(function () { POOL = []; });
    return POOLP;
  }
  var RK = { PPG: ['ppg'], RPG: ['rpg'], APG: ['apg'], MPG: ['mpg'], '3P%': ['tp_pct', function (v) { return (+v.tpa || 0) >= 1.5; }] };
  function rankOf(k, val) {
    var d = RK[k]; if (!POOL || !d || !isFinite(val)) return null;
    var pool = d[1] ? POOL.filter(d[1]) : POOL, n = pool.length; if (n < 50) return null;
    var above = 0; pool.forEach(function (v) { var x = parseFloat(v[d[0]]); if (isFinite(x) && x > val + 1e-9) above++; });
    return { r: above + 1, n: n, pc: Math.round(100 * (1 - above / n)) };
  }
  // OVR tile, the stat strip and the chips, read from the desktop hero the page keeps updating
  function renderLine() {
    var host = document.getElementById('mpLine'); if (!host) return;
    var g = txt('#heroGrade') || '—', o = document.getElementById('mpOvr');
    if (o) o.firstChild.textContent = g;
    var past = !!document.querySelector('.pa-hero.pc-past');
    var last = txt('#paRankLast b'), od = document.getElementById('mpOvrD');
    if (od) { var dg = parseFloat(g), dl = parseFloat(last);
      var dh = (!past && isFinite(dg) && isFinite(dl) && dg !== dl) ? (dg < dl ? '▼' : '▲') + ' from ' + dl : (!past && isFinite(dl) ? 'same as last yr' : '');
      od.className = (!past && isFinite(dg) && isFinite(dl)) ? (dg < dl ? 'dn' : dg > dl ? 'up' : '') : ''; od.textContent = dh; }
    var fr = document.querySelector('.mp-hero .mp-from'); if (fr) fr.style.display = past ? 'none' : '';
    var sel = document.querySelector('.mpb-sub .mp-sel'), lbl = document.getElementById('mpLineLbl');
    var isProj = !past;
    if (lbl) lbl.textContent = isProj ? 'D-I rank' : 'Change vs year before';
    if (isProj) loadPool();
    var cells = [], want = ['PPG', 'RPG', 'APG', '3P%', 'MPG'], lab = { PPG: 'PTS', RPG: 'REB', APG: 'AST', '3P%': '3P%', MPG: 'MIN' };
    var by = {};
    document.querySelectorAll('#paProj .pa-big').forEach(function (b) { var k = ((b.querySelector('.pa-k') || {}).textContent || '').trim().toUpperCase(); by[k] = b; });
    want.forEach(function (k) {
      var b = by[k]; if (!b) return;
      var v = ((b.querySelector('.pa-bv') || {}).textContent || '—').trim(), em = b.querySelector('em'), sub = '', cls = '';
      if (isProj) { var rr = rankOf(k, parseFloat(v)); if (rr) { sub = '<i>#' + rr.r.toLocaleString() + '</i>'; cls = 'mp-c' + pctBucket(rr.pc); } }
      else if (em) sub = '<em class="' + em.className + '">' + esc(em.textContent.replace(/^([+−-])0\./, '$1.')) + '</em>';
      cells.push('<div class="' + cls + '"><span>' + lab[k] + '</span><b>' + esc(v) + '</b>' + sub + '</div>');
    });
    var h = cells.join('');
    if (host.__h !== h) { host.__h = h; host.innerHTML = h; }
    renderChips(past);
  }
  function renderChips(past) {
    var host = document.getElementById('mpChips'); if (!host) return;
    if (past === undefined) past = !!document.querySelector('.pa-hero.pc-past');
    var c = [], rank = txt('#paRankPlayer b'), tr = txt('#paRankTeam b');
    var wa = ''; var w = document.querySelector('#impactSection tbody tr td.strong'); if (w) wa = w.textContent.trim();
    var bb = (txt('#ovcFoot .bb').match(/#(\d+)/) || [])[1], nil = window._ovcNil || '';
    var p = (typeof player !== 'undefined') ? player : null, tm = p && p.team ? (window.tdcShortSchool ? tdcShortSchool(p.team) : p.team) : '';
    if (!past && rank) c.push('<b>' + esc(rank) + '</b> in D-I');
    if (wa) c.push('<b>' + esc(wa) + '</b> wins added');
    if (!past && bb) c.push('<b>#' + esc(bb) + '</b> big board');
    if (nil) c.push('<b>' + esc(nil) + '</b> NIL');
    if (!past && tr && tm) c.push(esc(tm) + ' <b>' + esc(tr) + '</b> nationally');
    var h = c.map(function (x) { return '<span>' + x + '</span>'; }).join('');
    if (host.__h !== h) { host.__h = h; host.innerHTML = h; }
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
      var b = el('button', '', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (TAB_ICON[g.key] || '') + '"></path></svg><span>' + esc(g.label) + '</span>'); b.type = 'button'; b.dataset.g = g.key;
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
    // rank lives in the header row now
    if (last) cols.push(['Last OVR', last, '', ovrBucket(last)]);
    if (wa) cols.push(['Wins add.', wa, '']);
    if (bb) cols.push(['Big Board', '#' + bb, '']);
    if (nil) cols.push(['NIL', nil, '']);
    if (!cols.length) { host.innerHTML = ''; return; }
    var h = '<div class="ovc-sl">Standing</div><div class="sheet-wrap" style="max-height:none"><table class="sheet dense" style="width:100%"><thead><tr>' +
      cols.map(function (c) { return '<th class="c">' + c[0] + '</th>'; }).join('') + '</tr></thead><tbody><tr>' +
      cols.map(function (c) { return '<td class="c strong ' + (c[3] ? c[3].replace('mp-c', 'c') : '') + '">' + esc(c[1]) + '</td>'; }).join('') + '</tr></tbody></table></div>';
    if (host.__h !== h) { host.__h = h; host.innerHTML = h; }
    renderChips();
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
