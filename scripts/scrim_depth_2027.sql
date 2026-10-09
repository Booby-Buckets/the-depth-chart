-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Alabama: 0.74 reality, known 0.46, weight 0.53; starters Aden Holloway, Qayden Samuels, Jaxon Richardson, Amari Allen, Drew Fielder -> Aden Holloway, Amari Allen, Qayden Samuels, Jaxon Richardson, Drew Fielder
update players p set depth_order = v.d, depth_set_at = now() from (values (50594, 1), (50597, 2), (50595, 3), (50596, 4), (50598, 5), (50599, 6), (50603, 7), (50601, 8), (50604, 9), (50600, 10), (50605, 11), (50602, 12), (50607, 13), (50606, 14)) v(id, d)
 where p.id = v.id and p.team = 'Alabama';
-- Belmont: 0.79 reality, known 0.56, weight 0.50; starters Jack Smiley, Jabez Jenkins, Kayden Fish, Eoin Dillon, Vincent Neugebauer -> Jack Smiley, Jabez Jenkins, Eoin Dillon, Vincent Neugebauer, Isaiah West
update players p set depth_order = v.d, depth_set_at = now() from (values (89425, 1), (85958, 2), (85961, 3), (85962, 4), (85960, 5), (85963, 6), (85959, 7), (85968, 8), (85965, 9), (85966, 10), (89424, 11), (85957, 12), (85964, 13), (85956, 14), (85967, 15)) v(id, d)
 where p.id = v.id and p.team = 'Belmont';
-- Dayton: 0.66 reality, known 0.57, weight 0.46; starters Travis Perry, Zaide Lowery, Aidan Derkack, Grant Randall, Ameal L'etang -> Grant Randall, Zaide Lowery, Travis Perry, Ameal L'etang, Aidan Derkack
update players p set depth_order = v.d, depth_set_at = now() from (values (53015, 1), (53014, 2), (53013, 3), (53016, 4), (53006, 5), (53019, 6), (53018, 7), (53017, 8), (53021, 9), (53010, 10), (53020, 11), (53008, 12), (53007, 13), (92779, 14), (53009, 15)) v(id, d)
 where p.id = v.id and p.team = 'Dayton';
-- Duke: 0.81 reality, known 0.59, weight 0.50; starters Cayden Boozer, John Blackwell, Dame Sarr, Joaquim Boumtje Boumtje, Patrick Ngongba -> John Blackwell, Dame Sarr, Cayden Boozer, Joaquim Boumtje Boumtje, Patrick Ngongba
update players p set depth_order = v.d, depth_set_at = now() from (values (49774, 1), (49775, 2), (49773, 3), (49776, 4), (49777, 5), (49781, 6), (49779, 7), (49780, 8), (49778, 9), (71310, 10), (49782, 11), (49783, 12), (49784, 13)) v(id, d)
 where p.id = v.id and p.team = 'Duke';
-- Furman: 0.86 reality, known 0.65, weight 0.49; starters Jaxson Bell, Cole Bowser, Charles Johnston, Marcus Kell, Jordan Butler -> Charles Johnston, Jaxson Bell, Cole Bowser, Marcus Kell, Jordan Butler
update players p set depth_order = v.d, depth_set_at = now() from (values (92771, 1), (78386, 2), (78387, 3), (78385, 4), (78393, 5), (78389, 6), (78381, 7), (78388, 8), (78394, 9), (78391, 10), (78390, 11), (78383, 12), (78384, 13), (78382, 14), (78392, 15), (78395, 16)) v(id, d)
 where p.id = v.id and p.team = 'Furman';
-- Georgetown: 0.69 reality, known 0.66, weight 0.44; starters Jaland Lowe, Vyctorius Miller, Caleb Williams, NJ Benson, Vince Iwuchukwu -> Jaland Lowe, Vince Iwuchukwu, Vyctorius Miller, NJ Benson, Caleb Williams
update players p set depth_order = v.d, depth_set_at = now() from (values (50514, 1), (72093, 2), (50515, 3), (60539, 4), (50517, 5), (50519, 6), (50516, 7), (50520, 8), (50518, 9), (50523, 10), (50522, 11), (50521, 12), (72088, 13), (92773, 14), (92772, 15), (50524, 16)) v(id, d)
 where p.id = v.id and p.team = 'Georgetown';
-- Incarnate Word: 0.61 reality, known 0.21, weight 0.63; starters Brandon McCreesh, Ismail Habib, D'Arrae Goodwin, Kaleb Spencer, Drew Barbee -> Brandon McCreesh, D'Arrae Goodwin, Ismail Habib, Mekhi Connor, Drew Barbee
update players p set depth_order = v.d, depth_set_at = now() from (values (92663, 1), (92665, 2), (92664, 3), (92672, 4), (92667, 5), (92666, 6), (92674, 7), (92670, 8), (92671, 9), (92668, 10), (92669, 11), (92677, 12), (92673, 13), (92675, 14), (92676, 15)) v(id, d)
 where p.id = v.id and p.team = 'Incarnate Word';
