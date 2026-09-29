-- ============================================================================
--  OWNER MEMBER ACCESS — search accounts + set their plan from owner.html.
--  Run the whole file in the Supabase SQL editor. Safe to re-run.
--
--  profiles.plan is column-locked (users can't raise their own plan), and emails live in
--  auth.users, which the browser can't read. These SECURITY DEFINER functions can — but
--  each one refuses to run unless the caller's JWT is the owner email (tdc_is_owner()).
--
--    admin_find_accounts(q)                         → up to 50 accounts matching username/email
--    admin_set_plan(p_user, p_plan, p_months)       → plan = free|premium|pro|coach;
--                                                     p_months null = no expiry, else N months
-- ============================================================================

create or replace function public.tdc_is_owner() returns boolean
language sql stable as $$ select coalesce(auth.jwt() ->> 'email', '') = 'blee4824@gmail.com' $$;

-- profiles.plan must accept every tier (same fix as fix_promo_codes_all.sql; harmless if done)
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and rel.relname = 'profiles' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%plan%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
  alter table public.profiles
    add constraint profiles_plan_check
    check (plan is null or plan in ('free','premium','pro','coach'));
end $$;


drop function if exists public.admin_find_accounts(text);
create function public.admin_find_accounts(q text)
returns table (id uuid, username text, email text, plan text, sub_expires_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.tdc_is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  return query
    select u.id, p.username::text, u.email::text, coalesce(p.plan, 'free')::text, p.sub_expires_at, u.created_at
    from auth.users u
    left join public.profiles p on p.id = u.id
    where coalesce(btrim(q), '') = ''
       or p.username ilike '%' || btrim(q) || '%'
       or u.email    ilike '%' || btrim(q) || '%'
    order by u.created_at desc
    limit 50;
end $$;

revoke all on function public.admin_find_accounts(text) from public, anon;
grant execute on function public.admin_find_accounts(text) to authenticated;


create or replace function public.admin_set_plan(p_user uuid, p_plan text, p_months int default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_plan    text := lower(btrim(coalesce(p_plan, '')));
  v_expires timestamptz;
begin
  if not public.tdc_is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  if v_plan not in ('free','premium','pro','coach') then raise exception 'Unknown plan: %', p_plan; end if;

  v_expires := case when v_plan = 'free' or p_months is null then null
                    else now() + make_interval(months => p_months) end;

  update public.profiles set plan = v_plan, sub_expires_at = v_expires where id = p_user;
  if not found then
    raise exception 'That account has no profile yet (they have not finished sign-up)';
  end if;

  return json_build_object('ok', true, 'plan', v_plan, 'expires', v_expires);
end $$;

revoke all on function public.admin_set_plan(uuid, text, int) from public, anon;
grant execute on function public.admin_set_plan(uuid, text, int) to authenticated;


-- VERIFY — expect two rows
select proname from pg_proc where proname in ('admin_find_accounts', 'admin_set_plan') order by proname;
