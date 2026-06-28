-- ============================================================================
-- Team competition tiers (1=elite … 4=weak), per team-season, from SRS
-- (opponent-adjusted net rating, re-centered to mean 0 each season → tiers are
-- comparable across years).  Denormalized into box_scores so every game knows
-- the player's team tier AND the opponent's tier (for opponent-adjusted ratings,
-- grade weighting, and filtering by quality of competition).
-- ============================================================================

-- 1) Tier on each team-season.
ALTER TABLE team_seasons ADD COLUMN IF NOT EXISTS tier smallint;
UPDATE team_seasons SET tier =
  CASE WHEN srs >= 20 THEN 1
       WHEN srs >= 11 THEN 2
       WHEN srs >=  3 THEN 3
       ELSE 4 END
WHERE srs IS NOT NULL;

-- preview the spread (run/inspect before the big box_scores update if you like)
-- SELECT tier, count(*) FROM team_seasons GROUP BY tier ORDER BY tier;

-- 2) Denormalize team tier + opponent tier into box_scores.
ALTER TABLE box_scores ADD COLUMN IF NOT EXISTS team_tier smallint;
ALTER TABLE box_scores ADD COLUMN IF NOT EXISTS opp_tier  smallint;

UPDATE box_scores b SET team_tier = t.tier
  FROM team_seasons t
 WHERE t.season_year = b.season_year AND t.team = b.team;

UPDATE box_scores b SET opp_tier = t.tier
  FROM team_seasons t
 WHERE t.season_year = b.season_year AND t.team = b.opp;

-- helpful for filtering games by competition level
CREATE INDEX IF NOT EXISTS box_opp_tier_idx  ON box_scores(opp_tier);
CREATE INDEX IF NOT EXISTS box_team_tier_idx ON box_scores(team_tier);
