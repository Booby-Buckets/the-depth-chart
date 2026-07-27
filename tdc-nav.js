/* tdc-nav.js — shared site navigation bar.
   Some pages (predict, awards, bracket, buzz, matchup, portal, game, gradelist,
   customize) shipped with only a back-link header, so the main nav "disappeared"
   when you tabbed to them. Including this script injects the SAME sticky nav the
   rest of the site uses (logo + auth actions + full tab row), styled and
   auth-aware, with the current page's tab auto-highlighted.

   Usage: drop `<script src="tdc-nav.js?v=1"></script>` near the top of <body>
   and remove the page's old minimal header. Safe to include even if the page
   already defines toggleTheme() — it only fills gaps, never overrides. */
(function () {
  if (window.__tdcNav) return; window.__tdcNav = 1;

  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
  var KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';

  // Canonical tab order — mirrors index.html's .nav-sub.
  var TABS = [
    ['index.html', 'Rankings'],
    ['roster.html', 'Players'],
    ['compare-players.html', 'Compare'],
    ['draft.html', 'Draft'],
    ['analytics.html', 'Stats'],
    ['shot-genome.html', 'Shot Genome'],
    ['onoff.html', 'On/Off'],
    ['tournaments.html', 'Tournaments'],
    ['predict.html', 'Predict'],
    ['awards.html', 'Awards'],
    ['bracket.html', 'Bracket'],
    ['buzz.html', 'News'],
    ['coaches.html', 'Coaches'],
    ['development.html', 'Development'],
    ['games.html', '🎮 Games'],
    ['community.html', 'Community'],
    ['team.html', 'Teams'],
    ['coach-tier.html', "⬡ Coach's Tier"],
    ['customize.html', '✦ Customize'],
    ['pricing.html', 'Pricing'],
  ];

  // Current page file (e.g. "predict.html"); default to index.
  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  // ── Styles (copied from index.html so it matches the inline-nav pages) ──
  if (!document.getElementById('tdc-nav-css')) {
    var css = document.createElement('style');
    css.id = 'tdc-nav-css';
    css.textContent = [
      '.nav-wrap{border-bottom:1px solid var(--border);background:rgba(250,249,246,.66);backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%);position:sticky;top:0;z-index:200;}',
      '[data-theme="dark"] .nav-wrap{background:rgba(20,20,22,.84);border-bottom-color:rgba(26,43,68,.9);}',
      '.nav-top{padding:0 40px;height:52px;display:flex;align-items:center;justify-content:space-between;min-width:0;}',
      '@keyframes logoReveal{from{opacity:0;transform:translateX(-8px);}to{opacity:1;transform:translateX(0);}}',
      ".nav-logo{font-family:'Playfair Display',serif;font-weight:800;font-size:20px;color:var(--text);text-decoration:none;letter-spacing:-.01em;white-space:nowrap;animation:logoReveal .55s cubic-bezier(.22,1,.36,1) both;}",
      '.nav-logo span{color:var(--accent);}',
      '.nav-actions{display:flex;align-items:center;gap:20px;}',
      '.nav-actions a{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);text-decoration:none;transition:color .15s;}',
      '.nav-actions a:hover{color:var(--text);}',
      '.nav-signin{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--bg);background:var(--text);border:none;padding:6px 16px;cursor:pointer;text-decoration:none;display:inline-block;transition:opacity .15s;}',
      '.nav-signin:hover{opacity:.85;}',
      '[data-theme="dark"] .nav-signin{background:var(--text);color:var(--bg);}',
      '.nav-wrap .theme-toggle{background:none;border:1px solid var(--border2);color:var(--text3);font-size:14px;width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color .15s,color .15s;}',
      '.nav-wrap .theme-toggle:hover{border-color:var(--accent);color:var(--text);}',
      '.nav-sub{border-top:1px solid var(--border);padding:0 40px;height:36px;display:flex;align-items:center;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;}',
      '.nav-sub::-webkit-scrollbar{display:none;}',
      '.nav-sub a{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);text-decoration:none;padding:0 14px;height:100%;display:flex;align-items:center;position:relative;white-space:nowrap;flex-shrink:0;transition:color .2s;}',
      '.nav-sub a:first-child{padding-left:0;}',
      ".nav-sub a::after{content:'';position:absolute;bottom:0;left:14px;right:14px;height:2px;background:var(--accent);transform:scaleX(0);transform-origin:left center;transition:transform .22s cubic-bezier(.22,1,.36,1);border-radius:1px 1px 0 0;}",
      '.nav-sub a:first-child::after{left:0;}',
      '.nav-sub a:hover{color:var(--text);}',
      '.nav-sub a:hover::after{transform:scaleX(1);}',
      '.nav-sub a.active{color:var(--text);}',
      '.nav-sub a.active::after{transform:scaleX(1);}',
      '@media(max-width:900px){',
      '.nav-top,.nav-sub{padding-left:16px!important;padding-right:16px!important;}',
      '.nav-top{height:44px;padding:0 12px!important;}',
      '.nav-logo{font-size:15px;}',
      '.nav-signin{padding:5px 8px;font-size:10px;letter-spacing:.02em;}',
      '.nav-actions{gap:8px;}',
      '.nav-actions a{font-size:10px;}',
      '.nav-wrap .theme-toggle{width:28px;height:28px;font-size:13px;}',
      '.nav-sub{padding:0 12px!important;}',
      '.nav-sub a{padding:0 10px;font-size:10px;}',
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
  var subLinks = TABS.map(function (t) {
    var active = t[0].toLowerCase() === here ? ' class="active"' : '';
    return '<a href="' + t[0] + '"' + active + '>' + t[1] + '</a>';
  }).join('');

  var wrap = document.createElement('div');
  wrap.className = 'nav-wrap';
  wrap.innerHTML =
    '<div class="nav-top">' +
      '<a class="nav-logo" href="index.html">The Depth <span>Chart</span></a>' +
      '<div class="nav-actions" id="navActions">' +
        '<button class="theme-toggle" onclick="toggleTheme()" id="themeBtn" title="Toggle dark mode">' + themeGlyph + '</button>' +
        '<a href="pricing.html" style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);text-decoration:none;">Sign In</a>' +
        '<a href="pricing.html" class="nav-signin">Subscribe</a>' +
      '</div>' +
    '</div>' +
    '<div class="nav-sub">' + subLinks + '</div>';

  function mount() {
    if (document.querySelector('.nav-wrap') !== wrap && document.body) {
      document.body.insertBefore(wrap, document.body.firstChild);
    }
    upgradeAuth();
  }

  // ── Auth-aware actions: show avatar/username when signed in (matches the
  //    inline-nav pages). Falls back silently to Sign In / Subscribe. ──
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
