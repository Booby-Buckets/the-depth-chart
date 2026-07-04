-- Persist the 7-pillar grade breakdown (offense, efficiency, defense, creation,
-- usage, scalability, impact — each a z-score from grade_v4.py) alongside the
-- final tdc_grade scalar. Today these are computed in memory and thrown away;
-- this lets downstream consumers (NIL valuation) read individual pillars
-- instead of only the single blended grade.
--
-- Additive column on an existing table — no RLS/policy change needed (Row
-- Level Security is row-scoped, not column-scoped; the existing "public read"
-- policy on bbref_seasons already covers this column once it exists).
--
-- Run once in the Supabase SQL editor.

alter table public.bbref_seasons add column if not exists grade_pillars jsonb;
