-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Alabama: 0.65 reality, known 0.44, weight 0.22; starters Aden Holloway, Amari Allen, Qayden Samuels, Jaxon Richardson, Drew Fielder -> Aden Holloway, Amari Allen, Qayden Samuels, Jaxon Richardson, Drew Fielder
update players p set depth_order = v.d, depth_set_at = now() from (values (50594, 1), (50597, 2), (50595, 3), (50596, 4), (50598, 5), (50599, 6), (50603, 7), (50601, 8), (50604, 9), (50600, 10), (50605, 11), (93791, 12), (50602, 13), (50607, 14), (50606, 15)) v(id, d)
 where p.id = v.id and p.team = 'Alabama';
-- Belmont: 0.76 reality, known 0.56, weight 0.22; starters Jack Smiley, Jabez Jenkins, Kayden Fish, Eoin Dillon, Vincent Neugebauer -> Jack Smiley, Jabez Jenkins, Vincent Neugebauer, Kayden Fish, Eoin Dillon
update players p set depth_order = v.d, depth_set_at = now() from (values (89425, 1), (85958, 2), (85962, 3), (85959, 4), (85961, 5), (85963, 6), (85960, 7), (85965, 8), (89424, 9), (85966, 10), (85964, 11), (85957, 12), (85967, 13), (85968, 14), (85956, 15)) v(id, d)
 where p.id = v.id and p.team = 'Belmont';
-- Butler: 0.58 reality, known 0.48, weight 0.19; starters Jordan Ellerbee, Samu Adler, Eduardo Klafke, Treyson Anderson, Drayton Jones -> Jordan Ellerbee, Treyson Anderson, Samu Adler, Eduardo Klafke, Drayton Jones
update players p set depth_order = v.d, depth_set_at = now() from (values (50536, 1), (50539, 2), (50537, 3), (50538, 4), (50540, 5), (50541, 6), (50542, 7), (50543, 8), (50544, 9), (50545, 10), (50546, 11), (50547, 12), (50548, 13), (72115, 14), (93721, 15)) v(id, d)
 where p.id = v.id and p.team = 'Butler';
-- Duke: 0.73 reality, known 0.51, weight 0.22; starters John Blackwell, Cayden Boozer, Dame Sarr, Joaquim Boumtje Boumtje, Patrick Ngongba -> John Blackwell, Dame Sarr, Cayden Boozer, Joaquim Boumtje Boumtje, Patrick Ngongba
update players p set depth_order = v.d, depth_set_at = now() from (values (49774, 1), (49775, 2), (49773, 3), (49776, 4), (49777, 5), (49781, 6), (49779, 7), (71310, 8), (49778, 9), (49780, 10), (49783, 11), (49782, 12), (49784, 13), (92812, 14), (92825, 15)) v(id, d)
 where p.id = v.id and p.team = 'Duke';
-- Eastern Michigan: 0.66 reality, known 0.52, weight 0.20; starters Jabri Fitzpatrick, Emanuel Richards, Jordan Wright, Mohammad Habhab, Kaden Johnson -> Mohammad Habhab, Jabri Fitzpatrick, Emanuel Richards, Jordan Wright, Kaden Johnson
update players p set depth_order = v.d, depth_set_at = now() from (values (77446, 1), (77447, 2), (77449, 3), (77448, 4), (77454, 5), (77450, 6), (77452, 7), (77445, 8), (77453, 9), (77456, 10), (77451, 11), (77455, 12), (77457, 13), (77458, 14)) v(id, d)
 where p.id = v.id and p.team = 'Eastern Michigan';
-- Furman: 0.64 reality, known 0.65, weight 0.18; starters Jaxson Bell, Cole Bowser, Charles Johnston, Marcus Kell, Jordan Butler -> Charles Johnston, Jaxson Bell, Cole Bowser, Marcus Kell, Jordan Butler
update players p set depth_order = v.d, depth_set_at = now() from (values (92771, 1), (78386, 2), (78387, 3), (78385, 4), (78393, 5), (78394, 6), (78389, 7), (78388, 8), (78390, 9), (78381, 10), (78391, 11), (78392, 12), (78395, 13), (78384, 14), (78383, 15), (78382, 16)) v(id, d)
 where p.id = v.id and p.team = 'Furman';
