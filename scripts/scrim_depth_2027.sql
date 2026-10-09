-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Alabama: 0.74 reality, known 0.46, weight 0.53; starters Aden Holloway, Qayden Samuels, Jaxon Richardson, Amari Allen, Drew Fielder -> Aden Holloway, Qayden Samuels, Jaxon Richardson, Amari Allen, Drew Fielder
update players p set depth_order = v.d, depth_set_at = now() from (values (50594, 1), (50595, 2), (50596, 3), (50597, 4), (50598, 5), (50599, 6), (50604, 7), (50603, 8), (50601, 9), (50600, 10), (50605, 11), (50602, 12), (50607, 13), (50606, 14)) v(id, d)
 where p.id = v.id and p.team = 'Alabama';
-- Belmont: 0.79 reality, known 0.56, weight 0.50; starters Jack Smiley, Jabez Jenkins, Kayden Fish, Eoin Dillon, Vincent Neugebauer -> Jack Smiley, Jabez Jenkins, Isaiah West, Eoin Dillon, Vincent Neugebauer
update players p set depth_order = v.d, depth_set_at = now() from (values (89425, 1), (85958, 2), (85960, 3), (85961, 4), (85962, 5), (85959, 6), (85963, 7), (85968, 8), (85965, 9), (85966, 10), (89424, 11), (85957, 12), (85964, 13), (85956, 14), (85967, 15)) v(id, d)
 where p.id = v.id and p.team = 'Belmont';
-- Dayton: 0.66 reality, known 0.57, weight 0.46; starters Travis Perry, Zaide Lowery, Aidan Derkack, Grant Randall, Ameal L'etang -> Travis Perry, Zaide Lowery, Aidan Derkack, Grant Randall, Ameal L'etang
update players p set depth_order = v.d, depth_set_at = now() from (values (53013, 1), (53014, 2), (53006, 3), (53015, 4), (53016, 5), (53019, 6), (53018, 7), (53017, 8), (53010, 9), (53021, 10), (53020, 11), (53008, 12), (53007, 13), (92779, 14), (53009, 15)) v(id, d)
 where p.id = v.id and p.team = 'Dayton';
-- Duke: 0.81 reality, known 0.59, weight 0.50; starters Cayden Boozer, John Blackwell, Dame Sarr, Joaquim Boumtje Boumtje, Patrick Ngongba -> Cayden Boozer, John Blackwell, Dame Sarr, Joaquim Boumtje Boumtje, Patrick Ngongba
update players p set depth_order = v.d, depth_set_at = now() from (values (49773, 1), (49774, 2), (49775, 3), (49776, 4), (49777, 5), (49779, 6), (49780, 7), (49781, 8), (49778, 9), (71310, 10), (49782, 11), (49783, 12), (49784, 13)) v(id, d)
 where p.id = v.id and p.team = 'Duke';
-- Furman: 0.86 reality, known 0.65, weight 0.49; starters Jaxson Bell, Cole Bowser, Charles Johnston, Marcus Kell, Jordan Butler -> Jaxson Bell, Cole Bowser, Charles Johnston, Marcus Kell, Jordan Butler
update players p set depth_order = v.d, depth_set_at = now() from (values (78386, 1), (78387, 2), (92771, 3), (78385, 4), (78393, 5), (78389, 6), (78388, 7), (78381, 8), (78394, 9), (78390, 10), (78391, 11), (78383, 12), (78384, 13), (78382, 14), (78392, 15), (78395, 16)) v(id, d)
 where p.id = v.id and p.team = 'Furman';
-- Georgetown: 0.69 reality, known 0.66, weight 0.44; starters Jaland Lowe, Vyctorius Miller, Caleb Williams, NJ Benson, Vince Iwuchukwu -> Jaland Lowe, Vyctorius Miller, Caleb Williams, NJ Benson, Vince Iwuchukwu
update players p set depth_order = v.d, depth_set_at = now() from (values (50514, 1), (50515, 2), (50517, 3), (60539, 4), (72093, 5), (50519, 6), (50516, 7), (50520, 8), (50523, 9), (50518, 10), (50522, 11), (72088, 12), (50521, 13), (92772, 14), (92773, 15), (50524, 16)) v(id, d)
 where p.id = v.id and p.team = 'Georgetown';
-- Incarnate Word: 0.61 reality, known 0.21, weight 0.63; starters Brandon McCreesh, Ismail Habib, D'Arrae Goodwin, Kaleb Spencer, Drew Barbee -> Brandon McCreesh, Ismail Habib, D'Arrae Goodwin, Mekhi Connor, Drew Barbee
update players p set depth_order = v.d, depth_set_at = now() from (values (92663, 1), (92664, 2), (92665, 3), (92672, 4), (92667, 5), (92666, 6), (92674, 7), (92671, 8), (92670, 9), (92668, 10), (92669, 11), (92677, 12), (92673, 13), (92675, 14), (92676, 15)) v(id, d)
 where p.id = v.id and p.team = 'Incarnate Word';
