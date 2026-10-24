-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Bradley: 0.60 reality, known 0.34, weight 0.23; starters Trevon Payton, Xander Alarie, Timoty van der Knaap, Josh Ibukunoluwa, Dietrich Richardson -> Trevon Payton, Timoty van der Knaap, Xander Alarie, Josh Ibukunoluwa, Dietrich Richardson
update players p set depth_order = v.d, depth_set_at = now() from (values (92755, 1), (92757, 2), (92756, 3), (92758, 4), (92759, 5), (92760, 6), (92761, 7), (92762, 8), (92763, 9), (92764, 10), (92767, 11), (92768, 12), (92765, 13), (92766, 14), (92769, 15)) v(id, d)
 where p.id = v.id and p.team = 'Bradley';
-- Saint Louis: 1.26 reality, known 0.74, weight 0.28; starters Trey Green, Quentin Jones, Amari McCottry, Kellen Thames, Robbie Avila -> Trey Green, Quentin Jones, Amari McCottry, Kellen Thames, Robbie Avila
update players p set depth_order = v.d, depth_set_at = now() from (values (52982, 1), (52983, 2), (52984, 3), (52987, 4), (72497, 5), (52986, 6), (52985, 7), (52988, 8), (52975, 9), (52989, 10), (52990, 11), (52979, 12), (52980, 13), (52976, 14), (52977, 15), (52978, 16)) v(id, d)
 where p.id = v.id and p.team = 'Saint Louis';
commit;