-- Georgetown: 0.69 reality, known 0.66, weight 0.19; starters Jaland Lowe, Vyctorius Miller, Caleb Williams, NJ Benson, Vince Iwuchukwu -> Jaland Lowe, Vince Iwuchukwu, Vyctorius Miller, Caleb Williams, NJ Benson
update players p set depth_order = v.d, depth_set_at = now() from (values (50514, 1), (72093, 2), (50515, 3), (50517, 4), (60539, 5), (50519, 6), (50516, 7), (50520, 8), (50518, 9), (72088, 10), (50521, 11), (50522, 12), (50523, 13), (50524, 14), (92772, 15), (92773, 16)) v(id, d)
 where p.id = v.id and p.team = 'Georgetown';
-- Georgia Tech: 0.61 reality, known 0.41, weight 0.22; starters Colby Garland, Nasir Whitlock, Kayden Allen, Victor Valdes, Jackson McVey -> Nasir Whitlock, Colby Garland, Kayden Allen, Victor Valdes, Jackson McVey
update players p set depth_order = v.d, depth_set_at = now() from (values (49975, 1), (49974, 2), (49976, 3), (49977, 4), (49978, 5), (49980, 6), (49981, 7), (49979, 8), (49982, 9), (49983, 10), (49984, 11), (49985, 12), (49986, 13), (49987, 14), (93047, 15)) v(id, d)
 where p.id = v.id and p.team = 'Georgia Tech';
-- Incarnate Word: 0.56 reality, known 0.21, weight 0.25; starters Brandon McCreesh, Ismail Habib, D'Arrae Goodwin, Kaleb Spencer, Drew Barbee -> Kaleb Spencer, Brandon McCreesh, Ismail Habib, D'Arrae Goodwin, Drew Barbee
update players p set depth_order = v.d, depth_set_at = now() from (values (92666, 1), (92663, 2), (92664, 3), (92665, 4), (92667, 5), (92670, 6), (92668, 7), (92669, 8), (92672, 9), (92671, 10), (92673, 11), (92674, 12), (92675, 13), (92676, 14), (92677, 15)) v(id, d)
 where p.id = v.id and p.team = 'Incarnate Word';
-- Indiana: 0.53 reality, known 0.56, weight 0.17; starters Markus Burton, Bryce Lindsay, Jaeden Mustaf, Aiden Sherrell, Samet Yigitoglu -> Markus Burton, Bryce Lindsay, Jaeden Mustaf, Samet Yigitoglu, Aiden Sherrell
update players p set depth_order = v.d, depth_set_at = now() from (values (50140, 1), (50141, 2), (50142, 3), (50144, 4), (50143, 5), (70173, 6), (50145, 7), (50146, 8), (50147, 9), (50148, 10), (50149, 11), (50150, 12), (50151, 13), (93254, 14), (93255, 15), (93256, 16), (93257, 17)) v(id, d)
 where p.id = v.id and p.team = 'Indiana';
-- Maryland: 0.55 reality, known 0.58, weight 0.17; starters DJ Wagner, Andre Mills, Baba Oladotun, Tomislav Buljan, Pharrel Payne -> Andre Mills, DJ Wagner, Tomislav Buljan, Pharrel Payne, Baba Oladotun
update players p set depth_order = v.d, depth_set_at = now() from (values (50153, 1), (50152, 2), (50155, 3), (50156, 4), (50154, 5), (50158, 6), (50157, 7), (50159, 8), (50160, 9), (61569, 10), (50162, 11), (50165, 12), (93274, 13), (50163, 14), (50164, 15), (93272, 16), (93273, 17)) v(id, d)
 where p.id = v.id and p.team = 'Maryland';
-- Michigan State: 0.69 reality, known 0.77, weight 0.17; starters Jeremy Fears Jr., Jasiah Jervis, Jordan Scott, Coen Carr, Anton Bonke -> Jeremy Fears Jr., Coen Carr, Jordan Scott, Jasiah Jervis, Anton Bonke
update players p set depth_order = v.d, depth_set_at = now() from (values (50026, 1), (50029, 2), (50028, 3), (50027, 4), (50030, 5), (50032, 6), (50031, 7), (50033, 8), (50035, 9), (50036, 10), (50037, 11), (50034, 12), (92774, 13), (92775, 14), (92776, 15)) v(id, d)
 where p.id = v.id and p.team = 'Michigan State';
