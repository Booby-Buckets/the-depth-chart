-- ============================================================================
--  Private fantasy league (2026-10-02). Run the whole file once in the Supabase SQL editor.
--  Safe to re-run. Needs forum_moderation.sql first (tdc_is_owner).
-- ----------------------------------------------------------------------------
--  league.html: a $200 auction league over Big Ten / SEC / ACC / Big 12 / Big East players.
--    * fl_leagues   the league + its rules (budget, roster size, pickups) + a private invite code
--    * fl_members   one row per owner (their team name)
--    * fl_rosters   every ownership stint: draft / pickup / trade / commish. A row with end_date null
--                   is on a roster now. Stats count on a date D when start_date <= D < end_date
--                   (null = open), so a pickup or trade takes effect the next day (Eastern time).
--    * fl_dates     the dates that count, chosen by the commissioner
--    * fl_trades    proposals between two owners; accepting swaps the players at once
--  Everything is private: only members can read their league. Every write goes through a
--  function below that checks the rules, so nobody can edit the page to break them.
-- ============================================================================

create table if not exists public.fl_leagues (
  id           bigserial primary key,
  name         text not null check (char_length(name) between 3 and 60),
  season       int  not null default 2027,
  budget       int  not null default 200 check (budget between 1 and 10000),
  roster_size  int  not null default 12  check (roster_size between 1 and 30),
  max_pickups  int  not null default 5   check (max_pickups between 0 and 100),
  max_teams    int  not null default 12  check (max_teams between 2 and 30),
  commissioner uuid not null default auth.uid(),
  invite_code  text not null unique default upper(substr(md5(random()::text), 1, 6)),
  draft_done   boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.fl_members (
  league_id  bigint not null references public.fl_leagues(id) on delete cascade,
  user_id    uuid not null,
  team_name  text not null check (char_length(team_name) between 2 and 40),
  joined_at  timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table if not exists public.fl_rosters (
  id          bigserial primary key,
  league_id   bigint not null references public.fl_leagues(id) on delete cascade,
  user_id     uuid not null,
  player_id   bigint not null,            -- players.id
  espn_id     bigint,
  player_name text not null,
  player_team text not null,              -- players.team (short)
  price       int not null default 0,
  how         text not null check (how in ('draft', 'pickup', 'trade', 'commish')),
  start_date  date,                       -- null = from the start of the season
  end_date    date,                       -- null = still on the roster
  created_at  timestamptz not null default now()
);
create unique index if not exists fl_rosters_one_owner on public.fl_rosters (league_id, player_id) where end_date is null;
create index if not exists fl_rosters_league on public.fl_rosters (league_id, user_id);

create table if not exists public.fl_dates (
  league_id bigint not null references public.fl_leagues(id) on delete cascade,
  d         date not null,
  primary key (league_id, d)
);

create table if not exists public.fl_trades (
  id         bigserial primary key,
  league_id  bigint not null references public.fl_leagues(id) on delete cascade,
  from_user  uuid not null,
  to_user    uuid not null,
  give       bigint[] not null default '{}',   -- fl_rosters ids from_user sends
  get        bigint[] not null default '{}',   -- fl_rosters ids to_user sends
  note       text check (char_length(coalesce(note, '')) <= 300),
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- ── helpers ─────────────────────────────────────────────────────────────────
create or replace function public.fl_is_member(p_league bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tdc_is_owner() or exists (select 1 from fl_members where league_id = p_league and user_id = auth.uid())
$$;
create or replace function public.fl_is_commish(p_league bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tdc_is_owner() or exists (select 1 from fl_leagues where id = p_league and commissioner = auth.uid())
$$;
-- "tomorrow" in Eastern time: when a pickup / trade starts counting
create or replace function public.fl_tomorrow() returns date language sql stable as $$
  select ((now() at time zone 'America/New_York')::date + 1)
$$;
-- the player pool: Big Ten, SEC, ACC, Big 12, Big East
create or replace function public.fl_in_pool(p_player bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from players p join teams t on t.name = p.team
                  where p.id = p_player and t.conference in ('B10', 'SEC', 'ACC', 'BIG-12', 'Big-East'))
$$;

-- ── RLS: members read, nobody writes directly (except the few noted) ─────────
alter table public.fl_leagues enable row level security;
alter table public.fl_members enable row level security;
alter table public.fl_rosters enable row level security;
alter table public.fl_dates   enable row level security;
alter table public.fl_trades  enable row level security;

drop policy if exists "fl_l_read" on public.fl_leagues;
drop policy if exists "fl_l_edit" on public.fl_leagues;
create policy "fl_l_read" on public.fl_leagues for select to authenticated using (public.fl_is_member(id));
create policy "fl_l_edit" on public.fl_leagues for update to authenticated using (public.fl_is_commish(id)) with check (public.fl_is_commish(id));

drop policy if exists "fl_m_read" on public.fl_members;
drop policy if exists "fl_m_name" on public.fl_members;
create policy "fl_m_read" on public.fl_members for select to authenticated using (public.fl_is_member(league_id));
create policy "fl_m_name" on public.fl_members for update to authenticated
  using (user_id = auth.uid() or public.fl_is_commish(league_id)) with check (user_id = auth.uid() or public.fl_is_commish(league_id));

drop policy if exists "fl_r_read" on public.fl_rosters;
create policy "fl_r_read" on public.fl_rosters for select to authenticated using (public.fl_is_member(league_id));

drop policy if exists "fl_d_read" on public.fl_dates;
create policy "fl_d_read" on public.fl_dates for select to authenticated using (public.fl_is_member(league_id));

drop policy if exists "fl_t_read" on public.fl_trades;
create policy "fl_t_read" on public.fl_trades for select to authenticated using (public.fl_is_member(league_id));

revoke all on public.fl_leagues, public.fl_members, public.fl_rosters, public.fl_dates, public.fl_trades from anon;
grant select on public.fl_leagues, public.fl_members, public.fl_rosters, public.fl_dates, public.fl_trades to authenticated;
-- the commissioner edits name / rules / draft_done; owners rename their own team
revoke update on public.fl_leagues from authenticated;
grant update (name, budget, roster_size, max_pickups, max_teams, draft_done) on public.fl_leagues to authenticated;
revoke update on public.fl_members from authenticated;
grant update (team_name) on public.fl_members to authenticated;

-- ── league setup ────────────────────────────────────────────────────────────
create or replace function public.fl_create_league(p_name text, p_team_name text)
returns bigint language plpgsql security definer set search_path = public as $$
declare lid bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into fl_leagues (name, commissioner) values (trim(p_name), auth.uid()) returning id into lid;
  insert into fl_members (league_id, user_id, team_name) values (lid, auth.uid(), trim(p_team_name));
  return lid;
end $$;

create or replace function public.fl_join(p_code text, p_team_name text)
returns bigint language plpgsql security definer set search_path = public as $$
declare L fl_leagues; n int;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into L from fl_leagues where invite_code = upper(trim(p_code));
  if L.id is null then raise exception 'That invite code does not match a league.'; end if;
  if exists (select 1 from fl_members where league_id = L.id and user_id = auth.uid()) then return L.id; end if;
  select count(*) into n from fl_members where league_id = L.id;
  if n >= L.max_teams then raise exception 'This league is full (% teams).', L.max_teams; end if;
  insert into fl_members (league_id, user_id, team_name) values (L.id, auth.uid(), trim(p_team_name));
  return L.id;
end $$;

-- the commissioner removes an owner (their players go back to the pool)
create or replace function public.fl_remove_member(p_league bigint, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fl_is_commish(p_league) then raise exception 'Only the commissioner can do that.'; end if;
  if p_user = (select commissioner from fl_leagues where id = p_league) then raise exception 'The commissioner cannot be removed.'; end if;
  delete from fl_rosters where league_id = p_league and user_id = p_user;
  update fl_trades set status = 'cancelled', decided_at = now() where league_id = p_league and status = 'pending' and (from_user = p_user or to_user = p_user);
  delete from fl_members where league_id = p_league and user_id = p_user;
end $$;

create or replace function public.fl_set_dates(p_league bigint, p_dates date[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fl_is_commish(p_league) then raise exception 'Only the commissioner picks the dates.'; end if;
  delete from fl_dates where league_id = p_league;
  insert into fl_dates (league_id, d) select p_league, x from unnest(coalesce(p_dates, '{}')) x on conflict do nothing;
end $$;

-- ── the draft (commissioner enters each result) ─────────────────────────────
-- budget rule: after this pick the team must still afford $1 for every empty spot
create or replace function public.fl_draft(p_league bigint, p_user uuid, p_player bigint, p_price int)
returns bigint language plpgsql security definer set search_path = public as $$
declare L fl_leagues; n int; spent int; pl players; rid bigint;
begin
  if not public.fl_is_commish(p_league) then raise exception 'Only the commissioner enters draft results.'; end if;
  select * into L from fl_leagues where id = p_league;
  if not exists (select 1 from fl_members where league_id = p_league and user_id = p_user) then raise exception 'That owner is not in this league.'; end if;
  select * into pl from players where id = p_player;
  if pl.id is null then raise exception 'Unknown player.'; end if;
  if not public.fl_in_pool(p_player) then raise exception '% is not in a Big Ten / SEC / ACC / Big 12 / Big East program.', pl.name; end if;
  if exists (select 1 from fl_rosters where league_id = p_league and player_id = p_player and end_date is null) then
    raise exception '% is already on a team.', pl.name; end if;
  select count(*), coalesce(sum(price), 0) into n, spent from fl_rosters where league_id = p_league and user_id = p_user and end_date is null;
  if n >= L.roster_size then raise exception 'That team already has % players.', L.roster_size; end if;
  if coalesce(p_price, 0) < 1 then raise exception 'Bids start at $1.'; end if;
  if p_price > L.budget - spent - (L.roster_size - n - 1) then
    raise exception 'Too much: that team can bid at most $% (it needs $1 for each spot left).', L.budget - spent - (L.roster_size - n - 1); end if;
  insert into fl_rosters (league_id, user_id, player_id, espn_id, player_name, player_team, price, how)
  values (p_league, p_user, p_player, pl.espn_id, pl.name, pl.team, p_price, 'draft') returning id into rid;
  return rid;
end $$;

-- the commissioner deletes a roster row outright (undo a draft pick, fix a mistake)
create or replace function public.fl_undo(p_roster bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r fl_rosters;
begin
  select * into r from fl_rosters where id = p_roster;
  if r.id is null then return; end if;
  if not public.fl_is_commish(r.league_id) then raise exception 'Only the commissioner can undo.'; end if;
  delete from fl_rosters where id = p_roster;
end $$;

-- ── pickups (an owner, for themselves) ──────────────────────────────────────
create or replace function public.fl_pickup(p_league bigint, p_add bigint, p_drop bigint)
returns void language plpgsql security definer set search_path = public as $$
declare L fl_leagues; n int; used int; pl players; d fl_rosters;
begin
  select * into L from fl_leagues where id = p_league;
  if not exists (select 1 from fl_members where league_id = p_league and user_id = auth.uid()) then raise exception 'You are not in this league.'; end if;
  if not L.draft_done then raise exception 'Pickups open once the commissioner marks the draft finished.'; end if;
  select count(*) into used from fl_rosters where league_id = p_league and user_id = auth.uid() and how = 'pickup';
  if used >= L.max_pickups then raise exception 'You have used all % pickups.', L.max_pickups; end if;
  select * into pl from players where id = p_add;
  if pl.id is null or not public.fl_in_pool(p_add) then raise exception 'That player is not in the pool.'; end if;
  if exists (select 1 from fl_rosters where league_id = p_league and player_id = p_add and end_date is null) then
    raise exception '% is already on a team.', pl.name; end if;
  if p_drop is not null then
    select * into d from fl_rosters where id = p_drop;
    if d.id is null or d.league_id <> p_league or d.user_id <> auth.uid() or d.end_date is not null then
      raise exception 'You can only drop a player who is on your roster.'; end if;
  end if;
  select count(*) into n from fl_rosters where league_id = p_league and user_id = auth.uid() and end_date is null;
  if n - (case when p_drop is null then 0 else 1 end) >= L.roster_size then
    raise exception 'Your roster is full. Pick someone to drop.'; end if;
  if p_drop is not null then update fl_rosters set end_date = public.fl_tomorrow() where id = p_drop; end if;
  insert into fl_rosters (league_id, user_id, player_id, espn_id, player_name, player_team, price, how, start_date)
  values (p_league, auth.uid(), p_add, pl.espn_id, pl.name, pl.team, 0, 'pickup', public.fl_tomorrow());
end $$;

-- ── trades ──────────────────────────────────────────────────────────────────
create or replace function public.fl_trade_propose(p_league bigint, p_to uuid, p_give bigint[], p_get bigint[], p_note text)
returns bigint language plpgsql security definer set search_path = public as $$
declare tid bigint;
begin
  if not exists (select 1 from fl_members where league_id = p_league and user_id = auth.uid()) then raise exception 'You are not in this league.'; end if;
  if not exists (select 1 from fl_members where league_id = p_league and user_id = p_to) or p_to = auth.uid() then raise exception 'Pick another team to trade with.'; end if;
  if coalesce(array_length(p_give, 1), 0) + coalesce(array_length(p_get, 1), 0) = 0 then raise exception 'Pick at least one player.'; end if;
  if (select count(*) from fl_rosters where id = any(p_give) and league_id = p_league and user_id = auth.uid() and end_date is null) <> coalesce(array_length(p_give, 1), 0)
  or (select count(*) from fl_rosters where id = any(p_get) and league_id = p_league and user_id = p_to and end_date is null) <> coalesce(array_length(p_get, 1), 0) then
    raise exception 'Those players are not on those rosters any more.'; end if;
  insert into fl_trades (league_id, from_user, to_user, give, get, note)
  values (p_league, auth.uid(), p_to, coalesce(p_give, '{}'), coalesce(p_get, '{}'), nullif(trim(coalesce(p_note, '')), '')) returning id into tid;
  return tid;
end $$;

create or replace function public.fl_trade_respond(p_trade bigint, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare t fl_trades; L fl_leagues; nf int; nt int; ng int; nr int; r fl_rosters;
begin
  select * into t from fl_trades where id = p_trade for update;
  if t.id is null or t.status <> 'pending' then raise exception 'That trade is no longer open.'; end if;
  if t.to_user <> auth.uid() then raise exception 'Only the team receiving the offer can answer it.'; end if;
  if not p_accept then update fl_trades set status = 'declined', decided_at = now() where id = p_trade; return; end if;
  select * into L from fl_leagues where id = t.league_id;
  ng := coalesce(array_length(t.give, 1), 0); nr := coalesce(array_length(t.get, 1), 0);
  if (select count(*) from fl_rosters where id = any(t.give) and user_id = t.from_user and end_date is null) <> ng
  or (select count(*) from fl_rosters where id = any(t.get)  and user_id = t.to_user   and end_date is null) <> nr then
    update fl_trades set status = 'cancelled', decided_at = now() where id = p_trade;
    raise exception 'One of those players has moved since the offer, so the trade was cancelled.';
  end if;
  select count(*) into nf from fl_rosters where league_id = t.league_id and user_id = t.from_user and end_date is null;
  select count(*) into nt from fl_rosters where league_id = t.league_id and user_id = t.to_user   and end_date is null;
  if nf - ng + nr > L.roster_size or nt - nr + ng > L.roster_size then
    raise exception 'That trade would put a team over % players.', L.roster_size; end if;
  for r in select * from fl_rosters where id = any(t.give) or id = any(t.get) loop
    update fl_rosters set end_date = public.fl_tomorrow() where id = r.id;
    insert into fl_rosters (league_id, user_id, player_id, espn_id, player_name, player_team, price, how, start_date)
    values (r.league_id, case when r.user_id = t.from_user then t.to_user else t.from_user end,
            r.player_id, r.espn_id, r.player_name, r.player_team, r.price, 'trade', public.fl_tomorrow());
  end loop;
  update fl_trades set status = 'accepted', decided_at = now() where id = p_trade;
end $$;

create or replace function public.fl_trade_cancel(p_trade bigint)
returns void language plpgsql security definer set search_path = public as $$
declare t fl_trades;
begin
  select * into t from fl_trades where id = p_trade;
  if t.id is null or t.status <> 'pending' then return; end if;
  if t.from_user <> auth.uid() and not public.fl_is_commish(t.league_id) then raise exception 'Only the team that sent it (or the commissioner) can cancel.'; end if;
  update fl_trades set status = 'cancelled', decided_at = now() where id = p_trade;
end $$;

revoke execute on function public.fl_create_league(text, text), public.fl_join(text, text), public.fl_remove_member(bigint, uuid),
  public.fl_set_dates(bigint, date[]), public.fl_draft(bigint, uuid, bigint, int), public.fl_undo(bigint),
  public.fl_pickup(bigint, bigint, bigint), public.fl_trade_propose(bigint, uuid, bigint[], bigint[], text),
  public.fl_trade_respond(bigint, boolean), public.fl_trade_cancel(bigint) from public, anon;

grant execute on function public.fl_create_league(text, text), public.fl_join(text, text), public.fl_remove_member(bigint, uuid),
  public.fl_set_dates(bigint, date[]), public.fl_draft(bigint, uuid, bigint, int), public.fl_undo(bigint),
  public.fl_pickup(bigint, bigint, bigint), public.fl_trade_propose(bigint, uuid, bigint[], bigint[], text),
  public.fl_trade_respond(bigint, boolean), public.fl_trade_cancel(bigint) to authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename like 'fl_%' order by 1, 2;
