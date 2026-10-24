-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Eastern Washington: 0.65 reality, known 0.68, weight 0.18; starters Tavi Jackson, Andrew Cook, Jamil Miller, Alton Hamilton IV, Emmett Marquardt -> Tavi Jackson, Andrew Cook, Jamil Miller, Alton Hamilton IV, Emmett Marquardt
update players p set depth_order = v.d, depth_set_at = now() from (values (76101, 1), (76099, 2), (76102, 3), (76100, 4), (76104, 5), (76103, 6), (76105, 7), (76106, 8), (76107, 9), (76108, 10), (76109, 11), (76096, 12), (76098, 13), (76097, 14)) v(id, d)
 where p.id = v.id and p.team = 'Eastern Washington';
commit;
