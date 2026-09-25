-- Six more 2026-27 roster rows carry an older namesake's espn_id (found while tracing Josh Harris).
-- Each id belongs to a different, inactive player whose career ended years ago at another school;
-- ESPN's own record shows the mismatch (school, and for several the height too).
--
--   Juan Fernandez (South Carolina)  45182   -> Temple 2011-12, 6-4   (ours: 6-11 Liga ACB import)   -> NULL
--   Christian Collins (USC)          58744   -> Towson 2012-13, 6-0   (ours: 6-8 freshman)            -> NULL
--   Isaiah Rogers (Stanford)         4284136 -> UMBC 2018-19          (ours: freshman)                -> NULL
--   Austin Brown (Maryland)          4902374 -> Radford 2021-22, 6-2  (ours: 6-8 freshman)            -> NULL
--   Trey Thompson (Iowa)             3136175 -> Arkansas 2017-18      -> 5311841 (Iowa 2025-26 roster, 6-8, redshirt year)
--   Bryce Jackson (Houston)          3130710 -> North Texas 2017-18   -> 5144098 (Houston 2025-26 roster, 6-6, redshirt year)
--
-- The four set to NULL have no college ESPN id yet (true freshmen / a pro import). The two
-- replacements are unused by any other row and have no box scores (redshirt season), checked
-- against ESPN's roster API on 2026-09-25.
--
-- Left alone on purpose (confirmed genuine long gaps): John Carter Jr. (Navy 2021-22),
-- Mady Traore (Maryland 2023-24), Amondo Miller Jr. (Colorado 2022-23, then D2).
--
-- Each UPDATE is keyed on BOTH the row id and the current wrong espn_id, so it is a no-op if
-- anything has changed since this was written. Run it in the Supabase SQL editor.
--
-- ALSO FIX THE SHEET: the roster sync writes espn_id from the Google Sheet, so change these six
-- there too (blank the four, put the two new ids in) or the next sync puts the wrong ids back.

UPDATE players SET espn_id = NULL    WHERE id = 50769 AND espn_id = 45182;    -- Juan Fernandez, South Carolina
UPDATE players SET espn_id = NULL    WHERE id = 50067 AND espn_id = 58744;    -- Christian Collins, USC
UPDATE players SET espn_id = NULL    WHERE id = 49845 AND espn_id = 4284136;  -- Isaiah Rogers, Stanford
UPDATE players SET espn_id = NULL    WHERE id = 50165 AND espn_id = 4902374;  -- Austin Brown, Maryland
UPDATE players SET espn_id = 5311841 WHERE id = 50135 AND espn_id = 3136175;  -- Trey Thompson, Iowa
UPDATE players SET espn_id = 5144098 WHERE id = 50242 AND espn_id = 3130710;  -- Bryce Jackson, Houston

-- verify: expect NULL x4, then 5311841 and 5144098
SELECT id, name, team, espn_id FROM players
WHERE id IN (50769, 50067, 49845, 50165, 50135, 50242) ORDER BY id;

-- revert, if ever needed
-- UPDATE players SET espn_id = 45182   WHERE id = 50769;
-- UPDATE players SET espn_id = 58744   WHERE id = 50067;
-- UPDATE players SET espn_id = 4284136 WHERE id = 49845;
-- UPDATE players SET espn_id = 4902374 WHERE id = 50165;
-- UPDATE players SET espn_id = 3136175 WHERE id = 50135;
-- UPDATE players SET espn_id = 3130710 WHERE id = 50242;
