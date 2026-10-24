-- The two other shared espn_ids from the Oct 24 audit, fixed directly (no long function run needed).
-- Each wrong row also carries the real player's copied stat line, so both the id and the stats are cleared.
-- Clear the same stat cells in the roster Google Sheet too, or the next sync writes them back.

-- Josiah Sanders: espn_id 5237444's history is Colorado -> the Colorado sophomore keeps it, not Montana's senior.
update players
   set espn_id = null,
       ppg = null, rpg = null, apg = null, mpg = null, fg_pct = null, tp_pct = null, ft_pct = null,
       stl = null, blk = null, tovs = null, oreb = null, dreb = null,
       gp = null, fgm = null, fga = null, tpm = null, tpa = null, ftm = null, fta = null
 where id = 76148 and team = 'Montana' and name = 'Josiah Sanders' and espn_id = 5237444;

-- Jayden Reid: espn_id 4895746's history is Northwestern; the roster has him at Memphis (Sr.) AND Quinnipiac (So.).
-- If the Memphis senior is the Northwestern transfer, un-comment this to clear the Quinnipiac sophomore:
-- update players
--    set espn_id = null,
--        ppg = null, rpg = null, apg = null, mpg = null, fg_pct = null, tp_pct = null, ft_pct = null,
--        stl = null, blk = null, tovs = null, oreb = null, dreb = null,
--        gp = null, fgm = null, fga = null, tpm = null, tpa = null, ftm = null, fta = null
--  where id = 77299 and team = 'Quinnipiac' and name = 'Jayden Reid' and espn_id = 4895746;

select id, name, team, yr, espn_id, ppg, mpg from players
 where name in ('Josiah Sanders', 'Jayden Reid', 'Kenyon Giles') order by name, id;
