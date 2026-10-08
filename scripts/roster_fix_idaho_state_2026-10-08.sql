-- Idaho State's Malik Johnson (6-11 Jr., transfer from D-II Cal State Stanislaus) was linked to a
-- DIFFERENT Malik Johnson (ESPN 4067275, a Canisius guard 2016-17..2019-20) and carried his 2019-20
-- line (12.6 ppg / 5.9 apg / 38.2 mpg). Unlink him and clear the borrowed stats; he projects as a
-- typical upperclass newcomer (70) until he plays D-I games.
update players
   set espn_id = null, ppg = null, rpg = null, apg = null, mpg = null, gp = null,
       fg_pct = null, ft_pct = null, tp_pct = null, fgm = null, fga = null, tpm = null, tpa = null,
       ftm = null, fta = null, oreb = null, dreb = null, stl = null, blk = null, tovs = null
 where id = 76139 and team = 'Idaho State' and name = 'Malik Johnson' and espn_id = 4067275;
