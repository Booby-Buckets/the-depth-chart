-- ============================================================================
-- RLS LOCKDOWN — The Depth Chart   (v2 — resilient / idempotent)
-- ============================================================================
-- WHY: the browser talks to Supabase with the PUBLIC anon key (in every page).
-- Safe ONLY if RLS blocks writes. It does not today: anon can UPDATE/DELETE
-- `players`/`teams` and overwrite the shared caches. This closes that.
--
-- v2 CHANGES (the v1 you ran silently rolled back):
--   • Every table is wrapped in its OWN block with EXCEPTION handling, so one
--     bad table can't abort the whole script. Watch the "NOTICE" lines in the
--     output — they tell you which tables were skipped and why.
--   • DROPS ALL existing policies on each table first, then creates ours — so a
--     pre-existing permissive policy (e.g. predictive_ratings "public insert")
--     can't keep writes open.
--   • Guards every table/column with information_schema existence checks.
--
-- MODEL: anon -> SELECT only. service_role (your Python load_supabase.py) ->
--   bypasses RLS, unaffected. owner (blee4824@gmail.com JWT) -> publishes the
--   shared caches. authenticated users -> write only their own community rows.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste ALL of this -> Run.
-- Then tell me and I'll re-probe to confirm writes are blocked + reads work.
-- Re-runnable safely (idempotent). Reversible per table:
--   alter table public.<t> disable row level security;
-- ============================================================================

-- Helper note: this whole file is DO blocks; nothing here fails the transaction.

-- ---------------------------------------------------------------------------
-- TIER 1 + TIER 2 — data tables (SELECT-only) and caches (SELECT + owner write)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  pol record;
  readonly text[] := array[
    'players','teams','player_history','losses','shots',
    'coach_seasons','coach_profiles','team_style',
    'bbref_seasons','games','box_scores','team_seasons',
    'team_actual_stats','postseason_games','awards','promo_codes'
  ];
  caches text[] := array[
    'predictive_ratings','team_projections','award_projections','tournament_games'
  ];
begin
  -- TIER 1: read-only data
  foreach t in array readonly loop
    begin
      if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
        for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
          execute format('drop policy if exists %I on public.%I', pol.policyname, t);
        end loop;
        execute format('alter table public.%I enable row level security', t);
        execute format('create policy "tdc_anon_read" on public.%I for select to anon, authenticated using (true)', t);
        raise notice 'TIER1 locked (SELECT-only): %', t;
      else
        raise notice 'TIER1 skipped (no such table): %', t;
      end if;
    exception when others then raise notice 'TIER1 ERROR on % -> %', t, sqlerrm;
    end;
  end loop;

  -- TIER 2: shared caches (SELECT for all; writes only for the owner JWT)
  foreach t in array caches loop
    begin
      if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
        for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
          execute format('drop policy if exists %I on public.%I', pol.policyname, t);
        end loop;
        execute format('alter table public.%I enable row level security', t);
        execute format('create policy "tdc_anon_read" on public.%I for select to anon, authenticated using (true)', t);
        execute format($f$create policy "tdc_owner_write" on public.%I for all to authenticated
          using ((auth.jwt() ->> 'email') = 'blee4824@gmail.com')
          with check ((auth.jwt() ->> 'email') = 'blee4824@gmail.com')$f$, t);
        raise notice 'TIER2 locked (owner-write): %', t;
      else
        raise notice 'TIER2 skipped (no such table): %', t;
      end if;
    exception when others then raise notice 'TIER2 ERROR on % -> %', t, sqlerrm;
    end;
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- TIER 3 — community tables (own-row writes + owner moderation)
-- Each table is independent. Adjust the owner-column names if yours differ
-- (the NOTICE output will tell you if a column doesn't exist).
-- ---------------------------------------------------------------------------

-- profiles: read all; user writes only their OWN row; plan/verified NOT user-writable.
do $$
declare pol record; c text;
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='profiles') then
    for pol in select policyname from pg_policies where schemaname='public' and tablename='profiles' loop
      execute format('drop policy if exists %I on public.profiles', pol.policyname);
    end loop;
    alter table public.profiles enable row level security;
    create policy "tdc_read_profiles" on public.profiles for select to anon, authenticated using (true);
    create policy "tdc_insert_own"    on public.profiles for insert to authenticated with check (auth.uid() = id);
    create policy "tdc_update_own"    on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
    create policy "tdc_owner_profiles" on public.profiles for all to authenticated
      using ((auth.jwt() ->> 'email') = 'blee4824@gmail.com') with check ((auth.jwt() ->> 'email') = 'blee4824@gmail.com');
    -- column lockdown: a user can't escalate plan/verified even on their own row, but
    -- freshman_projections IS owner-writable (the freshman editor saves it via PATCH) —
    -- leaving it off this list is what 403'd the save. RLS still limits it to one's own row.
    revoke update on public.profiles from authenticated;
    foreach c in array array['username','avatar_url','bio','favorite_team','display_name','freshman_projections'] loop
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name=c) then
        execute format('grant update (%I) on public.profiles to authenticated', c);
      end if;
    end loop;
    raise notice 'TIER3 locked: profiles';
  else raise notice 'TIER3 skipped (no such table): profiles'; end if;
