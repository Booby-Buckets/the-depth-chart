/* tdc-nav.js — shared site navigation bar (grouped dropdowns).
   The site's ~20 destinations used to sit in one flat 25-item row. This renders
   them as five top-level menus (Teams / Players / Analytics / Postseason /
   More), each opening a dropdown on click. (Scouting & Game Prep + Coaching Lab live under More.)

   One source of truth: it builds its own `.tdn-wrap` bar with namespaced classes
   and injects a rule that hides any page's OLD inline `.nav-wrap`, so dropping
   this script onto a page swaps its legacy flat nav for the grouped one with no
   per-page nav edits. Auth-aware (avatar when signed in); current page's group
   is auto-highlighted.

   Usage: `<script src="tdc-nav.js?v=28"></script>` near the top of <body>. */
(function () {
  if (window.__tdcNav) return; window.__tdcNav = 1;

  var SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
  var KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';

  // [group label, [[href, name], …]] — the six top-level menus.
  // Owner, Nov 2026: the nav confused people (13 coined tool names under "Analytics", rankings split across menus).
  // Plain-English groups, a one-line "what it is" under every item, sub-headings in the long menus.
  // Item = [href, label, what it is]; ['#Heading'] starts a section; a group with a string is a plain link.
  var GROUPS = [
    ['Scores', 'today.html', ['game.html', 'scrimmages.html']],
    ['Rankings', [
      ['#This season'],
      ['index.html',           'Team Rankings',          'All 365 teams, best to worst'],
      ['rankings-by-date.html','Rankings by Date',       'Where every team ranked on any date, and what it did since'],
      ['roster.html',          'Player Rankings',        'Every player by overall'],
      ['conferences.html',     'Conferences & Standings','League tables and conference ratings'],
      ['predict.html',         'Predictive Ratings',     'Who wins going forward'],
      ['#Postseason'],
      ['bracket.html',         'Bracketology',           'Projected NCAA Tournament field'],
      ['tournaments.html',     'Tournaments',            'Early-season events and conference tournaments'],
      ['awards.html',          'Awards',                 'All-Conference, All-America, Player of the Year odds'],
    ]],
    ['Teams', [
      ['team.html',            'Team Pages',             'Roster, depth chart, schedule, scouting'],
      ['team-stats.html',      'Team Stats',             'Sortable team stats for the season'],
      ['compare-players.html?mode=teams', 'Compare Teams', 'Two teams side by side'],
      ['compare-games.html',   'Compare Games',          'Two games side by side'],
      ['payroll.html',         'Payrolls',               'Estimated NIL spending by team'],
    ]],
    ['Players', [
      ['following.html',       '★ Following',            'Players and teams you follow'],
      ['compare-players.html', 'Compare Players',        'Two players side by side'],
      ['draft.html',           'Big Board',              'NBA Draft prospects ranked'],
      ['development.html',     'Development',            'Who improved the most year to year'],
      ['roles.html#arch',      'Archetypes',             'Players grouped by playing style'],
      ['#Transfers & recruiting'],
      ['transfers.html',       'Transfer Portal',        'Every transfer and where they went'],
      ['transfer-fit.html',    'Transfer Fit',           'Which teams fit a transfer best'],
      ['recruiting.html',      'Recruiting',             'Commits and the recruit rankings'],
      ['recruiting-history.html', 'Recruit Hype Check',  'Did top recruits live up to their ranking'],
    ]],
    ['Stats', [
      ['#Overview'],
      ['analytics.html',       'Advanced Stats',         'Efficiency and impact leaderboards'],
      ['passing.html',         'Passing & Roles',        'Who assists whom, bench and starter roles'],
      ['#Shooting'],
      ['shot-genome.html',     'Shot Genome',            'Shot quality vs shot-making for every player'],
      ['shot-quality.html',    'Shot Quality',           'How good the looks are, by team and player'],
      ['shot-compare.html',    'Shot Chart Compare',     'Two shot charts side by side: teams, conferences, seasons'],
      ['mastery.html',         'Mastery Shots',          'Points per shot, measured against 1.1'],
      ['hunt-great.html',      'Hunt Great',             'Great, average and bad shots by shot clock'],
      ['shot-aftermath.html',  'Shot Aftermath',         'What happens after each kind of shot'],
      ['#Lineups & impact'],
      ['wowy.html',            'WOWY Lineups / On-Off',  'How a team plays with or without a player'],
      ['statshift.html',       'Stat Line Shift',        'A player\'s line with or without a teammate'],
      ['#Game moments'],
      ['crunch.html',          'Crunch-Time Takeovers',  'Who takes over late in close games'],
      ['game-situations.html', 'Game Situations',        'Stats by score, time and situation'],
      ['plays.html',           'Play Finder',            'Search every play since 2008'],
    ]],
    ['More', [
      ['explore.html',         'Explore all tools',      'Every tool on one page'],
      ['coach-tier.html',      'Scouting & Game Prep',   'Opponent reports for coaches'],
      ['coaches.html',         'Coaching Lab',           'Coach profiles and styles'],
      ['bet/',                 'TDC Bet ↗',              'Lines, picks and betting trends'],
      ['#Community'],
      ['buzz.html',            'News',                   'Headlines around college hoops'],
      ['community.html',       'Community',              'Forum and discussions'],
      ['fan.html',             'Fan Sites',              'Team fan pages and articles'],
      ['league.html',          'Fantasy',                'Fantasy leagues'],
      ['games.html',           'Games',                  'Daily trivia and guessing games'],
      ['dynasty.html',         'Dynasty (beta)',         'Run a program season by season'],
      ['#Account'],
      ['customize.html',       'Customize',              'Build your own depth charts'],
      ['pricing.html',         'Pricing',                'Plans and Pro access'],
      ['changelog.html',       "What's New",             'Recent changes to the site'],
      ['just-added.html',      'Just Added',             'Newest tools and data'],
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
      // ESPN has no dark conference logos (team logos get swapped to 500-dark below): a thin light outline keeps black marks visible
      ':root[data-theme="dark"] img[src*="/teamlogos/ncaa_conf/"]{filter:drop-shadow(0 0 .7px rgba(255,255,255,.85)) drop-shadow(0 0 .7px rgba(255,255,255,.6));}',
      '.tdn-wrap{border-bottom:1px solid var(--border);background:var(--bg);position:sticky;top:0;z-index:400;font-family:\'Inter\',system-ui,sans-serif;}',
      '.tdn-wrap button,.tdn-wrap a{font-family:inherit;}',
      // the bar's contents sit in the same 1400px column as the page, like CFB
      // same column maths as tdc-column.css, so the bar lines up with the page at EVERY width:
      // content starts at max(gutter, the space that centres a 1400px column)
      ':root{--tdc-col:1400px;--tdc-gut:64px;}',
      '@media(max-width:1100px){:root{--tdc-gut:32px;}}',
      '@media(max-width:760px){:root{--tdc-gut:14px;}}',
      '.tdn-col{padding:0 max(var(--tdc-gut),calc((100% - var(--tdc-col)) / 2));}',
      '.tdn-top{height:52px;display:flex;align-items:center;justify-content:space-between;min-width:0;}',
      ".tdn-logo{font-family:'Playfair Display',serif;font-weight:800;font-size:20px;color:var(--text);text-decoration:none;letter-spacing:-.01em;white-space:nowrap;}",
      '.tdn-logo span{color:var(--accent);}',
      // sport badge, mirroring CFB's green turf 'CFB': basketball's is hardwood
      ".tdn-logo em{font-style:normal;font-family:'Inter',sans-serif;font-size:10px;font-weight:800;letter-spacing:.14em;color:var(--court-on,#fff);background:var(--court,#A8531F);padding:3px 6px;margin-left:8px;vertical-align:3px;border-radius:3px;}",
      '.tdn-x{font-size:11px!important;font-weight:700!important;letter-spacing:.08em!important;}',
      '@media(max-width:520px){.tdn-x{display:none!important;}}',
      // PHONES (Sept 29 2026): signed in, the avatar + username + Sign Out made the header wider than a
      // 390px phone, so iOS zoomed the WHOLE page out to fit it — tiny text everywhere, and the desktop-only
      // Football link came back. On phones the header shows the avatar only (the name is on the profile),
      // header items may shrink, and nothing past the screen edge can widen the page again.
      'html{overflow-x:clip;}',
      '.tdn-top>*{min-width:0;}',
      '@media(max-width:640px){#navActions a[href="profile.html"] span{display:none!important;}#navActions a[href="profile.html"] img,#navActions a[href="profile.html"]>div{width:28px!important;height:28px!important;}.tdn-logo em{margin-left:5px;padding:2px 5px;}}',
      '.tdn-actions{display:flex;align-items:center;gap:20px;}',
      '.tdn-actions a{font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);text-decoration:none;transition:color .15s;}',
      '.tdn-actions a:hover{color:var(--text);}',
      '.tdn-fol{font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--accent,#a8843c)!important;text-decoration:none;margin-right:14px;white-space:nowrap}.tdn-fol[aria-current]{text-decoration:underline;text-underline-offset:4px}',
      '.tdn-signin{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--bg)!important;background:var(--text);border:none;padding:5px 12px;cursor:pointer;text-decoration:none;display:inline-block;transition:opacity .15s;}',
      '.tdn-signin:hover{opacity:.85;}',
      '.tdn-wrap .theme-toggle{background:none;border:1px solid var(--border2);color:var(--text3);font-size:12px;width:28px;height:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color .15s,color .15s;}',
      '.tdn-wrap .theme-toggle:hover{border-color:var(--accent);color:var(--text);}',
      '.tdn-rowwrap{border-top:1px solid var(--border);}',
      '.tdn-row{display:flex;flex-wrap:wrap;align-items:stretch;gap:2px;position:relative;}',
      '.tdn-group{position:relative;display:flex;align-items:stretch;flex-shrink:0;}',
      '.tdn-btn{font-family:inherit;background:none;border:none;cursor:pointer;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);padding:0 14px;height:36px;display:flex;align-items:center;gap:6px;white-space:nowrap;position:relative;transition:color .18s;}',
      '.tdn-row .tdn-group:first-child .tdn-btn{padding-left:0;}',
      '.tdn-btn .car{width:7px;height:7px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg) translateY(-1px);opacity:.65;transition:transform .2s;}',
      '.tdn-btn:hover{color:var(--text);}',
      '.tdn-btn.active{color:var(--text);}',
      ".tdn-btn.active::after{content:'';position:absolute;bottom:0;left:15px;right:15px;height:2px;background:var(--accent);border-radius:1px 1px 0 0;}",
      '.tdn-row .tdn-group:first-child .tdn-btn.active::after{left:0;}',
      '.tdn-group.open .tdn-btn{color:var(--text);}',
      '.tdn-group.open .tdn-btn .car{transform:rotate(225deg) translateY(2px);}',
      '.tdn-menu{position:absolute;top:100%;left:0;min-width:200px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;box-shadow:0 10px 26px rgba(0,0,0,.10);padding:6px;opacity:0;visibility:hidden;transform:translateY(-6px);transition:opacity .16s,transform .16s;z-index:60;}',
      '.tdn-row .tdn-group:first-child .tdn-menu{left:0;}',
      // a CLOSED menu still occupies layout (visibility:hidden), and a right-hand group's panel
      // stuck past the phone's edge, so every page scrolled sideways ~50px. Closed = no layout.
      '.tdn-menu{display:none;}',
      '.tdn-group.open .tdn-menu{display:block;}',
      // and it can never hang off the right edge of a phone
      '@media(max-width:760px){.tdn-menu{left:auto;right:0;max-width:calc(100vw - 24px);}}',
      '.tdn-group.open .tdn-menu{opacity:1;visibility:visible;transform:translateY(0);}',
      // site search (owner, Nov 2 2026: "a player or team search tab at the top … for any time")
      '.tdn-srch{margin-left:auto;}',
      '.tdn-srch .tdn-btn svg{width:14px;height:14px;flex-shrink:0;}',
      '.tdn-menu.tdn-sp{left:auto;right:0;width:min(460px,calc(100vw - 24px));max-width:none;padding:10px;}',
      '.tdn-sp input{width:100%;box-sizing:border-box;font:500 15px Inter,system-ui,sans-serif;color:var(--text);background:var(--bg2);border:1px solid var(--border2);border-radius:6px;padding:10px 12px;outline:none;-webkit-appearance:none;}',
      '.tdn-sp input:focus{border-color:var(--accent);}',
      '.tdn-sr{max-height:min(62vh,520px);overflow-y:auto;margin-top:6px;}',
      '.tdn-sr h6{margin:10px 4px 4px;font:700 10px Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);}',
      '.tdn-sp .tdn-sr a{display:flex;align-items:center;gap:10px;padding:8px 8px;border-radius:5px;text-decoration:none;color:var(--text);font-size:14px;line-height:1.25;text-transform:none;letter-spacing:0;font-weight:600;}',
      '.tdn-sp .tdn-sr a:hover,.tdn-sp .tdn-sr a.on{background:var(--bg2);}',
      '.tdn-sr a img{width:22px;height:22px;object-fit:contain;flex-shrink:0;}',
      '.tdn-sr a .tx{min-width:0;flex:1;}',
      '.tdn-sr a .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.tdn-sr a .ds{display:block;font-size:12px;font-weight:500;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.tdn-sr a .tg{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);flex-shrink:0;}',
      '.tdn-sr .none{padding:10px 8px;font-size:13px;color:var(--text3);}',
      '.tdn-sr .hint{padding:8px 8px 2px;font-size:12px;color:var(--text3);}',
      '@media(max-width:640px){.tdn-srch .tdn-srl{display:none;}.tdn-srch .tdn-btn{padding:0 2px 0 6px;}.tdn-sp input{font-size:16px;}}',
      '.tdn-menu a{display:block;font-size:12.5px;font-weight:600;letter-spacing:.01em;text-transform:none;color:var(--text2);text-decoration:none;padding:8px 12px;border-radius:4px;white-space:nowrap;transition:background .13s,color .13s;}',
      // each item: name, then one plain line saying what it is
      "a.tdn-btn{text-decoration:none;}",
      '.tdn-menu:not(.tdn-sp){width:290px;max-height:min(78vh,720px);overflow-y:auto;}',
      '.tdn-menu.tdn-wide{width:600px;column-count:2;column-gap:6px;}',
      '.tdn-menu:not(.tdn-sp) a{white-space:normal;padding:7px 12px;break-inside:avoid;}',
      '.tdn-menu a b{display:block;font-weight:600;color:var(--text);}',
      '.tdn-menu a span{display:block;font-size:11.5px;font-weight:500;color:var(--text3);line-height:1.35;margin-top:1px;}',
      '.tdn-menu a.active b{color:var(--accent);}',
      '.tdn-mh{margin:10px 12px 3px;font:700 9.5px Inter,system-ui,sans-serif;letter-spacing:.13em;text-transform:uppercase;color:var(--accent);break-after:avoid;}',
      '.tdn-mh:first-child{margin-top:4px;}',
      // phones: a menu opens full width under the bar instead of hanging off one button
      '@media(max-width:760px){.tdn-row{position:relative;}.tdn-group{position:static;}.tdn-menu:not(.tdn-sp),.tdn-menu.tdn-wide{left:0!important;right:0!important;width:auto;max-width:none;column-count:1;max-height:72vh;}}',
      '.tdn-menu a:hover{background:var(--bg3);color:var(--text);}',
      '.tdn-menu a.active{color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent);}',
      '.tdn-signout{font-family:inherit;background:none;border:1px solid var(--border2);border-radius:4px;cursor:pointer;font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);padding:4px 9px;white-space:nowrap;transition:color .15s,border-color .15s;}',
      '.tdn-signout:hover{color:var(--text);border-color:var(--text3);}',
      '@media(max-width:900px){',
      '.tdn-top{height:44px;}',
      '.tdn-signout{padding:4px 7px;font-size:10px;letter-spacing:.02em;}',
      '.tdn-logo{font-size:15px;}',
      '.tdn-signin{padding:5px 8px;font-size:10px;letter-spacing:.02em;}',
      '.tdn-fol{margin-right:4px;font-size:0!important;display:inline-block;width:20px;overflow:hidden;line-height:1}.tdn-fol::first-letter{font-size:18px}',
      '.tdn-actions{gap:8px;}',
      '.tdn-actions a{font-size:10px;}',
      '.tdn-wrap .theme-toggle{width:28px;height:28px;font-size:13px;}',
      
      '.tdn-btn{padding:0 10px;height:34px;font-size:10px;letter-spacing:.04em;}',
      '.tdn-menu{min-width:170px;}',
      '}',
      // phones: the five menus on ONE row (it used to wrap to two, the second indented)
      '@media(max-width:640px){.tdn-logo em{font-size:11px!important;}.tdn-signin,.tdn-actions a{font-size:11px!important;}.tdn-wrap .theme-toggle{font-family:inherit;font-size:13px!important;}.tdn-row{flex-wrap:nowrap;justify-content:space-between;gap:0;}.tdn-btn{padding:0 4px;font-size:11px;letter-spacing:.03em;}.tdn-btn .car{display:none;}.tdn-btn.active::after{left:4px;right:4px;}.tdn-actions>a,.tdn-actions>button{position:relative;}.tdn-actions>a::after,.tdn-actions>button::after{content:"";position:absolute;inset:-9px -4px;}}',
    ].join('');
    document.head.appendChild(css);
    // phones: one type system across every page (tdc-mobile.js; desktop untouched)
    if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches && !document.getElementById('tdc-mobile-js')) {
      var mj = document.createElement('script'); mj.id = 'tdc-mobile-js'; mj.src = 'tdc-mobile.js?v=22'; document.head.appendChild(mj);
    }
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
    if (typeof g[1] === 'string') {   // a plain link (Scores)
      var on = g[1] === here || (g[2] || []).indexOf(here) >= 0;
      return '<div class="tdn-group"><a class="tdn-btn' + (on ? ' active' : '') + '" href="' + g[1] + '">' + esc(g[0]) + '</a></div>';
    }
    var inGroup = g[1].some(function (t) { return t[0].toLowerCase().split('#')[0].split('?')[0] === here; });
    var items = g[1].map(function (t) {
      if (t[0].charAt(0) === '#') return '<h6 class="tdn-mh">' + esc(t[0].slice(1)) + '</h6>';
      var a = t[0].toLowerCase() === here ? ' class="active"' : '';
      return '<a href="' + t[0] + '"' + a + '><b>' + esc(t[1]) + '</b>' + (t[2] ? '<span>' + esc(t[2]) + '</span>' : '') + '</a>';
    }).join('');
    var wide = g[1].length > 12 ? ' tdn-wide' : '';
    return '<div class="tdn-group">'
      + '<button class="tdn-btn' + (inGroup ? ' active' : '') + '" type="button">' + esc(g[0]) + '<span class="car"></span></button>'
      + '<div class="tdn-menu' + wide + '">' + items + '</div></div>';
  }).join('');

  var wrap = document.createElement('div');
  wrap.className = 'tdn-wrap';
  wrap.innerHTML =
    '<div class="tdn-col"><div class="tdn-top">' +
      '<a class="tdn-logo" href="index.html">The <span>Depth</span> Chart</a>' +
      '<div class="tdn-actions">' +   // (Football link removed from the top bar, owner Oct 2026)
      '<a class="tdn-fol" href="following.html" title="Players and teams you follow"' + (here === 'following.html' ? ' aria-current="page"' : '') + '>★ Following</a>' +
      '<div class="tdn-actions" id="navActions">' +
        '<button class="theme-toggle" onclick="toggleTheme()" id="themeBtn" title="Toggle dark mode">' + themeGlyph + '</button>' +
        '<a href="signin.html" style="font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);text-decoration:none;">Sign In</a>' +
        '<a href="pricing.html" class="tdn-signin">Subscribe</a>' +
      '</div></div>' +
    '</div></div>' +
    '<div class="tdn-rowwrap"><div class="tdn-col"><div class="tdn-row">' + groupsHtml +
      '<div class="tdn-group tdn-srch"><button class="tdn-btn" type="button" aria-label="Search players and teams">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/></svg><span class="tdn-srl">Search</span></button>' +
        '<div class="tdn-menu tdn-sp"><input type="search" placeholder="Any player or team, any season" aria-label="Search players and teams" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<div class="tdn-sr"><div class="hint">Try “Cooper Flagg”, “Gonzaga”, or add a year: “Duke 2015”.</div></div></div></div>' +
    '</div></div></div>';

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

  // ── Site search: every player and team, every season ──
  // players = this season's rosters (players) + all 20 years of player_history, grouped into one row per person
  // (ESPN id first, so namesakes stay apart); teams = the D-I list. A year in the query ("Duke 2015", "2014-15")
  // narrows players to that season and opens the team page on it.
  function wireSearch() {
    var g = wrap.querySelector('.tdn-srch'); if (!g) return;
    var inp = g.querySelector('input'), out = g.querySelector('.tdn-sr'), btn = g.querySelector('.tdn-btn');
    var H = { apikey: KEY }, seq = 0, timer = 0, hint = out.innerHTML;
    btn.addEventListener('click', function () { if (g.classList.contains('open')) { inp.focus(); inp.select(); } });   // same tap, so phones raise the keyboard
    g.querySelector('.tdn-sp').addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('keydown', function (e) {
      var t = e.target, typing = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (!g.classList.contains('open')) btn.click(); else inp.focus(); }
    });
    var lab = function (y) { return (y - 1) + '-' + String(y).slice(2); };
    var get = function (path) { return fetch(SB + '/rest/v1/' + path, { headers: H }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }); };
    var logo = function (team) { try { var c = window.tdcTeamColor && window.tdcTeamColor(team); return (c && c.logo) || ''; } catch (e) { return ''; } };
    var row = function (href, name, desc, tag, img) {
      return '<a href="' + esc(href) + '">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '') +
        '<span class="tx"><span class="nm">' + esc(name) + '</span>' + (desc ? '<span class="ds">' + esc(desc) + '</span>' : '') + '</span>' + (tag ? '<span class="tg">' + esc(tag) + '</span>' : '') + '</a>';
    };
    function run() {
      var raw = inp.value.trim(), y = null, m;
      if ((m = raw.match(/\b(?:19|20)(\d{2})\s*[-–\/]\s*(\d{2})\b/))) { y = 2000 + +m[2]; raw = raw.replace(m[0], ''); }
      else if ((m = raw.match(/\b((?:19|20)\d{2})\b/))) { y = +m[1]; raw = raw.replace(m[0], ''); }
      var text = raw.replace(/[^\w .'\-]/g, ' ').replace(/\s+/g, ' ').trim();
      if (text.length < 2) { out.innerHTML = hint; return; }
      var my = ++seq, pat = encodeURIComponent('*' + text.replace(/ /g, '*') + '*'), cur = !y || y >= 2027;
      out.innerHTML = '<div class="none">Searching…</div>';
      Promise.all([
        cur ? get('players?name=ilike.' + pat + '&select=id,name,team,position,yr,espn_id&order=name&limit=12') : Promise.resolve([]),
        get('player_history?name=ilike.' + pat + '&select=name,team,season_year,espn_id&order=season_year.desc&limit=300' + (y && !cur ? '&season_year=eq.' + y : '')),
        get('teams?name=ilike.' + pat + '&select=name,conference&order=name&limit=8'),
      ]).then(function (res) {
        if (my !== seq) return;
        var P = res[0] || [], hist = res[1] || [], T = res[2] || [];
        // one entry per person: ESPN id when we have it; an id-less season joins the same-named person
        var by = {}, byName = {}, list = [];
        hist.forEach(function (h) { if (h.espn_id) { var k = 'e' + h.espn_id; if (!by[k]) { by[k] = { name: h.name, espn: h.espn_id, rows: [] }; list.push(by[k]); byName[h.name.toLowerCase()] = by[k]; } by[k].rows.push(h); } });
        hist.forEach(function (h) { if (h.espn_id) return; var k = h.name.toLowerCase(), e = byName[k];
          if (!e) { e = byName[k] = { name: h.name, espn: null, rows: [] }; list.push(e); } e.rows.push(h); });
        P.forEach(function (p) {
          var e = (p.espn_id && by['e' + p.espn_id]) || byName[p.name.toLowerCase()];
          if (!e) { e = { name: p.name, espn: p.espn_id || null, rows: [] }; list.push(e); byName[p.name.toLowerCase()] = e; }
          e.now = p;
        });
        var q = text.toLowerCase(), score = function (e) { var n = e.name.toLowerCase(); return (n === q ? 0 : n.indexOf(q) === 0 ? 1 : 2); };
        var last = function (e) { return e.now ? 2027 : e.rows.length ? e.rows[0].season_year : 0; };
        list.sort(function (a, b) { return score(a) - score(b) || last(b) - last(a) || a.name.localeCompare(b.name); });
        var pl = list.slice(0, 10).map(function (e) {
          var yrs = e.rows.map(function (r) { return r.season_year; }), teams = [];
          if (e.now) teams.push(e.now.team);
          e.rows.forEach(function (r) { if (r.team && teams.indexOf(r.team) < 0) teams.push(r.team); });
          var lo = Math.min.apply(null, yrs.length ? yrs : [2027]), hi = e.now ? 2027 : Math.max.apply(null, yrs);
          var span = lo === hi ? lab(hi) : lab(lo) + ' to ' + lab(hi);
          var desc = teams.slice(0, 3).join(' · ') + (teams.length > 3 ? ' +' + (teams.length - 3) : '') + ' · ' + span;
          var href = e.now ? 'player.html?id=' + e.now.id
            : e.espn ? 'player.html?espn=' + e.espn + '&name=' + encodeURIComponent(e.name) + (y ? '&season=' + y : '')
            : 'player.html?name=' + encodeURIComponent(e.name) + '&team=' + encodeURIComponent(e.rows[0].team) + '&season=' + e.rows[0].season_year;
          return row(href, e.name, desc, e.now ? (e.now.position || 'Now') : '', logo(teams[0]));
        }).join('');
        var tm = T.map(function (t) {
          var old = y && y < 2027;
          return row('team.html?team=' + encodeURIComponent(t.name) + (old ? '&season=' + y : ''), t.name, (t.conference || '') + (old ? ' · ' + lab(y) + ' roster' : ''), '', logo(t.name));
        }).join('');
        out.innerHTML = (tm ? '<h6>Teams</h6>' + tm : '') + (pl ? '<h6>Players' + (y ? ' · ' + lab(y) : '') + '</h6>' + pl : '') +
          (!tm && !pl ? '<div class="none">No players or teams match “' + esc(inp.value.trim()) + '”.</div>' : '');
        var f = out.querySelector('a'); if (f) f.classList.add('on');
      });
    }
    inp.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 220); });
    inp.addEventListener('keydown', function (e) {
      var as = [].slice.call(out.querySelectorAll('a')), i = as.findIndex(function (a) { return a.classList.contains('on'); });
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!as.length) return;
        if (i >= 0) as[i].classList.remove('on');
        i = (i + (e.key === 'ArrowDown' ? 1 : -1) + as.length) % as.length; as[i].classList.add('on'); as[i].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') { e.preventDefault(); if (i >= 0) location.href = as[i].getAttribute('href'); else { clearTimeout(timer); run(); } }
    });
  }

  function mount() {
    if (!document.body) return;
    // remove any legacy inline nav so only the grouped bar remains
    var old = document.querySelectorAll('.nav-wrap'); old.forEach(function (n) { n.parentNode && n.parentNode.removeChild(n); });
    if (document.querySelector('.tdn-wrap') !== wrap) document.body.insertBefore(wrap, document.body.firstChild);
    // scores strip above the bar (tdc-ticker.js): scrolls away, the bar stays pinned
    if (!window.TDC_NO_TICKER && !document.querySelector('.tdt')) {
      var tk = document.createElement('div'); tk.className = 'tdt'; tk.setAttribute('aria-label', 'Scores');
      document.body.insertBefore(tk, wrap);
      var go = function () { if (window.TDC_TICKER) TDC_TICKER.mount(tk); };
      if (window.TDC_TICKER) go(); else { var ts = document.createElement('script'); ts.src = 'tdc-ticker.js?v=3'; ts.onload = go; ts.onerror = function () { tk.remove(); }; document.head.appendChild(ts); }
    }
    wireMenus();
    wireSearch();
    upgradeAuth();
    watchActions();
  }

  // member badge (premium/pro/coach seal or verified dot) — shared module tdc-badge.js; load it if the
  // page didn't, and re-run the auth upgrade once it lands so the seal appears next to the name.
  function badge(p) { return (window.TDC_BADGE && TDC_BADGE.html(p)) || ''; }
  function ensureBadge(cb) {
    if (window.TDC_BADGE) return cb();
    if (document.getElementById('tdc-badge-js')) return;
    var sc = document.createElement('script'); sc.id = 'tdc-badge-js'; sc.src = 'tdc-badge.js?v=1'; sc.onload = cb; document.head.appendChild(sc);
  }
  // ── Auth-aware actions: avatar/username when signed in, else Sign In/Subscribe ──
  function upgradeAuth() {
    if (!window.TDC_BADGE) { ensureBadge(upgradeAuth); return; }
    var s; try { s = JSON.parse(localStorage.getItem('tdc_session') || 'null'); } catch (e) { return; }
    if (!s || !s.access_token || !s.user || !s.user.id) return;
    fetch(SB + '/rest/v1/profiles?id=eq.' + s.user.id + '&select=username,avatar_url,plan,verified',
      { headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token } })
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        var p = rows && rows[0]; if (!p) return;
        // First sign-in with no username yet → finish account setup before anything else.
        // (welcome.html itself, and the sign-in page, are exempt so the flow can't loop.)
        if (!p.username && !/(^|\/)(welcome|pricing)\.html$/.test(location.pathname)) {
          var here = location.pathname.split('/').pop() + location.search;
          location.replace('welcome.html?next=' + encodeURIComponent(here)); return;
        }
        var u = p.username || (s.user.email ? s.user.email.split('@')[0] : 'User');
        var el = document.getElementById('navActions'); if (!el) return;
        var av = p.avatar_url
          ? '<img src="' + p.avatar_url + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid var(--accent);">'
          : '<div style="width:32px;height:32px;border-radius:50%;background:var(--bg2);border:2px solid var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--accent);">' + u[0].toUpperCase() + '</div>';
        el.innerHTML =
          '<button class="theme-toggle" onclick="toggleTheme()" id="themeBtn" title="Toggle dark mode">' + themeGlyph + '</button>' +
          '<a href="profile.html" style="display:flex;align-items:center;gap:8px;text-decoration:none;">' + av +
          '<span style="display:inline-flex;align-items:center;font-size:13px;font-weight:700;color:var(--text);">' + u + badge(p) + '</span></a>';
      })
      .catch(function () {});
  }

  // ── Sign Out, next to the avatar on every page ──
  // Several pages still run their own inline "AUTH NAV" script that rewrites #navActions
  // after we do, so rather than only baking the button into upgradeAuth's markup we watch
  // the element and re-add it whenever it shows a signed-in avatar (a profile.html link).
  window.tdcSignOut = function () {
    var s; try { s = JSON.parse(localStorage.getItem('tdc_session') || 'null'); } catch (e) {}
    var done = function () {
      try { localStorage.removeItem('tdc_session'); localStorage.removeItem('tdc_persist'); sessionStorage.removeItem('tdc_alive'); } catch (e) {}
      location.href = 'index.html';
    };
    if (!s || !s.access_token) return done();
    fetch(SB + '/auth/v1/logout', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + s.access_token } })
      .catch(function () {}).then(done);
  };
  function ensureSignOut(el) {
    if (!el || !el.querySelector('a[href="profile.html"]')) return;
    // owner only: a "Console" link to owner.html (Rebuild projections / Republish ratings live there)
    if (window.tdcIsOwner && window.tdcIsOwner() && !el.querySelector('.tdn-owner')) {
      var o = document.createElement('a');
      o.href = 'owner.html'; o.className = 'tdn-signout tdn-owner'; o.textContent = 'Console'; o.style.textDecoration = 'none';
      el.appendChild(o);
    }
    if (el.querySelector('.tdn-signout:not(.tdn-owner)')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'tdn-signout'; b.textContent = 'Sign Out';
    b.onclick = window.tdcSignOut;
    el.appendChild(b);
  }
  function watchActions() {
    var el = document.getElementById('navActions'); if (!el) return;
    ensureSignOut(el);
    if (window.MutationObserver) new MutationObserver(function () { ensureSignOut(el); }).observe(el, { childList: true });
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  // Dark mode: navy/black team logos vanish on the charcoal page, so swap every ESPN college logo for ESPN's own
  // dark-background variant (teamlogos/ncaa/500 → 500-dark) and back when the theme flips. Covers images drawn later
  // (tables, ticker) via one observer; a missing dark file falls back to the normal logo.
  (function darkLogos() {
    var LIGHT = '/teamlogos/ncaa/500/', DARK = '/teamlogos/ncaa/500-dark/';
    var root = document.documentElement;
    function isDark() { return root.getAttribute('data-theme') === 'dark'; }
    function fix(img) {
      var src = img.getAttribute('src');
      if (!src || src.indexOf('/teamlogos/ncaa/500') < 0) return;
      if (isDark()) {
        if (src.indexOf(LIGHT) < 0 || img.dataset.tdcNoDark) return;
        img.addEventListener('error', function back() {
          img.removeEventListener('error', back);
          img.dataset.tdcNoDark = '1';
          img.setAttribute('src', img.getAttribute('src').replace(DARK, LIGHT));
        });
        img.setAttribute('src', src.replace(LIGHT, DARK));
      } else if (src.indexOf(DARK) >= 0) img.setAttribute('src', src.replace(DARK, LIGHT));
    }
    function scan(el) {
      if (el.tagName === 'IMG') fix(el);
      else if (el.querySelectorAll) Array.prototype.forEach.call(el.querySelectorAll('img[src*="/teamlogos/ncaa/500"]'), fix);
    }
    function start() {
      scan(document.body);
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'attributes') { if (m.target.tagName === 'IMG') fix(m.target); continue; }
          for (var j = 0; j < m.addedNodes.length; j++) if (m.addedNodes[j].nodeType === 1) scan(m.addedNodes[j]);
        }
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      new MutationObserver(function () { scan(document.body); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    }
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  })();
})();
