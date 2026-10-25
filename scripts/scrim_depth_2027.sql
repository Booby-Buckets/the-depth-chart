-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Niagara: 0.73 reality, known 0.34, weight 0.26; starters Bastien Rieber, Cole Farrell, Vukasin Todorovic, Fidel Rotta, Noah Slingerland -> Bastien Rieber, Cole Farrell, Vukasin Todorovic, Fidel Rotta, Noah Slingerland
update players p set depth_order = v.d, depth_set_at = now() from (values (77291, 1), (77289, 2), (77293, 3), (77286, 4), (77295, 5), (77290, 6), (77292, 7), (77294, 8), (77296, 9), (77298, 10), (77285, 11), (77297, 12), (77287, 13), (77288, 14)) v(id, d)
 where p.id = v.id and p.team = 'Niagara';
-- Syracuse: 1.95 reality, known 0.54, weight 0.43; starters Garwey Dual, Gavin Doty, Aiden Tobiason, Amari Monroe, Luke Wilson -> Gavin Doty, Garwey Dual, Aiden Tobiason, Amari Monroe, Luke Wilson
update players p set depth_order = v.d, depth_set_at = now() from (values (49947, 1), (49945, 2), (49946, 3), (58336, 4), (49949, 5), (49948, 6), (49950, 7), (49951, 8), (49952, 9), (49953, 10), (71486, 11), (49955, 12), (49956, 13), (49957, 14), (49958, 15), (93028, 16)) v(id, d)
 where p.id = v.id and p.team = 'Syracuse';
commit;
