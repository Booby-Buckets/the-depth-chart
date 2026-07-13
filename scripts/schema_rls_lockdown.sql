-- ============================================================================
-- RLS LOCKDOWN — The Depth Chart
-- ============================================================================
-- WHY: the site talks to Supabase from the browser with the PUBLIC anon key
-- (it's in every page's HTML). That key is only safe if Row-Level Security
-- blocks writes. Today it does NOT: an anonymous visitor can UPDATE/DELETE
-- `players`, `teams`, `posts`, and overwrite the shared ranking caches. This
-- file closes that.
--
-- MODEL:
--   • anon (public) role  → SELECT only, everywhere.
--   • service_role (your Python scripts, load_supabase.py) → BYPASSES RLS,
--     so all your batch data loads keep working with no changes.
--   • owner (blee4824@gmail.com, signed in) → may publish the shared caches
--     (the client now sends the owner JWT for those writes; see auth.js
--     window.tdcOwnerToken + tdc-ratings.js/tdc-awards.js/team.html).
--   • authenticated users → may write their OWN community rows only.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste a tier → Run.
-- Apply TIER 1 first (zero breakage risk, stops the worst). Then TIER 2.
-- TIER 3 is delicate (community) — apply it, then click through follow/post/
-- reply/verify on the live site and confirm each still works.
--
-- ⚠️ REVIEW BEFORE RUNNING. Table/column names below are inferred from the
-- client code; adjust any that differ. After applying, run the Supabase
-- advisor "RLS Disabled in Public" to catch any table this file missed.
-- Nothing here is reversible-proof — you can re-enable a table's old behavior
-- with `alter table X disable row level security;` if something breaks.
-- ============================================================================


