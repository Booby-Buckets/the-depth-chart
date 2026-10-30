-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Missouri: 1.32 reality, known 0.46, weight 0.36; starters Jason Crowe Jr., Kennard Davis Jr., Jamier Jones, Bryson Tiller, Mark Mitchell -> Jason Crowe Jr., Kennard Davis Jr., Jamier Jones, Bryson Tiller, Mark Mitchell
update players p set depth_order = v.d, depth_set_at = now() from (values (50679, 1), (50680, 2), (50681, 3), (50683, 4), (67704, 5), (50684, 6), (50682, 7), (50685, 8), (50686, 9), (50687, 10), (50688, 11), (50689, 12), (50690, 13), (50692, 14), (50691, 15), (50693, 16), (94762, 17)) v(id, d)
 where p.id = v.id and p.team = 'Missouri';
commit;
