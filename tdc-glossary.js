/* tdc-glossary.js — plain-English descriptors for stats.
   Each entry says what the NUMBER MEANS, not how it's derived, for hover tooltips.
   Keyed by a short stat id. Use statTip(id) to fetch, or tipAttr(id) for a ready
   title="..." attribute. Shared by team.html, index.html, conference.html, etc. */
(function (g) {
  var TIP = {
    // ── Power Rating (formerly "Net Rating" / SRS) — the headline team number ──
    power: "How many points better than an average Division I team this team is, on a " +
           "neutral court and adjusted for who they played. A +18 team would beat an " +
           "average team by about 18. The gap between two teams' Power Ratings is the " +
           "projected point spread between them.",
    projrating: "The coming season's projected Power Rating: points better than an " +
           "average D1 team, built from the roster's talent and the coach, before any " +
           "games are played.",

    // ── record / ranking ──
    record:   "Wins and losses this season.",
    projseed: "The NCAA tournament seed (1 = best, 16 = worst) this team currently " +
              "projects to earn.",
    projrank: "Projected national rank among all Division I teams for the coming season.",
    natrank:  "National rank among all Division I teams, ordered by Power Rating.",
    ncaaseed: "The seed this team was given in the NCAA tournament that season.",

    // ── per-game box score ──
    ppg:    "Points scored per game.",
    oppg:   "Points allowed per game. Lower is better.",
    fg_pct: "Percentage of field goals (2s and 3s together) that go in.",
    tp_pct: "Percentage of three-point shots that go in.",
    ft_pct: "Percentage of free throws that go in.",
    rpg:    "Rebounds pulled down per game (offensive and defensive).",
    apg:    "Assists per game — passes that led directly to a made basket.",
    topg:   "Turnovers given away per game. Lower is better.",
    spg:    "Steals per game.",
    bpg:    "Shots blocked per game.",
    oreb:   "Offensive rebounds per game — missed shots the team grabbed for another chance.",
    dreb:   "Defensive rebounds per game — opponent misses the team secured to end the possession.",
    ato:    "Assist-to-turnover ratio — how many assists the team records for every turnover. Higher means cleaner, more efficient ball movement.",
    winpct: "Percentage of games won.",

    // ── efficiency / tempo (Team DNA) ──
    ortg:   "Points scored per 100 possessions — scoring efficiency, independent of how " +
            "fast the team plays.",
    drtg:   "Points allowed per 100 possessions — defensive efficiency, independent of " +
            "pace. Lower is better.",
    neteff: "Scoring efficiency minus defensive efficiency, per 100 possessions: how much " +
            "a team outscores opponents once pace is stripped out. (Different scale from " +
            "Power Rating, which is on the point-margin scale.)",
    tempo:  "Possessions per game — how fast the team plays. Higher means a faster style.",
    efg:    "Shooting percentage that gives extra credit for threes being worth more (a " +
            "made 3 counts like 1.5 made 2s). A better read on shooting than raw FG%.",
    ts:     "Overall shooting efficiency, counting 2s, 3s and free throws all together.",

    // ── grades shown on the team hero ──
    coach:   "This coach's career grade (0–99) — how much he has helped his teams win " +
             "beyond what their talent alone would predict.",
    depth:   "How strong the team is beyond its starters — the quality of the bench.",
    recruit: "The strength of the incoming recruiting class.",
    nilteam: "This program's overall NIL spending power tier.",
    expwins: "How many games the team would be expected to win given how well it scored " +
             "and defended. Compare to actual wins to see over- or under-performance.",
    luck:    "Actual wins minus expected wins. Positive means the team won more close " +
             "games than its scoring suggests; negative means fewer.",

    // ── the past-season letter-grade tiles on the team hero (A–F vs all of D1) ──
    gradeoverall: "This team's overall quality that season as a letter grade, based on " +
             "where its Power Rating ranked among all Division I teams.",
    gradepower: "A letter grade for the team's Power Rating — how it ranked nationally in " +
             "points better than an average D1 team.",
    gradeoff: "A letter grade for the offense, based on how its points-per-game ranked " +
             "among all Division I teams that season.",
    gradedef: "A letter grade for the defense, based on how few points it allowed relative " +
             "to the rest of Division I that season.",

    // ── projection: shot-luck de-luck ──
    shotluck: "How far this team's returning players shot ABOVE (or below) the quality of " +
             "their looks last season, in eFG points. Shooting over your shot quality is " +
             "only partly repeatable, so the projection regresses a hot number back down " +
             "(and bumps a cold one up) — a positive value is a regression caution.",
    continuity: "The share of last season's minutes that return on this year's roster. " +
             "High-continuity teams tend to over-perform their raw talent (chemistry and " +
             "system familiarity), so the projection gives them a small bump; heavily " +
             "rebuilt rosters get a small dock.",

    // ── Shot Genome (from shot location + type + who assisted, 2025-26) ──
    lookq: "The quality of the shots taken — the eFG% a league-average shooter would post on " +
             "this shot diet, before anyone even shoots. High = lots of layups and open threes; " +
             "low = a diet of tough, contested looks.",
    shotmaking: "Points added over an average shooter given the difficulty of the shots, per " +
             "100 shots, adjusted for competition. Pure finishing skill — how much better the " +
             "ball actually went in than the looks would predict.",
    creation: "Expected points a player's passing creates for teammates — each assist valued by " +
             "the quality of the look it set up (a corner-3 dime is worth more than a long-two).",
    selfcreation: "The share of a player's made baskets that came UNASSISTED — how much of his " +
             "own offense he generates off the dribble versus off setups from teammates.",
    consistency: "How steady a scorer is game to game. Low = a metronome who gives you the same " +
             "line every night; high = a boom-or-bust scorer with a low floor and a high ceiling. " +
             "Measured as the swing in his game-by-game points, ranked nationally.",

    // ── rankings-page rail panels ──
    contenders: "The teams projected to be strongest in the country this season, by Power Rating.",
    sleepers: "Teams with a strong projected roster that are still ranked outside the top 25 — " +
             "undervalued clubs to keep an eye on."
  };
  TIP.srs = TIP.power;         // legacy alias
  TIP.netrating = TIP.power;
  TIP.mpg = "Minutes played per game.";

  // label → key lookup, so a surface can be decorated by its visible stat label
  // (PPG, FG%, A/TO…) instead of a hand-maintained per-column id map.
  var LBL = { ppg: 'ppg', pts: 'ppg', rpg: 'rpg', reb: 'rpg', trb: 'rpg', apg: 'apg', ast: 'apg',
    mpg: 'mpg', min: 'mpg', mins: 'mpg', fg: 'fg_pct', '3p': 'tp_pct', tp: 'tp_pct', ft: 'ft_pct',
    stl: 'spg', spg: 'spg', blk: 'bpg', bpg: 'bpg', to: 'topg', tov: 'topg', topg: 'topg',
    oreb: 'oreb', orb: 'oreb', dreb: 'dreb', drb: 'dreb', ortg: 'ortg', drtg: 'drtg',
    net: 'neteff', neteff: 'neteff', efg: 'efg', ts: 'ts', tempo: 'tempo', poss: 'tempo',
    pace: 'tempo', ato: 'ato', winpct: 'winpct', oppg: 'oppg', opp: 'oppg' };
  function norm(s) { return ('' + s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function statTip(id) { return (id && TIP[id]) || ''; }
  function tipByLabel(label) { return TIP[LBL[norm(label)]] || ''; }
  function tipAttr(id) {
    var t = statTip(id);
    return t ? ' title="' + t.replace(/"/g, '&quot;') + '"' : '';
  }
  // apply tooltips to every element matching sel whose visible text is a known stat label
  function decorate(root, sel) {
    (root || document).querySelectorAll(sel).forEach(function (el) {
      if (el.getAttribute('title')) return;
      var t = tipByLabel(el.textContent); if (!t) return;
      el.setAttribute('title', t); el.style.textDecoration = 'underline dotted';
      el.style.textUnderlineOffset = '2px'; el.style.cursor = 'help';
    });
  }
  // decorate the common stat-label surfaces across a page. Only elements whose visible
  // text is a KNOWN stat label get a tooltip, and anything with an existing title is left
  // alone — so a broad selector is safe (non-stat headers simply don't match).
  function autoDecorate() { try { decorate(document, '.stat-card-label,.s-label,.stat-lbl,.stat-label,[data-stat],th,.th'); } catch (e) {} }
  g.TDC_TIP = TIP;
  g.statTip = statTip;
  g.tipAttr = tipAttr;
  g.tipByLabel = tipByLabel;
  g.tdcDecorateTips = decorate;
  g.tdcAutoTips = autoDecorate;
  // Auto-run on any page that includes this script: on load + two async waves (for
  // fetched/late-rendered content). No permanent observer — pages that keep re-rendering
  // (e.g. player tabs) add their own light observer.
  if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') autoDecorate(); else document.addEventListener('DOMContentLoaded', autoDecorate);
    try { setTimeout(autoDecorate, 700); setTimeout(autoDecorate, 1800); } catch (e) {}
  }
})(typeof window !== 'undefined' ? window : this);
