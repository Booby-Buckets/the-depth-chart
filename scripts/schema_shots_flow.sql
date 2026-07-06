-- Shot-flow enrichment: shot type + assist attribution.
-- Adds three nullable columns to the existing `shots` table so the shot-flow
-- (Sankey) charts can show Zone -> Type -> Outcome -> Assister.
-- Nullable, so this does NOT disrupt the running location backfill; a re-scrape
-- (scrape_shots.py, newest-first) then fills them in.
-- Run in the Supabase SQL editor.

alter table shots add column if not exists stype    text;    -- layup/dunk/tip/floater/pullup/hook/stepback/jumper
alter table shots add column if not exists ast_id   bigint;  -- teammate who assisted this make (null = unassisted / missed)
alter table shots add column if not exists ast_name text;    -- assister display name (from PBP text)

create index if not exists shots_ast_idx on shots (ast_id, season_year);
