-- fantasy_cl.sql — the owner's 2026-27 counting league (fantasy-league.html), Nov 2026.
-- 12 teams in 2 divisions of 6, drafted in person ($200 auction, 12 players). Scoring = roto on PTS / REB / AST over
-- each school's 22 counted games (scripts/data/fantasy_counting_2027.json). Top 3 of each division make the playoffs.
-- Teams sign in with a CODE, not an account: every write goes through a SECURITY DEFINER function that checks the code's
-- sha256 against cl_teams.code_hash (a column anon can't read). Run once in the Supabase SQL editor, then run the seed
-- (exports/fantasy-league/fantasy_cl_seed.sql, built by scripts/build_fantasy_cl.py — not in git: it holds the hashes).
--
-- Ownership is a set of STINTS (start_date inclusive, end_date exclusive, null = still on the roster); IR is a set of
-- periods on a stint. A player scores for a team on the dates he is on its roster and not on IR.
-- EVERY ROSTER CHANGE IS A REQUEST (owner, Nov 10 2026): pickups, drops and IR go to the commissioner; a trade goes to
-- the other team first, then to the commissioner. Nothing moves until the commissioner approves; an approved move takes
-- effect the next ET day. The roster rules (active spots, pickups, PGs, IR) are checked when it is approved.

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
  how text not null default 'draft',     -- draft / pickup / trade
  start_date date not null,
  end_date date,
  check (end_date is null or end_date>=start_date)
);
alter table cl_stints drop constraint if exists cl_stints_how_check;
alter table cl_stints add constraint cl_stints_how_check check (how in ('draft','pickup','trade'));
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
  kind text not null,                    -- add / drop / ir / activate / trade_in / trade_out
  player text not null,
  eff date not null,
  at timestamptz not null default now()
);

