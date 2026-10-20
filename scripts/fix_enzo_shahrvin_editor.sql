-- Follow-up to fix_enzo_shahrvin_name.sql. After the rename, an editor tab that still held the OLD blob saved it
-- back: the owner profile now has BOTH keys —
--   tdc_fr:Purdue:Enzo Sharhrvin  = your real edits (OVR 82, Scoring 85, Rebounding 95, Interior Big, starter)
--   tdc_fr:Purdue:Enzo Shahrvin   = a fresh default (Scoring 50, Rebounding 50, no OVR) → 8.8 ppg / 81 on the site
-- This puts your edits under the new spelling and removes the old key.
--
-- BEFORE running: close or reload every open tab of the site (team page / freshman editor), so a tab holding the
-- old blob in memory can't save it back again. Then run once in the Supabase SQL editor; the next nightly rebuild
-- (or the owner console's Rebuild) puts the line back on the site.

update profiles
   set freshman_projections = (freshman_projections - 'tdc_fr:Purdue:Enzo Sharhrvin')
       || jsonb_build_object('tdc_fr:Purdue:Enzo Shahrvin', freshman_projections -> 'tdc_fr:Purdue:Enzo Sharhrvin')
 where freshman_projections ? 'tdc_fr:Purdue:Enzo Sharhrvin';

-- check: only the new key, with ovr 82
select key, value -> 'ovr' as ovr, value -> 'sliders' -> 'scoring' as scoring
  from profiles, jsonb_each(freshman_projections)
 where key like 'tdc_fr:Purdue:Enzo%';