-- Michigan: 0.77 reality, known 0.49, weight 0.24; starters Elliot Cadeau, Brandon McCoy Jr., Trey Mckenney, JP Estrella, Moustapha Thiam -> Elliot Cadeau, Brandon McCoy Jr., Trey Mckenney, Moustapha Thiam, JP Estrella
update players p set depth_order = v.d, depth_set_at = now() from (values (49988, 1), (49989, 2), (49990, 3), (49992, 4), (49991, 5), (49994, 6), (49995, 7), (64203, 8), (49996, 9), (49997, 10), (49998, 11), (49999, 12), (50000, 13), (50001, 14), (93076, 15), (93077, 16), (93078, 17)) v(id, d)
 where p.id = v.id and p.team = 'Michigan';
-- Murray State: 0.57 reality, known 0.57, weight 0.17; starters Kaden Magwood, Christian Jones, Pavle Nikolic, Brigham Rogers, Shon Tupuola -> Brigham Rogers, Christian Jones, Shon Tupuola, Kaden Magwood, Pavle Nikolic
update players p set depth_order = v.d, depth_set_at = now() from (values (85992, 1), (85989, 2), (85991, 3), (85996, 4), (85984, 5), (85990, 6), (85993, 7), (85994, 8), (85987, 9), (85986, 10), (85995, 11), (85983, 12), (85982, 13), (85985, 14), (85988, 15)) v(id, d)
 where p.id = v.id and p.team = 'Murray State';
-- Nebraska: 0.60 reality, known 0.74, weight 0.16; starters Pryce Sandfort, Trevan Leonhardt, Braden Frager, Sam Orme, Boden Kapke -> Pryce Sandfort, Trevan Leonhardt, Braden Frager, Sam Orme, Boden Kapke
update players p set depth_order = v.d, depth_set_at = now() from (values (50052, 1), (50051, 2), (50053, 3), (50054, 4), (50055, 5), (50058, 6), (50057, 7), (50056, 8), (50059, 9), (71606, 10), (50064, 11), (50060, 12), (50062, 13), (50063, 14), (93154, 15)) v(id, d)
 where p.id = v.id and p.team = 'Nebraska';
-- New Mexico: 0.61 reality, known 0.55, weight 0.19; starters Uriah Tenette, Jake Hall, Tunde Vahlberg Fasasi, Federico Grani, AJ Pierre-Jerome -> Uriah Tenette, Jake Hall, AJ Pierre-Jerome, Tunde Vahlberg Fasasi, Federico Grani
update players p set depth_order = v.d, depth_set_at = now() from (values (77794, 1), (77793, 2), (77800, 3), (77795, 4), (77799, 5), (77796, 6), (77797, 7), (77798, 8), (77791, 9), (77790, 10), (77789, 11), (77792, 12), (77801, 13)) v(id, d)
 where p.id = v.id and p.team = 'New Mexico';
-- North Carolina: 0.59 reality, known 0.43, weight 0.21; starters Terrence Brown, Jarin Stevenson, Neoklis Avdalas, Matt Able, Sayon Keita -> Terrence Brown, Jarin Stevenson, Neoklis Avdalas, Matt Able, Sayon Keita
update players p set depth_order = v.d, depth_set_at = now() from (values (49800, 1), (49803, 2), (49801, 3), (49805, 4), (49806, 5), (49802, 6), (49807, 7), (49804, 8), (49810, 9), (58193, 10), (49808, 11), (49811, 12), (49809, 13), (49812, 14), (92856, 15), (92857, 16)) v(id, d)
 where p.id = v.id and p.team = 'North Carolina';
