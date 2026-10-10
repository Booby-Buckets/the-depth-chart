-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Belmont: 0.77 reality, known 0.56, weight 0.50; starters Jack Smiley, Jabez Jenkins, Kayden Fish, Eoin Dillon, Vincent Neugebauer -> Jack Smiley, Jabez Jenkins, Eoin Dillon, Kayden Fish, Vincent Neugebauer
update players p set depth_order = v.d, depth_set_at = now() from (values (89425, 1), (85958, 2), (85961, 3), (85959, 4), (85962, 5), (85963, 6), (85960, 7), (85968, 8), (85965, 9), (85966, 10), (89424, 11), (85957, 12), (85964, 13), (85956, 14), (85967, 15)) v(id, d)
 where p.id = v.id and p.team = 'Belmont';
-- Dayton: 0.69 reality, known 0.57, weight 0.47; starters Travis Perry, Zaide Lowery, Aidan Derkack, Grant Randall, Ameal L'etang -> Zaide Lowery, Travis Perry, Grant Randall, Ameal L'etang, Aidan Derkack
update players p set depth_order = v.d, depth_set_at = now() from (values (53014, 1), (53013, 2), (53015, 3), (53016, 4), (53006, 5), (53019, 6), (53018, 7), (53017, 8), (53020, 9), (53021, 10), (53010, 11), (53007, 12), (53008, 13), (92779, 14), (53009, 15)) v(id, d)
 where p.id = v.id and p.team = 'Dayton';
-- Georgetown: 0.71 reality, known 0.66, weight 0.44; starters Jaland Lowe, Vyctorius Miller, Caleb Williams, NJ Benson, Vince Iwuchukwu -> Jaland Lowe, Vince Iwuchukwu, Vyctorius Miller, NJ Benson, Caleb Williams
update players p set depth_order = v.d, depth_set_at = now() from (values (50514, 1), (72093, 2), (50515, 3), (60539, 4), (50517, 5), (50516, 6), (50520, 7), (50519, 8), (50518, 9), (50523, 10), (50522, 11), (50521, 12), (72088, 13), (92773, 14), (92772, 15), (50524, 16)) v(id, d)
 where p.id = v.id and p.team = 'Georgetown';
-- Incarnate Word: 0.70 reality, known 0.21, weight 0.66; starters Brandon McCreesh, Ismail Habib, D'Arrae Goodwin, Kaleb Spencer, Drew Barbee -> Brandon McCreesh, Ismail Habib, D'Arrae Goodwin, Drew Barbee, Mekhi Connor
update players p set depth_order = v.d, depth_set_at = now() from (values (92663, 1), (92664, 2), (92665, 3), (92667, 4), (92672, 5), (92666, 6), (92670, 7), (92668, 8), (92669, 9), (92671, 10), (92674, 11), (92677, 12), (92673, 13), (92675, 14), (92676, 15)) v(id, d)
 where p.id = v.id and p.team = 'Incarnate Word';
-- Michigan State: 0.88 reality, known 0.77, weight 0.46; starters Jeremy Fears Jr., Jasiah Jervis, Jordan Scott, Coen Carr, Anton Bonke -> Coen Carr, Jeremy Fears Jr., Jordan Scott, Jasiah Jervis, Anton Bonke
update players p set depth_order = v.d, depth_set_at = now() from (values (50029, 1), (50026, 2), (50028, 3), (50027, 4), (50030, 5), (50035, 6), (50032, 7), (50031, 8), (50033, 9), (50036, 10), (50037, 11), (50034, 12), (92775, 13), (92774, 14), (92776, 15)) v(id, d)
 where p.id = v.id and p.team = 'Michigan State';
-- Murray State: 0.74 reality, known 0.57, weight 0.49; starters Kaden Magwood, Christian Jones, Pavle Nikolic, Brigham Rogers, Shon Tupuola -> Brigham Rogers, Christian Jones, Shon Tupuola, Pavle Nikolic, Kaden Magwood
update players p set depth_order = v.d, depth_set_at = now() from (values (85992, 1), (85989, 2), (85991, 3), (85984, 4), (85996, 5), (85990, 6), (85993, 7), (85986, 8), (85983, 9), (85994, 10), (85987, 11), (85995, 12), (85988, 13), (85982, 14), (85985, 15)) v(id, d)
 where p.id = v.id and p.team = 'Murray State';
