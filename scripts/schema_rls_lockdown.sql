-- ============================================================================
--  RLS LOCKDOWN — The Depth Chart
--  Run ONCE in the Supabase SQL editor (Dashboard → SQL). Idempotent: safe to
--  re-run. The service_role key (loaders in load_supabase.py) BYPASSES RLS, so
--  every build/backfill script keeps working. The site uses the public anon
--  key, which after this is READ-ONLY on data and can only touch a user's OWN
--  rows. The owner (blee4824) keeps full cache-write access via their JWT.
--
--  WHY: today the anon key can write/delete every table, ANY signed-in user can
--  set their own profiles.plan='coach' (free paywall bypass), promo codes are
--  fully client-trusted, and profiles.email is publicly dumpable (PII leak).
--
--  ⚠️  This migration is paired with app changes (explicit profile selects +
--      promo RPC + dropping client-side counter writes). Run the SQL AND deploy
--      the matching app commit together, or the promo flow / profile reads break.
--
--  Verification + rollback are at the bottom of this file.
-- ============================================================================

-- Owner email used by the cache-write policies.  (Kept in one place.)
-- If you change the owner account, update it here and re-run this file.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) PUBLIC DATA TABLES — public READ, no client writes.
--    (Loaders write with the service_role key, which bypasses RLS.)
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'players','player_history','player_advanced','teams','team_seasons',
    'team_actual_stats','games','box_scores','shots','postseason_games',
    'tournament_games','awards','bbref_seasons','losses','posts'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "public read" on public.%I;', t);
    execute format('create policy "public read" on public.%I for select using (true);', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) OWNER-PUBLISHED CACHES — public READ; write only with the owner's JWT.
--    The owner publishes these from the browser (tdcOwnerToken); everyone else
--    reads. (service_role still bypasses for offline rebuilds.)
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare t text; owner text := 'blee4824@gmail.com';
begin
  foreach t in array array['predictive_ratings','team_projections','award_projections'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "public read" on public.%I;', t);
    execute format('drop policy if exists "owner insert" on public.%I;', t);
    execute format('drop policy if exists "owner update" on public.%I;', t);
    execute format('drop policy if exists "owner delete" on public.%I;', t);
    execute format('create policy "public read" on public.%I for select using (true);', t);
    execute format($f$create policy "owner insert" on public.%I for insert to authenticated with check ((auth.jwt() ->> 'email') = %L);$f$, t, owner);
    execute format($f$create policy "owner update" on public.%I for update to authenticated using ((auth.jwt() ->> 'email') = %L) with check ((auth.jwt() ->> 'email') = %L);$f$, t, owner, owner);
    execute format($f$create policy "owner delete" on public.%I for delete to authenticated using ((auth.jwt() ->> 'email') = %L);$f$, t, owner);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) PROFILES — the paywall's crown jewel.
--    • public READ of display fields, but NOT email (PII).
--    • a user may UPDATE only their OWN row …
--    • … and may NOT change plan / sub_expires_at / verified / *_count.
--      Those are set only by the service_role (Stripe webhook) or the
--      redeem_promo() function below. THIS is what makes plan un-self-grantable.
--    • rows are created by your existing new-user trigger (SECURITY DEFINER),
--      not by the client — so no INSERT policy is granted here.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "public read profiles" on public.profiles;
create policy "public read profiles" on public.profiles for select using (true);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Column-level locks (enforced alongside RLS):
revoke update (plan, sub_expires_at, verified, follower_count, following_count)
  on public.profiles from anon, authenticated;
revoke select (email) on public.profiles from anon, authenticated;
--   ^ requires the app to read explicit columns (never select=*) on profiles.
--     The paired app commit does this.

