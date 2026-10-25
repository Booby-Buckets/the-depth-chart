-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Arizona State: 0.64 reality, known 0.53, weight 0.20; starters Joel Foxwell, Bryce Ford, Dillan Shaw, Paulius Murauskas, Ben Defty -> Joel Foxwell, Bryce Ford, Dillan Shaw, Paulius Murauskas, Ben Defty
update players p set depth_order = v.d, depth_set_at = now() from (values (50390, 1), (50391, 2), (50392, 3), (50393, 4), (50394, 5), (50395, 6), (50396, 7), (50397, 8), (50398, 9), (50399, 10), (50400, 11), (50403, 12), (50401, 13), (50402, 14), (50404, 15)) v(id, d)
 where p.id = v.id and p.team = 'Arizona State';
commit;
