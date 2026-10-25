-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- St. John's: 2.23 reality, known 0.47, weight 0.48; starters Quinn Ellis, Tounde Yessoufou, Donnie Freeman, Keyshawn Hall, Ruben Prey -> Quinn Ellis, Tounde Yessoufou, Donnie Freeman, Keyshawn Hall, Ruben Prey
update players p set depth_order = v.d, depth_set_at = now() from (values (50476, 1), (50478, 2), (50490, 3), (63291, 4), (50480, 5), (50477, 6), (50479, 7), (50481, 8), (61897, 9), (50483, 10), (50486, 11), (50484, 12), (50485, 13), (50487, 14), (50482, 15), (50488, 16), (50489, 17), (93645, 18)) v(id, d)
 where p.id = v.id and p.team = 'St. John''s';
-- Texas: 0.88 reality, known 0.41, weight 0.28; starters Isaiah Johnson, Mikey Lewis, Elyjah Freeman, David Punch, Matas Vokietaitis -> Isaiah Johnson, Mikey Lewis, Elyjah Freeman, David Punch, Matas Vokietaitis
update players p set depth_order = v.d, depth_set_at = now() from (values (50637, 1), (50638, 2), (50639, 3), (50640, 4), (50641, 5), (50642, 6), (50643, 7), (50644, 8), (50645, 9), (50649, 10), (50646, 11), (50647, 12), (50648, 13), (50650, 14), (50651, 15)) v(id, d)
 where p.id = v.id and p.team = 'Texas';
commit;
