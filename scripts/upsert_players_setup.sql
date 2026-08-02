-- ============================================================
-- One-time setup for the UPSERT sync (preserves players.id)
-- ------------------------------------------------------------
-- The old sync wiped & re-inserted `players`, so every player got a
-- NEW id each run — which orphaned every id-keyed grade file
-- (player_coupled_grades / arch_bonus / gp_shrink / recruit_pedigree /
-- versatility_adj) and forced the projection back onto raw sheet grades.
--
-- The new sync UPSERTs on (name, team) instead, so a returning player
-- keeps the SAME id forever and the data-driven grade layer stays valid.
-- This index is the conflict target. It's PARTIAL — it excludes the
-- '—' / '-' empty-slot placeholders so a team can carry several unfilled
-- roster spots without violating the key.
--
-- Prereq: players(name, team) must have no duplicates among real players
-- (verified clean: 1043 rows, 0 dups). If this errors on a duplicate,
-- dedup those rows first, then re-run.
--
-- Run once in the Supabase SQL editor. `players.updated_at` already exists
-- (used by the sync's departed-player cleanup), so nothing else is needed.
-- ============================================================

create unique index if not exists players_name_team_uk
  on players (name, team)
  where name is not null and name <> '—' and name <> '-';
