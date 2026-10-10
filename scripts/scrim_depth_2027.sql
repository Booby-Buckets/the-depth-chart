-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Belmont: 0.77 reality, known 0.56, weight 0.50; starters Jack Smiley, Jabez Jenkins, Kayden Fish, Eoin Dillon, Vincent Neugebauer -> Jack Smiley, Jabez Jenkins, Eoin Dillon, Kayden Fish, Vincent Neugebauer
update players p set depth_order = v.d, depth_set_at = now() from (values (89425, 1), (85958, 2), (85961, 3), (85959, 4), (85962, 5), (85963, 6), (85960, 7), (85968, 8), (85965, 9), (85966, 10), (89424, 11), (85957, 12), (85964, 13), (85956, 14), (85967, 15)) v(id, d)
 where p.id = v.id and p.team = 'Belmont';
-- Furman: 0.91 reality, known 0.65, weight 0.51; starters Jaxson Bell, Cole Bowser, Charles Johnston, Marcus Kell, Jordan Butler -> Charles Johnston, Jaxson Bell, Cole Bowser, Marcus Kell, Abijah Franklin
update players p set depth_order = v.d, depth_set_at = now() from (values (92771, 1), (78386, 2), (78387, 3), (78385, 4), (78389, 5), (78381, 6), (78388, 7), (78394, 8), (78393, 9), (78391, 10), (78390, 11), (78383, 12), (78384, 13), (78382, 14), (78392, 15), (78395, 16)) v(id, d)
 where p.id = v.id and p.team = 'Furman';
-- Georgetown: 0.71 reality, known 0.66, weight 0.44; starters Jaland Lowe, Vyctorius Miller, Caleb Williams, NJ Benson, Vince Iwuchukwu -> Jaland Lowe, Vince Iwuchukwu, Vyctorius Miller, NJ Benson, Caleb Williams
update players p set depth_order = v.d, depth_set_at = now() from (values (50514, 1), (72093, 2), (50515, 3), (60539, 4), (50517, 5), (50516, 6), (50519, 7), (50520, 8), (50518, 9), (50523, 10), (50522, 11), (50521, 12), (72088, 13), (92773, 14), (92772, 15), (50524, 16)) v(id, d)
 where p.id = v.id and p.team = 'Georgetown';
-- Incarnate Word: 0.68 reality, known 0.21, weight 0.66; starters Brandon McCreesh, Ismail Habib, D'Arrae Goodwin, Kaleb Spencer, Drew Barbee -> Brandon McCreesh, D'Arrae Goodwin, Ismail Habib, Mekhi Connor, Drew Barbee
update players p set depth_order = v.d, depth_set_at = now() from (values (92663, 1), (92665, 2), (92664, 3), (92672, 4), (92667, 5), (92666, 6), (92674, 7), (92671, 8), (92670, 9), (92668, 10), (92669, 11), (92677, 12), (92673, 13), (92675, 14), (92676, 15)) v(id, d)
 where p.id = v.id and p.team = 'Incarnate Word';
-- Nebraska: 0.64 reality, known 0.71, weight 0.40; starters Trevan Leonhardt, Pryce Sandfort, Braden Frager, Sam Orme, Boden Kapke -> Pryce Sandfort, Braden Frager, Trevan Leonhardt, Sam Orme, Boden Kapke
update players p set depth_order = v.d, depth_set_at = now() from (values (50052, 1), (50053, 2), (50051, 3), (50054, 4), (50055, 5), (50059, 6), (50057, 7), (50056, 8), (50058, 9), (50064, 10), (50062, 11), (71606, 12), (50060, 13), (50063, 14)) v(id, d)
 where p.id = v.id and p.team = 'Nebraska';
