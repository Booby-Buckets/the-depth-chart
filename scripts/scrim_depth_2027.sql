-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Eastern Michigan: 0.61 reality, known 0.52, weight 0.46; starters Jabri Fitzpatrick, Emanuel Richards, Jordan Wright, Mohammad Habhab, Kaden Johnson -> Mohammad Habhab, Emanuel Richards, Kaden Johnson, Jabri Fitzpatrick, Jordan Wright
update players p set depth_order = v.d, depth_set_at = now() from (values (77446, 1), (77449, 2), (77454, 3), (77447, 4), (77448, 5), (77450, 6), (77452, 7), (77445, 8), (77451, 9), (77456, 10), (77453, 11), (77455, 12), (77457, 13), (77458, 14)) v(id, d)
 where p.id = v.id and p.team = 'Eastern Michigan';
-- Georgia Tech: 0.62 reality, known 0.41, weight 0.51; starters Colby Garland, Nasir Whitlock, Kayden Allen, Victor Valdes, Jackson McVey -> Nasir Whitlock, Victor Valdes, Jackson Fields, Jackson McVey, Kam Craft
update players p set depth_order = v.d, depth_set_at = now() from (values (49975, 1), (49977, 2), (49980, 3), (49978, 4), (49981, 5), (49974, 6), (49976, 7), (49983, 8), (49979, 9), (49982, 10), (49985, 11), (49984, 12), (49986, 13), (49987, 14), (93047, 15)) v(id, d)
 where p.id = v.id and p.team = 'Georgia Tech';
-- Maryland: 0.54 reality, known 0.58, weight 0.40; starters DJ Wagner, Andre Mills, Baba Oladotun, Tomislav Buljan, Pharrel Payne -> Andre Mills, DJ Wagner, Pharrel Payne, Tomislav Buljan, Baba Oladotun
update players p set depth_order = v.d, depth_set_at = now() from (values (50153, 1), (50152, 2), (50156, 3), (50155, 4), (50154, 5), (50158, 6), (50157, 7), (50159, 8), (61569, 9), (50160, 10), (93274, 11), (50162, 12), (50165, 13), (50164, 14), (93272, 15), (50163, 16), (93273, 17)) v(id, d)
 where p.id = v.id and p.team = 'Maryland';
-- Michigan: 0.77 reality, known 0.49, weight 0.53; starters Elliot Cadeau, Brandon McCoy Jr., Trey Mckenney, JP Estrella, Moustapha Thiam -> Elliot Cadeau, Brandon McCoy Jr., Trey Mckenney, Moustapha Thiam, JP Estrella
update players p set depth_order = v.d, depth_set_at = now() from (values (49988, 1), (49989, 2), (49990, 3), (49992, 4), (49991, 5), (49995, 6), (49994, 7), (64203, 8), (49999, 9), (49996, 10), (49997, 11), (49998, 12), (50001, 13), (50000, 14), (93078, 15), (93076, 16), (93077, 17)) v(id, d)
 where p.id = v.id and p.team = 'Michigan';
-- New Mexico: 0.61 reality, known 0.55, weight 0.44; starters Uriah Tenette, Jake Hall, Tunde Vahlberg Fasasi, Federico Grani, AJ Pierre-Jerome -> Uriah Tenette, Jake Hall, AJ Pierre-Jerome, Tunde Vahlberg Fasasi, Federico Grani
update players p set depth_order = v.d, depth_set_at = now() from (values (77794, 1), (77793, 2), (77800, 3), (77795, 4), (77799, 5), (77797, 6), (77798, 7), (77796, 8), (77791, 9), (77789, 10), (77801, 11), (77790, 12), (77792, 13)) v(id, d)
 where p.id = v.id and p.team = 'New Mexico';
-- Oklahoma State: 0.53 reality, known 0.56, weight 0.41; starters Kanye Clary, Kashie Natt, Luka Bogavac, Jordan Burks, Parsa Fallah -> Luka Bogavac, Parsa Fallah, Kashie Natt, Kanye Clary, Jordan Burks
update players p set depth_order = v.d, depth_set_at = now() from (values (50287, 1), (61702, 2), (50286, 3), (50285, 4), (50288, 5), (50291, 6), (50290, 7), (50294, 8), (50289, 9), (50292, 10), (50293, 11), (50298, 12), (50296, 13), (50295, 14), (50297, 15)) v(id, d)
 where p.id = v.id and p.team = 'Oklahoma State';
-- Rutgers: 0.55 reality, known 0.68, weight 0.37; starters Tariq Francis, Jamichael Davis, Darin Smith Jr., Darren Buchanan, Christian Gurdak -> Tariq Francis, Darin Smith Jr., Christian Gurdak, Jamichael Davis, Darren Buchanan
update players p set depth_order = v.d, depth_set_at = now() from (values (50205, 1), (50207, 2), (50209, 3), (50206, 4), (50208, 5), (50213, 6), (50210, 7), (50211, 8), (50216, 9), (50214, 10), (50212, 11), (50217, 12), (71759, 13), (50215, 14), (50218, 15), (71758, 16), (93334, 17)) v(id, d)
 where p.id = v.id and p.team = 'Rutgers';
-- Villanova: 0.59 reality, known 0.48, weight 0.46; starters Darryl Simmons ll, Tyler Perkins, Devin Royale, Kwame Evans Jr., Luigi Suigo -> Tyler Perkins, Devin Royale, Luigi Suigo, Kwame Evans Jr., Darryl Simmons ll
update players p set depth_order = v.d, depth_set_at = now() from (values (50492, 1), (50493, 2), (50495, 3), (50494, 4), (61907, 5), (50496, 6), (50497, 7), (93659, 8), (50498, 9), (50499, 10), (72070, 11), (72059, 12), (72071, 13), (50500, 14)) v(id, d)
 where p.id = v.id and p.team = 'Villanova';
commit;
