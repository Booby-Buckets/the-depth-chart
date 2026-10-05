-- Roster cleanup found while fixing projected minutes (Oct 5 2026). Run in the Supabase SQL editor.
-- The projection build already works around all of this; these rows still show wrong stats on team pages.

-- 1) A namesake borrowed another player's ESPN id (and his stat line) through the roster autofill.
--    The id stays with the row that matches his record (height, name, school); these four are a
--    different person and should read as newcomers with no college line.
--    Quinnipiac  Jayden Reid      6-10 PF So.   (id 4895746 = 5-10 PG, USF -> Northwestern -> Memphis)
--    UMass Lowell Kenyon Giles    5-11 PG Jr.   (id 5107508 = 5-10 G, Radford/UNCG/Wichita St)
--    Florida St. Amare Robinson   6-1  PG So.   (id 5176227 = Amire Robinson, 6-3, Nevada -> Oral Roberts)
--    Montana     Josiah Sanders   6-7  SF Sr.   (id 5237444 = 6-5 So., Colorado)
update players
   set espn_id = null, ppg = null, rpg = null, apg = null, mpg = null, fg_pct = null, tp_pct = null,
       ft_pct = null, fgm = null, fga = null, tpm = null, tpa = null, ftm = null, fta = null,
       oreb = null, dreb = null, stl = null, blk = null, tovs = null, gp = null, hometown = null
 where id in (77299, 75980, 49865, 76148);

-- 2) Bradley's roster import is broken: six rows whose "names" are class labels (Fr., Jr., R-Fr., R-Sr.,
--    So., Sr.). Look before deleting; re-import Bradley from the Sheet afterwards.
select id, name, team, class_year, tdc_grade from players where team = 'Bradley';
-- delete from players where team = 'Bradley' and name in ('Fr.','Jr.','R-Fr.','R-Sr.','So.','Sr.');