-- North Carolina: 0.69 reality, known 0.38, weight 0.55; starters Terrence Brown, Neoklis Avdalas, Maximo Adams, Jarin Stevenson, Alexandros Samodurov -> Jarin Stevenson, Terrence Brown, Neoklis Avdalas, Alexandros Samodurov, Matt Able
update players p set depth_order = v.d, depth_set_at = now() from (values (49803, 1), (49800, 2), (49801, 3), (49804, 4), (49805, 5), (49802, 6), (49806, 7), (49807, 8), (58193, 9), (49810, 10), (49811, 11), (49808, 12), (49809, 13), (49812, 14)) v(id, d)
 where p.id = v.id and p.team = 'North Carolina';
-- Saint Louis: 0.59 reality, known 0.88, weight 0.34; starters Trey Green, Quentin Jones, Amari McCottry, Kellen Thames, Robbie Avila -> Trey Green, Robbie Avila, Quentin Jones, Amari McCottry, Kellen Thames
update players p set depth_order = v.d, depth_set_at = now() from (values (52982, 1), (72497, 2), (52983, 3), (52984, 4), (52987, 5), (52986, 6), (52988, 7), (52985, 8), (52975, 9), (52989, 10), (52990, 11), (52980, 12), (52979, 13), (52978, 14), (52976, 15), (52977, 16)) v(id, d)
 where p.id = v.id and p.team = 'Saint Louis';
-- UNLV: 0.82 reality, known 0.56, weight 0.51; starters Terrance Ford Jr., AJ Storr, MJ Thomas, Tyrin Jones, Jeremy Foumena -> Tyrin Jones, Terrance Ford Jr., AJ Storr, Sebastian Mack, MJ Thomas
update players p set depth_order = v.d, depth_set_at = now() from (values (77835, 1), (77834, 2), (77837, 3), (77839, 4), (77836, 5), (77841, 6), (77844, 7), (77832, 8), (77833, 9), (77843, 10), (77845, 11), (77840, 12), (77838, 13), (77842, 14)) v(id, d)
 where p.id = v.id and p.team = 'UNLV';
-- USC: 0.70 reality, known 0.63, weight 0.45; starters Rodney Rice, Alijah Arenas, Christian Collins, Jacob Cofie, Eric Reibe -> Rodney Rice, Alijah Arenas, Jacob Cofie, Christian Collins, Eric Reibe
update players p set depth_order = v.d, depth_set_at = now() from (values (50065, 1), (50066, 2), (50068, 3), (50067, 4), (50069, 5), (50073, 6), (50074, 7), (50070, 8), (50072, 9), (50071, 10), (50075, 11), (57086, 12), (50077, 13), (50076, 14)) v(id, d)
 where p.id = v.id and p.team = 'USC';
-- Utah: 0.78 reality, known 0.35, weight 0.60; starters Noam Yaacov, Trey Campbell, Taison Chatman, Lucas Langarita, Jackson Holcombe -> Noam Yaacov, Trey Campbell, Taison Chatman, Jackson Holcombe, Alec Anigbata
update players p set depth_order = v.d, depth_set_at = now() from (values (50419, 1), (92770, 2), (50420, 3), (50422, 4), (50426, 5), (50424, 6), (50421, 7), (50427, 8), (50423, 9), (50430, 10), (50425, 11), (50428, 12), (50434, 13), (50432, 14), (50431, 15), (50433, 16), (50429, 17)) v(id, d)
 where p.id = v.id and p.team = 'Utah';
-- Xavier: 0.80 reality, known 0.52, weight 0.52; starters Chance Westrey, Tru Washington, Gabriel Pozzato, Jovan Miliecevic, Michael Nwoko -> Tru Washington, Jovan Miliecevic, Michael Nwoko, Chance Westrey, Ruben Dominguez
update players p set depth_order = v.d, depth_set_at = now() from (values (50565, 1), (50567, 2), (50568, 3), (50564, 4), (50570, 5), (50569, 6), (50566, 7), (50573, 8), (72152, 9), (50571, 10), (50577, 11), (50575, 12), (50578, 13), (50574, 14), (50576, 15), (50579, 16)) v(id, d)
 where p.id = v.id and p.team = 'Xavier';
commit;
