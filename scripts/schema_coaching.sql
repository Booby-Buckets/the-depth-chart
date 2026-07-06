-- Coaching data foundation. Run in the Supabase SQL editor.
-- Phase 1 tables are populated by scrape_coaches.py and compute_team_style.py;
-- coach_profiles is populated by build_coach_profiles.py.

create table if not exists coach_seasons (
  school_slug  text    not null,
  season_year  int     not null,
  school       text,
  coach        text,
  coach_slug   text,
  wins         int,
  losses       int,
  srs          real,
  conf         text,
  primary key (school_slug, season_year)
);
create index if not exists coach_seasons_coach_idx on coach_seasons (coach_slug);

create table if not exists team_style (
  team             text  not null,     -- ESPN name ("Duke Blue Devils")
  season_year      int   not null,
  games            int,
  poss_pg          real,               -- pace (possessions/game)
  rotation_size    real,               -- avg players 10+ min/game
  bench_min_pct    real,               -- share of minutes beyond the top-5
  three_pa_rate    real,               -- 3PA / FGA
  ft_rate          real,               -- FTA / FGA
  ast_rate         real,               -- AST / FGM
  oreb_pg          real,
  opp_tov_pg       real,               -- turnovers forced
  stl_pg           real,
  top_scorer_share real,               -- top scorer's share of team points
  min_hhi          real,               -- minute concentration (lower = deeper)
  primary key (team, season_year)
);

create table if not exists coach_profiles (
  coach_slug   text primary key,
  coach        text,
  seasons      int,
  first_year   int,
  last_year    int,
  schools      text,                   -- comma-joined
  wins         int,
  losses       int,
  win_pct      real,
  avg_srs      real,
  -- career-average style
  poss_pg          real,
  rotation_size    real,
  bench_min_pct    real,
  three_pa_rate    real,
  ft_rate          real,
  ast_rate         real,
  oreb_pg          real,
  opp_tov_pg       real,
  top_scorer_share real,
  -- 0-100 percentiles vs all coaches (for the UI + projections)
  pctl         jsonb,
  archetype    text,
  tags         text,                   -- comma-joined descriptors
  updated_at   timestamptz default now()
);
