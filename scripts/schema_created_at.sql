-- ============================================================================
--  Track when players/teams are ADDED to the database — powers the "Just Added" feed.
--  Run once in the Supabase SQL editor.
--
--  HOW IT WORKS: created_at defaults to now() on INSERT. Existing rows are reset to
--  NULL so they read as "baseline" (not new). The roster sync UPSERTs on (name,team)
--  and never sends created_at, so from here on every re-sync auto-stamps now() on a
--  genuinely-new player/team and leaves existing rows untouched.
--
--  ⚠ Depends on the sync being an UPSERT (not delete+reinsert). If it ever wipes and
--    re-inserts the whole roster, created_at would reset for everyone. Keep it UPSERT.
-- ============================================================================

alter table public.players add column if not exists created_at timestamptz default now();
alter table public.teams   add column if not exists created_at timestamptz default now();

-- Reset existing rows to NULL (only inserts AFTER this show up as "added").
update public.players set created_at = null;
update public.teams   set created_at = null;

-- Helpful for the feed's "newest first" queries.
create index if not exists players_created_at_idx on public.players (created_at desc nulls last);
create index if not exists teams_created_at_idx   on public.teams   (created_at desc nulls last);

-- VERIFY:  select count(*) from players where created_at is not null;  -- → 0 (until next sync)
--          after a sync that adds players, that count > 0 and the feed fills in.
