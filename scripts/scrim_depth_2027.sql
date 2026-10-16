-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Seattle: 0.60 reality, known 0.55, weight 0.19; starters Tyler Boston, Mason Williams, Junseok Yeo, Yuto Kawashima, Halvine Dzellat -> Tyler Boston, Mason Williams, Junseok Yeo, Yuto Kawashima, Halvine Dzellat
update players p set depth_order = v.d, depth_set_at = now() from (values (79237, 1), (79240, 2), (79238, 3), (79244, 4), (79243, 5), (79239, 6), (79241, 7), (79242, 8), (79245, 9), (79246, 10), (79248, 11), (79235, 12), (79234, 13), (79247, 14), (79236, 15)) v(id, d)
 where p.id = v.id and p.team = 'Seattle';
commit;
