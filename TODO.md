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
- [!] **2008-09 UNC roster has no player stats** — team.html "No roster data for 2008-09"
      even though it's rated the #1 team all-time (SRS). The season is in team_seasons but
      the roster/player rows (player_history / box_scores) are missing. Backfill the 08-09
      roster + per-player stats. *Done = 08-09 UNC depth chart + player stats render.*
      **May need a scrape + DB insert (user-run) — investigate source first.**
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

- [!] **On/off has no opponent/talent adjustment** — the reconstructed lineup NET/ORtg/DRtg
      (onoff.html + tdc-lineups) are unadjusted for opponent strength (SRS / Net), so a big
      swing on a bad team is overstated, and the per-stint ORtg/DRtg values are absurd
      (e.g. ORtg 321.4 / DRtg 206.0 — not real per-100). Add a talent/opponent adjuster
      (like adjust_team_dna does for teams) so on/off reads vs the field, not vs a weak
      slate. *Done = lineup ratings are opponent-adjusted and in a believable per-100 range.*
      **Likely a pipeline change (build_pbp_analytics) — investigate; may need a re-run.**

## Optional / backlog
- [ ] **Personnel Book pass 4** (roles.html) — dedicated shot-profile chart + full
      consistency distribution (largely redundant now; low priority).
