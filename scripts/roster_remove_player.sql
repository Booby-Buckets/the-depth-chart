-- ============================================================================
--  Owner "remove player" in the team page's depth chart editor — ANY player, not only website-added ones
--  (owner, Nov 12 2026: "add remove player from roster to the edit depth chart").
-- ----------------------------------------------------------------------------
--  A sheet player deleted from `players` would come straight back on the next sheet sync, so a removal is
--  remembered in roster_removed (team + name): sheet_sync.gs skips those rows. restore_roster_player()
--  forgets the removal; the next sheet sync then puts him back. Owner-only (SECURITY DEFINER, owner email).
--  Run the whole file once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================
create table if not exists public.roster_removed (
  team text not null, name text not null, espn_id bigint, removed_at timestamptz not null default now(),
  primary key (team, name));
alter table public.roster_removed enable row level security;
drop policy if exists roster_removed_read on public.roster_removed;
create policy roster_removed_read on public.roster_removed for select using (true);   -- the sync + pages read it

create or replace function public.remove_roster_player(p_id bigint)
returns integer language plpgsql security definer set search_path = public as $$
declare r players%rowtype; n integer;
begin
  if coalesce(auth.jwt() ->> 'email', '') <> 'blee4824@gmail.com' then
    raise exception 'owner only' using errcode = '42501';
  end if;
  select * into r from players where id = p_id;
  if not found then raise exception 'Player not found'; end if;
  -- a sheet player: remember the removal so the sheet sync doesn't re-add him
  if r.site_added_at is null then
    insert into roster_removed (team, name, espn_id) values (r.team, r.name, r.espn_id)
      on conflict (team, name) do update set espn_id = excluded.espn_id, removed_at = now();
  end if;
  delete from players where id = p_id;
  get diagnostics n = row_count;
  -- close the gap in the depth chart
  update players p set depth_order = q.rn from (
    select id, row_number() over (order by depth_order nulls last, id) as rn from players where team = r.team) q
  where p.id = q.id and p.depth_order is distinct from q.rn;
  return n;
end; $$;

create or replace function public.restore_roster_player(p_team text, p_name text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if coalesce(auth.jwt() ->> 'email', '') <> 'blee4824@gmail.com' then
    raise exception 'owner only' using errcode = '42501';
  end if;
  delete from roster_removed where team = p_team and name = p_name;
  get diagnostics n = row_count; return n;
end; $$;

revoke all on function public.remove_roster_player(bigint) from public, anon;
revoke all on function public.restore_roster_player(text, text) from public, anon;
grant execute on function public.remove_roster_player(bigint) to authenticated;
grant execute on function public.restore_roster_player(text, text) to authenticated;
select proname from pg_proc where proname in ('remove_roster_player', 'restore_roster_player');
