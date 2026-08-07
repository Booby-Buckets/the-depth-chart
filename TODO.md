# TODO

Working list for `/loop`. Newest requests captured from the session. Ordered roughly
by "quick UI wins" → "bigger data/model work". `[x]` done · `[ ]` open · `[!]` blocked.

> **The remaining open items are all blocked on a decision, a DB/pipeline action, or Node-verified
> model work — see [FOR_TOMORROW.md](FOR_TOMORROW.md) for the diagnosis + recommended fix on each.**

## UI / Design
- [x] **Deepen the dark grey** — darker dark palette site-wide (tdc-skin.css). *(done, cc026b3)*
- [x] **Uniform rankings dropdowns** — season + sort selects: same radius/height/custom caret. *(done, cc026b3)*
- [x] **Expanded report scrolls off-left** (index rankings) — fixed: `wireStickyScroll`
      sizes each open `.tr-drop` to the viewport and counter-translates it by `scrollLeft`
      (re-pinned on scroll / expand / resize). Verified at 768px. *(done, 4473032)*
- [x] **Team-color matching on player + team pages** — the projected-stat numbers/accents
      render generic purple (--accent) instead of the team color. Make the projected stats
      + accent slots use `--tc`/`--tcr` (team-tinted) on both player.html and team.html.
      *Done = Notre Dame reads navy/gold, not purple; verified on 2–3 teams incl. a dark navy.*
- [x] **Mainstream the color system** — user picked the **blue scale**. Unified grade/percentile
      coloring to one blue intensity ramp (bright/deep = better, muted grey-blue = weaker) across
      rankings (index gradeColor/pctColor/grade letters + sparks), player DB (roster letter + 2K
      grade classes), and stats table (analytics `_gradeCol`). Stat-cell heat was already this blue
      (`c1–c4` / `_statColor`). Left true +/- deltas (margin, Luck, Shot-Making, rank arrows) as
      red→green. Verified blue on player DB + no traffic-light strays; no console errors.
- [x] **Postseason achievement badges** — small result tag on team-season rows/pages:
      (Champ) (Runner-up) (Final 4) (Elite 8) (S16) (R64) (First 4). Source from postseason
      data. Show on team.html season header + the Analytics → Team History / stats rows.
      *Done = each tourney team-season shows its finish.*
- [x] **Logos on the stat/history tables** — team logos are missing next to team names on
      the Analytics → Team History (and player DB team cells use colored pills, not logos).
      Add the team logo where names appear. *Done = logos render on those tables.*
- [x] **Contender Quadrant not year-aware + kill "Volume vs Efficiency"** (analytics League
      Landscape). The quadrant loads a precomputed single-season JSON (chart_quadrant.json)
      once, so it never changes when you pick a year in the Conference-Talent `#confYear`
      selector. FIX: rebuild the quadrant from `team_dna[year].teams` (ORtg/DRtg per team)
      on `#confYear` change, and update its subtitle to the year. The "Volume vs Efficiency"
      bubbles chart isn't working → **remove that section** (user offered). *Fully scoped,
      quick. Done = quadrant redraws per selected year; bubbles gone.*

## Data
- [x] **2008-09 UNC roster has no player stats** — DONE. Backfilled the championship roster
      (17 players) into player_history via scripts/insert_unc_2009.sql (ESPN per-game stats,
      team='North Carolina' to match the join convention). Verified: team.html renders the full
      2008-09 depth chart (Lawson/Ellington/Green/Hansbrough starters, positions inferred), no
      "No roster data", no console errors. Pre-2012 so grades/WA are blank (no box_scores). This
      SQL is the template for backfilling other pre-2012 all-time teams.
- [x] **Players missing stats / WA / class on the stat pages** — RESOLVED by the espn_id
      backfill (the "—" rows were unlinked players who couldn't join player_advanced/history).
      Verified: 0 of 3,522 2025-26 rotation players (gp≥5, mpg≥8) are missing WA or class.

## Model
- [x] **Projections are inflated / "messed up again"** — FIXED. Root cause was NOT the live
      depth-chart engine (that already had Duncomb ~11) but the precomputed
      `stat_overall_projected.json` the player page + rankings read: it projected each box line
      from last year's usage with NO offensive discount for a level jump, and the usage-vacancy
      model (weight ∝ last_usg²) concentrated departed shots onto a mid-major transfer's inflated
      usage → depth-order-5 Duncomb slammed to the 34% usage cap → 21.0/10.3. Fix
      (build_stat_overall_projected.py): discount a transfer's projected usage by the SOS gap
      old→new school (never boosts on a step down); regenerated JSON — 295 transfers compress,
      all drops, returners identical; Duncomb 21.0/34%→14.4/23%, OVR 91→87. Verified on player
      page. *(done, b484eb8)*

- [!] **On/off lineup ratings are systematically broken** (bigger than the original "no opponent
      adjustment" framing). Diagnosis (Aug 2026): the per-lineup ORtg/DRtg/net in lineups.json are
      unreliable across the board, not just outliers — median ORtg is 77–83 even for poss≥400
      lineups (real ≈105), only ~30% land in a believable 80–135 band, and outliers hit ORtg 815
      on 46 poss (8 pts/possession, impossible). Root: points/possessions aren't attributed to the
      on-court five consistently in the pbp parse (build_pbp_analytics.py), AND `_combos` uses the
      OFFENSIVE possession estimate (fga−oreb+tov+0.44·fta) as the denominator for BOTH off_rtg and
      def_rtg (L400 — def should use defensive possessions). lineups.json stores only the computed
      ratings (no raw points), so it can't be fixed client-side, and a display filter would show a
      small still-wrong subset. **BLOCKED HERE:** needs the pbp parser debugged against real games +
      a full-season re-scrape — both require an env where ESPN/SR aren't WAF-blocked (this one is).
      Then add the opponent adjuster. Do it where the scrape runs so parser fixes can be verified.

## Optional / backlog
- [x] **Personnel Book pass 4** (roles.html) — DONE. Added a visual shot-profile chart
      (rim/mid/three frequency bars colored by efficiency) + a game-scoring distribution
      (per-game points histogram with floor/avg/ceiling). Renders per player with shot/box
      data; freshmen/no-data players skip gracefully. Verified on Houston, no console errors.
