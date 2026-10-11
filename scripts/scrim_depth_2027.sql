-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Belmont: 0.78 reality, known 0.56, weight 0.50; starters Jack Smiley, Jabez Jenkins, Kayden Fish, Eoin Dillon, Vincent Neugebauer -> Jack Smiley, Jabez Jenkins, Eoin Dillon, Vincent Neugebauer, Isaiah West
update players p set depth_order = v.d, depth_set_at = now() from (values (89425, 1), (85958, 2), (85961, 3), (85962, 4), (85960, 5), (85959, 6), (85963, 7), (85968, 8), (85965, 9), (85966, 10), (89424, 11), (85957, 12), (85964, 13), (85956, 14), (85967, 15)) v(id, d)
 where p.id = v.id and p.team = 'Belmont';
commit;