-- ─────────────────────────────────────────────────────────────────────────
-- 4) USER-GENERATED CONTENT — public READ; a user writes only their OWN rows.
--    author_id / follower_id / user_id must equal the caller (auth.uid()).
-- ─────────────────────────────────────────────────────────────────────────
-- forum_topics / forum_replies / team_comments  (owner column = author_id)
do $$
declare t text;
begin
  foreach t in array array['forum_topics','forum_replies','team_comments'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "public read" on public.%I;', t);
    execute format('drop policy if exists "insert own" on public.%I;', t);
    execute format('drop policy if exists "update own" on public.%I;', t);
    execute format('drop policy if exists "delete own" on public.%I;', t);
    execute format('create policy "public read" on public.%I for select using (true);', t);
    execute format('create policy "insert own" on public.%I for insert to authenticated with check (author_id = auth.uid());', t);
    execute format('create policy "update own" on public.%I for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());', t);
    execute format('create policy "delete own" on public.%I for delete to authenticated using (author_id = auth.uid());', t);
  end loop;
end $$;

-- follows  (owner column = follower_id)
alter table public.follows enable row level security;
drop policy if exists "public read" on public.follows;
drop policy if exists "insert own" on public.follows;
drop policy if exists "delete own" on public.follows;
create policy "public read" on public.follows for select using (true);
create policy "insert own" on public.follows for insert to authenticated with check (follower_id = auth.uid());
create policy "delete own" on public.follows for delete to authenticated using (follower_id = auth.uid());

-- team_follows  (owner column = user_id)
alter table public.team_follows enable row level security;
drop policy if exists "public read" on public.team_follows;
drop policy if exists "insert own" on public.team_follows;
drop policy if exists "delete own" on public.team_follows;
create policy "public read" on public.team_follows for select using (true);
create policy "insert own" on public.team_follows for insert to authenticated with check (user_id = auth.uid());
create policy "delete own" on public.team_follows for delete to authenticated using (user_id = auth.uid());

-- Denormalized counters are maintained server-side (triggers below), so clients
-- no longer PATCH other users' rows. Lock those columns from client writes:
revoke update (reply_count) on public.forum_topics from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) COUNTER TRIGGERS — keep reply_count / follower_count / following_count
--    correct without the client cross-updating rows it doesn't own.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.bump_reply_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update forum_topics set reply_count = coalesce(reply_count,0)+1, updated_at = now() where id = new.topic_id;
    return new;
  elsif tg_op = 'DELETE' then
    update forum_topics set reply_count = greatest(coalesce(reply_count,0)-1,0) where id = old.topic_id;
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
    update profiles set follower_count  = coalesce(follower_count,0)+1  where id = new.following_id;
    update profiles set following_count = coalesce(following_count,0)+1 where id = new.follower_id;
    return new;
  elsif tg_op = 'DELETE' then
    update profiles set follower_count  = greatest(coalesce(follower_count,0)-1,0)  where id = old.following_id;
    update profiles set following_count = greatest(coalesce(following_count,0)-1,0) where id = old.follower_id;
    return old;
  end if;
  return null;
end $$;
drop trigger if exists trg_follow_counts on public.follows;
create trigger trg_follow_counts after insert or delete on public.follows
  for each row execute function public.bump_follow_counts();

-- ─────────────────────────────────────────────────────────────────────────
-- 6) PROMO CODES — fully locked. Codes must never be enumerable, and redeeming
--    must not let the client set its own plan. A SECURITY DEFINER function does
--    the validation + plan grant atomically; the table gets NO client policies.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.promo_codes enable row level security;
drop policy if exists "public read" on public.promo_codes;   -- remove any prior open access
-- (no select/insert/update/delete policy → anon & authenticated get nothing;
--  only service_role and the definer function below can touch it.)

create or replace function public.redeem_promo(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v promo_codes; v_months int; v_expires timestamptz; v_uid uuid := auth.uid();
begin
  if v_uid is null then return json_build_object('ok', false, 'msg', 'Not signed in'); end if;
  select * into v from promo_codes where code = p_code;
  if not found      then return json_build_object('ok', false, 'msg', 'Code not found'); end if;
  if v.used         then return json_build_object('ok', false, 'msg', 'This code has already been used'); end if;
  v_months  := case when coalesce(v.duration,'') ilike '%year%' then 12 else 1 end;
  v_expires := now() + (v_months || ' months')::interval;
  update promo_codes set used = true, used_by = v_uid, used_at = now() where id = v.id;
  update profiles     set plan = 'premium', sub_expires_at = v_expires where id = v_uid;
  return json_build_object('ok', true, 'months', v_months, 'expires', v_expires);
end $$;
revoke all on function public.redeem_promo(text) from public;
grant execute on function public.redeem_promo(text) to authenticated;

-- ============================================================================
--  VERIFICATION (run these after; all should behave as noted)
-- ============================================================================
-- a) Every public table has RLS on:
--    select relname, relrowsecurity from pg_class
--    where relnamespace = 'public'::regnamespace and relkind='r' order by relname;
--    → relrowsecurity should be true for every app table.
--
-- b) The site still reads (anon):  open the live site — rankings, players, teams
--    must load. If a page 401/406s on a table, that table is missing a
--    "public read" policy — add one.
--
-- c) Plan can't be self-granted: signed in as a NON-owner in the browser console:
--    fetch(SB+'/rest/v1/profiles?id=eq.'+MY_ID,{method:'PATCH',
--      headers:{apikey:ANON,Authorization:'Bearer '+MY_TOKEN,'Content-Type':'application/json'},
--      body:JSON.stringify({plan:'coach'})}).then(r=>r.status)   // → 401/403, plan unchanged
--
-- d) Owner cache publish still works: from owner.html, run the republish job.
--
-- e) Promo: window.supabaseRedeem — the app calls rpc/redeem_promo (paired commit).
-- ============================================================================
--  ROLLBACK (if something breaks, disable per-table and investigate)
-- ============================================================================
--    alter table public.<table> disable row level security;
--    -- or drop a specific policy:  drop policy "<name>" on public.<table>;
--    -- restore a revoked column grant:
--    grant update (plan) on public.profiles to authenticated;   -- (etc.)
-- ============================================================================
