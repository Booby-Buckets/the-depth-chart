-- fantasy_cl_v2_lock.sql — run AFTER fantasy_cl.sql (+ seed). Owner, Nov 11 2026: the league is private.
-- You need a site ACCOUNT and your team CODE: entering the code once links your account to that team (cl_members;
-- several accounts may share a team). After that every read and write is by account: the cl_* tables are closed to
-- the site and the league comes only through cl_data(), which answers only a linked account.

create table if not exists cl_members(
  user_id uuid primary key,
  team_id int not null references cl_teams(id),
  linked_at timestamptz not null default now()
);
alter table cl_members enable row level security;

-- close every league table: no policies = no direct reads; grants removed too
do $$ declare t text; begin
  foreach t in array array['cl_settings','cl_teams','cl_pg','cl_stints','cl_ir','cl_moves','cl_requests','cl_members'] loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop; end $$;

-- the signed-in account's team
create or replace function cl_my_team() returns cl_teams language plpgsql stable security definer set search_path=public,extensions as $$
declare t cl_teams;
begin
  if auth.uid() is null then raise exception 'Sign in to your account first.'; end if;
  select tm.* into t from cl_members m join cl_teams tm on tm.id=m.team_id where m.user_id=auth.uid();
  if t.id is null then raise exception 'Enter your team code first.'; end if;
  return t;
end $$;

-- enter a code: links this account to the code's team (entering another code moves the account)
create or replace function cl_claim(p_code text) returns json language plpgsql security definer set search_path=public,extensions as $$
declare t cl_teams;
begin
  if auth.uid() is null then raise exception 'Sign in to your account first.'; end if;
  t := cl_team_of(p_code);
  insert into cl_members(user_id,team_id) values (auth.uid(),t.id) on conflict (user_id) do update set team_id=excluded.team_id, linked_at=now();
  return json_build_object('id',t.id,'name',t.name,'division',t.division,'is_commish',t.is_commish);
end $$;

-- everything the page shows, for a linked account only
create or replace function cl_data() returns json language plpgsql stable security definer set search_path=public,extensions as $$
declare t cl_teams := cl_my_team();
begin
  return json_build_object(
    'me', json_build_object('id',t.id,'name',t.name,'division',t.division,'is_commish',t.is_commish),
    'settings', (select row_to_json(s) from cl_settings s where id=1),
    'teams', (select coalesce(json_agg(json_build_object('id',id,'name',name,'division',division,'is_commish',is_commish) order by id),'[]') from cl_teams),
    'stints', (select coalesce(json_agg(s order by s.id),'[]') from cl_stints s),
    'ir', (select coalesce(json_agg(i order by i.id),'[]') from cl_ir i),
    'moves', (select coalesce(json_agg(m order by m.id desc),'[]') from (select * from cl_moves order by id desc limit 200) m),
    'requests', (select coalesce(json_agg(r order by r.id desc),'[]') from (select * from cl_requests order by id desc limit 300) r),
    'pg', (select coalesce(json_agg(player_id),'[]') from cl_pg));
end $$;

-- the request functions, by account instead of by code (the code versions are removed below)
create or replace function cl_request(p_kind text, p_payload jsonb, p_to int default null) returns json language plpgsql security definer set search_path=public,extensions as $$
declare t cl_teams := cl_my_team(); st cl_settings; v_id int;
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

create or replace function cl_respond(p_req int, p_accept boolean, p_drops jsonb default '[]') returns json language plpgsql security definer set search_path=public,extensions as $$
declare t cl_teams := cl_my_team(); r cl_requests;
begin
  select * into r from cl_requests where id=p_req for update;
  if r.id is null or r.to_team<>t.id or r.status<>'partner' then raise exception 'That trade is not waiting on you.'; end if;
  if p_accept then update cl_requests set status='commish', payload=payload||jsonb_build_object('pdrops',coalesce(p_drops,'[]'::jsonb)) where id=r.id;
  else update cl_requests set status='declined', note='Declined by '||t.name, decided_at=now() where id=r.id; end if;
  return json_build_object('ok',true);
end $$;

create or replace function cl_cancel(p_req int) returns json language plpgsql security definer set search_path=public,extensions as $$
declare t cl_teams := cl_my_team();
begin
  update cl_requests set status='canceled', decided_at=now() where id=p_req and from_team=t.id and status in ('partner','commish');
  if not found then raise exception 'That request can''t be canceled.'; end if;
  return json_build_object('ok',true);
end $$;

create or replace function cl_decide(p_req int, p_approve boolean, p_note text default null) returns json language plpgsql security definer set search_path=public,extensions as $$
declare t cl_teams := cl_my_team(); r cl_requests; e date := cl_eff(); err text;
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

-- the old code-per-call versions: gone, so a code alone (without an account) opens nothing but cl_claim
drop function if exists cl_login(text);
drop function if exists cl_request(text,text,jsonb,int);
drop function if exists cl_respond(text,int,boolean,jsonb);
drop function if exists cl_cancel(text,int);
drop function if exists cl_decide(text,int,boolean,text);

revoke execute on function cl_my_team() from public, anon, authenticated;
revoke execute on function cl_claim(text), cl_data(), cl_request(text,jsonb,int), cl_respond(int,boolean,jsonb), cl_cancel(int), cl_decide(int,boolean,text) from public, anon;
grant execute on function cl_claim(text), cl_data(), cl_request(text,jsonb,int), cl_respond(int,boolean,jsonb), cl_cancel(int), cl_decide(int,boolean,text) to authenticated;
