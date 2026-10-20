-- ============================================================================
--  Owner "Add player" in the team page's depth chart editor (tdc-depth-editor.js).
-- ----------------------------------------------------------------------------
--  For the odd missing player (a walk-on, a late transfer) without re-running the sheet sync.
--  add_roster_player() inserts one row into players at the bottom of the team's depth chart and
--  stamps site_added_at; remove_roster_player() undoes a website-added row (only those).
--  Both are SECURITY DEFINER and only the owner's signed-in account may call them, like
--  set_depth_chart() in depth_chart_editor.sql. players stays read-only to the public key.
--
--  The sheet sync (sheet_sync.gs) removes a team's rows that aren't on its tab; it now skips rows
--  with site_added_at set, so a website-added player survives the next sync. If the same player is
--  later added to the sheet, the sync's upsert on (name, team) updates this row.
--
--  Run the whole file once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

alter table public.players add column if not exists site_added_at timestamptz;

create or replace function public.add_roster_player(
  p_team text, p_name text, p_position text default null, p_class text default null,
  p_height text default null, p_hometown text default null, p_espn_id bigint default null,
  p_transfer boolean default false, p_international boolean default false)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare new_id bigint; nm text := btrim(coalesce(p_name, ''));
begin
  if coalesce(auth.jwt() ->> 'email', '') <> 'blee4824@gmail.com' then
    raise exception 'owner only' using errcode = '42501';
  end if;
  if length(nm) < 3 then raise exception 'Enter the player''s full name'; end if;
  -- only teams that already have a roster (catches a typo'd team name)
  if not exists (select 1 from players where team = p_team) then
    raise exception 'No roster found for %', p_team;
  end if;
  if exists (select 1 from players where team = p_team and lower(name) = lower(nm)) then
    raise exception '% is already on the % roster', nm, p_team;
  end if;
  if p_espn_id is not null and exists (select 1 from players where espn_id = p_espn_id) then
    raise exception 'That ESPN id is already on a roster (%)', (select team || ': ' || name from players where espn_id = p_espn_id limit 1);
  end if;
  insert into players (name, team, position, class_year, yr, height, hometown, espn_id, depth_order,
                       starter, is_addition, is_international, is_injured, site_added_at)
  values (nm, p_team, nullif(btrim(coalesce(p_position, '')), ''), nullif(btrim(coalesce(p_class, '')), ''),
          nullif(btrim(coalesce(p_class, '')), ''), nullif(btrim(coalesce(p_height, '')), ''),
          nullif(btrim(coalesce(p_hometown, '')), ''), p_espn_id,
          (select coalesce(max(depth_order), 0) + 1 from players where team = p_team),
          false, coalesce(p_transfer, false), coalesce(p_international, false), false, now())
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.remove_roster_player(p_id bigint)
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
  delete from players where id = p_id and site_added_at is not null;   -- website-added rows only
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Only players added on the website can be removed here'; end if;
  return n;
end;
$$;

revoke all on function public.add_roster_player(text, text, text, text, text, text, bigint, boolean, boolean) from public, anon;
revoke all on function public.remove_roster_player(bigint) from public, anon;
grant execute on function public.add_roster_player(text, text, text, text, text, text, bigint, boolean, boolean) to authenticated;
grant execute on function public.remove_roster_player(bigint) to authenticated;

-- verify: expect the column and both functions
select column_name from information_schema.columns where table_name = 'players' and column_name = 'site_added_at';
select proname from pg_proc where proname in ('add_roster_player', 'remove_roster_player');
