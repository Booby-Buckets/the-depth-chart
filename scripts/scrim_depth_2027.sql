-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- St. Bonaventure: 0.70 reality, known 0.28, weight 0.28; starters Ilia Ermakov, Zach Philipkoski, Mason Blackwood, Joe Grahovac, Benjamin Bill -> Ilia Ermakov, Zach Philipkoski, Mason Blackwood, Joe Grahovac, Benjamin Bill
update players p set depth_order = v.d, depth_set_at = now() from (values (53125, 1), (53126, 2), (53127, 3), (53128, 4), (53129, 5), (72627, 6), (53130, 7), (53131, 8), (53121, 9), (53132, 10), (53134, 11), (53133, 12), (53122, 13), (53123, 14)) v(id, d)
 where p.id = v.id and p.team = 'St. Bonaventure';
commit;
