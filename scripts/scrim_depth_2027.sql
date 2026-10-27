-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Drexel: 1.19 reality, known 0.53, weight 0.32; starters Josh Reed, Dillon Tingler, Panagiotis Pagonis, Martin de LaPorterie, Ralph Akuta -> Josh Reed, Dillon Tingler, Panagiotis Pagonis, Martin de LaPorterie, Ralph Akuta
update players p set depth_order = v.d, depth_set_at = now() from (values (76548, 1), (76551, 2), (76549, 3), (76550, 4), (76552, 5), (76553, 6), (76554, 7), (76555, 8), (76545, 9), (76556, 10), (76544, 11), (76546, 12), (76543, 13), (76547, 14)) v(id, d)
 where p.id = v.id and p.team = 'Drexel';
-- Penn State: 1.50 reality, known 0.55, weight 0.36; starters Dasante Bowen, Roberts Blums, Brant Byers, Josh Reed, Ivan Juric -> Dasante Bowen, Roberts Blums, Brant Byers, Josh Reed, Ivan Juric
update players p set depth_order = v.d, depth_set_at = now() from (values (50192, 1), (50193, 2), (50194, 3), (50195, 4), (50196, 5), (50197, 6), (50198, 7), (50199, 8), (50200, 9), (50201, 10), (50203, 11), (50202, 12), (50204, 13), (93304, 14)) v(id, d)
 where p.id = v.id and p.team = 'Penn State';
commit;
