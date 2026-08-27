-- ============================================================================
--  Open the `shots` table to PRO & COACH'S TIER subscribers (and the owner)
-- ----------------------------------------------------------------------------
--  Shot-location data (`shots`) powers:
--    • player-page shot charts  (Pro tier)
--    • Coach's Tier shot-zone maps  (scout.html / self-scout.html)
--  Until now RLS allowed ONLY the owner's JWT, so paying subscribers saw empty
--  shot sections. This grants SELECT to anyone whose profiles.plan is 'pro' or
--  'coach' — the exact same check as auth.js `tdcHasCoachTier()`.
--
--  HOW TO RUN:  Supabase Dashboard → SQL Editor → New query → paste all of this
--               → Run.  (You run it — Claude cannot and should not touch your DB.)
--
--  SAFE & ADDITIVE:  only GRANTS read to paid tiers. It does not touch writes,
--  any other table, or the existing owner access. Re-running it is idempotent.
--  No PII is exposed — `shots` is x/y shot-location analytics, the product itself.
-- ============================================================================

-- (optional) 0) inspect what's on the table today, before changing anything:
--   SELECT policyname, cmd, roles, qual
--     FROM pg_policies WHERE schemaname='public' AND tablename='shots';

-- 1) helper: is the CURRENT caller a paid (pro/coach) subscriber, or the owner?
--    SECURITY DEFINER lets it read `profiles` regardless of that table's own RLS.
--    STABLE + a plan check that doesn't reference the shots row means Postgres
--    evaluates it ONCE per query (an InitPlan), not once per shot — so it stays
--    fast even on the full shots table.
CREATE OR REPLACE FUNCTION public.tdc_is_shot_subscriber()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    coalesce((auth.jwt() ->> 'email'), '') = 'blee4824@gmail.com'   -- owner, always
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.plan IN ('pro','coach')                               -- paid tiers
    );
$$;

-- 2) make sure RLS is enabled (it already is; harmless if repeated)
ALTER TABLE public.shots ENABLE ROW LEVEL SECURITY;

-- 3) the read policy for paid tiers (drop-then-create → safe to re-run)
DROP POLICY IF EXISTS shots_read_paid_tiers ON public.shots;
CREATE POLICY shots_read_paid_tiers ON public.shots
  FOR SELECT
  TO authenticated
  USING ( public.tdc_is_shot_subscriber() );

-- Done.  Pro & Coach subscribers (and the owner) can now read `shots`.
-- Free / Premium / anonymous still cannot.  Writes are unchanged.
--
-- To restrict to COACH ONLY (exclude Pro), change the plan check above to:
--     AND p.plan = 'coach'
-- and re-run this whole script.