-- ============================================================================
-- TIER 1 — READ-ONLY DATA TABLES  (safe, critical, zero breakage risk)
-- These are written ONLY by your service-key scripts, never by the browser,
-- so making them anon-SELECT-only cannot break any user-facing feature. It
-- stops the roster/grade/ranking vandalism outright.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'players','teams','player_history','losses','shots',
    'coach_seasons','coach_profiles','team_style',
    'bbref_seasons','games','box_scores','team_seasons',
    'postseason_games','awards','promo_codes'
  ]
  loop
    if exists (select 1 from information_schema.tables
               where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security;', t);
      execute format('drop policy if exists "tdc anon read" on public.%I;', t);
      execute format(
        'create policy "tdc anon read" on public.%I for select to anon, authenticated using (true);', t);
      -- NOTE: no insert/update/delete policy => anon & authenticated are DENIED
      -- writes. service_role bypasses RLS, so your Python loaders keep working.
    end if;
  end loop;
end $$;


-- ============================================================================
-- TIER 2 — SHARED CACHES  (anon SELECT; OWNER-only writes)
-- The client now sends the owner JWT for these (auth.js window.tdcOwnerToken).
-- Everyone else reads the owner-published cache.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['predictive_ratings','team_projections','award_projections','tournament_games'] loop
    if exists (select 1 from information_schema.tables
               where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security;', t);
      execute format('drop policy if exists "tdc anon read" on public.%I;', t);
      execute format('drop policy if exists "tdc owner write" on public.%I;', t);
      execute format(
        'create policy "tdc anon read" on public.%I for select to anon, authenticated using (true);', t);
      execute format($p$
        create policy "tdc owner write" on public.%I for all to authenticated
        using ((auth.jwt() ->> 'email') = 'blee4824@gmail.com')
        with check ((auth.jwt() ->> 'email') = 'blee4824@gmail.com');
      $p$, t);
    end if;
  end loop;
end $$;


-- ============================================================================
-- TIER 3 — COMMUNITY TABLES  (delicate — TEST each feature after applying)
-- Signed-in users read everything and write only their OWN rows. The owner
-- keeps full control (moderation) via the email check.
--
-- ⚠️ Two things to verify on the live site right after applying:
--   (a) follow/unfollow, new topic, reply, and the community feed still work;
--   (b) the follower_count denormalization (community.html PATCHes ANOTHER
--       user's profiles.follower_count on follow) will now be BLOCKED by the
--       own-row policy. That's a pre-existing design smell — the correct fix
--       is a SECURITY DEFINER function/trigger that recomputes follower_count
--       server-side. Until that exists, either keep follower_count updates in
--       such a function, or accept that the number won't live-update. It does
--       NOT block following itself (the follows row insert is the owner's).
-- ============================================================================

-- profiles: anyone reads; a user updates only their own row; NEVER let a user
-- set their own plan/verified (that's the paywall + trust badge). We allow the
-- row update but revoke column privileges on the sensitive columns.
alter table public.profiles enable row level security;
drop policy if exists "tdc read profiles"   on public.profiles;
drop policy if exists "tdc update own"       on public.profiles;
drop policy if exists "tdc insert own"       on public.profiles;
drop policy if exists "tdc owner all profiles" on public.profiles;
create policy "tdc read profiles" on public.profiles for select to anon, authenticated using (true);
create policy "tdc insert own"    on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "tdc update own"    on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);
create policy "tdc owner all profiles" on public.profiles for all to authenticated
  using ((auth.jwt() ->> 'email') = 'blee4824@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'blee4824@gmail.com');
-- Column lockdown so a user can't escalate plan/verified even on their own row:
revoke update on public.profiles from authenticated;
grant  update (username, avatar_url, bio, favorite_team) on public.profiles to authenticated;
-- (plan, verified, follower_count intentionally excluded — service_role / owner only.)

-- posts: public read; only the OWNER writes/pins/deletes (it's an editorial feed).
alter table public.posts enable row level security;
drop policy if exists "tdc read posts"  on public.posts;
drop policy if exists "tdc owner posts" on public.posts;
create policy "tdc read posts"  on public.posts for select to anon, authenticated using (true);
create policy "tdc owner posts" on public.posts for all to authenticated
  using ((auth.jwt() ->> 'email') = 'blee4824@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'blee4824@gmail.com');

-- follows / team_follows: a user manages only their own follow rows.
do $$
declare t text; owncol text;
begin
  for t, owncol in select * from (values ('follows','follower_id'), ('team_follows','user_id')) as v(t,c) loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security;', t);
      execute format('drop policy if exists "tdc read %1$s" on public.%1$I;', t);
      execute format('drop policy if exists "tdc own %1$s"  on public.%1$I;', t);
      execute format('create policy "tdc read %1$s" on public.%1$I for select to anon, authenticated using (true);', t);
      execute format('create policy "tdc own %1$s" on public.%1$I for all to authenticated using (auth.uid() = %2$I) with check (auth.uid() = %2$I);', t, owncol);
    end if;
  end loop;
end $$;

-- forum topics/replies + team_comments: public read; author writes own; owner moderates.
do $$
declare t text; owncol text;
begin
  for t, owncol in select * from (values
      ('forum_topics','author_id'), ('forum_replies','author_id'), ('team_comments','author_id')
    ) as v(t,c) loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security;', t);
      execute format('drop policy if exists "tdc read %1$s"  on public.%1$I;', t);
      execute format('drop policy if exists "tdc author %1$s" on public.%1$I;', t);
      execute format('drop policy if exists "tdc owner %1$s"  on public.%1$I;', t);
      execute format('create policy "tdc read %1$s" on public.%1$I for select to anon, authenticated using (true);', t);
      execute format('create policy "tdc author %1$s" on public.%1$I for all to authenticated using (auth.uid() = %2$I) with check (auth.uid() = %2$I);', t, owncol);
      execute format('create policy "tdc owner %1$s" on public.%1$I for all to authenticated using ((auth.jwt() ->> ''email'') = ''blee4824@gmail.com'') with check ((auth.jwt() ->> ''email'') = ''blee4824@gmail.com'');', t);
    end if;
  end loop;
end $$;

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   select relname, relrowsecurity from pg_class
--   where relnamespace = 'public'::regnamespace and relkind = 'r'
--   order by relrowsecurity, relname;   -- every public table should be `t`
-- Then re-run the "Security Advisor" in the dashboard.
-- ============================================================================