-- requests. kind + payload:
--   pickup   {add: players.id, add_espn, drop: stint|null}
--   drop     {stint}
--   ir       {stint, on: true|false}
--   trade    {give:[stints], get:[stints], add: players.id|null, add_espn, drops:[stints], pdrops:[stints] (partner, on accept)}
-- status: partner (trade waiting on the other team) -> commish -> approved / declined / failed; or canceled by the sender
create table if not exists cl_requests(
  id serial primary key,
  kind text not null check (kind in ('pickup','drop','ir','trade')),
  from_team int not null references cl_teams(id),
  to_team int references cl_teams(id),
  payload jsonb not null default '{}',
  status text not null default 'commish' check (status in ('partner','commish','approved','declined','failed','canceled')),
  note text,
  eff date,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists cl_requests_status on cl_requests(status);

alter table cl_settings enable row level security;
alter table cl_teams enable row level security;
alter table cl_pg enable row level security;
alter table cl_stints enable row level security;
alter table cl_ir enable row level security;
alter table cl_moves enable row level security;
alter table cl_requests enable row level security;
do $$ declare t text; begin
  foreach t in array array['cl_settings','cl_teams','cl_pg','cl_stints','cl_ir','cl_moves','cl_requests'] loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select using (true)', t, t);
  end loop; end $$;
-- reads only: every write is a function below. The code hash is never readable.
revoke insert, update, delete on cl_settings, cl_teams, cl_pg, cl_stints, cl_ir, cl_moves, cl_requests from anon, authenticated;
revoke select on cl_teams from anon, authenticated;
grant select (id, name, division, is_commish) on cl_teams to anon, authenticated;

-- the next ET day: when an approved move takes effect
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

-- ── the moves themselves (internal: only cl_decide runs them) ──
create or replace function _cl_open_stint(p_team int, p_stint int) returns cl_stints language plpgsql as $$
declare s cl_stints;
begin
  select * into s from cl_stints where id=p_stint and team_id=p_team and end_date is null for update;
  if s.id is null then raise exception 'A player in this move is no longer on that roster.'; end if;
  return s;
end $$;

create or replace function _cl_end_stint(s cl_stints, e date) returns void language plpgsql as $$
begin
  if s.start_date>=e then delete from cl_stints where id=s.id;
  else
    update cl_stints set end_date=e where id=s.id;
    delete from cl_ir where stint_id=s.id and start_date>=e;
    update cl_ir set end_date=e where stint_id=s.id and end_date is null;
  end if;
end $$;

create or replace function _cl_drop(p_team int, p_stint int, e date) returns void language plpgsql as $$
declare s cl_stints := _cl_open_stint(p_team,p_stint);
begin
  perform _cl_end_stint(s,e);
  insert into cl_moves(team_id,kind,player,eff) values (p_team,'drop',s.name,e);
end $$;

create or replace function _cl_add(p_team int, p_add int, p_espn bigint, e date) returns void language plpgsql as $$
declare p record; used int; st cl_settings;
begin
  select * into st from cl_settings where id=1;
  select pl.id, pl.name, pl.team, coalesce(pl.espn_id,p_espn) espn_id into p
    from players pl join teams tm on tm.name=pl.team
    where pl.id=p_add and tm.conference in ('B10','SEC','ACC','BIG-12','Big-East');
  if p.id is null then raise exception 'That player is not in the league pool.'; end if;
  if exists(select 1 from cl_stints where player_id=p.id and end_date is null) then raise exception '% is already on a roster.', p.name; end if;
  select count(*) into used from cl_stints where team_id=p_team and how='pickup';
  if used>=st.pickups then raise exception 'All % pickups are used.', st.pickups; end if;
  insert into cl_stints(team_id,player_id,espn_id,name,school,price,how,start_date) values (p_team,p.id,p.espn_id,p.name,p.team,0,'pickup',e);
  insert into cl_moves(team_id,kind,player,eff) values (p_team,'add',p.name,e);
end $$;

create or replace function _cl_ir(p_team int, p_stint int, p_on boolean, e date) returns void language plpgsql as $$
declare s cl_stints := _cl_open_stint(p_team,p_stint); ir cl_ir; n int; st cl_settings;
begin
  select * into st from cl_settings where id=1;
  select * into ir from cl_ir where stint_id=s.id and end_date is null;
  if p_on then
    if ir.id is not null then raise exception '% is already on IR.', s.name; end if;
    select count(*) into n from cl_ir i join cl_stints x on x.id=i.stint_id where x.team_id=p_team and i.end_date is null;
    if n>=st.max_ir then raise exception 'IR is full (% spots).', st.max_ir; end if;
    insert into cl_ir(stint_id,start_date) values (s.id, greatest(e,s.start_date));
    insert into cl_moves(team_id,kind,player,eff) values (p_team,'ir',s.name,e);
  else
    if ir.id is null then raise exception '% is not on IR.', s.name; end if;
    if ir.start_date>=e then delete from cl_ir where id=ir.id; else update cl_ir set end_date=e where id=ir.id; end if;
    insert into cl_moves(team_id,kind,player,eff) values (p_team,'activate',s.name,e);
  end if;
end $$;

-- move a stint to another team (a trade): ends his stint here, starts one there (off IR)
create or replace function _cl_trade_one(p_from int, p_to int, p_stint int, e date) returns void language plpgsql as $$
declare s cl_stints := _cl_open_stint(p_from,p_stint);
begin
  perform _cl_end_stint(s,e);
  insert into cl_stints(team_id,player_id,espn_id,name,school,price,how,start_date) values (p_to,s.player_id,s.espn_id,s.name,s.school,s.price,'trade',e);
  insert into cl_moves(team_id,kind,player,eff) values (p_from,'trade_out',s.name,e),(p_to,'trade_in',s.name,e);
end $$;

-- a team's roster after the move must fit the rules
create or replace function _cl_check(p_team int, e date) returns void language plpgsql as $$
declare st cl_settings; nm text; npg int; nir int; act int;
begin
  select * into st from cl_settings where id=1;
  select name into nm from cl_teams where id=p_team;
  act := cl_active_count(p_team,e);
  if act>st.roster then raise exception '% would have % active players (max %): add a drop.', nm, act, st.roster; end if;
  select count(*) into npg from cl_stints s join cl_pg g on g.player_id=s.player_id where s.team_id=p_team and (s.end_date is null or s.end_date>e) and s.start_date<=e;
  if npg>st.max_pg then raise exception '% would have % point guards (max %).', nm, npg, st.max_pg; end if;
  select count(*) into nir from cl_ir i join cl_stints s on s.id=i.stint_id where s.team_id=p_team and i.end_date is null;
  if nir>st.max_ir then raise exception '% would have % on IR (max %).', nm, nir, st.max_ir; end if;
end $$;

create or replace function _cl_exec(r cl_requests, e date) returns void language plpgsql as $$
declare p jsonb := r.payload; x jsonb;
begin
  if r.kind='pickup' then
    if p->>'drop' is not null then perform _cl_drop(r.from_team,(p->>'drop')::int,e); end if;
    perform _cl_add(r.from_team,(p->>'add')::int,nullif(p->>'add_espn','')::bigint,e);
    perform _cl_check(r.from_team,e);
  elsif r.kind='drop' then
    perform _cl_drop(r.from_team,(p->>'stint')::int,e);
  elsif r.kind='ir' then
    perform _cl_ir(r.from_team,(p->>'stint')::int,(p->>'on')::boolean,e);
    perform _cl_check(r.from_team,e);
  elsif r.kind='trade' then
    for x in select * from jsonb_array_elements(coalesce(p->'give','[]')) loop perform _cl_trade_one(r.from_team,r.to_team,x::text::int,e); end loop;
    for x in select * from jsonb_array_elements(coalesce(p->'get','[]')) loop perform _cl_trade_one(r.to_team,r.from_team,x::text::int,e); end loop;
    for x in select * from jsonb_array_elements(coalesce(p->'drops','[]')) loop perform _cl_drop(r.from_team,x::text::int,e); end loop;
    for x in select * from jsonb_array_elements(coalesce(p->'pdrops','[]')) loop perform _cl_drop(r.to_team,x::text::int,e); end loop;
    if p->>'add' is not null then perform _cl_add(r.from_team,(p->>'add')::int,nullif(p->>'add_espn','')::bigint,e); end if;
    perform _cl_check(r.from_team,e); perform _cl_check(r.to_team,e);
  end if;
end $$;

-- ── requests (code-checked) ──
create or replace function cl_request(p_code text, p_kind text, p_payload jsonb, p_to int default null) returns json language plpgsql security definer set search_path=public,extensions as $$
declare t cl_teams := cl_team_of(p_code); st cl_settings; v_id int;
begin
  select * into st from cl_settings where id=1;
  if cl_eff()>st.reg_end then raise exception 'The regular season is over.'; end if;
  if p_kind='trade' then
    if p_to is null or p_to=t.id or not exists(select 1 from cl_teams where id=p_to) then raise exception 'Pick a team to trade with.'; end if;
    if jsonb_array_length(coalesce(p_payload->'give','[]'))+jsonb_array_length(coalesce(p_payload->'get','[]'))=0 then raise exception 'A trade needs at least one player.'; end if;
    insert into cl_requests(kind,from_team,to_team,payload,status) values ('trade',t.id,p_to,p_payload,'partner') returning cl_requests.id into v_id;
  elsif p_kind in ('pickup','drop','ir') then
    insert into cl_requests(kind,from_team,payload,status) values (p_kind,t.id,p_payload,'commish') returning cl_requests.id into v_id;
  else raise exception 'Unknown request.'; end if;
  return json_build_object('ok',true,'id',v_id);
end $$;

-- the other team answers a trade (accepting can add their own drops)
create or replace function cl_respond(p_code text, p_req int, p_accept boolean, p_drops jsonb default '[]') returns json language plpgsql security definer set search_path=public,extensions as $$
declare t cl_teams := cl_team_of(p_code); r cl_requests;
begin
  select * into r from cl_requests where id=p_req for update;
  if r.id is null or r.to_team<>t.id or r.status<>'partner' then raise exception 'That trade is not waiting on you.'; end if;
  if p_accept then update cl_requests set status='commish', payload=payload||jsonb_build_object('pdrops',coalesce(p_drops,'[]'::jsonb)) where id=r.id;
  else update cl_requests set status='declined', note='Declined by '||t.name, decided_at=now() where id=r.id; end if;
  return json_build_object('ok',true);
end $$;

create or replace function cl_cancel(p_code text, p_req int) returns json language plpgsql security definer set search_path=public,extensions as $$
declare t cl_teams := cl_team_of(p_code);
begin
  update cl_requests set status='canceled', decided_at=now() where id=p_req and from_team=t.id and status in ('partner','commish');
  if not found then raise exception 'That request can''t be canceled.'; end if;
  return json_build_object('ok',true);
end $$;

-- the commissioner approves (runs it, next ET day) or declines
create or replace function cl_decide(p_code text, p_req int, p_approve boolean, p_note text default null) returns json language plpgsql security definer set search_path=public,extensions as $$
declare t cl_teams := cl_team_of(p_code); r cl_requests; e date := cl_eff(); err text;
begin
  if not t.is_commish then raise exception 'Only the commissioner can do that.'; end if;
  perform pg_advisory_xact_lock(4242);
  select * into r from cl_requests where id=p_req for update;
  if r.id is null or r.status<>'commish' then raise exception 'That request is not waiting on the commissioner.'; end if;
  if not p_approve then
    update cl_requests set status='declined', note=coalesce(nullif(p_note,''),'Declined by the commissioner'), decided_at=now() where id=r.id;
    return json_build_object('ok',true,'status','declined');
  end if;
  begin
    perform _cl_exec(r,e);
  exception when others then
    err := sqlerrm;   -- the sub-block's roster changes are rolled back; the request records why
  end;
  if err is not null then
    update cl_requests set status='failed', note=err, decided_at=now() where id=r.id;
    return json_build_object('ok',false,'status','failed','note',err);
  end if;
  update cl_requests set status='approved', note=nullif(p_note,''), eff=e, decided_at=now() where id=r.id;
  return json_build_object('ok',true,'status','approved','eff',e);
end $$;

drop function if exists cl_move(text,int,int,bigint);
drop function if exists cl_set_ir(text,int,boolean);
-- only the code-checked entry points are callable from the site; the helpers run inside them
revoke execute on function cl_team_of(text), cl_active_count(int,date), _cl_open_stint(int,int), _cl_end_stint(cl_stints,date), _cl_drop(int,int,date),
  _cl_add(int,int,bigint,date), _cl_ir(int,int,boolean,date), _cl_trade_one(int,int,int,date), _cl_check(int,date), _cl_exec(cl_requests,date) from public, anon, authenticated;
grant execute on function cl_login(text), cl_request(text,text,jsonb,int), cl_respond(text,int,boolean,jsonb), cl_cancel(text,int), cl_decide(text,int,boolean,text) to anon, authenticated;
