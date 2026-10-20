-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Pittsburgh: 0.55 reality, known 0.44, weight 0.19; starters Naithan George, A'lahn Sumler, Jalil Bethea, Baye Ndongo, Armani Mighty -> Naithan George, A'lahn Sumler, Jalil Bethea, Baye Ndongo, Armani Mighty
update players p set depth_order = v.d, depth_set_at = now() from (values (49959, 1), (49960, 2), (49961, 3), (49962, 4), (49963, 5), (49964, 6), (49965, 7), (49966, 8), (49967, 9), (49968, 10), (49969, 11), (49972, 12), (49970, 13), (49971, 14), (49973, 15), (93044, 16), (93045, 17), (93046, 18)) v(id, d)
 where p.id = v.id and p.team = 'Pittsburgh';
-- Siena: 0.50 reality, known 0.57, weight 0.16; starters Chris Torres, Tan Yildizoglu, Brendan Coyle, Isaiah Henderson, Reid Ducharme -> Chris Torres, Tan Yildizoglu, Brendan Coyle, Reid Ducharme, Isaiah Henderson
update players p set depth_order = v.d, depth_set_at = now() from (values (77368, 1), (77363, 2), (77364, 3), (77366, 4), (77365, 5), (77367, 6), (77369, 7), (77370, 8), (77359, 9), (77360, 10), (77356, 11), (77357, 12), (77361, 13), (77362, 14), (77358, 15), (77355, 16)) v(id, d)
 where p.id = v.id and p.team = 'Siena';
commit;
