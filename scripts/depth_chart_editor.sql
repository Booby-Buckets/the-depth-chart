-- ============================================================================
--  Owner depth-chart editor (team page → "Edit depth chart").
-- ----------------------------------------------------------------------------
--  players is read-only to the public key (RLS), so the website saves a new order through
--  set_depth_chart(), a SECURITY DEFINER function that only the owner's signed-in account may
--  call. It writes players.depth_order (1 = first starter) and stamps players.depth_set_at.
--
--  The sheet sync (sheet_sync.gs) reads depth_set_at: a team with any stamped row keeps the
--  website order on the next sync, and players new to the sheet go to the bottom. Calling
--  reset_depth_chart('Team') clears the stamps and hands that team back to the sheet order.
--
--  Run the whole file once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

alter table public.players add column if not exists depth_set_at timestamptz;

create or replace function public.set_depth_chart(p_team text, p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if coalesce(auth.jwt() ->> 'email', '') <> 'blee4824@gmail.com' then
    raise exception 'owner only' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'empty depth chart';
  end if;
  -- every id must belong to this team, so a stale page can't reorder someone else's roster
  if exists (select 1 from unnest(p_ids) as x(id)
             where not exists (select 1 from players p where p.id = x.id and p.team = p_team)) then
    raise exception 'depth chart lists a player who is not on %', p_team;
  end if;
  update players p
     set depth_order  = array_position(p_ids, p.id),
         depth_set_at = now()
   where p.team = p_team
     and p.id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.reset_depth_chart(p_team text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if coalesce(auth.jwt() ->> 'email', '') <> 'blee4824@gmail.com' then
    raise exception 'owner only' using errcode = '42501';
  end if;
  update players set depth_set_at = null where team = p_team and depth_set_at is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.set_depth_chart(text, bigint[]) from public, anon;
revoke all on function public.reset_depth_chart(text) from public, anon;
grant execute on function public.set_depth_chart(text, bigint[]) to authenticated;
grant execute on function public.reset_depth_chart(text) to authenticated;

-- verify: expect the column and both functions
select column_name from information_schema.columns where table_name = 'players' and column_name = 'depth_set_at';
select proname from pg_proc where proname in ('set_depth_chart', 'reset_depth_chart');
