-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Gonzaga: 0.83 reality, known 0.56, weight 0.24; starters Javon Bennett, Xaivian Lee, Davis Fogle, Braden Huff, Massamba Diop -> Javon Bennett, Xaivian Lee, Davis Fogle, Braden Huff, Massamba Diop
update players p set depth_order = v.d, depth_set_at = now() from (values (59191, 1), (63625, 2), (52889, 3), (52890, 4), (52891, 5), (59196, 6), (52892, 7), (54248, 8), (54249, 9), (94546, 10), (52885, 11), (52886, 12), (52887, 13), (94547, 14), (94548, 15)) v(id, d)
 where p.id = v.id and p.team = 'Gonzaga';
-- Monmouth: 0.70 reality, known 0.28, weight 0.27; starters O'Marion Harvey, Torrey Brooks Jr., Jakai Sanders, Stefanos Spartalis, Stephen Osei -> O'Marion Harvey, Jakai Sanders, Stefanos Spartalis, Torrey Brooks Jr., Stephen Osei
update players p set depth_order = v.d, depth_set_at = now() from (values (76613, 1), (76609, 2), (76611, 3), (76605, 4), (76615, 5), (76610, 6), (76614, 7), (76612, 8), (76619, 9), (76616, 10), (76617, 11), (76618, 12), (76608, 13), (76607, 14), (76606, 15)) v(id, d)
 where p.id = v.id and p.team = 'Monmouth';
commit;
