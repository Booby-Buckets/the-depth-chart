-- Six 2026-27 roster rows carry another player's espn_id.
--
-- Every one is listed as a freshman with no stats, and each id belongs to exactly one older
-- player with a completed career somewhere else. No second player of that name exists in our
-- data, so there is no correct id to swap in: a player who has never played has no row in any
-- played-season table, and the right value is NULL.
--
--   Alex Smith (Ohio State)          56615   -> Bethune-Cookman 2012-13
--   Eric Jacobsen (Colorado)         61554   -> Arizona State 2013-16
--   Chase Foster (Pittsburgh)        3136525 -> San Francisco 2015-18
--   Aleksandar Zecevic (Penn State)  4397486 -> Florida Atlantic 2019-20
--   Elijah Williams (Baylor)         4600147 -> Howard 2023-24
--   Ethan Taylor (Michigan State)    4903265 -> Air Force 2022-25
--
-- The first two are five-digit legacy ESPN ids from the 2012-16 era; a 2026-27 freshman could
-- never have one. This matters beyond projections — every surface joins on espn_id, so these
-- rows can serve a stranger's stats, shot chart and on/off under your player's name.
--
-- Each UPDATE is keyed on BOTH the row id and the wrong espn_id, so it is a no-op if anything
-- has changed since this was written. Run it in the Supabase SQL editor.
--
-- ROOT CAUSE: after each sync, backfill_espn_ids() re-links ids by name alone (the sheet does not
-- carry espn_id). Run scripts/espn_id_blocklist.sql once so these can never be re-linked.

UPDATE players SET espn_id = NULL WHERE id = 50125 AND espn_id = 56615;    -- Alex Smith, Ohio State
UPDATE players SET espn_id = NULL WHERE id = 50348 AND espn_id = 61554;    -- Eric Jacobsen, Colorado
UPDATE players SET espn_id = NULL WHERE id = 49965 AND espn_id = 3136525;  -- Chase Foster, Pittsburgh
UPDATE players SET espn_id = NULL WHERE id = 50201 AND espn_id = 4397486;  -- Aleksandar Zecevic, Penn State
UPDATE players SET espn_id = NULL WHERE id = 50327 AND espn_id = 4600147;  -- Elijah Williams, Baylor
UPDATE players SET espn_id = NULL WHERE id = 50036 AND espn_id = 4903265;  -- Ethan Taylor, Michigan State

-- verify
SELECT id, name, team, class_year, espn_id FROM players
WHERE id IN (50125, 50348, 49965, 50201, 50327, 50036) ORDER BY id;

-- revert, if ever needed
-- UPDATE players SET espn_id = 56615   WHERE id = 50125;
-- UPDATE players SET espn_id = 61554   WHERE id = 50348;
-- UPDATE players SET espn_id = 3136525 WHERE id = 49965;
-- UPDATE players SET espn_id = 4397486 WHERE id = 50201;
-- UPDATE players SET espn_id = 4600147 WHERE id = 50327;
-- UPDATE players SET espn_id = 4903265 WHERE id = 50036;
