-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Alabama: 0.66 reality, known 0.44, weight 0.51; starters Aden Holloway, Amari Allen, Qayden Samuels, Jaxon Richardson, Drew Fielder -> Aden Holloway, Amari Allen, Qayden Samuels, Jaxon Richardson, Drew Fielder
update players p set depth_order = v.d, depth_set_at = now() from (values (50594, 1), (50597, 2), (50595, 3), (50596, 4), (50598, 5), (50599, 6), (50603, 7), (50604, 8), (50601, 9), (50605, 10), (50600, 11), (93791, 12), (50602, 13), (50606, 14), (50607, 15)) v(id, d)
 where p.id = v.id and p.team = 'Alabama';
-- Duke: 0.77 reality, known 0.51, weight 0.52; starters John Blackwell, Cayden Boozer, Dame Sarr, Joaquim Boumtje Boumtje, Patrick Ngongba -> John Blackwell, Dame Sarr, Joaquim Boumtje Boumtje, Cayden Boozer, Patrick Ngongba
update players p set depth_order = v.d, depth_set_at = now() from (values (49774, 1), (49775, 2), (49776, 3), (49773, 4), (49777, 5), (49781, 6), (71310, 7), (49779, 8), (49783, 9), (49778, 10), (49780, 11), (49784, 12), (49782, 13), (92825, 14), (92812, 15)) v(id, d)
 where p.id = v.id and p.team = 'Duke';
-- Nebraska: 0.51 reality, known 0.74, weight 0.34; starters Pryce Sandfort, Trevan Leonhardt, Braden Frager, Sam Orme, Boden Kapke -> Pryce Sandfort, Braden Frager, Trevan Leonhardt, Sam Orme, Boden Kapke
update players p set depth_order = v.d, depth_set_at = now() from (values (50052, 1), (50053, 2), (50051, 3), (50054, 4), (50055, 5), (50058, 6), (50057, 7), (50059, 8), (50056, 9), (71606, 10), (50064, 11), (50062, 12), (50060, 13), (50063, 14), (93154, 15)) v(id, d)
 where p.id = v.id and p.team = 'Nebraska';
-- North Carolina: 0.60 reality, known 0.43, weight 0.49; starters Terrence Brown, Jarin Stevenson, Neoklis Avdalas, Matt Able, Sayon Keita -> Jarin Stevenson, Terrence Brown, Neoklis Avdalas, Sayon Keita, Matt Able
update players p set depth_order = v.d, depth_set_at = now() from (values (49803, 1), (49800, 2), (49801, 3), (49806, 4), (49805, 5), (49807, 6), (49802, 7), (49804, 8), (49810, 9), (58193, 10), (49811, 11), (49808, 12), (92856, 13), (92857, 14), (49812, 15), (49809, 16)) v(id, d)
 where p.id = v.id and p.team = 'North Carolina';
-- Ohio State: 0.80 reality, known 0.56, weight 0.51; starters John Mobley Jr., Amare Bynum, Anthony Thompson, Curtis Givens, Ivan Njegovan -> John Mobley Jr., Amare Bynum, Anthony Thompson, Curtis Givens, Ivan Njegovan
update players p set depth_order = v.d, depth_set_at = now() from (values (50117, 1), (50119, 2), (50118, 3), (50122, 4), (50124, 5), (71664, 6), (50121, 7), (50116, 8), (50120, 9), (50123, 10), (71674, 11), (50125, 12), (93226, 13), (50126, 14), (50127, 15)) v(id, d)
 where p.id = v.id and p.team = 'Ohio State';
-- Utah: 0.58 reality, known 0.34, weight 0.53; starters Noam Yaacov, Trey Campbell, Taison Chatman, Jackson Holcombe, Alec Anigbata -> Noam Yaacov, Trey Campbell, Taison Chatman, Jackson Holcombe, Alec Anigbata
update players p set depth_order = v.d, depth_set_at = now() from (values (50419, 1), (92770, 2), (50420, 3), (50422, 4), (50426, 5), (50427, 6), (50424, 7), (50421, 8), (50423, 9), (50430, 10), (50428, 11), (50434, 12), (50432, 13), (50425, 14), (50431, 15), (93581, 16), (50433, 17), (50429, 18)) v(id, d)
 where p.id = v.id and p.team = 'Utah';
-- Wake Forest: 0.60 reality, known 0.40, weight 0.51; starters Kevair Kennedy, Gavin Placide, Xander Pintelon, Isaac Carr, Jamari McDowell -> Kevair Kennedy, Gavin Placide, Xander Pintelon, Isaac Carr, Jamari McDowell
update players p set depth_order = v.d, depth_set_at = now() from (values (49891, 1), (49894, 2), (49895, 3), (49897, 4), (49893, 5), (49892, 6), (49898, 7), (71432, 8), (69920, 9), (49896, 10), (92777, 11), (92963, 12), (92778, 13), (92965, 14), (49900, 15), (49899, 16)) v(id, d)
 where p.id = v.id and p.team = 'Wake Forest';
-- Wichita State: 0.55 reality, known 0.84, weight 0.33; starters Will Berg, Kenyon Giles, Jahari Long, Dillon Battie, Jordan Frison -> Will Berg, Kenyon Giles, Jahari Long, Jordan Frison, Dillon Battie
update players p set depth_order = v.d, depth_set_at = now() from (values (68159, 1), (72724, 2), (68156, 3), (68155, 4), (68158, 5), (68157, 6), (72729, 7), (68160, 8), (68161, 9), (68162, 10), (68154, 11), (68165, 12), (68163, 13), (68164, 14), (72737, 15)) v(id, d)
 where p.id = v.id and p.team = 'Wichita State';
-- Xavier: 0.64 reality, known 0.42, weight 0.51; starters Tru Washington, Jovan Miliecevic, Chance Westrey, Michael Nwoko, Gabriel Pozzato -> Tru Washington, Jovan Miliecevic, Michael Nwoko, Chance Westrey, Ruben Dominguez
update players p set depth_order = v.d, depth_set_at = now() from (values (50565, 1), (50567, 2), (50568, 3), (50564, 4), (50570, 5), (50566, 6), (50573, 7), (50569, 8), (72152, 9), (50577, 10), (50575, 11), (50578, 12), (50571, 13), (50579, 14), (93754, 15), (93755, 16), (50574, 17), (50576, 18)) v(id, d)
 where p.id = v.id and p.team = 'Xavier';
commit;
