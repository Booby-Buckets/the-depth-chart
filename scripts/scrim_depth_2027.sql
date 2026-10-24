-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Miami: 0.54 reality, known 0.68, weight 0.15; starters Acaden Lewis, LJ Cason, Shelton Henderson, Malik Reneau, Somoto Cyril -> Acaden Lewis, LJ Cason, Shelton Henderson, Malik Reneau, Somoto Cyril
update players p set depth_order = v.d, depth_set_at = now() from (values (49759, 1), (49764, 2), (49761, 3), (69784, 4), (49763, 5), (49765, 6), (49762, 7), (49766, 8), (49760, 9), (49769, 10), (58153, 11), (49767, 12), (49768, 13), (49770, 14), (49771, 15)) v(id, d)
 where p.id = v.id and p.team = 'Miami';
commit;
