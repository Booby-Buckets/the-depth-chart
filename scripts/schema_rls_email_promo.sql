-- ============================================================================
--  RLS ADDENDUM — email PII + promo codes + counter triggers
--  Run in the Supabase SQL editor AFTER schema_rls_lockdown.sql. Additive and
--  idempotent (safe to re-run). service_role bypasses all of this.
--
--  Closes two gaps the base lockdown left open (both confirmed live 2026-08):
--    1) profiles.email was still anon-readable — a PII leak.
--    2) promo_codes were anon-enumerable, and since the lockdown blocks client
--       writes the old client-side redemption no longer works at all. Redemption
--       is moved server-side to a SECURITY DEFINER function that validates the
--       code and grants the plan atomically — the client can neither read the
--       codes nor set its own plan.
--  Plus: triggers so denormalized counters stay correct now that the client no
--  longer cross-updates other users' rows (the base lockdown blocks that).
--
--  PAIRS WITH the app commit that (a) reads explicit profile columns (never
--  email) and (b) redeems via rpc/redeem_promo. Deploy them together.
-- ============================================================================

-- 1) Hide email from the public. The app reads explicit profile columns and
--    never selects email; a user's own email comes from their auth session.
revoke select (email) on public.profiles from anon, authenticated;

-- 2) Lock promo_codes entirely (no client read/write). Only service_role and the
--    definer function below can touch it.
do $$
declare pol record;
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='promo_codes') then
    for pol in select policyname from pg_policies where schemaname='public' and tablename='promo_codes' loop
      execute format('drop policy if exists %I on public.promo_codes', pol.policyname);
    end loop;
    alter table public.promo_codes enable row level security;
    raise notice 'promo_codes locked (no client policies)';
  else
    raise notice 'promo_codes skipped (no such table)';
  end if;
end $$;

-- redeem_promo(): validate + mark used + grant plan, atomically. SECURITY DEFINER
-- so it can touch the locked promo_codes table and the plan column (which users
-- cannot). Returns { ok, months, expires } | { ok:false, msg }.
create or replace function public.redeem_promo(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v public.promo_codes; v_months int; v_expires timestamptz; v_uid uuid := auth.uid();
begin
  if v_uid is null then return json_build_object('ok', false, 'msg', 'Not signed in'); end if;
  select * into v from public.promo_codes where code = p_code;
  if not found then return json_build_object('ok', false, 'msg', 'Code not found'); end if;
  if v.used    then return json_build_object('ok', false, 'msg', 'This code has already been used'); end if;
  v_months  := case when coalesce(v.duration,'') ilike '%year%' then 12 else 1 end;
  v_expires := now() + (v_months || ' months')::interval;
  update public.promo_codes set used = true, used_by = v_uid, used_at = now() where id = v.id;
  update public.profiles     set plan = 'premium', sub_expires_at = v_expires where id = v_uid;
  return json_build_object('ok', true, 'months', v_months, 'expires', v_expires);
end $$;
revoke all on function public.redeem_promo(text) from public;
grant execute on function public.redeem_promo(text) to authenticated;

-- 3) Counter triggers — keep reply_count / follower_count / following_count
--    correct server-side (the client no longer PATCHes other users' rows).
create or replace function public.bump_reply_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.forum_topics set reply_count = coalesce(reply_count,0)+1, updated_at = now() where id = new.topic_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.forum_topics set reply_count = greatest(coalesce(reply_count,0)-1,0) where id = old.topic_id;
    return old;
  end if;
  return null;
end $$;
drop trigger if exists trg_reply_count on public.forum_replies;
create trigger trg_reply_count after insert or delete on public.forum_replies
  for each row execute function public.bump_reply_count();

create or replace function public.bump_follow_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set follower_count  = coalesce(follower_count,0)+1  where id = new.following_id;
    update public.profiles set following_count = coalesce(following_count,0)+1 where id = new.follower_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.profiles set follower_count  = greatest(coalesce(follower_count,0)-1,0)  where id = old.following_id;
    update public.profiles set following_count = greatest(coalesce(following_count,0)-1,0) where id = old.follower_id;
    return old;
  end if;
  return null;
end $$;
drop trigger if exists trg_follow_counts on public.follows;
create trigger trg_follow_counts after insert or delete on public.follows
  for each row execute function public.bump_follow_counts();

-- ============================================================================
--  VERIFY (as anon via REST, i.e. the site's public key):
--    select email from public.profiles limit 1;   -- → permission denied (good)
--    select code  from public.promo_codes limit 1; -- → permission denied / [] (good)
--  As a signed-in user, redeeming a bad code returns {ok:false}; a valid unused
--  code flips plan→premium and marks it used (verify in the profiles row).
--  ROLLBACK:  grant select (email) on public.profiles to anon, authenticated;
--             drop function if exists public.redeem_promo(text);
-- ============================================================================
