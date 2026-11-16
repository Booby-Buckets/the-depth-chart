-- fantasy_cl_v4_commish.sql — run AFTER fantasy_cl.sql, v2 and v3. Owner, Nov 15 2026: some teams won't use the site,
-- so the commissioner records their adds and drops directly, with the date they happened (backdating is fine).
--   DROP on date D: his games through D count for this team (stint ends D+1, end_date is exclusive).
--   ADD  on date D: only his games AFTER D count (stint starts D+1).
-- So a same-day swap never double-counts a date. Adding uses one of the team's pickups (same rule as a request), and the
-- team must still fit the roster rules on D+1. Dropping on/before the day a stint started erases that stint (an undo).

create or replace function cl_commish_move(p_code text, p_team int, p_date date, p_add int default null, p_add_espn bigint default null, p_drop int default null)
returns json language plpgsql security definer set search_path=public,extensions as $$
declare t cl_teams := cl_team_of(p_code); e date; s cl_stints; p record; st cl_settings; used int;
begin
  if not t.is_commish then raise exception 'Only the commissioner can do that.'; end if;
  if p_date is null then raise exception 'Pick the date of the move.'; end if;
  if p_add is null and p_drop is null then raise exception 'Pick a player to add or drop.'; end if;
  if not exists(select 1 from cl_teams where id=p_team) then raise exception 'Pick a team.'; end if;
  perform pg_advisory_xact_lock(4242);
  select * into st from cl_settings where id=1;
  e := p_date + 1;
  if p_drop is not null then
    s := _cl_open_stint(p_team, p_drop);
    perform _cl_end_stint(s, e);
    insert into cl_moves(team_id,kind,player,eff) values (p_team,'drop',s.name,e);
  end if;
  if p_add is not null then
    select pl.id, pl.name, pl.team, coalesce(pl.espn_id,p_add_espn) espn_id into p
      from players pl join teams tm on tm.name=pl.team
      where pl.id=p_add and tm.conference in ('B10','SEC','ACC','BIG-12','Big-East');
    if p.id is null then raise exception 'That player is not in the league pool.'; end if;
    if exists(select 1 from cl_stints where player_id=p.id and (end_date is null or end_date>e)) then
      raise exception '% is on a roster after that date — drop him there first.', p.name; end if;
    select count(*) into used from cl_stints where team_id=p_team and how='pickup';
    if used>=st.pickups then raise exception 'That team has used all % pickups.', st.pickups; end if;
    insert into cl_stints(team_id,player_id,espn_id,name,school,price,how,start_date) values (p_team,p.id,p.espn_id,p.name,p.team,0,'pickup',e);
    insert into cl_moves(team_id,kind,player,eff) values (p_team,'add',p.name,e);
  end if;
  perform _cl_check(p_team, e);
  return json_build_object('ok',true,'eff',e);
end $$;

revoke execute on function cl_commish_move(text,int,date,int,bigint,int) from public;
grant execute on function cl_commish_move(text,int,date,int,bigint,int) to anon, authenticated;
