-- ============================================================================
--  Fantasy league v2 (2026-10-02). Run AFTER fantasy_league.sql. Safe to re-run.
-- ----------------------------------------------------------------------------
--  * snake drafts: fl_leagues.draft_type ('auction' | 'snake') + draft_order; fl_snake_pick lets the team
--    on the clock pick (the commissioner can pick for anyone)
--  * test teams: the commissioner adds placeholder teams (no account) and runs them; a friend can later
--    claim one with the invite code and keep its roster (fl_peek + fl_claim)
--  * acting for a placeholder: pickups and trades take p_as (the commissioner, for a placeholder team)
--  * public leagues: is_public lets anyone (signed in or not) read the league
--  * playoffs: date windows for round 1 (conference tournaments), round 2 (NCAA first weekend), final
-- ============================================================================

alter table public.fl_leagues add column if not exists draft_type text not null default 'auction';
alter table public.fl_leagues drop constraint if exists fl_leagues_draft_type_check;
alter table public.fl_leagues add constraint fl_leagues_draft_type_check check (draft_type in ('auction', 'snake'));
alter table public.fl_leagues add column if not exists draft_order uuid[];
alter table public.fl_leagues add column if not exists is_public boolean not null default false;
alter table public.fl_leagues add column if not exists r1_start date not null default '2027-03-02';
alter table public.fl_leagues add column if not exists r1_end   date not null default '2027-03-14';
alter table public.fl_leagues add column if not exists r2_start date not null default '2027-03-16';
alter table public.fl_leagues add column if not exists r2_end   date not null default '2027-03-21';
alter table public.fl_leagues add column if not exists f_start  date not null default '2027-03-25';
alter table public.fl_leagues add column if not exists f_end    date not null default '2027-04-05';
alter table public.fl_members add column if not exists placeholder boolean not null default false;

grant update (name, budget, roster_size, max_pickups, max_teams, draft_done, draft_type, is_public,
              r1_start, r1_end, r2_start, r2_end, f_start, f_end) on public.fl_leagues to authenticated;

