-- Add game-clock + running-score context to the shots table so we can build
-- true late-game / clutch identifiers (last N minutes, score margin at the shot).
-- These come free from ESPN play-by-play (clock.displayValue, homeScore, awayScore);
-- the original scrape_shots.py just didn't store them. Run in the Supabase SQL editor,
-- then re-run scrape_shots.py (upsert on id) to backfill — start with the current
-- season for the fastest path to a live clutch tool:
--   python3 scripts/scrape_shots.py --seasons 2026
-- then backfill older seasons as time allows.

alter table shots add column if not exists sec_left   int;  -- seconds left in the period
alter table shots add column if not exists home_score int;  -- running home score at the shot
alter table shots add column if not exists away_score int;  -- running away score at the shot

-- margin at the shot (from the shooter's side) is derived at query time by joining
-- games.home_id / games.away_id against shots.team_id, so no extra column is needed.
