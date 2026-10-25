-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Morehead State: 0.78 reality, known 0.46, weight 0.25; starters Chase Dawson, Kyrell Shaw, Clayton Parker, Dalman Alexander, Lonnie Bass, Jr. -> Chase Dawson, Kyrell Shaw, Clayton Parker, Dalman Alexander, Lonnie Bass, Jr.
update players p set depth_order = v.d, depth_set_at = now() from (values (77991, 1), (77992, 2), (77994, 3), (77998, 4), (78000, 5), (77993, 6), (77995, 7), (77997, 8), (77996, 9), (77990, 10), (77999, 11), (78001, 12), (77988, 13), (77989, 14)) v(id, d)
 where p.id = v.id and p.team = 'Morehead State';
-- Syracuse: 1.95 reality, known 0.52, weight 0.43; starters Gavin Doty, Garwey Dual, Aiden Tobiason, Amari Monroe, Luke Wilson -> Gavin Doty, Aiden Tobiason, Garwey Dual, Amari Monroe, Luke Wilson
update players p set depth_order = v.d, depth_set_at = now() from (values (49947, 1), (49946, 2), (49945, 3), (58336, 4), (49949, 5), (49948, 6), (49950, 7), (49955, 8), (49953, 9), (49951, 10), (49952, 11), (71486, 12), (49956, 13), (49957, 14), (49958, 15), (93028, 16)) v(id, d)
 where p.id = v.id and p.team = 'Syracuse';
commit;
