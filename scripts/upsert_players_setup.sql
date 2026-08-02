-- ============================================================
-- One-time setup for the UPSERT sync (preserves players.id)
-- ------------------------------------------------------------
-- The sync UPSERTs players on (name, team) so a returning player keeps the
-- SAME id forever, which keeps the id-keyed grade files valid. This FULL
-- unique index is the conflict target for `?on_conflict=name,team`.
--
-- Must be a FULL (not partial) index: PostgREST's on_conflict can't match a
-- partial index. The sync therefore does NOT insert '—' empty-slot rows
-- (they'd collide on a full (name,team) key), so this stays valid.
--
-- Prereq: no duplicate (name, team) rows (verified clean: 1043 rows, 0 dups,
-- 0 '—' rows). Run once in the Supabase SQL editor. `players.updated_at`
-- already exists (used by the sync's departed-player cleanup).
-- ============================================================

-- drop the old partial index if a previous attempt created it
drop index if exists players_name_team_uk;

create unique index players_name_team_uk on players (name, team);
