# Coaching profiles pipeline

Build coach ↔ team-season history, per-team-season style signals, and
per-coach archetypes — the foundation for coach-aware player projections.

## Run order

1. **Create tables** — run `schema_coaching.sql` in the Supabase SQL editor
   (creates `coach_seasons`, `team_style`, `coach_profiles`).

2. **Coach history** (~15–20 min; scrapes ~360 Sports-Reference school pages,
   3s apart to respect their rate limit):
   ```
   python3 scripts/scrape_coaches.py --upload
   ```
   → `data/coach_seasons.json` + Supabase `coach_seasons`.

3. **Team style** (~15 min; rolls up 20 years of box scores):
   ```
   python3 scripts/compute_team_style.py --upload
   ```
   → `data/team_style.json` + Supabase `team_style`.

4. **Coach profiles + archetypes**:
   ```
   python3 scripts/build_coach_profiles.py --from-db --upload
   ```
   → `data/coach_profiles.json` + Supabase `coach_profiles`.

## What each style signal means

| field | reads as |
|---|---|
| `poss_pg` | pace (possessions/game) |
| `rotation_size` | avg players 10+ min/game — bench depth |
| `bench_min_pct` | share of minutes beyond the top-5 |
| `three_pa_rate` | 3PA / FGA — perimeter lean |
| `ft_rate` | FTA / FGA — rim/foul pressure |
| `ast_rate` | AST / FGM — ball movement |
| `opp_tov_pg` | turnovers forced — defensive pressure |
| `top_scorer_share` | top scorer's % of team points — star reliance |
| `min_hhi` | minute concentration (lower = deeper) |

Each is turned into a 0-100 percentile vs all coaches (`coach_profiles.pctl`)
and rolled into an `archetype` (e.g. *Up-Tempo Shooters*, *Deep-Bench Pressure*,
*Grind-It-Out Bigs*, *Star-Centric Iso*, *Motion Shooters*) + `tags`.

## Next (not yet built)

- **Projection integration** — use a team's coach archetype/percentiles to
  nudge player projections: minutes distribution (bench depth), counting-stat
  pace multiplier, 3PA volume, usage concentration.
- **UI** — coach profile view + surface the archetype on team/player pages.
