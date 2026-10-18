-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Creighton: 0.57 reality, known 0.77, weight 0.15; starters Wes Enis, Austin Swartz, Hudson Greer, Jackson McAndrew, Oswin Erhunmwunse -> Wes Enis, Austin Swartz, Jackson McAndrew, Hudson Greer, Oswin Erhunmwunse
update players p set depth_order = v.d, depth_set_at = now() from (values (50463, 1), (50464, 2), (50466, 3), (50465, 4), (50467, 5), (50468, 6), (50469, 7), (50470, 8), (60491, 9), (50471, 10), (50472, 11), (50473, 12), (50474, 13), (50475, 14), (93627, 15)) v(id, d)
 where p.id = v.id and p.team = 'Creighton';
-- Rutgers: 1.34 reality, known 0.68, weight 0.31; starters Tariq Francis, Jamichael Davis, Darin Smith Jr., Darren Buchanan, Christian Gurdak -> Tariq Francis, Jamichael Davis, Darin Smith Jr., Darren Buchanan, Christian Gurdak
update players p set depth_order = v.d, depth_set_at = now() from (values (50205, 1), (50206, 2), (50207, 3), (50208, 4), (50209, 5), (50210, 6), (50211, 7), (50212, 8), (50213, 9), (50214, 10), (50215, 11), (71759, 12), (71758, 13), (50216, 14), (50217, 15), (50218, 16), (93334, 17)) v(id, d)
 where p.id = v.id and p.team = 'Rutgers';
-- St. John's: 1.36 reality, known 0.47, weight 0.36; starters Quinn Ellis, Tounde Yessoufou, Donnie Freeman, Keyshawn Hall, Ruben Prey -> Quinn Ellis, Tounde Yessoufou, Donnie Freeman, Keyshawn Hall, Ruben Prey
update players p set depth_order = v.d, depth_set_at = now() from (values (50476, 1), (50478, 2), (50490, 3), (63291, 4), (50480, 5), (50477, 6), (50479, 7), (50481, 8), (61897, 9), (50483, 10), (50484, 11), (50485, 12), (50486, 13), (50487, 14), (50482, 15), (50488, 16), (50489, 17), (93645, 18)) v(id, d)
 where p.id = v.id and p.team = 'St. John''s';
commit;
