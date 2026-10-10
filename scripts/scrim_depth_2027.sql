-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Belmont: 0.78 reality, known 0.56, weight 0.50; starters Jack Smiley, Jabez Jenkins, Kayden Fish, Eoin Dillon, Vincent Neugebauer -> Jack Smiley, Jabez Jenkins, Eoin Dillon, Vincent Neugebauer, Isaiah West
update players p set depth_order = v.d, depth_set_at = now() from (values (89425, 1), (85958, 2), (85961, 3), (85962, 4), (85960, 5), (85959, 6), (85963, 7), (85968, 8), (85965, 9), (85966, 10), (89424, 11), (85957, 12), (85964, 13), (85956, 14), (85967, 15)) v(id, d)
 where p.id = v.id and p.team = 'Belmont';
-- Murray State: 0.73 reality, known 0.57, weight 0.48; starters Kaden Magwood, Christian Jones, Pavle Nikolic, Brigham Rogers, Shon Tupuola -> Brigham Rogers, Christian Jones, Shon Tupuola, Pavle Nikolic, Kaden Magwood
update players p set depth_order = v.d, depth_set_at = now() from (values (85992, 1), (85989, 2), (85991, 3), (85984, 4), (85996, 5), (85990, 6), (85993, 7), (85986, 8), (85994, 9), (85983, 10), (85987, 11), (85995, 12), (85988, 13), (85982, 14), (85985, 15)) v(id, d)
 where p.id = v.id and p.team = 'Murray State';
commit;
