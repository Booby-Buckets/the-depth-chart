-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- SMU: 0.73 reality, known 0.57, weight 0.21; starters Rowan Brumbaugh, David Terrell Jr., Oziyah Sellers, Jaylin Stewart, Jaden Toombs -> Rowan Brumbaugh, David Terrell Jr., Oziyah Sellers, Jaylin Stewart, Jaden Toombs
update players p set depth_order = v.d, depth_set_at = now() from (values (49827, 1), (49828, 2), (71368, 3), (49830, 4), (49831, 5), (49833, 6), (49832, 7), (49834, 8), (49829, 9), (49835, 10), (71364, 11), (49836, 12), (71365, 13), (49838, 14), (92890, 15)) v(id, d)
 where p.id = v.id and p.team = 'SMU';
commit;
