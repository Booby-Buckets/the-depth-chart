-- Basketball Reference player-seasons (bio + per-game + per-40 + advanced as JSON).
create table if not exists bbref_seasons (
  bbref_id    text,
  season_year int,
  school      text,
  school_slug text,
  player      text,
  class       text,
  pos         text,
  height      text,
  weight      int,
  hometown    text,
  pergame     jsonb,
  per40       jsonb,
  advanced    jsonb,
  primary key (bbref_id, season_year, school_slug)
);
create index if not exists bbref_season_idx on bbref_seasons(season_year);
create index if not exists bbref_school_idx on bbref_seasons(school_slug);
create index if not exists bbref_player_idx on bbref_seasons(player);
alter table bbref_seasons enable row level security;
create policy "public read" on bbref_seasons for select using (true);
