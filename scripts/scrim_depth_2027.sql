-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Monmouth: 0.70 reality, known 0.28, weight 0.27; starters Torrey Brooks Jr., Jakai Sanders, O'Marion Harvey, Stefanos Spartalis, Stephen Osei -> O'Marion Harvey, Torrey Brooks Jr., Jakai Sanders, Stefanos Spartalis, Stephen Osei
update players p set depth_order = v.d, depth_set_at = now() from (values (76613, 1), (76605, 2), (76609, 3), (76611, 4), (76615, 5), (76610, 6), (76614, 7), (76612, 8), (76616, 9), (76619, 10), (76617, 11), (76618, 12), (76608, 13), (76607, 14), (76606, 15)) v(id, d)
 where p.id = v.id and p.team = 'Monmouth';
commit;
