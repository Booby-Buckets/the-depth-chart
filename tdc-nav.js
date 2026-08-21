/* tdc-nav.js — shared site navigation bar (grouped dropdowns).
   The site's ~20 destinations used to sit in one flat 25-item row. This renders
   them as five top-level menus (Teams / Players / Analytics / Postseason /
   More), each opening a dropdown on click. (Coach's Tier + Coaching Lab live under More.)

   One source of truth: it builds its own `.tdn-wrap` bar with namespaced classes
   and injects a rule that hides any page's OLD inline `.nav-wrap`, so dropping
   this script onto a page swaps its legacy flat nav for the grouped one with no
   per-page nav edits. Auth-aware (avatar when signed in); current page's group
   is auto-highlighted.

   Usage: `<script src="tdc-nav.js?v=3"></script>` near the top of <body>. */
(function () {
  if (window.__tdcNav) return; window.__tdcNav = 1;

  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
  var KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';

  // [group label, [[href, name], …]] — the six top-level menus.
  var GROUPS = [
    ['Teams', [
      ['index.html',           'Team Rankings'],
      ['team.html',            'Teams'],
      ['team-stats.html',      'Team Stats'],
      ['compare-players.html?mode=teams', 'Compare Teams'],
      ['predict.html',         'Projections'],
    ]],
    ['Players', [
      ['roster.html',          'Player Projected Stats'],
      ['recent-additions.html','Recent Additions'],
      ['transfer-fit.html',    'Transfer Fit'],
      ['compare-players.html', 'Compare Players'],
      ['draft.html',           'Mock Draft'],
      ['development.html',     'Development'],
      ['archetypes.html',      'Archetypes'],
      ['gradelist.html',       'Grade List'],
    ]],
    ['Analytics', [
      ['betting.html',                  '🎯 Betting Lab'],
      ['analytics.html',                'Advanced Stats'],
      ['analytics.html?view=explorer',  'Stat Explorer'],
      ['analytics.html?view=teams',     'Team History'],
      ['analytics.html?view=landscape', 'League Landscape'],
      ['shot-genome.html',              'Shot Genome'],
      ['onoff.html',                    'On / Off'],
    ]],
    ['Postseason', [
      ['tournaments.html',     'Tournaments'],
      ['bracket.html',         'Bracketology'],
      ['awards.html',          'Awards'],
    ]],
    ['More', [
      ['coach-tier.html',      "⬡ Coach's Tier"],
      ['coaches.html',         'Coaching Lab'],
      ['buzz.html',            'News'],
      ['community.html',       'Community'],
      ['games.html',           '🎮 Games'],
      ['customize.html',       '✦ Customize'],
      ['pricing.html',         'Pricing'],
      ['just-added.html',      'Just Added'],
      ['changelog.html',       "What's New"],
    ]],
  ];

  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  function esc(t) { return (''+t).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  // ── Styles (namespaced .tdn-*; also hides any legacy inline .nav-wrap) ──
  if (!document.getElementById('tdc-nav-css')) {
    var css = document.createElement('style');
    css.id = 'tdc-nav-css';
    css.textContent = [
      '.nav-wrap{display:none!important;}',            // suppress legacy inline nav on older pages
      '.tdn-wrap{border-bottom:1px solid var(--border);background:rgba(250,249,246,.72);backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%);position:sticky;top:0;z-index:400;}',
      '[data-theme="dark"] .tdn-wrap{background:rgba(20,20,22,.86);border-bottom-color:rgba(26,43,68,.9);}',
      '.tdn-top{padding:0 40px;height:52px;display:flex;align-items:center;justify-content:space-between;min-width:0;}',
      '@keyframes tdnLogo{from{opacity:0;transform:translateX(-8px);}to{opacity:1;transform:translateX(0);}}',
      ".tdn-logo{font-family:'Playfair Display',serif;font-weight:800;font-size:20px;color:var(--text);text-decoration:none;letter-spacing:-.01em;white-space:nowrap;animation:tdnLogo .55s cubic-bezier(.22,1,.36,1) both;}",
      '.tdn-logo span{color:var(--accent);}',
      '.tdn-actions{display:flex;align-items:center;gap:20px;}',
      '.tdn-actions a{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);text-decoration:none;transition:color .15s;}',
      '.tdn-actions a:hover{color:var(--text);}',
      '.tdn-signin{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--bg)!important;background:var(--text);border:none;padding:6px 16px;cursor:pointer;text-decoration:none;display:inline-block;transition:opacity .15s;}',
      '.tdn-signin:hover{opacity:.85;}',
      '.tdn-wrap .theme-toggle{background:none;border:1px solid var(--border2);color:var(--text3);font-size:14px;width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color .15s,color .15s;}',
      '.tdn-wrap .theme-toggle:hover{border-color:var(--accent);color:var(--text);}',
      '.tdn-row{border-top:1px solid var(--border);padding:0 40px;display:flex;flex-wrap:wrap;align-items:stretch;gap:2px;position:relative;}',
      '.tdn-group{position:relative;display:flex;align-items:stretch;flex-shrink:0;}',
      '.tdn-btn{font-family:inherit;background:none;border:none;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);padding:0 15px;height:38px;display:flex;align-items:center;gap:6px;white-space:nowrap;position:relative;transition:color .18s;}',
      '.tdn-row .tdn-group:first-child .tdn-btn{padding-left:0;}',
      '.tdn-btn .car{width:7px;height:7px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg) translateY(-1px);opacity:.65;transition:transform .2s;}',
      '.tdn-btn:hover{color:var(--text);}',
      '.tdn-btn.active{color:var(--text);}',
      ".tdn-btn.active::after{content:'';position:absolute;bottom:0;left:15px;right:15px;height:2px;background:var(--accent);border-radius:1px 1px 0 0;}",
      '.tdn-row .tdn-group:first-child .tdn-btn.active::after{left:0;}',
      '.tdn-group.open .tdn-btn{color:var(--text);}',
      '.tdn-group.open .tdn-btn .car{transform:rotate(225deg) translateY(2px);}',
      '.tdn-menu{position:absolute;top:calc(100% + 4px);left:0;min-width:190px;background:var(--bg2);border:1px solid var(--border2);border-radius:12px;box-shadow:0 16px 44px rgba(0,0,0,.26);padding:6px;opacity:0;visibility:hidden;transform:translateY(-6px);transition:opacity .16s,transform .16s;z-index:60;}',
      '.tdn-row .tdn-group:first-child .tdn-menu{left:0;}',
      '.tdn-group.open .tdn-menu{opacity:1;visibility:visible;transform:translateY(0);}',
      '.tdn-menu a{display:block;font-size:12.5px;font-weight:600;letter-spacing:.01em;text-transform:none;color:var(--text2);text-decoration:none;padding:9px 13px;border-radius:8px;white-space:nowrap;transition:background .13s,color .13s;}',
      '.tdn-menu a:hover{background:var(--bg3);color:var(--text);}',
      '.tdn-menu a.active{color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent);}',
      '@media(max-width:900px){',
      '.tdn-top{height:44px;padding:0 12px!important;}',
      '.tdn-logo{font-size:15px;}',
      '.tdn-signin{padding:5px 8px;font-size:10px;letter-spacing:.02em;}',
      '.tdn-actions{gap:8px;}',
      '.tdn-actions a{font-size:10px;}',
      '.tdn-wrap .theme-toggle{width:28px;height:28px;font-size:13px;}',
      '.tdn-row{padding:0 12px!important;}',
      '.tdn-btn{padding:0 10px;height:34px;font-size:10px;letter-spacing:.04em;}',
      '.tdn-menu{min-width:170px;}',
      '}',
    ].join('');
    document.head.appendChild(css);
  }

  // ── Theme toggle (only define if the page hasn't) ──
  function syncThemeBtn(t) { var b = document.getElementById('themeBtn'); if (b) b.textContent = (t === 'dark' ? '☀️' : '🌙'); }
  if (typeof window.toggleTheme !== 'function') {
    window.toggleTheme = function () {
      var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('tdc_theme', next); } catch (e) {}
      syncThemeBtn(next);
    };
  }
  var curTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  var themeGlyph = curTheme === 'dark' ? '☀️' : '🌙';

  // ── Markup ──
  var groupsHtml = GROUPS.map(function (g) {
    var inGroup = g[1].some(function (t) { return t[0].toLowerCase() === here; });
    var items = g[1].map(function (t) {
      var a = t[0].toLowerCase() === here ? ' class="active"' : '';
      return '<a href="' + t[0] + '"' + a + '>' + esc(t[1]) + '</a>';
    }).join('');
    return '<div class="tdn-group">'
      + '<button class="tdn-btn' + (inGroup ? ' active' : '') + '" type="button">' + esc(g[0]) + '<span class="car"></span></button>'
      + '<div class="tdn-menu">' + items + '</div></div>';
  }).join('');

  var wrap = document.createElement('div');
  wrap.className = 'tdn-wrap';
  wrap.innerHTML =
    '<div class="tdn-top">' +
      '<a class="tdn-logo" href="index.html">The Depth <span>Chart</span></a>' +
      '<div class="tdn-actions" id="navActions">' +
        '<button class="theme-toggle" onclick="toggleTheme()" id="themeBtn" title="Toggle dark mode">' + themeGlyph + '</button>' +
        '<a href="pricing.html" style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);text-decoration:none;">Sign In</a>' +
        '<a href="pricing.html" class="tdn-signin">Subscribe</a>' +
      '</div>' +
    '</div>' +
    '<div class="tdn-row">' + groupsHtml + '</div>';

  // ── Dropdown behavior: click to toggle, click-outside / Escape to close ──
  function wireMenus() {
    var groups = wrap.querySelectorAll('.tdn-group');
    function closeAll(except) { groups.forEach(function (g) { if (g !== except) g.classList.remove('open'); }); }
    groups.forEach(function (g) {
      var btn = g.querySelector('.tdn-btn');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var willOpen = !g.classList.contains('open');
        closeAll(g);
        g.classList.toggle('open', willOpen);
      });
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) closeAll(null); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(null); });
  }

  function mount() {
    if (!document.body) return;
    // remove any legacy inline nav so only the grouped bar remains
    var old = document.querySelectorAll('.nav-wrap'); old.forEach(function (n) { n.parentNode && n.parentNode.removeChild(n); });
    if (document.querySelector('.tdn-wrap') !== wrap) document.body.insertBefore(wrap, document.body.firstChild);
    wireMenus();
    upgradeAuth();
  }

  // ── Auth-aware actions: avatar/username when signed in, else Sign In/Subscribe ──
  function upgradeAuth() {
    var s; try { s = JSON.parse(localStorage.getItem('tdc_session') || 'null'); } catch (e) { return; }
    if (!s || !s.access_token || !s.user || !s.user.id) return;
    fetch(SB + '/rest/v1/profiles?id=eq.' + s.user.id + '&select=username,avatar_url,plan',
      { headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token } })
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        var p = rows && rows[0]; if (!p) return;
        var u = p.username || (s.user.email ? s.user.email.split('@')[0] : 'User');
        var el = document.getElementById('navActions'); if (!el) return;
        var av = p.avatar_url
          ? '<img src="' + p.avatar_url + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid var(--accent);">'
          : '<div style="width:32px;height:32px;border-radius:50%;background:var(--bg2);border:2px solid var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--accent);">' + u[0].toUpperCase() + '</div>';
        el.innerHTML =
          '<button class="theme-toggle" onclick="toggleTheme()" id="themeBtn" title="Toggle dark mode">' + themeGlyph + '</button>' +
          '<a href="profile.html" style="display:flex;align-items:center;gap:8px;text-decoration:none;">' + av +
          '<span style="font-size:13px;font-weight:700;color:var(--text);">' + u + '</span></a>';
      })
      .catch(function () {});
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
