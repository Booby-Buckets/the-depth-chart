-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Samford: 0.74 reality, known 0.74, weight 0.19; starters Cooper Noard, Najimi George, Judson Bjornstad, Braeden Macvicar, Will Shaver -> Cooper Noard, Najimi George, Judson Bjornstad, Braeden Macvicar, Will Shaver
update players p set depth_order = v.d, depth_set_at = now() from (values (78415, 1), (78413, 2), (78419, 3), (78422, 4), (78418, 5), (78414, 6), (78416, 7), (78417, 8), (78420, 9), (78426, 10), (78421, 11), (78423, 12), (78424, 13), (78425, 14), (78428, 15), (78427, 16), (78412, 17), (78411, 18)) v(id, d)
 where p.id = v.id and p.team = 'Samford';
commit;