-- Michigan State: 0.87 reality, known 0.77, weight 0.46; starters Jeremy Fears Jr., Jasiah Jervis, Jordan Scott, Coen Carr, Anton Bonke -> Coen Carr, Jeremy Fears Jr., Jordan Scott, Jasiah Jervis, Anton Bonke
update players p set depth_order = v.d, depth_set_at = now() from (values (50029, 1), (50026, 2), (50028, 3), (50027, 4), (50030, 5), (50035, 6), (50031, 7), (50032, 8), (50036, 9), (50037, 10), (50033, 11), (50034, 12), (92774, 13), (92775, 14), (92776, 15)) v(id, d)
 where p.id = v.id and p.team = 'Michigan State';
-- Murray State: 0.74 reality, known 0.57, weight 0.49; starters Kaden Magwood, Christian Jones, Pavle Nikolic, Brigham Rogers, Shon Tupuola -> Brigham Rogers, Christian Jones, Pavle Nikolic, Shon Tupuola, Kaden Magwood
update players p set depth_order = v.d, depth_set_at = now() from (values (85992, 1), (85989, 2), (85984, 3), (85991, 4), (85996, 5), (85990, 6), (85993, 7), (85986, 8), (85994, 9), (85983, 10), (85995, 11), (85987, 12), (85988, 13), (85982, 14), (85985, 15)) v(id, d)
 where p.id = v.id and p.team = 'Murray State';
-- Ohio State: 0.77 reality, known 0.52, weight 0.51; starters Jimmie Williams, John Mobley Jr., Anthony Thompson, Amare Bynum, Josh Ojanwuna -> John Mobley Jr., Amare Bynum, Anthony Thompson, Curtis Givens, Ivan Njegovan
update players p set depth_order = v.d, depth_set_at = now() from (values (50117, 1), (50119, 2), (50118, 3), (50122, 4), (50124, 5), (50116, 6), (50120, 7), (50121, 8), (71664, 9), (50123, 10), (50125, 11), (71674, 12), (50126, 13), (50127, 14)) v(id, d)
 where p.id = v.id and p.team = 'Ohio State';
-- UNLV: 0.74 reality, known 0.56, weight 0.49; starters Terrance Ford Jr., AJ Storr, MJ Thomas, Tyrin Jones, Jeremy Foumena -> Tyrin Jones, Terrance Ford Jr., AJ Storr, MJ Thomas, Jeremy Foumena
update players p set depth_order = v.d, depth_set_at = now() from (values (77835, 1), (77834, 2), (77837, 3), (77836, 4), (77844, 5), (77839, 6), (77841, 7), (77832, 8), (77833, 9), (77843, 10), (77845, 11), (77840, 12), (77838, 13), (77842, 14)) v(id, d)
 where p.id = v.id and p.team = 'UNLV';
-- Utah: 0.69 reality, known 0.35, weight 0.57; starters Noam Yaacov, Trey Campbell, Taison Chatman, Lucas Langarita, Jackson Holcombe -> Noam Yaacov, Trey Campbell, Taison Chatman, Jackson Holcombe, Alec Anigbata
update players p set depth_order = v.d, depth_set_at = now() from (values (50419, 1), (92770, 2), (50420, 3), (50422, 4), (50426, 5), (50421, 6), (50424, 7), (50427, 8), (50423, 9), (50430, 10), (50425, 11), (50428, 12), (50434, 13), (50432, 14), (50431, 15), (50433, 16), (50429, 17)) v(id, d)
 where p.id = v.id and p.team = 'Utah';
-- Wake Forest: 0.78 reality, known 0.39, weight 0.58; starters Kevair Kennedy, Justin Ray, Lukas Bojovic, Gavin Placide, Justin Abson -> Kevair Kennedy, Gavin Placide, Xander Pintelon, Isaac Carr, Jamari McDowell
update players p set depth_order = v.d, depth_set_at = now() from (values (49891, 1), (49894, 2), (49895, 3), (49897, 4), (49893, 5), (49892, 6), (71432, 7), (49898, 8), (69920, 9), (49896, 10), (92777, 11), (49899, 12), (92778, 13), (49900, 14)) v(id, d)
 where p.id = v.id and p.team = 'Wake Forest';
-- Wichita State: 0.61 reality, known 0.83, weight 0.36; starters Jordan Frison, Kenyon Giles, Jahari Long, Dillon Battie, Will Berg -> Kenyon Giles, Will Berg, Jahari Long, Dillon Battie, Jordan Frison
update players p set depth_order = v.d, depth_set_at = now() from (values (72724, 1), (68159, 2), (68156, 3), (68158, 4), (68155, 5), (68157, 6), (72729, 7), (68160, 8), (68162, 9), (68161, 10), (68154, 11), (68165, 12), (92780, 13), (68163, 14), (68164, 15), (72737, 16)) v(id, d)
 where p.id = v.id and p.team = 'Wichita State';
-- Xavier: 0.75 reality, known 0.52, weight 0.51; starters Chance Westrey, Tru Washington, Gabriel Pozzato, Jovan Miliecevic, Michael Nwoko -> Tru Washington, Jovan Miliecevic, Michael Nwoko, Chance Westrey, Ruben Dominguez
update players p set depth_order = v.d, depth_set_at = now() from (values (50565, 1), (50567, 2), (50568, 3), (50564, 4), (50570, 5), (50569, 6), (50566, 7), (50573, 8), (50571, 9), (72152, 10), (50577, 11), (50575, 12), (50578, 13), (50574, 14), (50576, 15), (50579, 16)) v(id, d)
 where p.id = v.id and p.team = 'Xavier';
commit;
