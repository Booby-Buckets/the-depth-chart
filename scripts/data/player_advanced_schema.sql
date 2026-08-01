-- Owned advanced stats (replaces bbref_seasons.advanced). Computed from box_scores
-- by scripts/derived_stats.py — reproducible, no Sports-Reference values.
-- Load: create table, then import player_advanced.csv (Supabase Table Editor > Import).

DROP TABLE IF EXISTS player_advanced;
CREATE TABLE player_advanced (
  espn_id integer,
  season_year integer,
  name text,
  team text,
  g integer,
  min integer,
  ppg real,
  rpg real,
  apg real,
  ts_pct real,
  efg_pct real,
  fg_pct real,
  tp_pct real,
  ft_pct real,
  pts40 real,
  reb40 real,
  ast40 real,
  usg_pct real,
  ast_pct real,
  tov_pct real,
  orb_pct real,
  drb_pct real,
  trb_pct real,
  stl_pct real,
  blk_pct real,
  ti40 real,
  ti100 real,
  PRIMARY KEY (espn_id, season_year)
);
CREATE INDEX idx_padv_year ON player_advanced (season_year);
CREATE INDEX idx_padv_espn ON player_advanced (espn_id);
-- RLS: read-only public (same posture as other reference tables)
ALTER TABLE player_advanced ENABLE ROW LEVEL SECURITY;
CREATE POLICY padv_read ON player_advanced FOR SELECT USING (true);
