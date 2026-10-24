-- UMass Lowell's Kenyon Giles (players.id 75980) is NOT Wichita State's Kenyon Giles (espn_id 5107508:
-- Radford -> UNC Greensboro -> Wichita State). The name-based roster autofill gave him that id and copied
-- the Wichita State line (19.1 ppg, 36.2 mpg), so his pages showed the other player's career and stats.
-- Run this, THEN re-run scripts/backfill_espn_ids.sql (its updated function keeps this from coming back:
-- shared ids self-heal and a name shared by two roster rows only links by team match).
-- Also clear his stat cells in the roster Google Sheet, or the next sync writes 19.1 / 36.2 back.
update players
   set espn_id = null,
       ppg = null, rpg = null, apg = null, mpg = null,
       fg_pct = null, tp_pct = null, ft_pct = null,
       stl = null, blk = null, tovs = null, oreb = null, dreb = null,
       gp = null, fgm = null, fga = null, tpm = null, tpa = null, ftm = null, fta = null
 where id = 75980 and team = 'UMass Lowell' and name = 'Kenyon Giles' and espn_id = 5107508;

-- check: Wichita State keeps 5107508, UMass Lowell has none
select id, name, team, espn_id, ppg, mpg from players where name = 'Kenyon Giles';

-- Same audit (Oct 24), two more shared ids:
--  * Josiah Sanders 5237444 (history: Colorado) on Colorado So. AND Montana Sr. -> the updated backfill
--    self-heals this one automatically (Montana's row is cleared, Colorado keeps it).
--  * Jayden Reid 4895746 (history: Northwestern) on Memphis Sr. AND Quinnipiac So. -> neither row is at
--    Northwestern, so the function won't guess. If the Memphis senior is the Northwestern transfer
--    (most likely), un-comment this to clear the Quinnipiac sophomore:
-- update players set espn_id = null where id = 77299 and team = 'Quinnipiac' and name = 'Jayden Reid';
