/* tdc-coachlinks.js — "same team, other tools" deep-dive bar for the Coach's Tier.
   Each team-based tool calls TDC_COACHLINKS.bar(teamFullName) in its render output;
   it links to every OTHER tool for the same team via ?team=, so a coach can pivot
   from a scouting report to that team's shot profile, game review, consistency, etc.
   without re-searching. Injects its own scoped CSS once. */
window.TDC_COACHLINKS = (function () {
  var TOOLS = [
    ['scout.html',        'Scouting Report', '🔍'],
    ['shot-profile.html', 'Shot Profile',    '◎'],
    ['situational.html',  'Situational',     '📅'],
    ['game-review.html',  'Game Review',     '📋'],
    ['consistency.html',  'Consistency',     '📊'],
    ['lineups.html',      'Lineups',         '▦'],
    ['pairings.html',     'Pairings',        '🔗'],
    ['roles.html',        'Roles & Fit',     '🧩'],
    ['player-splits.html','Player Splits',   '🔀'],
    ['roster-dev.html',   'Development',      '📈'],
  ];
  function ensureCss() {
    if (document.getElementById('cl-css')) return;
    var s = document.createElement('style'); s.id = 'cl-css';
    s.textContent =
      '.cl-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:28px 0 2px;padding:12px 15px;border:1px solid var(--border);border-radius:12px;'
      + 'background:radial-gradient(120% 120% at 0 0,color-mix(in srgb,var(--accent) 7%,var(--bg2)),var(--bg2));}'
      + '.cl-bar .cl-lbl{font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);margin-right:2px;}'
      + '.cl-link{font-size:12px;font-weight:700;color:var(--text2);text-decoration:none;border:1px solid var(--border);border-radius:20px;padding:5px 12px;transition:border-color .15s,color .15s,background .15s;}'
      + '.cl-link:hover{border-color:var(--accent);color:var(--accent);background:var(--bg);}';
    document.head.appendChild(s);
  }
  function bar(teamFull) {
    if (!teamFull) return '';
    ensureCss();
    var here = (location.pathname.split('/').pop() || '').toLowerCase();
    var q = encodeURIComponent(teamFull);
    var esc = function (t) { return (''+t).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
    var links = TOOLS.filter(function (t) { return t[0] !== here; })
      .map(function (t) { return '<a class="cl-link" href="' + t[0] + '?team=' + q + '">' + t[2] + ' ' + esc(t[1]) + '</a>'; })
      .join('');
    return '<div class="cl-bar"><span class="cl-lbl">Same team, other tools</span>' + links + '</div>';
  }
  return { bar: bar };
})();