-- Michigan State: 0.87 reality, known 0.77, weight 0.46; starters Jeremy Fears Jr., Jasiah Jervis, Jordan Scott, Coen Carr, Anton Bonke -> Jeremy Fears Jr., Jasiah Jervis, Jordan Scott, Coen Carr, Anton Bonke
update players p set depth_order = v.d, depth_set_at = now() from (values (50026, 1), (50027, 2), (50028, 3), (50029, 4), (50030, 5), (50035, 6), (50032, 7), (50031, 8), (50036, 9), (50033, 10), (50037, 11), (50034, 12), (92774, 13), (92775, 14), (92776, 15)) v(id, d)
 where p.id = v.id and p.team = 'Michigan State';
-- Murray State: 0.74 reality, known 0.57, weight 0.49; starters Kaden Magwood, Christian Jones, Pavle Nikolic, Brigham Rogers, Shon Tupuola -> Kaden Magwood, Christian Jones, Pavle Nikolic, Brigham Rogers, Shon Tupuola
update players p set depth_order = v.d, depth_set_at = now() from (values (85996, 1), (85989, 2), (85984, 3), (85992, 4), (85991, 5), (85990, 6), (85993, 7), (85986, 8), (85983, 9), (85994, 10), (85987, 11), (85995, 12), (85988, 13), (85982, 14), (85985, 15)) v(id, d)
 where p.id = v.id and p.team = 'Murray State';
-- Ohio State: 0.77 reality, known 0.52, weight 0.51; starters Jimmie Williams, John Mobley Jr., Anthony Thompson, Amare Bynum, Josh Ojanwuna -> Curtis Givens, John Mobley Jr., Anthony Thompson, Amare Bynum, Ivan Njegovan
update players p set depth_order = v.d, depth_set_at = now() from (values (50122, 1), (50117, 2), (50118, 3), (50119, 4), (50124, 5), (50116, 6), (50120, 7), (50121, 8), (71664, 9), (50123, 10), (50125, 11), (71674, 12), (50126, 13), (50127, 14)) v(id, d)
 where p.id = v.id and p.team = 'Ohio State';
-- UNLV: 0.74 reality, known 0.56, weight 0.49; starters Terrance Ford Jr., AJ Storr, MJ Thomas, Tyrin Jones, Jeremy Foumena -> Terrance Ford Jr., AJ Storr, MJ Thomas, Tyrin Jones, Jeremy Foumena
update players p set depth_order = v.d, depth_set_at = now() from (values (77834, 1), (77837, 2), (77836, 3), (77835, 4), (77844, 5), (77839, 6), (77841, 7), (77845, 8), (77833, 9), (77832, 10), (77843, 11), (77840, 12), (77838, 13), (77842, 14)) v(id, d)
 where p.id = v.id and p.team = 'UNLV';
-- Utah: 0.69 reality, known 0.35, weight 0.57; starters Noam Yaacov, Trey Campbell, Taison Chatman, Lucas Langarita, Jackson Holcombe -> Noam Yaacov, Trey Campbell, Taison Chatman, Alec Anigbata, Jackson Holcombe
update players p set depth_order = v.d, depth_set_at = now() from (values (50419, 1), (92770, 2), (50420, 3), (50426, 4), (50422, 5), (50421, 6), (50424, 7), (50427, 8), (50423, 9), (50425, 10), (50428, 11), (50430, 12), (50434, 13), (50432, 14), (50431, 15), (50433, 16), (50429, 17)) v(id, d)
 where p.id = v.id and p.team = 'Utah';
-- Wake Forest: 0.78 reality, known 0.39, weight 0.58; starters Kevair Kennedy, Justin Ray, Lukas Bojovic, Gavin Placide, Justin Abson -> Kevair Kennedy, Xander Pintelon, Jamari McDowell, Gavin Placide, Isaac Carr
update players p set depth_order = v.d, depth_set_at = now() from (values (49891, 1), (49895, 2), (49893, 3), (49894, 4), (49897, 5), (49892, 6), (71432, 7), (69920, 8), (49898, 9), (49896, 10), (92777, 11), (49899, 12), (92778, 13), (49900, 14)) v(id, d)
 where p.id = v.id and p.team = 'Wake Forest';
-- Wichita State: 0.61 reality, known 0.83, weight 0.36; starters Jordan Frison, Kenyon Giles, Jahari Long, Dillon Battie, Will Berg -> Jordan Frison, Kenyon Giles, Jahari Long, Dillon Battie, Will Berg
update players p set depth_order = v.d, depth_set_at = now() from (values (68155, 1), (72724, 2), (68156, 3), (68158, 4), (68159, 5), (68157, 6), (72729, 7), (68160, 8), (68162, 9), (68161, 10), (68154, 11), (68165, 12), (92780, 13), (68163, 14), (68164, 15), (72737, 16)) v(id, d)
 where p.id = v.id and p.team = 'Wichita State';
-- Xavier: 0.75 reality, known 0.52, weight 0.51; starters Chance Westrey, Tru Washington, Gabriel Pozzato, Jovan Miliecevic, Michael Nwoko -> Chance Westrey, Tru Washington, Ruben Dominguez, Jovan Miliecevic, Michael Nwoko
update players p set depth_order = v.d, depth_set_at = now() from (values (50564, 1), (50565, 2), (50570, 3), (50567, 4), (50568, 5), (50569, 6), (50566, 7), (50573, 8), (50571, 9), (72152, 10), (50575, 11), (50577, 12), (50574, 13), (50578, 14), (50576, 15), (50579, 16)) v(id, d)
 where p.id = v.id and p.team = 'Xavier';
commit;