-- Nebraska: 0.64 reality, known 0.71, weight 0.40; starters Trevan Leonhardt, Pryce Sandfort, Braden Frager, Sam Orme, Boden Kapke -> Pryce Sandfort, Trevan Leonhardt, Braden Frager, Sam Orme, Boden Kapke
update players p set depth_order = v.d, depth_set_at = now() from (values (50052, 1), (50051, 2), (50053, 3), (50054, 4), (50055, 5), (50057, 6), (50058, 7), (50056, 8), (50059, 9), (71606, 10), (50064, 11), (50060, 12), (50062, 13), (50063, 14)) v(id, d)
 where p.id = v.id and p.team = 'Nebraska';
-- North Carolina: 0.74 reality, known 0.38, weight 0.57; starters Terrence Brown, Neoklis Avdalas, Maximo Adams, Jarin Stevenson, Alexandros Samodurov -> Jarin Stevenson, Terrence Brown, Neoklis Avdalas, Alexandros Samodurov, Matt Able
update players p set depth_order = v.d, depth_set_at = now() from (values (49803, 1), (49800, 2), (49801, 3), (49804, 4), (49805, 5), (49802, 6), (49806, 7), (58193, 8), (49807, 9), (49808, 10), (49810, 11), (49811, 12), (49809, 13), (49812, 14)) v(id, d)
 where p.id = v.id and p.team = 'North Carolina';
-- Ohio State: 0.80 reality, known 0.52, weight 0.52; starters Jimmie Williams, John Mobley Jr., Anthony Thompson, Amare Bynum, Josh Ojanwuna -> John Mobley Jr., Amare Bynum, Anthony Thompson, Curtis Givens, Ivan Njegovan
update players p set depth_order = v.d, depth_set_at = now() from (values (50117, 1), (50119, 2), (50118, 3), (50122, 4), (50124, 5), (50116, 6), (50120, 7), (50121, 8), (71664, 9), (50123, 10), (71674, 11), (50125, 12), (50126, 13), (50127, 14)) v(id, d)
 where p.id = v.id and p.team = 'Ohio State';
-- Saint Louis: 0.60 reality, known 0.88, weight 0.34; starters Trey Green, Quentin Jones, Amari McCottry, Kellen Thames, Robbie Avila -> Trey Green, Quentin Jones, Amari McCottry, Robbie Avila, Kellen Thames
update players p set depth_order = v.d, depth_set_at = now() from (values (52982, 1), (52983, 2), (52984, 3), (72497, 4), (52987, 5), (52986, 6), (52988, 7), (52985, 8), (52975, 9), (52989, 10), (52976, 11), (52990, 12), (52977, 13), (52978, 14), (52979, 15), (52980, 16)) v(id, d)
 where p.id = v.id and p.team = 'Saint Louis';
-- UNLV: 0.82 reality, known 0.56, weight 0.51; starters Terrance Ford Jr., AJ Storr, MJ Thomas, Tyrin Jones, Jeremy Foumena -> Tyrin Jones, Terrance Ford Jr., AJ Storr, Sebastian Mack, MJ Thomas
update players p set depth_order = v.d, depth_set_at = now() from (values (77835, 1), (77834, 2), (77837, 3), (77839, 4), (77836, 5), (77844, 6), (77841, 7), (77833, 8), (77832, 9), (77843, 10), (77845, 11), (77840, 12), (77838, 13), (77842, 14)) v(id, d)
 where p.id = v.id and p.team = 'UNLV';
-- Utah: 0.78 reality, known 0.35, weight 0.60; starters Noam Yaacov, Trey Campbell, Taison Chatman, Lucas Langarita, Jackson Holcombe -> Noam Yaacov, Trey Campbell, Taison Chatman, Jackson Holcombe, Alec Anigbata
update players p set depth_order = v.d, depth_set_at = now() from (values (50419, 1), (92770, 2), (50420, 3), (50422, 4), (50426, 5), (50421, 6), (50424, 7), (50423, 8), (50427, 9), (50425, 10), (50430, 11), (50428, 12), (50434, 13), (50432, 14), (50431, 15), (50433, 16), (50429, 17)) v(id, d)
 where p.id = v.id and p.team = 'Utah';
-- Wichita State: 0.64 reality, known 0.83, weight 0.37; starters Jordan Frison, Kenyon Giles, Jahari Long, Dillon Battie, Will Berg -> Will Berg, Kenyon Giles, Jahari Long, Dillon Battie, Jordan Frison
update players p set depth_order = v.d, depth_set_at = now() from (values (68159, 1), (72724, 2), (68156, 3), (68158, 4), (68155, 5), (68157, 6), (72729, 7), (68160, 8), (68161, 9), (68162, 10), (68154, 11), (68165, 12), (92780, 13), (68163, 14), (68164, 15), (72737, 16)) v(id, d)
 where p.id = v.id and p.team = 'Wichita State';
commit;
