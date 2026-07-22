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
             "to the rest of Division I that season."
  };
  TIP.srs = TIP.power;         // legacy alias
  TIP.netrating = TIP.power;

  function statTip(id) { return (id && TIP[id]) || ''; }
  function tipAttr(id) {
    var t = statTip(id);
    return t ? ' title="' + t.replace(/"/g, '&quot;') + '"' : '';
  }
  g.TDC_TIP = TIP;
  g.statTip = statTip;
  g.tipAttr = tipAttr;
})(typeof window !== 'undefined' ? window : this);
