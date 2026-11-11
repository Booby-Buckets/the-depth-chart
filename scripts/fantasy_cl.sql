-- fantasy_cl.sql — the owner's 2026-27 counting league (fantasy-league.html), Nov 2026.
-- 12 teams in 2 divisions of 6, drafted in person ($200 auction, 12 players). Scoring = roto on PTS / REB / AST over
-- each school's 22 counted games (scripts/data/fantasy_counting_2027.json). Top 3 of each division make the playoffs.
-- Teams sign in with a CODE, not an account: every write goes through a SECURITY DEFINER function that checks the code's
-- sha256 against cl_teams.code_hash (a column anon can't read). Run once in the Supabase SQL editor, then run the seed
-- (exports/fantasy-league/fantasy_cl_seed.sql, built by scripts/build_fantasy_cl.py — not in git: it holds the hashes).
--
-- Ownership is a set of STINTS (start_date inclusive, end_date exclusive, null = still on the roster); IR is a set of
-- periods on a stint. A player scores for a team on the dates he is on its roster and not on IR. Every move takes effect
-- the next ET day, so games already under way still count for whoever had him that morning.

create extension if not exists pgcrypto with schema extensions;

create table if not exists cl_settings(
  id int primary key default 1 check (id=1),
  season text not null default '2026-27',
  roster int not null default 12,        -- active (non-IR) players
  pickups int not null default 5,        -- adds per team for the season
  max_pg int not null default 3,         -- players on cl_pg, IR included
  max_ir int not null default 2,
  reg_end date not null default '2027-03-07',   -- last regular-season counting date
  draft_start date not null default '2026-11-01'
);
insert into cl_settings(id) values (1) on conflict do nothing;

create table if not exists cl_teams(
  id serial primary key,
  name text unique not null,
  division int not null check (division in (1,2)),
  code_hash text not null,
  is_commish boolean not null default false
);

-- the league's point-guard list (tdc-fantasy-pg.js), by players.id
create table if not exists cl_pg(player_id int primary key, espn_id bigint, name text not null, school text not null);

create table if not exists cl_stints(
  id serial primary key,
  team_id int not null references cl_teams(id),
  player_id int not null,
  espn_id bigint,
  name text not null,
  school text not null,                  -- players.team (sheet short name)
  price int not null default 0,
  how text not null default 'draft' check (how in ('draft','pickup')),
  start_date date not null,
  end_date date,
  check (end_date is null or end_date>=start_date)
);
create index if not exists cl_stints_team on cl_stints(team_id);
create unique index if not exists cl_stints_one_owner on cl_stints(player_id) where end_date is null;

create table if not exists cl_ir(
  id serial primary key,
  stint_id int not null references cl_stints(id) on delete cascade,
  start_date date not null,
  end_date date,
  check (end_date is null or end_date>=start_date)
);

create table if not exists cl_moves(
  id serial primary key,
  team_id int not null references cl_teams(id),
  kind text not null,                    -- add / drop / ir / activate
  player text not null,
  eff date not null,
  at timestamptz not null default now()
);

alter table cl_settings enable row level security;
alter table cl_teams enable row level security;
alter table cl_pg enable row level security;
alter table cl_stints enable row level security;
alter table cl_ir enable row level security;
alter table cl_moves enable row level security;
do $$ declare t text; begin
  foreach t in array array['cl_settings','cl_teams','cl_pg','cl_stints','cl_ir','cl_moves'] loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select using (true)', t, t);
  end loop; end $$;
-- reads only: every write is a function below. The code hash is never readable.
revoke insert, update, delete on cl_settings, cl_teams, cl_pg, cl_stints, cl_ir, cl_moves from anon, authenticated;
revoke select on cl_teams from anon, authenticated;
grant select (id, name, division, is_commish) on cl_teams to anon, authenticated;

-- the next ET day: when a move takes effect
create or replace function cl_eff() returns date language sql stable as
$$ select ((now() at time zone 'America/New_York')::date + 1) $$;

create or replace function cl_team_of(p_code text) returns cl_teams language plpgsql stable security definer set search_path=public,extensions as $$
declare t cl_teams;
begin
  select * into t from cl_teams where code_hash=encode(extensions.digest(upper(trim(coalesce(p_code,''))),'sha256'),'hex');
  if t.id is null then raise exception 'That code is not right.'; end if;
  return t;
end $$;

create or replace function cl_login(p_code text) returns json language plpgsql stable security definer set search_path=public,extensions as $$
declare t cl_teams := cl_team_of(p_code);
begin return json_build_object('id',t.id,'name',t.name,'division',t.division,'is_commish',t.is_commish); end $$;

-- open stints on a team that are NOT on IR from date d on
create or replace function cl_active_count(p_team int, d date) returns int language sql stable as $$
  select count(*)::int from cl_stints s
  where s.team_id=p_team and s.start_date<=d and (s.end_date is null or s.end_date>d)
    and not exists(select 1 from cl_ir i where i.stint_id=s.id and i.start_date<=d and (i.end_date is null or i.end_date>d))
$$;

-- IR on / off
create or replace function cl_set_ir(p_code text, p_stint int, p_on boolean) returns json language plpgsql security definer set search_path=public,extensions as $$
declare t cl_teams := cl_team_of(p_code); st cl_settings; s cl_stints; e date := cl_eff(); n int; ir cl_ir;
begin
  select * into st from cl_settings where id=1;
  if e>st.reg_end then raise exception 'The regular season is over.'; end if;
  select * into s from cl_stints where id=p_stint and team_id=t.id and end_date is null for update;
  if s.id is null then raise exception 'That player is not on your roster.'; end if;
  select * into ir from cl_ir where stint_id=s.id and end_date is null;
  if p_on then
    if ir.id is not null then raise exception '% is already on IR.', s.name; end if;
    select count(*) into n from cl_ir i join cl_stints x on x.id=i.stint_id where x.team_id=t.id and i.end_date is null;
    if n>=st.max_ir then raise exception 'Your IR is full (% spots).', st.max_ir; end if;
    insert into cl_ir(stint_id,start_date) values (s.id, greatest(e,s.start_date));
    insert into cl_moves(team_id,kind,player,eff) values (t.id,'ir',s.name,e);
  else
    if ir.id is null then raise exception '% is not on IR.', s.name; end if;
    if cl_active_count(t.id,e)>=st.roster then raise exception 'No open roster spot: drop someone first (% active max).', st.roster; end if;
    if ir.start_date>=e then delete from cl_ir where id=ir.id; else update cl_ir set end_date=e where id=ir.id; end if;
    insert into cl_moves(team_id,kind,player,eff) values (t.id,'activate',s.name,e);
  end if;
  return json_build_object('ok',true,'eff',e);
end $$;

-- add and/or drop in one move (either may be null)
create or replace function cl_move(p_code text, p_add int, p_drop int, p_add_espn bigint default null) returns json language plpgsql security definer set search_path=public,extensions as $$
declare t cl_teams := cl_team_of(p_code); st cl_settings; e date := cl_eff(); s cl_stints; p record; used int; npg int; ir_active boolean;
begin
  select * into st from cl_settings where id=1;
  if e>st.reg_end then raise exception 'The regular season is over.'; end if;
  if p_add is null and p_drop is null then raise exception 'Nothing to do.'; end if;
  perform pg_advisory_xact_lock(4242);    -- one roster move at a time, league-wide (two teams can't add the same player)
  if p_drop is not null then
    select * into s from cl_stints where id=p_drop and team_id=t.id and end_date is null for update;
    if s.id is null then raise exception 'That player is not on your roster.'; end if;
    if s.start_date>=e then delete from cl_stints where id=s.id;
    else
      update cl_stints set end_date=e where id=s.id;
      delete from cl_ir where stint_id=s.id and start_date>=e;
      update cl_ir set end_date=e where stint_id=s.id and end_date is null;
    end if;
    insert into cl_moves(team_id,kind,player,eff) values (t.id,'drop',s.name,e);
  end if;
  if p_add is not null then
    select pl.id, pl.name, pl.team, coalesce(pl.espn_id,p_add_espn) espn_id into p
      from players pl join teams tm on tm.name=pl.team
      where pl.id=p_add and tm.conference in ('B10','SEC','ACC','BIG-12','Big-East');
    if p.id is null then raise exception 'That player is not in the league pool.'; end if;
    if exists(select 1 from cl_stints where player_id=p.id and end_date is null) then raise exception '% is already on a roster.', p.name; end if;
    select count(*) into used from cl_stints where team_id=t.id and how='pickup';
    if used>=st.pickups then raise exception 'You have used all % pickups.', st.pickups; end if;
    insert into cl_stints(team_id,player_id,espn_id,name,school,price,how,start_date) values (t.id,p.id,p.espn_id,p.name,p.team,0,'pickup',e);
    select count(*) into npg from cl_stints s2 join cl_pg g on g.player_id=s2.player_id where s2.team_id=t.id and s2.end_date is null;
    if npg>st.max_pg then raise exception 'That would be % point guards (max %).', npg, st.max_pg; end if;
    if cl_active_count(t.id,e)>st.roster then raise exception 'Your roster is full (% active): drop someone or move someone to IR.', st.roster; end if;
    insert into cl_moves(team_id,kind,player,eff) values (t.id,'add',p.name,e);
  end if;
  return json_build_object('ok',true,'eff',e);
end $$;

grant execute on function cl_login(text), cl_set_ir(text,int,boolean), cl_move(text,int,int,bigint) to anon, authenticated;
revoke execute on function cl_team_of(text) from anon, authenticated, public;
