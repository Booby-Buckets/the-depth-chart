-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Purdue Fort Wayne: 0.83 reality, known 0.41, weight 0.27; starters DeAndre Craig Jr., Ashton Williamson, Anthony Isaac Jr., Edir Ortiz, Adam Walker -> DeAndre Craig Jr., Ashton Williamson, Anthony Isaac Jr., Edir Ortiz, Adam Walker
update players p set depth_order = v.d, depth_set_at = now() from (values (76979, 1), (76981, 2), (76980, 3), (76987, 4), (76978, 5), (76982, 6), (76983, 7), (76984, 8), (76985, 9), (76986, 10), (76977, 11), (76973, 12), (76976, 13), (76974, 14), (76975, 15)) v(id, d)
 where p.id = v.id and p.team = 'Purdue Fort Wayne';
commit;
