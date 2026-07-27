-- Shot-location data (from ESPN play-by-play). Run in the Supabase SQL editor.
-- Populated by scrape_shots.py. ~130 field-goal attempts per game.

create table if not exists shots (
  id          bigint primary key,   -- ESPN play id (globally unique)
  game_id     bigint not null,
  season_year int,
  espn_id     bigint,               -- shooter (matches box_scores.espn_id)
  team_id     int,                  -- shooting team (matches team_seasons.team_id / games.*_id)
  x           real,                 -- ESPN court x (0-50 width)
  y           real,                 -- ESPN court y (distance from baseline)
  made        boolean,
  sv          int,                  -- shot value (2 or 3)
  dist        int,                  -- feet, when ESPN provides it
  period      int,
  sec_left    int,                  -- seconds remaining in the period (from ESPN clock)
  home_score  int,                  -- running home score at the shot
  away_score  int                   -- running away score at the shot
);
create index if not exists shots_player_idx on shots (espn_id, season_year);
create index if not exists shots_team_idx   on shots (team_id, season_year);
