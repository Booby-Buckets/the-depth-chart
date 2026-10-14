-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Syracuse: 0.72 reality, known 0.48, weight 0.23; starters Garwey Dual, Gavin Doty, Aiden Tobiason, Amari Monroe, Luke Wilson -> Garwey Dual, Gavin Doty, Aiden Tobiason, Amari Monroe, Luke Wilson
update players p set depth_order = v.d, depth_set_at = now() from (values (49945, 1), (49947, 2), (49946, 3), (58336, 4), (49949, 5), (49948, 6), (49950, 7), (49952, 8), (49951, 9), (49953, 10), (49955, 11), (71486, 12), (49956, 13), (49957, 14), (49958, 15), (93028, 16)) v(id, d)
 where p.id = v.id and p.team = 'Syracuse';
commit;