exception when others then raise notice 'TIER3 ERROR on profiles -> %', sqlerrm;
end $$;

-- posts: public read; only the OWNER writes/pins/deletes (editorial feed).
do $$
declare pol record;
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='posts') then
    for pol in select policyname from pg_policies where schemaname='public' and tablename='posts' loop
      execute format('drop policy if exists %I on public.posts', pol.policyname);
    end loop;
    alter table public.posts enable row level security;
    create policy "tdc_read_posts"  on public.posts for select to anon, authenticated using (true);
    create policy "tdc_owner_posts" on public.posts for all to authenticated
      using ((auth.jwt() ->> 'email') = 'blee4824@gmail.com') with check ((auth.jwt() ->> 'email') = 'blee4824@gmail.com');
    raise notice 'TIER3 locked: posts';
  else raise notice 'TIER3 skipped (no such table): posts'; end if;
exception when others then raise notice 'TIER3 ERROR on posts -> %', sqlerrm;
end $$;

-- own-row tables: read all; a user writes only rows where <owner col> = their uid.
do $$
declare pol record; t text; oc text; pairs text[][] := array[
    array['follows','follower_id'],
    array['team_follows','user_id'],
    array['forum_topics','author_id'],
    array['forum_replies','author_id'],
    array['team_comments','author_id']
  ];
  i int;
begin
  for i in 1 .. array_length(pairs,1) loop
    t := pairs[i][1]; oc := pairs[i][2];
    begin
      if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
        if exists (select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name=oc) then
          for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
            execute format('drop policy if exists %I on public.%I', pol.policyname, t);
          end loop;
          execute format('alter table public.%I enable row level security', t);
          execute format('create policy "tdc_read" on public.%I for select to anon, authenticated using (true)', t);
          execute format('create policy "tdc_own" on public.%I for all to authenticated using (auth.uid() = %I) with check (auth.uid() = %I)', t, oc, oc);
          execute format($f$create policy "tdc_owner_mod" on public.%I for all to authenticated
            using ((auth.jwt() ->> 'email') = 'blee4824@gmail.com') with check ((auth.jwt() ->> 'email') = 'blee4824@gmail.com')$f$, t);
          raise notice 'TIER3 locked: % (own col %)', t, oc;
        else raise notice 'TIER3 skipped (% has no column %)', t, oc; end if;
      else raise notice 'TIER3 skipped (no such table): %', t; end if;
    exception when others then raise notice 'TIER3 ERROR on % -> %', t, sqlerrm;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- CATCH-ALL — secure any remaining public base table the explicit blocks missed.
-- Runs LAST, so tables handled above (with their own write policies) are already
-- RLS-enabled and skipped here. For each table STILL open (relrowsecurity=false)
-- it enables RLS + an anon/authenticated SELECT policy: this BLOCKS every anon
-- INSERT/UPDATE/DELETE without changing read exposure (a policy grants no new
-- table access, so genuinely-private tables with no anon GRANT stay private).
-- service_role (your Python loaders) bypasses RLS and keeps writing.
-- Read the NOTICE lines to see exactly which tables this secured.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity=false
    order by c.relname
  loop
    begin
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists "tdc_anon_read" on public.%I', t);
      execute format('create policy "tdc_anon_read" on public.%I for select to anon, authenticated using (true)', t);
      raise notice 'CATCH-ALL secured (SELECT-only, writes blocked): %', t;
    exception when others then raise notice 'CATCH-ALL ERROR on % -> %', t, sqlerrm;
    end;
  end loop;
  raise notice '=== lockdown complete — re-run the VERIFY query below ===';
end $$;

-- ---------------------------------------------------------------------------
-- VERIFY (run separately after the above; every public table should read `t`):
--   select relname, relrowsecurity from pg_class
--   where relnamespace='public'::regnamespace and relkind='r' order by 2,1;
-- Then re-run the Dashboard "Security Advisor". Known follow-up: community.html
-- updates ANOTHER user's profiles.follower_count on follow — now blocked by the
-- own-row policy; move that to a SECURITY DEFINER function or accept no live
-- follower-count update. Following itself still works (the follows insert is theirs).
-- ============================================================================
