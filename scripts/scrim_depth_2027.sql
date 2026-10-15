-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- St. John's: 0.65 reality, known 0.47, weight 0.21; starters Quinn Ellis, Tounde Yessoufou, Donnie Freeman, Keyshawn Hall, Ruben Prey -> Quinn Ellis, Tounde Yessoufou, Donnie Freeman, Keyshawn Hall, Ruben Prey
update players p set depth_order = v.d, depth_set_at = now() from (values (50476, 1), (50478, 2), (50490, 3), (63291, 4), (50480, 5), (50477, 6), (50479, 7), (50481, 8), (61897, 9), (50483, 10), (50484, 11), (50486, 12), (50485, 13), (50487, 14), (50482, 15), (50488, 16), (50489, 17), (93645, 18)) v(id, d)
 where p.id = v.id and p.team = 'St. John''s';
commit;
