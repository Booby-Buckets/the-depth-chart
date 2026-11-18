-- fantasy_cl_v5_commish_ir.sql — run AFTER v4. Owner, Nov 17 2026: the commissioner can also put a player on IR on a
-- date (same rule as a drop: games through that date still count, IR starts the next day), optionally for a set
-- stretch: p_ir_until = the last day he is on IR (he counts again the day after). Null = until he's activated.
-- Done in the same call as the add, so "IR him and pick someone up" checks the roster rules once, after both.

drop function if exists cl_commish_move(text,int,date,int,bigint,int);
create or replace function cl_commish_move(p_code text, p_team int, p_date date, p_add int default null, p_add_espn bigint default null,
  p_drop int default null, p_ir int default null, p_ir_until date default null)
returns json language plpgsql security definer set search_path=public,extensions as $$
declare t cl_teams := cl_team_of(p_code); e date; s cl_stints; p record; st cl_settings; used int; nir int;
begin
  if not t.is_commish then raise exception 'Only the commissioner can do that.'; end if;
  if p_date is null then raise exception 'Pick the date of the move.'; end if;
  if p_add is null and p_drop is null and p_ir is null then raise exception 'Pick a player to add, drop or put on IR.'; end if;
  if not exists(select 1 from cl_teams where id=p_team) then raise exception 'Pick a team.'; end if;
  perform pg_advisory_xact_lock(4242);
  select * into st from cl_settings where id=1;
  e := p_date + 1;
  if p_ir is not null then
    s := _cl_open_stint(p_team, p_ir);
    if p_ir_until is not null and p_ir_until < e then raise exception 'The IR has to end after it starts.'; end if;
    if exists(select 1 from cl_ir where stint_id=s.id and (end_date is null or end_date>e)) then raise exception '% is already on IR then.', s.name; end if;
    select count(*) into nir from cl_ir i join cl_stints x on x.id=i.stint_id
      where x.team_id=p_team and i.start_date<=e and (i.end_date is null or i.end_date>e);
    if nir>=st.max_ir then raise exception 'IR is full (% spots).', st.max_ir; end if;
    insert into cl_ir(stint_id,start_date,end_date) values (s.id, greatest(e,s.start_date), p_ir_until+1);
    insert into cl_moves(team_id,kind,player,eff) values (p_team,'ir',s.name,e);
    if p_ir_until is not null then insert into cl_moves(team_id,kind,player,eff) values (p_team,'activate',s.name,p_ir_until+1); end if;
  end if;
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

revoke execute on function cl_commish_move(text,int,date,int,bigint,int,int,date) from public;
grant execute on function cl_commish_move(text,int,date,int,bigint,int,int,date) to anon, authenticated;
