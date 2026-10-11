-- Player follows (Oct 2026, owner: "a page where I can follow certain players and teams").
-- Teams already have public.team_follows; this is the same for players. Each user sees and changes only
-- their own rows. Run once in the Supabase SQL editor.

create table if not exists public.player_follows (
  id          bigserial primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  espn_id     text,
  player_name text not null,
  team        text,
  created_at  timestamptz not null default now(),
  unique (user_id, player_name, team)
);
create index if not exists player_follows_user on public.player_follows (user_id);

alter table public.player_follows enable row level security;
drop policy if exists "own player follows: read"   on public.player_follows;
drop policy if exists "own player follows: add"    on public.player_follows;
drop policy if exists "own player follows: remove" on public.player_follows;
create policy "own player follows: read"   on public.player_follows for select using (auth.uid() = user_id);
create policy "own player follows: add"    on public.player_follows for insert with check (auth.uid() = user_id);
create policy "own player follows: remove" on public.player_follows for delete using (auth.uid() = user_id);
grant select, insert, delete on public.player_follows to authenticated;
grant usage, select on sequence public.player_follows_id_seq to authenticated;

-- check: should return 0 rows and no error
select * from public.player_follows limit 1;
