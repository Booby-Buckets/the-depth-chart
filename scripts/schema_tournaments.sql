-- Every tournament game (last 20 seasons): early-season MTEs (Maui, Battle 4
-- Atlantis, Players Era, all the classics) + postseason (NCAA/NIT/CBI/CIT/The
-- Basketball Classic + every conference tournament). Populated by
-- scripts/scrape_tournaments.py -> normalize_tournaments.py --write.
--
-- Run once in the Supabase SQL editor.

create table if not exists public.tournament_games (
  id            bigint primary key,
  season        int,
  date          date,
  seasontype    int,               -- 2 = early-season, 3 = postseason
  category      text,              -- NCAA | NIT | CBI | CIT | TBC | CONF | MTE
  tournament    text,              -- canonical name (sponsors stripped)
  tournament_raw text,             -- original ESPN note headline
  division      text,              -- MTE bracket division, if any
  round         text,
  round_order   int,               -- for bracket sorting
  neutral       boolean,
  home          text,
  home_id       int,
  home_score    int,
  home_seed     int,
  away          text,
  away_id       int,
  away_score    int,
  away_seed     int,
  winner        text,
  winner_id     int,
  status        text,
  notable       boolean
);

create index if not exists tg_season_idx     on public.tournament_games (season);
create index if not exists tg_tournament_idx on public.tournament_games (tournament);
create index if not exists tg_category_idx   on public.tournament_games (category);

alter table public.tournament_games enable row level security;
create policy "public read" on public.tournament_games for select using (true);
create policy "public insert" on public.tournament_games for insert with check (true);
create policy "public update" on public.tournament_games for update using (true);
