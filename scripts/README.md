# CBB Scraper — The Depth Chart

Scrapes historical college basketball data from **sports-reference.com/cbb**
and loads it into Supabase.

## What it scrapes

| Data | Table | Key fields |
|------|-------|-----------|
| Per-player per-game stats | `player_history` | name, team, season_year, ppg, rpg, apg, mpg, fg_pct, tp_pct, ft_pct, stl, blk, tovs, oreb, dreb, fga, tpa, gp, class_year, position |
| Team aggregate stats | `team_actual_stats` | espn_name, season, ppg, rpg, apg, fga, tpa, tov, spg, bpg, fg_pct, tp_pct, ft_pct |
| School location/info | `teams` (PATCH) | city, state, arena, mascot, location |

Season year convention: `2025` = 2024-25 season, `2024` = 2023-24, `2023` = 2022-23.

## Setup

```bash
# Both packages ship with Python 3 and are already installed:
pip3 install requests beautifulsoup4   # if not present
```

## Scraping (Step 1)

```bash
cd scripts/

# Scrape all 3 seasons (~4-5 hrs total, ~4.5s/team delay)
python3 scraper.py --seasons 2023 2024 2025

# Scrape specific seasons only (recommended starting point):
python3 scraper.py --seasons 2024 2025

# Resume if interrupted:
python3 scraper.py --seasons 2024 2025 --resume

# Test a single team first:
python3 scraper.py --seasons 2025 --team duke

# Only scrape location data (school addresses, arenas):
python3 scraper.py --locations

# Just build team slug lists (fast, <30s):
python3 scraper.py --teams-only
```

Output files in `scripts/data/`:
- `teams_{year}.json` — all D1 teams with slugs
- `players_{year}.json` — per-player stats
- `team_stats_{year}.json` — team aggregates
- `school_info.json` — school locations (cached)

## Loading into Supabase (Step 2)

> **Auth note**: The anon/publishable key is used by default. If you get 401/403 errors,
> replace `SB_KEY` in `load_supabase.py` with your **service_role** key from:
> Supabase Dashboard → Project Settings → API → `service_role` (secret).

```bash
# Dry-run first to preview:
python3 load_supabase.py --all --seasons 2024 2025 --dry-run

# Load player history:
python3 load_supabase.py --players --seasons 2024 2025

# Load team aggregate stats:
python3 load_supabase.py --team-stats --seasons 2024 2025

# Update teams table with city/state/arena:
python3 load_supabase.py --locations

# Load everything:
python3 load_supabase.py --all --seasons 2024 2025
```

## Location columns (teams table)

The `--locations` loader PATCHes the `teams` table with `city`, `state`, `arena`,
`mascot`, and `location` fields. Add these columns to Supabase first if they don't exist:

```sql
ALTER TABLE teams ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS arena TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS mascot TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS location TEXT;
```

## Timing estimates

| Scope | Approx time |
|-------|------------|
| 1 season, all teams | ~27 min (364 teams × 4.5s) |
| 3 seasons, all teams | ~1.5 hrs |
| Location data only | ~27 min (first run; cached after) |
| Load to Supabase | ~5 min |

The scraper saves checkpoints every 15 teams, so `--resume` picks up where you left off.
