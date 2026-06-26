-- New tables for game-level data + records + awards.
-- Run once in the Supabase SQL editor (these are additive; existing tables untouched).

-- ── Games: one row per game ──────────────────────────────────────────────────
create table if not exists games (
  id          bigint primary key,        -- ESPN event id
  season_year int,
  date        date,
  home        text, home_id int, home_score int,
  away        text, away_id int, away_score int,
  neutral     boolean,
  conf_game   boolean,
  status      text
);
create index if not exists games_season_idx on games(season_year);
create index if not exists games_home_idx   on games(home);
create index if not exists games_away_idx   on games(away);

-- ── Box scores: one row per player per game ──────────────────────────────────
create table if not exists box_scores (
  game_id     bigint,
  season_year int,
  date        date,
  team        text,
  opp         text,
  player      text,
  espn_id     bigint,
  starter     boolean,
  min int, pts int, fgm int, fga int, tpm int, tpa int, ftm int, fta int,
  reb int, oreb int, dreb int, ast int, tov int, stl int, blk int, pf int,
  primary key (game_id, espn_id)
);
create index if not exists box_espn_idx   on box_scores(espn_id);
create index if not exists box_season_idx on box_scores(season_year);
create index if not exists box_team_idx   on box_scores(team);

-- ── Team seasons: record + conference + season stat averages ─────────────────
create table if not exists team_seasons (
  season_year int,
  team        text,
  team_id     int,
  conference  text,
  wins int, losses int, conf_wins int, conf_losses int,
  ppg numeric, oppg numeric,
  primary key (season_year, team)
);
create index if not exists team_seasons_season_idx on team_seasons(season_year);

-- ── Awards: all-americans, player + team season awards (partly hand-entered) ──
create table if not exists awards (
  id          bigserial primary key,
  season_year int,
  category    text,   -- e.g. 'All-American 1st', 'National POY', 'Conf POY', 'Conf Champ', 'NCAA Champion'
  team        text,
  player      text,
  espn_id     bigint,
  detail      text
);
create index if not exists awards_season_idx on awards(season_year);