-- Ohio State: 0.81 reality, known 0.56, weight 0.23; starters John Mobley Jr., Amare Bynum, Anthony Thompson, Curtis Givens, Ivan Njegovan -> John Mobley Jr., Amare Bynum, Anthony Thompson, Curtis Givens, Ivan Njegovan
update players p set depth_order = v.d, depth_set_at = now() from (values (50117, 1), (50119, 2), (50118, 3), (50122, 4), (50124, 5), (50116, 6), (50121, 7), (71664, 8), (50120, 9), (50123, 10), (71674, 11), (50125, 12), (50126, 13), (50127, 14), (93226, 15)) v(id, d)
 where p.id = v.id and p.team = 'Ohio State';
-- Oklahoma State: 0.53 reality, known 0.56, weight 0.16; starters Kanye Clary, Kashie Natt, Luka Bogavac, Jordan Burks, Parsa Fallah -> Kanye Clary, Kashie Natt, Luka Bogavac, Jordan Burks, Parsa Fallah
update players p set depth_order = v.d, depth_set_at = now() from (values (50285, 1), (50286, 2), (50287, 3), (50288, 4), (61702, 5), (50291, 6), (50290, 7), (50289, 8), (50294, 9), (50293, 10), (50292, 11), (50295, 12), (50296, 13), (50297, 14), (50298, 15)) v(id, d)
 where p.id = v.id and p.team = 'Oklahoma State';
-- Richmond: 0.53 reality, known 0.53, weight 0.17; starters Derin Saran, Aiden Argabright, Dominick Stewart, Jamie Kaiser Jr., Amon Dorries -> Derin Saran, Aiden Argabright, Jamie Kaiser Jr., Amon Dorries, Dominick Stewart
update players p set depth_order = v.d, depth_set_at = now() from (values (53112, 1), (53113, 2), (53115, 3), (53116, 4), (53114, 5), (53118, 6), (53117, 7), (53119, 8), (53120, 9), (53105, 10), (53106, 11), (53107, 12), (53108, 13), (53109, 14), (53110, 15)) v(id, d)
 where p.id = v.id and p.team = 'Richmond';
-- Rutgers: 0.64 reality, known 0.68, weight 0.17; starters Tariq Francis, Jamichael Davis, Darin Smith Jr., Darren Buchanan, Christian Gurdak -> Tariq Francis, Darin Smith Jr., Jamichael Davis, Christian Gurdak, Darren Buchanan
update players p set depth_order = v.d, depth_set_at = now() from (values (50205, 1), (50207, 2), (50206, 3), (50209, 4), (50208, 5), (50213, 6), (50210, 7), (50211, 8), (50214, 9), (50216, 10), (50212, 11), (50215, 12), (50217, 13), (71758, 14), (71759, 15), (50218, 16), (93334, 17)) v(id, d)
 where p.id = v.id and p.team = 'Rutgers';
-- Saint Louis: 0.59 reality, known 0.74, weight 0.15; starters Trey Green, Quentin Jones, Amari McCottry, Kellen Thames, Robbie Avila -> Trey Green, Quentin Jones, Amari McCottry, Robbie Avila, Kellen Thames
update players p set depth_order = v.d, depth_set_at = now() from (values (52982, 1), (52983, 2), (52984, 3), (72497, 4), (52987, 5), (52986, 6), (52985, 7), (52988, 8), (52975, 9), (52989, 10), (52976, 11), (52990, 12), (52977, 13), (52978, 14), (52979, 15), (52980, 16)) v(id, d)
 where p.id = v.id and p.team = 'Saint Louis';
-- UNLV: 0.68 reality, known 0.56, weight 0.20; starters Terrance Ford Jr., AJ Storr, MJ Thomas, Tyrin Jones, Jeremy Foumena -> Tyrin Jones, Terrance Ford Jr., AJ Storr, MJ Thomas, Jeremy Foumena
update players p set depth_order = v.d, depth_set_at = now() from (values (77835, 1), (77834, 2), (77837, 3), (77836, 4), (77844, 5), (77839, 6), (77845, 7), (77840, 8), (77841, 9), (77838, 10), (77843, 11), (77842, 12), (77832, 13), (77833, 14)) v(id, d)
 where p.id = v.id and p.team = 'UNLV';