-- ── public read ─────────────────────────────────────────────────────────────
create or replace function public.fl_can_read(p_league bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.fl_is_member(p_league) or exists (select 1 from fl_leagues where id = p_league and is_public)
$$;
grant execute on function public.fl_can_read(bigint) to anon, authenticated;

drop policy if exists "fl_l_read" on public.fl_leagues;
drop policy if exists "fl_m_read" on public.fl_members;
drop policy if exists "fl_r_read" on public.fl_rosters;
drop policy if exists "fl_d_read" on public.fl_dates;
drop policy if exists "fl_t_read" on public.fl_trades;
create policy "fl_l_read" on public.fl_leagues for select to anon, authenticated using (public.fl_can_read(id));
create policy "fl_m_read" on public.fl_members for select to anon, authenticated using (public.fl_can_read(league_id));
create policy "fl_r_read" on public.fl_rosters for select to anon, authenticated using (public.fl_can_read(league_id));
create policy "fl_d_read" on public.fl_dates   for select to anon, authenticated using (public.fl_can_read(league_id));
create policy "fl_t_read" on public.fl_trades  for select to anon, authenticated using (public.fl_can_read(league_id));
grant select on public.fl_leagues, public.fl_members, public.fl_rosters, public.fl_dates, public.fl_trades to anon;
-- the invite code is the key to a league: never readable by a non-member, even on a public league
revoke select on public.fl_leagues from anon, authenticated;
grant select (id, name, season, budget, roster_size, max_pickups, max_teams, commissioner, draft_done, created_at,
              draft_type, draft_order, is_public, r1_start, r1_end, r2_start, r2_end, f_start, f_end) on public.fl_leagues to anon, authenticated;
create or replace function public.fl_invite_code(p_league bigint) returns text
language sql stable security definer set search_path = public as $$
  select invite_code from fl_leagues where id = p_league and public.fl_is_member(p_league)
$$;
grant execute on function public.fl_invite_code(bigint) to authenticated;

-- ── who is acting: yourself, or (commissioner) a placeholder team ──────────
create or replace function public.fl_actor(p_league bigint, p_as uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if p_as is null or p_as = auth.uid() then return auth.uid(); end if;
  if public.fl_is_commish(p_league) and exists (select 1 from fl_members where league_id = p_league and user_id = p_as and placeholder) then
    return p_as; end if;
  raise exception 'You can only act for test teams in a league you run.';
end $$;

-- ── placeholder teams ───────────────────────────────────────────────────────
create or replace function public.fl_add_placeholder(p_league bigint, p_team_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := gen_random_uuid(); L fl_leagues; n int;
begin
  if not public.fl_is_commish(p_league) then raise exception 'Only the commissioner can add test teams.'; end if;
  select * into L from fl_leagues where id = p_league;
  select count(*) into n from fl_members where league_id = p_league;
  if n >= L.max_teams then raise exception 'The league is full (% teams).', L.max_teams; end if;
  insert into fl_members (league_id, user_id, team_name, placeholder) values (p_league, uid, trim(p_team_name), true);
  return uid;
end $$;

-- what an invite code opens: the league name + the test teams waiting to be claimed
create or replace function public.fl_peek(p_code text)
returns json language plpgsql stable security definer set search_path = public as $$
declare L fl_leagues;
begin
  select * into L from fl_leagues where invite_code = upper(trim(p_code));
  if L.id is null then raise exception 'That invite code does not match a league.'; end if;
  return json_build_object('id', L.id, 'name', L.name, 'open', (select coalesce(json_agg(json_build_object('user_id', user_id, 'team_name', team_name)), '[]'::json)
                                                                 from fl_members where league_id = L.id and placeholder));
end $$;

create or replace function public.fl_claim(p_code text, p_member uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare L fl_leagues;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into L from fl_leagues where invite_code = upper(trim(p_code));
  if L.id is null then raise exception 'That invite code does not match a league.'; end if;
  if exists (select 1 from fl_members where league_id = L.id and user_id = auth.uid()) then raise exception 'You already have a team in this league.'; end if;
  if not exists (select 1 from fl_members where league_id = L.id and user_id = p_member and placeholder) then raise exception 'That team has already been claimed.'; end if;
  update fl_members set user_id = auth.uid(), placeholder = false where league_id = L.id and user_id = p_member;
  update fl_rosters set user_id = auth.uid() where league_id = L.id and user_id = p_member;
  update fl_trades set from_user = auth.uid() where league_id = L.id and from_user = p_member;
  update fl_trades set to_user = auth.uid() where league_id = L.id and to_user = p_member;
  update fl_leagues set draft_order = array_replace(draft_order, p_member, auth.uid()) where id = L.id and draft_order is not null;
  return L.id;
end $$;

-- ── snake draft ─────────────────────────────────────────────────────────────
create or replace function public.fl_set_order(p_league bigint, p_order uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fl_is_commish(p_league) then raise exception 'Only the commissioner sets the draft order.'; end if;
  if (select count(*) from fl_members where league_id = p_league) <> coalesce(array_length(p_order, 1), 0)
  or exists (select 1 from fl_members m where m.league_id = p_league and not (m.user_id = any(p_order))) then
    raise exception 'The order has to list every team exactly once.'; end if;
  update fl_leagues set draft_order = p_order where id = p_league;
end $$;

-- who is on the clock: picks so far → round / slot, even rounds run backwards
create or replace function public.fl_on_clock(p_league bigint) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare L fl_leagues; ord uuid[]; n int; t int; rnd int; slot int;
begin
  select * into L from fl_leagues where id = p_league;
  ord := coalesce(L.draft_order, (select array_agg(user_id order by joined_at) from fl_members where league_id = p_league));
  t := coalesce(array_length(ord, 1), 0); if t = 0 then return null; end if;
  select count(*) into n from fl_rosters where league_id = p_league and how = 'draft';
  if n >= t * L.roster_size then return null; end if;
  rnd := n / t; slot := n % t;
  return ord[case when rnd % 2 = 0 then slot + 1 else t - slot end];
end $$;

create or replace function public.fl_snake_pick(p_league bigint, p_player bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare L fl_leagues; who uuid; pl players; rid bigint;
begin
  select * into L from fl_leagues where id = p_league;
  if L.draft_type <> 'snake' then raise exception 'This league drafts by auction.'; end if;
  if L.draft_done then raise exception 'The draft is finished.'; end if;
  who := public.fl_on_clock(p_league);
  if who is null then raise exception 'Every roster is full.'; end if;
  if who <> auth.uid() and not public.fl_is_commish(p_league) then raise exception 'It is not your pick.'; end if;
  select * into pl from players where id = p_player;
  if pl.id is null or not public.fl_in_pool(p_player) then raise exception 'That player is not in the pool.'; end if;
  if exists (select 1 from fl_rosters where league_id = p_league and player_id = p_player and end_date is null) then
    raise exception '% is already taken.', pl.name; end if;
  insert into fl_rosters (league_id, user_id, player_id, espn_id, player_name, player_team, price, how)
  values (p_league, who, p_player, pl.espn_id, pl.name, pl.team, 0, 'draft') returning id into rid;
  return rid;
end $$;

-- ── pickups + trades, now able to act for a placeholder ─────────────────────
drop function if exists public.fl_pickup(bigint, bigint, bigint);
drop function if exists public.fl_trade_propose(bigint, uuid, bigint[], bigint[], text);
drop function if exists public.fl_trade_respond(bigint, boolean);
drop function if exists public.fl_trade_cancel(bigint);

create or replace function public.fl_pickup(p_league bigint, p_add bigint, p_drop bigint, p_as uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare L fl_leagues; n int; used int; pl players; d fl_rosters; me uuid;
begin
  me := public.fl_actor(p_league, p_as);
  select * into L from fl_leagues where id = p_league;
  if not exists (select 1 from fl_members where league_id = p_league and user_id = me) then raise exception 'You are not in this league.'; end if;
  if not L.draft_done then raise exception 'Pickups open once the commissioner marks the draft finished.'; end if;
  select count(*) into used from fl_rosters where league_id = p_league and user_id = me and how = 'pickup';
  if used >= L.max_pickups then raise exception 'All % pickups are used.', L.max_pickups; end if;
  select * into pl from players where id = p_add;
  if pl.id is null or not public.fl_in_pool(p_add) then raise exception 'That player is not in the pool.'; end if;
  if exists (select 1 from fl_rosters where league_id = p_league and player_id = p_add and end_date is null) then
    raise exception '% is already on a team.', pl.name; end if;
  if p_drop is not null then
    select * into d from fl_rosters where id = p_drop;
    if d.id is null or d.league_id <> p_league or d.user_id <> me or d.end_date is not null then
      raise exception 'You can only drop a player who is on that roster.'; end if;
  end if;
  select count(*) into n from fl_rosters where league_id = p_league and user_id = me and end_date is null;
  if n - (case when p_drop is null then 0 else 1 end) >= L.roster_size then raise exception 'That roster is full. Pick someone to drop.'; end if;
  if p_drop is not null then update fl_rosters set end_date = public.fl_tomorrow() where id = p_drop; end if;
  insert into fl_rosters (league_id, user_id, player_id, espn_id, player_name, player_team, price, how, start_date)
  values (p_league, me, p_add, pl.espn_id, pl.name, pl.team, 0, 'pickup', public.fl_tomorrow());
end $$;

create or replace function public.fl_trade_propose(p_league bigint, p_to uuid, p_give bigint[], p_get bigint[], p_note text, p_as uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare tid bigint; me uuid;
begin
  me := public.fl_actor(p_league, p_as);
  if not exists (select 1 from fl_members where league_id = p_league and user_id = me) then raise exception 'You are not in this league.'; end if;
  if not exists (select 1 from fl_members where league_id = p_league and user_id = p_to) or p_to = me then raise exception 'Pick another team to trade with.'; end if;
  if coalesce(array_length(p_give, 1), 0) + coalesce(array_length(p_get, 1), 0) = 0 then raise exception 'Pick at least one player.'; end if;
  if (select count(*) from fl_rosters where id = any(p_give) and league_id = p_league and user_id = me and end_date is null) <> coalesce(array_length(p_give, 1), 0)
  or (select count(*) from fl_rosters where id = any(p_get) and league_id = p_league and user_id = p_to and end_date is null) <> coalesce(array_length(p_get, 1), 0) then
    raise exception 'Those players are not on those rosters any more.'; end if;
  insert into fl_trades (league_id, from_user, to_user, give, get, note)
  values (p_league, me, p_to, coalesce(p_give, '{}'), coalesce(p_get, '{}'), nullif(trim(coalesce(p_note, '')), '')) returning id into tid;
  return tid;
end $$;

create or replace function public.fl_trade_respond(p_trade bigint, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare t fl_trades; L fl_leagues; nf int; nt int; ng int; nr int; r fl_rosters;
begin
  select * into t from fl_trades where id = p_trade for update;
  if t.id is null or t.status <> 'pending' then raise exception 'That trade is no longer open.'; end if;
  if t.to_user <> public.fl_actor(t.league_id, t.to_user) then raise exception 'Only the team receiving the offer can answer it.'; end if;
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

revoke execute on function public.fl_actor(bigint, uuid), public.fl_add_placeholder(bigint, text), public.fl_peek(text), public.fl_claim(text, uuid),
  public.fl_set_order(bigint, uuid[]), public.fl_on_clock(bigint), public.fl_snake_pick(bigint, bigint),
  public.fl_pickup(bigint, bigint, bigint, uuid), public.fl_trade_propose(bigint, uuid, bigint[], bigint[], text, uuid),
  public.fl_trade_respond(bigint, boolean), public.fl_trade_cancel(bigint) from public, anon;
grant execute on function public.fl_add_placeholder(bigint, text), public.fl_peek(text), public.fl_claim(text, uuid),
  public.fl_set_order(bigint, uuid[]), public.fl_snake_pick(bigint, bigint),
  public.fl_pickup(bigint, bigint, bigint, uuid), public.fl_trade_propose(bigint, uuid, bigint[], bigint[], text, uuid),
  public.fl_trade_respond(bigint, boolean), public.fl_trade_cancel(bigint) to authenticated;
grant execute on function public.fl_on_clock(bigint) to anon, authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'fl_leagues' order by ordinal_position;
