/* tdc-coachlinks.js — "same team, other tools" deep-dive bar for the Coach's Tier.
   Each team-based tool calls TDC_COACHLINKS.bar(teamFullName) in its render output;
   it links to every OTHER tool for the same team via ?team=, grouped by hub so the
   growing tool list stays scannable. A coach can pivot from a scouting report to
   that team's shot profile, pairings, creation, etc. without re-searching.
   Injects its own scoped CSS once. */
window.TDC_COACHLINKS = (function () {
  // [hub label, [[href, name], …]] — grouped so the bar reads cleanly as it grows
  var GROUPS = [
    ['Scouting', [
      ['scout.html',           'Scouting Report'],
      ['offense.html',         'Offense'],
      ['defense.html',         'Defense'],
      ['game-review.html',     'Game Review'],
      ['game-breakdown.html',  'Game Breakdown'],
    ]],
    ['Self-Scout', [
      ['self-scout.html',     'Self-Scout Report'],
      ['moneyball.html',      'Moneyball'],
      ['consistency.html',    'Consistency'],
      ['lineups.html',        'Lineups'],
      ['team-clutch.html',    'Team Clutch'],
      ['adjustments.html',    'Adjustments'],
    ]],
    ['Personnel', [
      ['dossier.html',        'Player Dossier'],
      ['predictive-profile.html', 'Predictive Profile'],
      ['roles.html',         'Roles & Fit'],
      ['matchup-advantage.html', 'Matchup Advantage'],
      ['roster-dev.html',    'Development'],
    ]],
  ];
  function ensureCss() {
    if (document.getElementById('cl-css')) return;
    var s = document.createElement('style'); s.id = 'cl-css';
    s.textContent =
      '.cl-bar{border:1px solid var(--border);border-radius:14px;margin:28px 0 2px;padding:13px 16px;'
      + 'background:radial-gradient(120% 120% at 0 0,color-mix(in srgb,var(--accent) 7%,var(--bg2)),var(--bg2));}'
      + '.cl-bar .cl-lbl{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-bottom:11px;}'
      + '.cl-grp{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-bottom:8px;}'
      + '.cl-grp:last-child{margin-bottom:0;}'
      + '.cl-hub{font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);min-width:70px;flex-shrink:0;}'
      + '.cl-link{font-size:12px;font-weight:700;color:var(--text2);text-decoration:none;border:1px solid var(--border);border-radius:20px;padding:5px 12px;background:var(--bg);transition:border-color .15s,color .15s;}'
      + '.cl-link:hover{border-color:var(--accent);color:var(--accent);}';
    document.head.appendChild(s);
  }
  function esc(t) { return (''+t).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function bar(teamFull) {
    if (!teamFull) return '';
    ensureCss();
    var here = (location.pathname.split('/').pop() || '').toLowerCase();
    var q = encodeURIComponent(teamFull);
    var groups = GROUPS.map(function (g) {
      var links = g[1].filter(function (t) { return t[0] !== here; })
        .map(function (t) { return '<a class="cl-link" href="' + t[0] + '?team=' + q + '">' + esc(t[1]) + '</a>'; })
        .join('');
      return links ? '<div class="cl-grp"><span class="cl-hub">' + g[0] + '</span>' + links + '</div>' : '';
    }).join('');
    return '<div class="cl-bar"><div class="cl-lbl">Same team · other tools</div>' + groups + '</div>';
  }
  return { bar: bar };
})();
