-- SRS net rating + postseason results. Run once in the Supabase SQL editor.

alter table team_seasons add column if not exists srs          numeric;
alter table team_seasons add column if not exists ncaa_seed    int;
alter table team_seasons add column if not exists ncaa_result  text;   -- 'Champion','Final Four','Round of 64'...
alter table team_seasons add column if not exists conf_tourney text;   -- 'ACC Tournament: Champion'...
alter table team_seasons add column if not exists conf_champ   boolean;
alter table team_seasons add column if not exists postseason   text;   -- one-line summary

-- Every labeled postseason game (conf tournaments, NCAA, NIT, CBI, CIT)
create table if not exists postseason_games (
  id bigint primary key, season_year int, date date,
  tournament text, round text, note text,
  home text, home_id int, home_seed int, home_score int,
  away text, away_id int, away_seed int, away_score int,
  winner text, winner_id int
);
create index if not exists postseason_season_idx on postseason_games(season_year);
create index if not exists postseason_tour_idx   on postseason_games(tournament);
