-- NBA data (ESPN) for college → NBA comparisons. Scraped by scrape_nba.py, loaded by load_nba.py.
-- espn_id is the SAME id ESPN uses for the player in college, so these join straight onto
-- box_scores / player_history / player_advanced by espn_id. Season = end year (2026 = 2025-26).

create table if not exists nba_players (
  espn_id         text primary key,
  name            text,
  first_name      text,
  last_name       text,
  dob             date,
  height_in       real,
  weight          real,
  pos             text,
  hand            text,
  birthplace      jsonb,
  college         text,
  college_espn_id text,
  played_college  boolean,
  college_athlete_id text,      -- college espn_id (differs from espn_id for most pre-~2016 exits)
  draft_year      int,
  draft_round     int,
  draft_pick      int,
  draft_team_id   text,
  draft_display   text,
  debut_year      int,
  experience      int,
  active          boolean,
  headshot        text          -- owner-gated on the site: render only behind window.tdcShowPhotos
);

create table if not exists nba_games (
  game_id     text primary key,
  season      int,
  season_type text,             -- regular | playin | postseason
  date        date,
  neutral     boolean,
  home        text,
  away        text,
  home_score  int,
  away_score  int,
  team_stats  jsonb,            -- {TEAM_ABBR: {fieldGoalsMade-fieldGoalsAttempted: "35-84", ...}}
  player_rows int
);
create index if not exists nba_games_season_idx on nba_games(season);

create table if not exists nba_box (
  game_id     text,
  espn_id     text,
  season      int,
  season_type text,
  date        date,
  name        text,
  pos         text,
  team        text,
  opp         text,
  home        boolean,
  starter     boolean,
  dnp         boolean,
  reason      text,
  ejected     boolean,
  min int, pts int, fgm int, fga int, fg3m int, fg3a int, ftm int, fta int,
  oreb int, dreb int, reb int, ast int, stl int, blk int, tov int, pf int, pm int,
  primary key (game_id, espn_id)
);
create index if not exists nba_box_player_idx on nba_box(espn_id, season);
create index if not exists nba_box_season_idx on nba_box(season);

create table if not exists nba_seasons (
  espn_id     text,
  season      int,
  season_type text,             -- regular | postseason
  teams       text[],
  stats       jsonb,            -- ESPN's ~110 season stats (avgPoints, PER, RPM, trueShootingPct, avg48*...)
  primary key (espn_id, season, season_type)
);
create index if not exists nba_seasons_season_idx on nba_seasons(season);

alter table nba_players enable row level security;
alter table nba_games   enable row level security;
alter table nba_box     enable row level security;
alter table nba_seasons enable row level security;
create policy "public read" on nba_players for select using (true);
create policy "public read" on nba_games   for select using (true);
create policy "public read" on nba_box     for select using (true);
create policy "public read" on nba_seasons for select using (true);
