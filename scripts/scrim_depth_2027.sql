-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Memphis: 1.51 reality, known 0.56, weight 0.36; starters Jayden Reid, Brandin Cummings, Julius Thedford, Tylik Weeks, Cornelious Williams -> Jayden Reid, Brandin Cummings, Tylik Weeks, Julius Thedford, Cornelious Williams
update players p set depth_order = v.d, depth_set_at = now() from (values (53167, 1), (53168, 2), (53170, 3), (53169, 4), (53171, 5), (53172, 6), (53173, 7), (53175, 8), (53174, 9), (53176, 10), (72695, 11), (53179, 12), (53177, 13), (53178, 14), (94759, 15)) v(id, d)
 where p.id = v.id and p.team = 'Memphis';
commit;