-- USC: 0.74 reality, known 0.63, weight 0.20; starters Rodney Rice, Alijah Arenas, Christian Collins, Jacob Cofie, Eric Reibe -> Rodney Rice, Jacob Cofie, Alijah Arenas, Christian Collins, Eric Reibe
update players p set depth_order = v.d, depth_set_at = now() from (values (50065, 1), (50068, 2), (50066, 3), (50067, 4), (50069, 5), (50070, 6), (50074, 7), (50073, 8), (50072, 9), (50071, 10), (50075, 11), (57086, 12), (50076, 13), (50077, 14)) v(id, d)
 where p.id = v.id and p.team = 'USC';
-- Utah: 0.57 reality, known 0.34, weight 0.22; starters Noam Yaacov, Trey Campbell, Taison Chatman, Jackson Holcombe, Alec Anigbata -> Noam Yaacov, Trey Campbell, Taison Chatman, Jackson Holcombe, Alec Anigbata
update players p set depth_order = v.d, depth_set_at = now() from (values (50419, 1), (92770, 2), (50420, 3), (50422, 4), (50426, 5), (50421, 6), (50424, 7), (50427, 8), (50423, 9), (50430, 10), (50428, 11), (50425, 12), (50434, 13), (50432, 14), (50431, 15), (50433, 16), (50429, 17), (93581, 18)) v(id, d)
 where p.id = v.id and p.team = 'Utah';
-- Villanova: 0.70 reality, known 0.48, weight 0.22; starters Darryl Simmons ll, Tyler Perkins, Devin Royale, Kwame Evans Jr., Luigi Suigo -> Tyler Perkins, Devin Royale, Darryl Simmons ll, Kwame Evans Jr., Luigi Suigo
update players p set depth_order = v.d, depth_set_at = now() from (values (50492, 1), (50493, 2), (61907, 3), (50494, 4), (50495, 5), (50496, 6), (50497, 7), (93659, 8), (50498, 9), (50499, 10), (72070, 11), (50500, 12), (72059, 13), (72071, 14)) v(id, d)
 where p.id = v.id and p.team = 'Villanova';
-- Wake Forest: 0.62 reality, known 0.40, weight 0.22; starters Kevair Kennedy, Gavin Placide, Xander Pintelon, Isaac Carr, Jamari McDowell -> Kevair Kennedy, Gavin Placide, Xander Pintelon, Isaac Carr, Jamari McDowell
update players p set depth_order = v.d, depth_set_at = now() from (values (49891, 1), (49894, 2), (49895, 3), (49897, 4), (49893, 5), (49892, 6), (49898, 7), (71432, 8), (69920, 9), (49896, 10), (92777, 11), (49899, 12), (92778, 13), (49900, 14), (92963, 15), (92965, 16)) v(id, d)
 where p.id = v.id and p.team = 'Wake Forest';
-- Wichita State: 0.55 reality, known 0.84, weight 0.14; starters Will Berg, Kenyon Giles, Jahari Long, Dillon Battie, Jordan Frison -> Will Berg, Kenyon Giles, Jahari Long, Dillon Battie, Jordan Frison
update players p set depth_order = v.d, depth_set_at = now() from (values (68159, 1), (72724, 2), (68156, 3), (68158, 4), (68155, 5), (68157, 6), (72729, 7), (68160, 8), (68161, 9), (68162, 10), (68154, 11), (68165, 12), (68163, 13), (68164, 14), (72737, 15)) v(id, d)
 where p.id = v.id and p.team = 'Wichita State';
-- Xavier: 0.65 reality, known 0.42, weight 0.22; starters Tru Washington, Jovan Miliecevic, Chance Westrey, Michael Nwoko, Gabriel Pozzato -> Tru Washington, Jovan Miliecevic, Chance Westrey, Michael Nwoko, Gabriel Pozzato
update players p set depth_order = v.d, depth_set_at = now() from (values (50565, 1), (50567, 2), (50564, 3), (50568, 4), (50566, 5), (50570, 6), (50569, 7), (50573, 8), (72152, 9), (50577, 10), (50571, 11), (50575, 12), (50578, 13), (50574, 14), (50576, 15), (50579, 16), (93754, 17), (93755, 18)) v(id, d)
 where p.id = v.id and p.team = 'Xavier';
commit;
