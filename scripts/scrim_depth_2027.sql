-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Richmond: 0.57 reality, known 0.53, weight 0.44; starters Derin Saran, Aiden Argabright, Dominick Stewart, Jamie Kaiser Jr., Amon Dorries -> Derin Saran, Aiden Argabright, Jamie Kaiser Jr., Amon Dorries, Dominick Stewart
update players p set depth_order = v.d, depth_set_at = now() from (values (53112, 1), (53113, 2), (53115, 3), (53116, 4), (53114, 5), (53118, 6), (53117, 7), (53120, 8), (53119, 9), (53105, 10), (53106, 11), (53108, 12), (53107, 13), (53109, 14), (53110, 15)) v(id, d)
 where p.id = v.id and p.team = 'Richmond';
-- Virginia: 0.50 reality, known 0.74, weight 0.34; starters Chance Mallory, Nolan Adekunle, Sam Lewis, Thijs De Ridder, Johann Grunloh -> Thijs De Ridder, Johann Grunloh, Sam Lewis, Chance Mallory, Nolan Adekunle
update players p set depth_order = v.d, depth_set_at = now() from (values (49816, 1), (49817, 2), (49815, 3), (49813, 4), (49814, 5), (49819, 6), (49818, 7), (49822, 8), (49821, 9), (49820, 10), (49823, 11), (49825, 12), (49824, 13), (49826, 14), (92873, 15), (92872, 16), (92874, 17), (92875, 18)) v(id, d)
 where p.id = v.id and p.team = 'Virginia';
commit;
