-- espn_id backfill for unlinked returners (run in Supabase SQL editor as owner).
-- These links are VERIFIED SAFE: exact full-name+team matches, plus Tugler (manually
-- confirmed nickname). The broader nickname set (JoJo→Joseph, etc.) is NOT auto-safe —
-- last-name+team matching produced false hits (Tyran Stokes ≠ Kamau Stokes), so those
-- need per-player review. The durable fix is nickname normalization in the roster-sync
-- Apps Script so espn_id is assigned on sync.

UPDATE players SET espn_id=5060700 WHERE id=50236;  -- JoJo Tugler = Joseph Tugler / Houston (verified)
UPDATE players SET espn_id=4869762 WHERE id=49769;  -- Marcus Allen / Miami (exact)
UPDATE players SET espn_id=5175591 WHERE id=50039;  -- CJ Cox / Purdue (exact)
UPDATE players SET espn_id=5214641 WHERE id=49993;  -- LJ Cason / Michigan (exact)
UPDATE players SET espn_id=5243405 WHERE id=53191;  -- Jayden Johnson / South Florida (exact)
UPDATE players SET espn_id=5106275 WHERE id=50653;  -- PJ Haggerty / Texas A&M (exact)
