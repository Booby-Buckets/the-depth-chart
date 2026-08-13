-- ============================================================================
--  HARD-GATE the `shots` table to Pro+ (Phase B)
--  Run in the Supabase SQL editor. Idempotent. service_role (loaders) bypasses RLS.
--
--  WHY: shot-location data (shot charts / shot-flow / Shot Genome / coach shot
--  analytics) is a Pro feature, and `shots` is the ONE table used ONLY by gated
--  features (never by a free/public page). So it can be truly locked server-side —
--  direct anon-key queries return nothing, not just a hidden-in-the-DOM overlay.
--
--  HOW IT STAYS WORKING FOR PAYING USERS: the site now sends the signed-in user's
--  JWT on every shot fetch (auth.js `tdcH()`), so Supabase can check their plan.
--  Pro/Coach/owner → rows; anon/free → nothing.
-- ============================================================================

alter table public.shots enable row level security;

-- Remove the public-read policy the base lockdown put on shots.
drop policy if exists "tdc_anon_read" on public.shots;
drop policy if exists "public read"   on public.shots;
drop policy if exists "pro read"      on public.shots;

-- Only authenticated Pro/Coach users (or the owner) may read shots. The `anon` role
-- (logged-out) gets NO policy → no access. The condition references only auth.uid()/
-- auth.jwt(), so Postgres evaluates it once per query (not per row).
create policy "pro read" on public.shots
  for select to authenticated
  using (
    (auth.jwt() ->> 'email') = 'blee4824@gmail.com'
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.plan in ('pro','coach')
    )
  );

-- ============================================================================
--  VERIFY
--   • As anon (the site's publishable key, NO user token):
--       select count(*) from public.shots;   -- via REST → permission denied / [] (blocked)
--   • Signed in as Pro/Coach or owner (their JWT) → rows returned; shot charts render.
--   • Owner: sign in on the site, open a player's Shot Charts tab — should still work.
--  ROLLBACK (re-open to everyone):
--   drop policy if exists "pro read" on public.shots;
--   create policy "public read" on public.shots for select using (true);
-- ============================================================================
