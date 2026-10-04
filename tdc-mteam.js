/* tdc-mteam.js — the phone layout of team.html (Oct 2026 mobile redesign). Same system as
   the player page (tdc-mplayer.js): a team-colour band header (logo, league · coach, name,
   season picker, one Power Rating cell), the hero ribbon as one small sheet, a Google-Sheets
   style tab strip pinned to the bottom, and no explainer prose. It re-arranges what
   team.html already renders and drives the page's own controls — no data of its own.
   Phones only (≤640px). */
(function () {
  var MQ = window.matchMedia('(max-width:640px)');
  var GROUPS = [
    { key: 'depth', label: 'Depth chart', tabs: ['depth'] },
    { key: 'schedule', label: 'Schedule', tabs: ['schedule'] },
    { key: 'preview', label: 'Preview', tabs: ['preview'] },
    { key: 'stats', label: 'Analytics', tabs: ['dna', 'shots', 'onoff', 'projections'] },
    { key: 'coach', label: "Coach's Tier", tabs: ['mcoach', 'customize', 'report'] },
    { key: 'nil', label: 'NIL', tabs: ['nil'] },
    { key: 'betting', label: 'Betting', tabs: ['betting'] },
    { key: 'conf', label: 'Conference', link: true }
  ];
  var STATS = [['dna', 'DNA'], ['shots', 'Shots'], ['onoff', 'On/Off'], ['projections', 'Projections']];
  var COACH = [['customize', 'Lineup Lab', 'Lineups, minutes, live projections'], ['report', 'Roster report', 'Scouting breakdown of the roster']];
  var TOOLS = [['scout.html', 'Opponent scouting', 'Scout any opponent'], ['self-scout.html', 'Self-scout', 'Your own tendencies'],
    ['matchup.html', 'Matchup predictor', 'Project any game'], ['offense.html', 'Offensive profile', 'Scheme and shot diet'],
    ['defense.html', 'Defensive profile', 'Coverages and rim protection'], ['moneyball.html', 'Moneyball', 'Roster value'],
    ['roster-dev.html', 'Roster development', "Who's trending up"]];

  var CSS = [
    'body.mt .breadcrumb,body.mt #teamHero,body.mt #tdc-ver,body.mt .panel-bar,body.mt .pc-grip,body.mt .pc-hide,body.mt .roster-year-bar,body.mt .sec-head-sub{display:none!important}',
    'body.mt{padding-bottom:calc(60px + env(safe-area-inset-bottom))}',
    '.mt-hero,.mt-strip,.mt-sub,.mt-season,#panel-mcoach{display:none}',
    /* team band */
    'body.mt .mt-hero{display:flex;gap:12px;padding:14px;background:var(--tc-band,#1d2433);color:#fff;margin:0 0 14px}',
    '.mt-logo{flex:0 0 46px;height:46px;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;align-self:flex-start;margin-top:2px}',
    '.mt-logo img{width:36px;height:36px;object-fit:contain}',
    '.mt-id{flex:1;min-width:0}',
    '.mt-eye{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.78);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mt-eye a{color:inherit;text-decoration:none}',
    '.mt-name{margin:4px 0 8px;font-family:"Playfair Display",Georgia,serif;font-size:28px;font-weight:800;line-height:1.05;color:#fff}',
    '.mt-ctl{display:flex;gap:6px;flex-wrap:wrap}',
    '.mt-sel,.mt-fol{font:700 13px Inter,system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:5px 8px;max-width:100%}',
    '.mt-sel option{color:#111;background:#fff}',
    '.mt-fol{cursor:pointer}',
    '.mt-cell{flex:0 0 76px;border:1px solid rgba(255,255,255,.45);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;align-self:stretch;background:#fff}',
    '.mt-cell span{font-size:11px;font-weight:800;letter-spacing:.07em;color:#555;background:rgba(0,0,0,.06);border-bottom:1px solid rgba(0,0,0,.12);text-align:center;padding:5px 0}',
    '.mt-cell b{flex:1;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;color:#111;min-height:54px;' +
    'background-image:linear-gradient(hsla(125,70%,48%,.40),hsla(125,70%,48%,.40))}',
    /* the ribbon as a sheet */
    'body.mt .mt-season{display:block;margin:0 14px 18px}',
    '.mt-st{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin:0 0 6px}',
    '.mt-season table{width:100%;table-layout:fixed}',
    '.mt-season tr.lab td{font-size:11px!important;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);background:var(--bg2)!important;padding:6px 4px!important;white-space:normal;line-height:1.2}',
    '.mt-season td{text-align:center!important;padding:7px 4px!important;font-weight:700}',
    /* bottom tab strip */
    'body.mt .mt-strip{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:60;height:calc(52px + env(safe-area-inset-bottom));padding-bottom:env(safe-area-inset-bottom);background:var(--bg2);border-top:1px solid var(--border2);overflow-x:auto;scrollbar-width:none}',
    '.mt-strip::-webkit-scrollbar{display:none}',
    '.mt-strip button{flex:0 0 auto;border:0;background:none;font:600 13px Inter,system-ui,sans-serif;color:var(--text2);padding:0 14px;margin:12px 0;border-right:1px solid var(--border);white-space:nowrap;cursor:pointer}',
    '.mt-strip button.on{background:var(--bg);color:var(--text);font-weight:800;border-top:3px solid var(--accent);border-right:0;margin:-1px 0 0}',
    'body.mt .tdc-explain{bottom:calc(62px + env(safe-area-inset-bottom))!important}',
    'body.mt .mt-sub.show{display:flex}',
    '.mt-sub{border:1px solid var(--border2);border-radius:8px;overflow:hidden;margin:0 14px 14px}',
    '.mt-sub button{flex:1;border:0;border-right:1px solid var(--border);background:none;font:700 13px Inter,system-ui,sans-serif;color:var(--text2);padding:9px 0;cursor:pointer}',
    '.mt-sub button:last-child{border-right:0}',
    '.mt-sub button.on{background:var(--text);color:var(--bg)}',
    '.mt-sub.back{border:0}',
    '.mt-sub.back button{flex:0 0 auto;text-align:left;padding:4px 0;color:var(--accent)}',
    /* coach menu */
    'body.mt #panel-mcoach.active{display:block!important}',
    '.mt-list{border:1px solid var(--border);border-radius:10px;overflow:hidden;margin:0 0 18px}',
    '.mt-list > *{display:grid;grid-template-columns:1fr auto;gap:2px 10px;width:100%;text-align:left;border:0;border-bottom:1px solid var(--border);background:var(--bg);padding:10px 12px;cursor:pointer;font-family:Inter,system-ui,sans-serif;text-decoration:none;box-sizing:border-box}',
    '.mt-list > *:nth-child(even){background:color-mix(in srgb,var(--text) 3.5%,var(--bg))}',
    '.mt-list > *:last-child{border-bottom:0}',
    '.mt-list b{font-size:13.5px;font-weight:700;color:var(--text)}',
    '.mt-list small{grid-column:1;font-size:12px;color:var(--text3)}',
    '.mt-tag{grid-row:1/span 2;grid-column:2;align-self:center;font-size:11px;font-weight:800;color:var(--text2);border:1px solid var(--border2);border-radius:4px;padding:1px 6px;white-space:nowrap}',
    /* sidebar cards and section heads: plain labels over sheets */
    'body.mt .side-card{background:none!important;border:0!important;box-shadow:none!important;padding:0!important;margin:0 0 18px!important}',
    'body.mt .side-col .side-card-head,body.mt .side-card-head{font:800 11px Inter,system-ui,sans-serif!important;letter-spacing:.06em!important;text-transform:uppercase;color:var(--text3)!important;border:0!important;padding:0!important;margin:0 0 6px!important;background:none!important}',
    'body.mt #shotProfileCard .side-card-body > div:first-child{display:none}',
    'body.mt .sec-head{font:800 11px Inter,system-ui,sans-serif!important;letter-spacing:.06em!important;text-transform:uppercase;color:var(--text3)!important;margin:0 0 6px!important;padding:0!important;border:0!important}',
    'body.mt .sec-head::after{display:none!important}',
    'body.mt .page-body{display:block!important;margin:0 14px 24px!important}',
    'body.mt .main-col{padding:0 0 8px!important;border:0!important;width:auto!important}',
    'body.mt.mt-depth .page-body .side-col{display:block!important}',
    /* every panel sits flat in the column */
    'body.mt .main-col > .panel{margin:0!important;padding:0!important;border:0!important;background:none!important;box-shadow:none!important;border-radius:0!important}',
    /* Schedule: summary tiles → one row of cells; no per-row SCRIMMAGE chip; low-value columns dropped (mtPrune) */
    'body.mt .tsp-sum{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:0!important;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin:0 0 18px!important}',
    'body.mt .tsp-tile{background:var(--bg)!important;border:0!important;border-right:1px solid var(--border)!important;border-radius:0!important;padding:8px 8px!important;box-shadow:none!important;min-width:0}',
    'body.mt .tsp-tile:last-child{border-right:0!important}',
    'body.mt .scrim-wrap .sec-head{margin-top:0!important}',
    'body.mt .scrim-chip,body.mt [class*="scrim-tag"],body.mt .scrim-wrap td span[class*="chip"]{display:none!important}',
    'body.mt .mt-x{display:none!important}',
    'body.mt #schedBody{padding:0!important;border:0!important;background:none!important;box-shadow:none!important}',
    'body.mt #schedBody .sheet-wrap{margin-left:0!important;margin-right:0!important}',
    'body.mt .tsp-table td,body.mt .tsp-table th,body.mt .scrim-wrap td,body.mt .scrim-wrap th{padding-left:5px!important;padding-right:5px!important}',
    'body.mt .tsp-tile *{white-space:normal!important;overflow:visible!important;text-overflow:clip!important}',
    /* Team DNA: no headline sentence or explainer lines — the tiles and factor rows carry it */
    'body.mt .dA-head{background:none!important;color:var(--text)!important;padding:0!important;margin:0 0 18px!important;border:0!important;box-shadow:none!important;border-radius:0!important}',
    'body.mt .dA-h1,body.mt .dA-hsub,body.mt .dA-eyebrow,body.mt .dA-foot,body.mt .dA-read,body.mt .dA-calib{display:none!important}',
    'body.mt .dA-hr{display:block!important;padding:0!important}',
    'body.mt .dA-sel{margin:0 0 10px!important}',
    'body.mt .dA-tiles{display:grid!important;grid-template-columns:1fr 1fr;gap:0!important;border:1px solid var(--border);border-radius:10px;overflow:hidden}',
    'body.mt .dA-tile{background:var(--bg)!important;border:0!important;border-right:1px solid var(--border)!important;border-bottom:1px solid var(--border)!important;border-radius:0!important;padding:8px 10px!important;color:var(--text)!important}',
    'body.mt .dA-tile *{color:inherit}',
    'body.mt .dA-card{background:none!important;border:0!important;box-shadow:none!important;padding:0!important;margin:0 0 18px!important;border-radius:0!important}',
    'body.mt .dA-sec{font:800 11px Inter,system-ui,sans-serif!important;letter-spacing:.06em!important;text-transform:uppercase;color:var(--text3)!important;margin:0 0 6px!important}',
    'body.mt .dA-sec *{text-transform:none;letter-spacing:0;font-weight:600}',
    'body.mt .dA-card > .dA-row,body.mt .dA-card > .dA-vrow{border:1px solid var(--border);border-top:0;padding:7px 10px!important;margin:0!important;background:var(--bg)}',
    'body.mt .dA-card > .dA-sec + .dA-row,body.mt .dA-card > .dA-sec + .dA-vrow{border-top:1px solid var(--border);border-radius:10px 10px 0 0}',
    'body.mt .dA-card > .dA-row:nth-of-type(even),body.mt .dA-card > .dA-vrow:nth-of-type(even){background:color-mix(in srgb,var(--text) 3.5%,var(--bg))}',
    'body.mt .side-col{width:auto!important;max-width:none!important;padding:18px 0 0!important;border:0!important;position:static!important}'
  ].join('\n');

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms || 60); }; }
  function watch(node, fn) { if (!node) return; var d = debounce(fn, 80); new MutationObserver(d).observe(node, { childList: true, subtree: true, characterData: true }); fn(); }
  function txt(id) { var e = document.getElementById(id); return e ? e.textContent.trim() : ''; }
  function mirror(src) {
    var sel = document.createElement('select'); sel.className = 'mt-sel'; sel.setAttribute('aria-label', 'Select season');
    function sync() { if (sel.innerHTML !== src.innerHTML) sel.innerHTML = src.innerHTML; sel.value = src.value; }
    sync(); new MutationObserver(sync).observe(src, { childList: true, subtree: true, attributes: true });
    src.addEventListener('change', function () { sel.value = src.value; });
    sel.addEventListener('change', function () { src.value = sel.value; src.dispatchEvent(new Event('change', { bubbles: true })); });
    return sel;
  }
  // the page's own control for a section: a top-level tab button or a dropdown item
  function go(id) {
    var b = document.querySelector('.hero-tab[onclick*="switchTab(\'' + id + '\'"]');
    if (b) { b.click(); return; }
    var g = document.querySelector('.hgm-item[onclick*="_tgPick(\'' + id + '\'"]');
    if (g) { g.click(); return; }
    if (window.switchTab) window.switchTab(id, null);
  }
  function groupOf(t) { for (var i = 0; i < GROUPS.length; i++) if ((GROUPS[i].tabs || []).indexOf(t) >= 0) return GROUPS[i]; return GROUPS[0]; }

  var built = false;
  function buildHero() {
    var name = txt('heroName'); if (!name || name === 'Loading…') return false;
    var wrap = document.querySelector('.page-body'); if (!wrap) return false;
    var tc = (window.tdcTeamColor && window.tdcTeamColor(name)) || {};
    var conf = document.getElementById('heroConf'), coach = document.getElementById('heroCoach');
    var eye = [];
    if (conf && conf.textContent.trim()) eye.push(conf.innerHTML.trim());
    if (coach && coach.textContent.trim()) eye.push(coach.innerHTML.replace(/^\s*HC:\s*/i, '').trim());
    var hero = el('div', 'mt-hero',
      (tc.logo ? '<span class="mt-logo"><img src="' + tc.logo + '" alt="" onerror="this.parentNode.remove()"></span>' : '') +
      '<div class="mt-id"><div class="mt-eye">' + eye.join(' · ') + '</div><h1 class="mt-name">' + esc(name) + '</h1><div class="mt-ctl"></div></div>' +
      '<div class="mt-cell"><span>RTG</span><b id="mtRtg">—</b></div>');
    var season = el('div', 'mt-season'); season.id = 'mtSeason';
    var sub = el('div', 'mt-sub'); sub.id = 'mtSub';
    wrap.parentNode.insertBefore(hero, wrap);
    wrap.parentNode.insertBefore(season, wrap);
    wrap.parentNode.insertBefore(sub, wrap);
    var ctl = hero.querySelector('.mt-ctl');
    var ss = document.getElementById('teamSeasonSelect'); if (ss) ctl.appendChild(mirror(ss));
    var fb = document.getElementById('followTeamBtn');
    if (fb) {
      var f = el('button', 'mt-fol', esc(fb.textContent.trim())); f.type = 'button';
      f.onclick = function () { fb.click(); };
      new MutationObserver(function () { f.textContent = fb.textContent.trim(); }).observe(fb, { childList: true, subtree: true, characterData: true });
      ctl.appendChild(f);
    }
    watch(document.getElementById('heroRibbon'), renderSeason);
    return true;
  }
  // ribbon → the Power Rating cell + one small sheet of everything else
  function renderSeason() {
    var host = document.getElementById('mtSeason'); if (!host) return;
    var items = [].slice.call(document.querySelectorAll('#heroRibbon .hrb')).map(function (h) {
      var v = h.querySelector('.hrb-v'), l = h.querySelector('.hrb-l');
      return [l ? l.textContent.trim() : '', v ? v.textContent.trim().replace(/^\d+\s*(?=No\.)/, '') : ''];
    }).filter(function (x) { return x[1]; });
    var rtg = items.filter(function (x) { return /power rating/i.test(x[0]); })[0];
    var cell = document.getElementById('mtRtg'); if (cell) cell.textContent = rtg ? rtg[1] : '—';
    var rest = items.filter(function (x) { return x !== rtg; }).map(function (x) {
      // shorten the long labels so four fit across a phone
      var l = x[0].replace(/projected\s*/i, 'Proj ').replace(/^proj record$/i, 'Proj').replace(/^last result$/i, 'Result')
        .replace(/^proj rank$/i, 'Rank').replace(/^proj seed$/i, 'Seed').replace(/\s+/g, ' ').trim();
      return [l, x[1]];
    });
    if (!rest.length) { host.innerHTML = ''; return; }
    var rows = '';
    for (var i = 0; i < rest.length; i += 4) {
      var chunk = rest.slice(i, i + 4); while (chunk.length < 4) chunk.push(['', '']);
      rows += '<tr class="lab">' + chunk.map(function (c) { return '<td>' + esc(c[0]) + '</td>'; }).join('') + '</tr>' +
        '<tr>' + chunk.map(function (c) { return '<td>' + esc(c[1]) + '</td>'; }).join('') + '</tr>';
    }
    var h = '<div class="mt-st">Season</div><div class="sheet-wrap" style="max-height:none"><table class="sheet dense"><tbody>' + rows + '</tbody></table></div>';
    if (host.__h !== h) { host.__h = h; host.innerHTML = h; }
  }

  function buildStrip() {
    var nav = el('nav', 'mt-strip'); nav.setAttribute('aria-label', 'Team sections');
    GROUPS.forEach(function (g) {
      var b = el('button', '', esc(g.label)); b.type = 'button'; b.dataset.g = g.key;
      b.onclick = function () {
        if (g.link) { var a = document.getElementById('heroConfTab'); if (a) location.href = a.href; return; }
        if (g.key === 'coach') { showCoach(); return; }
        go(g.tabs[0]); window.scrollTo({ top: 0 });
      };
      nav.appendChild(b);
    });
    document.body.appendChild(nav);
    var main = document.querySelector('.main-col');
    if (main && !document.getElementById('panel-mcoach')) {
      var pn = el('div', 'panel'); pn.id = 'panel-mcoach';
      pn.innerHTML = '<div class="mt-st">On this team</div><div class="mt-list">' +
        COACH.map(function (c) { return '<button type="button" data-t="' + c[0] + '"><b>' + c[1] + '</b><span class="mt-tag">Open ›</span><small>' + c[2] + '</small></button>'; }).join('') +
        '</div><div class="mt-st">Coach\'s Tier toolkit</div><div class="mt-list">' +
        TOOLS.map(function (c) { return '<a href="' + c[0] + '"><b>' + c[1] + '</b><span class="mt-tag">›</span><small>' + c[2] + '</small></a>'; }).join('') + '</div>';
      pn.addEventListener('click', function (e) { var b = e.target.closest('button[data-t]'); if (b) go(b.dataset.t); });
      main.insertBefore(pn, main.firstChild);
    }
  }
  function showCoach() {
    document.querySelectorAll('.main-col .panel').forEach(function (p) { p.classList.remove('active'); });
    var pn = document.getElementById('panel-mcoach'); if (pn) pn.classList.add('active');
    var side = document.querySelector('.side-col'); if (side) side.style.display = 'none';
    setActive('mcoach'); window.scrollTo({ top: 0 });
  }
  function setActive(t) {
    var g = groupOf(t);
    document.querySelectorAll('.mt-strip button').forEach(function (b) {
      var on = b.dataset.g === g.key; b.classList.toggle('on', on);
      if (on) { var s = b.parentNode, r = b.getBoundingClientRect(); if (r.left < 0 || r.right > window.innerWidth) s.scrollLeft += r.left - 40; }
    });
    var season = document.getElementById('mtSeason'); if (season) season.style.display = (g.key === 'depth') ? '' : 'none';
    document.body.classList.toggle('mt-depth', g.key === 'depth');
    var sub = document.getElementById('mtSub'); if (!sub) return;
    if (g.key === 'stats') {
      sub.className = 'mt-sub show';
      sub.innerHTML = STATS.map(function (s) { return '<button type="button" data-t="' + s[0] + '" class="' + (s[0] === t ? 'on' : '') + '">' + s[1] + '</button>'; }).join('');
    } else if (g.key === 'coach' && t !== 'mcoach') {
      sub.className = 'mt-sub back show'; sub.innerHTML = '<button type="button" data-back="1">‹ All Coach\'s Tier tools</button>';
    } else { sub.className = 'mt-sub'; sub.innerHTML = ''; }
    sub.onclick = function (e) { var b = e.target.closest('button'); if (!b) return; if (b.dataset.back) showCoach(); else if (b.dataset.t) go(b.dataset.t); };
  }
  function hookSwitch() {
    var orig = window.switchTab; if (typeof orig !== 'function' || orig.__mt) return;
    var w = function (id) {
      var pn = document.getElementById('panel-mcoach'); if (pn) pn.classList.remove('active');
      var side = document.querySelector('.side-col'); if (side && side.style.display === 'none') side.style.display = '';
      var r = orig.apply(this, arguments); setActive(id); return r;
    };
    w.__mt = true; window.switchTab = w;
  }

  // drop low-value columns from wide tables on a phone, by header label
  var PRUNE = { '.tsp-table': ['RK', 'QUAD', 'OPP PRTG'], '.scrim-wrap table': ['TIME', 'TOTAL'] };
  var WD = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+/;
  function prune() {
    // weekday off the date cells ("Mon 11/2" → "11/2"); kept in a hidden span so desktop is untouched
    document.querySelectorAll('.tsp-table tbody td:first-child,.scrim-wrap tbody td:first-child').forEach(function (td) {
      if (td.__wd || td.children.length) return; var m = td.textContent.match(WD); if (!m) return;
      td.__wd = true; td.innerHTML = '<span class="mt-x">' + m[0] + '</span>' + td.textContent.slice(m[0].length);
    });
    Object.keys(PRUNE).forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (t) {
        var heads = [].slice.call(t.querySelectorAll('thead th'));
        heads.forEach(function (th, i) {
          if (PRUNE[sel].indexOf(th.textContent.trim().toUpperCase()) < 0) return;
          th.classList.add('mt-x');
          t.querySelectorAll('tbody tr').forEach(function (tr) { var c = tr.children[i]; if (c && tr.children.length === heads.length) c.classList.add('mt-x'); });
        });
      });
    });
  }
  function build() {
    if (built) return;
    if (!document.getElementById('miCssT')) { var st = el('style'); st.id = 'miCssT'; st.textContent = CSS; document.head.appendChild(st); }
    if (!buildHero()) return;
    built = true;
    buildStrip(); hookSwitch();
    var act = document.querySelector('.main-col .panel.active'); setActive(act ? act.id.replace('panel-', '') : 'depth');
    var mc = document.querySelector('.main-col'); if (mc) watch(mc, debounce(prune, 150));
  }
  function apply() { document.body.classList.toggle('mt', MQ.matches); if (MQ.matches) build(); }
  function start() {
    apply();
    if (!built) { var n = 0, iv = setInterval(function () { apply(); if (built || ++n > 80) clearInterval(iv); }, 250); }
    if (MQ.addEventListener) MQ.addEventListener('change', apply); else if (MQ.addListener) MQ.addListener(apply);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
