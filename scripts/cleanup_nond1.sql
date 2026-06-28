-- ============================================================================
-- Remove all non-D1 data.  "D1" = any team that ever carries a conference in
-- team_seasons (370 teams).  Non-D1 = the other 986 (cupcake/NAIA/D2/D3 teams).
--
-- Kept: games where a D1 team plays a non-D1 opponent (the D1 team's schedule
--       and the D1 players' box scores stay).
-- Removed: non-D1 teams, games between two non-D1 teams, and every non-D1
--          player's box scores (incl. the non-D1 side of D1-vs-non-D1 games).
-- ============================================================================

-- 1) PREVIEW — run this first to see exactly how much will be deleted.
WITH d1 AS (SELECT DISTINCT team FROM team_seasons WHERE conference IS NOT NULL AND team IS NOT NULL)
SELECT
  (SELECT count(*) FROM box_scores   WHERE team NOT IN (SELECT team FROM d1))                                          AS del_box_scores,
  (SELECT count(*) FROM games        WHERE home NOT IN (SELECT team FROM d1) AND away NOT IN (SELECT team FROM d1))     AS del_games_nond1_only,
  (SELECT count(*) FROM team_seasons WHERE team NOT IN (SELECT team FROM d1))                                          AS del_team_seasons;

-- 2) DELETE — run after the preview looks right.  Order matters: box_scores and
--    games first (they read the D1 set from team_seasons), team_seasons last.
DELETE FROM box_scores
 WHERE team NOT IN (SELECT DISTINCT team FROM team_seasons WHERE conference IS NOT NULL AND team IS NOT NULL);

DELETE FROM games
 WHERE home NOT IN (SELECT DISTINCT team FROM team_seasons WHERE conference IS NOT NULL AND team IS NOT NULL)
   AND away NOT IN (SELECT DISTINCT team FROM team_seasons WHERE conference IS NOT NULL AND team IS NOT NULL);

DELETE FROM team_seasons
 WHERE team NOT IN (SELECT DISTINCT team FROM team_seasons WHERE conference IS NOT NULL AND team IS NOT NULL);
