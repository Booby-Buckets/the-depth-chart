-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Alabama: 0.58 reality, known 0.44, weight 0.20; starters Aden Holloway, Amari Allen, Qayden Samuels, Jaxon Richardson, Drew Fielder -> Aden Holloway, Amari Allen, Qayden Samuels, Jaxon Richardson, Drew Fielder
update players p set depth_order = v.d, depth_set_at = now() from (values (50594, 1), (50597, 2), (50595, 3), (50596, 4), (50598, 5), (50599, 6), (50603, 7), (50601, 8), (50600, 9), (50604, 10), (50605, 11), (50602, 12), (50607, 13), (50606, 14), (93791, 15)) v(id, d)
 where p.id = v.id and p.team = 'Alabama';
-- Belmont: 0.75 reality, known 0.56, weight 0.22; starters Jack Smiley, Jabez Jenkins, Kayden Fish, Eoin Dillon, Vincent Neugebauer -> Jack Smiley, Jabez Jenkins, Kayden Fish, Eoin Dillon, Vincent Neugebauer
update players p set depth_order = v.d, depth_set_at = now() from (values (89425, 1), (85958, 2), (85959, 3), (85961, 4), (85962, 5), (85960, 6), (85963, 7), (85964, 8), (85965, 9), (85966, 10), (85967, 11), (85968, 12), (85956, 13), (85957, 14), (89424, 15)) v(id, d)
 where p.id = v.id and p.team = 'Belmont';
-- Butler: 0.56 reality, known 0.48, weight 0.19; starters Jordan Ellerbee, Samu Adler, Eduardo Klafke, Treyson Anderson, Drayton Jones -> Jordan Ellerbee, Samu Adler, Eduardo Klafke, Treyson Anderson, Drayton Jones
update players p set depth_order = v.d, depth_set_at = now() from (values (50536, 1), (50537, 2), (50538, 3), (50539, 4), (50540, 5), (50541, 6), (50542, 7), (50543, 8), (50544, 9), (50545, 10), (50546, 11), (50547, 12), (50548, 13), (72115, 14), (93721, 15)) v(id, d)
 where p.id = v.id and p.team = 'Butler';
-- Duke: 0.71 reality, known 0.51, weight 0.22; starters John Blackwell, Cayden Boozer, Dame Sarr, Joaquim Boumtje Boumtje, Patrick Ngongba -> John Blackwell, Cayden Boozer, Dame Sarr, Joaquim Boumtje Boumtje, Patrick Ngongba
update players p set depth_order = v.d, depth_set_at = now() from (values (49774, 1), (49773, 2), (49775, 3), (49776, 4), (49777, 5), (49781, 6), (49779, 7), (49780, 8), (49778, 9), (71310, 10), (49782, 11), (49783, 12), (49784, 13), (92812, 14), (92825, 15)) v(id, d)
 where p.id = v.id and p.team = 'Duke';
-- Eastern Michigan: 0.58 reality, known 0.52, weight 0.18; starters Jabri Fitzpatrick, Emanuel Richards, Jordan Wright, Mohammad Habhab, Kaden Johnson -> Jabri Fitzpatrick, Emanuel Richards, Jordan Wright, Mohammad Habhab, Kaden Johnson
update players p set depth_order = v.d, depth_set_at = now() from (values (77447, 1), (77449, 2), (77448, 3), (77446, 4), (77454, 5), (77450, 6), (77451, 7), (77452, 8), (77453, 9), (77456, 10), (77455, 11), (77457, 12), (77458, 13), (77445, 14)) v(id, d)
 where p.id = v.id and p.team = 'Eastern Michigan';
-- Furman: 0.59 reality, known 0.65, weight 0.17; starters Jaxson Bell, Cole Bowser, Charles Johnston, Marcus Kell, Jordan Butler -> Jaxson Bell, Cole Bowser, Charles Johnston, Marcus Kell, Jordan Butler
update players p set depth_order = v.d, depth_set_at = now() from (values (78386, 1), (78387, 2), (92771, 3), (78385, 4), (78393, 5), (78394, 6), (78388, 7), (78389, 8), (78390, 9), (78391, 10), (78392, 11), (78381, 12), (78395, 13), (78384, 14), (78383, 15), (78382, 16)) v(id, d)
 where p.id = v.id and p.team = 'Furman';
-- Georgetown: 0.69 reality, known 0.66, weight 0.19; starters Jaland Lowe, Vyctorius Miller, Caleb Williams, NJ Benson, Vince Iwuchukwu -> Jaland Lowe, Vyctorius Miller, Caleb Williams, NJ Benson, Vince Iwuchukwu
update players p set depth_order = v.d, depth_set_at = now() from (values (50514, 1), (50515, 2), (50517, 3), (60539, 4), (72093, 5), (50516, 6), (50519, 7), (50520, 8), (50518, 9), (72088, 10), (50521, 11), (50522, 12), (50523, 13), (50524, 14), (92772, 15), (92773, 16)) v(id, d)
 where p.id = v.id and p.team = 'Georgetown';
-- Georgia Tech: 0.61 reality, known 0.41, weight 0.22; starters Colby Garland, Nasir Whitlock, Kayden Allen, Victor Valdes, Jackson McVey -> Nasir Whitlock, Colby Garland, Kayden Allen, Victor Valdes, Jackson McVey
update players p set depth_order = v.d, depth_set_at = now() from (values (49975, 1), (49974, 2), (49976, 3), (49977, 4), (49978, 5), (49979, 6), (49980, 7), (49981, 8), (49982, 9), (49983, 10), (49984, 11), (49985, 12), (49986, 13), (49987, 14), (93047, 15)) v(id, d)
 where p.id = v.id and p.team = 'Georgia Tech';
-- Incarnate Word: 0.53 reality, known 0.21, weight 0.24; starters Brandon McCreesh, Ismail Habib, D'Arrae Goodwin, Kaleb Spencer, Drew Barbee -> Brandon McCreesh, Ismail Habib, D'Arrae Goodwin, Kaleb Spencer, Drew Barbee
update players p set depth_order = v.d, depth_set_at = now() from (values (92663, 1), (92664, 2), (92665, 3), (92666, 4), (92667, 5), (92668, 6), (92669, 7), (92670, 8), (92671, 9), (92672, 10), (92673, 11), (92674, 12), (92675, 13), (92676, 14), (92677, 15)) v(id, d)
 where p.id = v.id and p.team = 'Incarnate Word';
-- Indiana: 0.51 reality, known 0.56, weight 0.16; starters Markus Burton, Bryce Lindsay, Jaeden Mustaf, Aiden Sherrell, Samet Yigitoglu -> Markus Burton, Bryce Lindsay, Jaeden Mustaf, Aiden Sherrell, Samet Yigitoglu
update players p set depth_order = v.d, depth_set_at = now() from (values (50140, 1), (50141, 2), (50142, 3), (50143, 4), (50144, 5), (50145, 6), (70173, 7), (50146, 8), (50147, 9), (50148, 10), (50149, 11), (50150, 12), (50151, 13), (93254, 14), (93255, 15), (93256, 16), (93257, 17)) v(id, d)
 where p.id = v.id and p.team = 'Indiana';
-- Maryland: 0.53 reality, known 0.58, weight 0.16; starters DJ Wagner, Andre Mills, Baba Oladotun, Tomislav Buljan, Pharrel Payne -> DJ Wagner, Andre Mills, Baba Oladotun, Tomislav Buljan, Pharrel Payne
update players p set depth_order = v.d, depth_set_at = now() from (values (50152, 1), (50153, 2), (50154, 3), (50155, 4), (50156, 5), (50157, 6), (50158, 7), (50159, 8), (50160, 9), (61569, 10), (50162, 11), (93274, 12), (50163, 13), (50164, 14), (50165, 15), (93272, 16), (93273, 17)) v(id, d)
 where p.id = v.id and p.team = 'Maryland';
-- Michigan State: 0.66 reality, known 0.77, weight 0.17; starters Jeremy Fears Jr., Jasiah Jervis, Jordan Scott, Coen Carr, Anton Bonke -> Jeremy Fears Jr., Jasiah Jervis, Jordan Scott, Coen Carr, Anton Bonke
update players p set depth_order = v.d, depth_set_at = now() from (values (50026, 1), (50027, 2), (50028, 3), (50029, 4), (50030, 5), (50031, 6), (50032, 7), (50033, 8), (50035, 9), (50036, 10), (50037, 11), (50034, 12), (92774, 13), (92775, 14), (92776, 15)) v(id, d)
 where p.id = v.id and p.team = 'Michigan State';
-- Michigan: 0.71 reality, known 0.49, weight 0.22; starters Elliot Cadeau, Brandon McCoy Jr., Trey Mckenney, JP Estrella, Moustapha Thiam -> Elliot Cadeau, Brandon McCoy Jr., Trey Mckenney, JP Estrella, Moustapha Thiam
update players p set depth_order = v.d, depth_set_at = now() from (values (49988, 1), (49989, 2), (49990, 3), (49991, 4), (49992, 5), (49994, 6), (49995, 7), (49996, 8), (64203, 9), (49997, 10), (49998, 11), (49999, 12), (50000, 13), (50001, 14), (93076, 15), (93077, 16), (93078, 17)) v(id, d)
 where p.id = v.id and p.team = 'Michigan';
-- Murray State: 0.54 reality, known 0.57, weight 0.17; starters Kaden Magwood, Christian Jones, Pavle Nikolic, Brigham Rogers, Shon Tupuola -> Kaden Magwood, Christian Jones, Brigham Rogers, Pavle Nikolic, Shon Tupuola
update players p set depth_order = v.d, depth_set_at = now() from (values (85996, 1), (85989, 2), (85992, 3), (85984, 4), (85991, 5), (85990, 6), (85993, 7), (85994, 8), (85995, 9), (85987, 10), (85986, 11), (85983, 12), (85982, 13), (85985, 14), (85988, 15)) v(id, d)
 where p.id = v.id and p.team = 'Murray State';
-- Nebraska: 0.59 reality, known 0.74, weight 0.15; starters Pryce Sandfort, Trevan Leonhardt, Braden Frager, Sam Orme, Boden Kapke -> Pryce Sandfort, Trevan Leonhardt, Braden Frager, Sam Orme, Boden Kapke
update players p set depth_order = v.d, depth_set_at = now() from (values (50052, 1), (50051, 2), (50053, 3), (50054, 4), (50055, 5), (50057, 6), (50058, 7), (50056, 8), (50059, 9), (71606, 10), (50064, 11), (50060, 12), (50062, 13), (50063, 14), (93154, 15)) v(id, d)
 where p.id = v.id and p.team = 'Nebraska';
-- New Mexico: 0.61 reality, known 0.55, weight 0.19; starters Uriah Tenette, Jake Hall, Tunde Vahlberg Fasasi, Federico Grani, AJ Pierre-Jerome -> Uriah Tenette, Jake Hall, Tunde Vahlberg Fasasi, Federico Grani, AJ Pierre-Jerome
update players p set depth_order = v.d, depth_set_at = now() from (values (77794, 1), (77793, 2), (77795, 3), (77799, 4), (77800, 5), (77796, 6), (77797, 7), (77798, 8), (77791, 9), (77790, 10), (77789, 11), (77792, 12), (77801, 13)) v(id, d)
 where p.id = v.id and p.team = 'New Mexico';
-- North Carolina: 0.60 reality, known 0.43, weight 0.21; starters Terrence Brown, Jarin Stevenson, Neoklis Avdalas, Matt Able, Sayon Keita -> Terrence Brown, Jarin Stevenson, Neoklis Avdalas, Matt Able, Sayon Keita
update players p set depth_order = v.d, depth_set_at = now() from (values (49800, 1), (49803, 2), (49801, 3), (49805, 4), (49806, 5), (49802, 6), (49804, 7), (58193, 8), (49807, 9), (49808, 10), (49810, 11), (49811, 12), (49809, 13), (49812, 14), (92856, 15), (92857, 16)) v(id, d)
 where p.id = v.id and p.team = 'North Carolina';
-- Ohio State: 0.82 reality, known 0.56, weight 0.23; starters John Mobley Jr., Amare Bynum, Anthony Thompson, Curtis Givens, Ivan Njegovan -> John Mobley Jr., Amare Bynum, Anthony Thompson, Curtis Givens, Ivan Njegovan
update players p set depth_order = v.d, depth_set_at = now() from (values (50117, 1), (50119, 2), (50118, 3), (50122, 4), (50124, 5), (50116, 6), (50120, 7), (50121, 8), (71664, 9), (50123, 10), (71674, 11), (50125, 12), (50126, 13), (50127, 14), (93226, 15)) v(id, d)
 where p.id = v.id and p.team = 'Ohio State';
-- Oklahoma State: 0.53 reality, known 0.56, weight 0.16; starters Kanye Clary, Kashie Natt, Luka Bogavac, Jordan Burks, Parsa Fallah -> Kanye Clary, Kashie Natt, Luka Bogavac, Jordan Burks, Parsa Fallah
update players p set depth_order = v.d, depth_set_at = now() from (values (50285, 1), (50286, 2), (50287, 3), (50288, 4), (61702, 5), (50290, 6), (50291, 7), (50289, 8), (50293, 9), (50294, 10), (50292, 11), (50295, 12), (50296, 13), (50297, 14), (50298, 15)) v(id, d)
 where p.id = v.id and p.team = 'Oklahoma State';
-- Richmond: 0.52 reality, known 0.53, weight 0.17; starters Derin Saran, Aiden Argabright, Dominick Stewart, Jamie Kaiser Jr., Amon Dorries -> Derin Saran, Aiden Argabright, Dominick Stewart, Jamie Kaiser Jr., Amon Dorries
update players p set depth_order = v.d, depth_set_at = now() from (values (53112, 1), (53113, 2), (53114, 3), (53115, 4), (53116, 5), (53118, 6), (53117, 7), (53119, 8), (53120, 9), (53105, 10), (53106, 11), (53107, 12), (53108, 13), (53109, 14), (53110, 15)) v(id, d)
 where p.id = v.id and p.team = 'Richmond';
-- Rutgers: 0.59 reality, known 0.68, weight 0.16; starters Tariq Francis, Jamichael Davis, Darin Smith Jr., Darren Buchanan, Christian Gurdak -> Tariq Francis, Jamichael Davis, Darin Smith Jr., Darren Buchanan, Christian Gurdak
update players p set depth_order = v.d, depth_set_at = now() from (values (50205, 1), (50206, 2), (50207, 3), (50208, 4), (50209, 5), (50210, 6), (50211, 7), (50212, 8), (50213, 9), (50214, 10), (50215, 11), (71759, 12), (50217, 13), (71758, 14), (50216, 15), (50218, 16), (93334, 17)) v(id, d)
 where p.id = v.id and p.team = 'Rutgers';
-- Saint Louis: 0.57 reality, known 0.74, weight 0.15; starters Trey Green, Quentin Jones, Amari McCottry, Kellen Thames, Robbie Avila -> Trey Green, Quentin Jones, Amari McCottry, Kellen Thames, Robbie Avila
update players p set depth_order = v.d, depth_set_at = now() from (values (52982, 1), (52983, 2), (52984, 3), (52987, 4), (72497, 5), (52986, 6), (52985, 7), (52988, 8), (52975, 9), (52989, 10), (52976, 11), (52990, 12), (52977, 13), (52978, 14), (52979, 15), (52980, 16)) v(id, d)
 where p.id = v.id and p.team = 'Saint Louis';
-- UNLV: 0.62 reality, known 0.56, weight 0.19; starters Terrance Ford Jr., AJ Storr, MJ Thomas, Tyrin Jones, Jeremy Foumena -> Terrance Ford Jr., AJ Storr, MJ Thomas, Tyrin Jones, Jeremy Foumena
update players p set depth_order = v.d, depth_set_at = now() from (values (77834, 1), (77837, 2), (77836, 3), (77835, 4), (77844, 5), (77838, 6), (77839, 7), (77841, 8), (77840, 9), (77842, 10), (77843, 11), (77845, 12), (77833, 13), (77832, 14)) v(id, d)
 where p.id = v.id and p.team = 'UNLV';
-- USC: 0.77 reality, known 0.63, weight 0.21; starters Rodney Rice, Alijah Arenas, Christian Collins, Jacob Cofie, Eric Reibe -> Alijah Arenas, Rodney Rice, Christian Collins, Jacob Cofie, Eric Reibe
update players p set depth_order = v.d, depth_set_at = now() from (values (50066, 1), (50065, 2), (50067, 3), (50068, 4), (50069, 5), (50070, 6), (50071, 7), (50073, 8), (50072, 9), (50074, 10), (50075, 11), (57086, 12), (50076, 13), (50077, 14)) v(id, d)
 where p.id = v.id and p.team = 'USC';
-- Villanova: 0.64 reality, known 0.48, weight 0.21; starters Darryl Simmons ll, Tyler Perkins, Devin Royale, Kwame Evans Jr., Luigi Suigo -> Darryl Simmons ll, Tyler Perkins, Devin Royale, Kwame Evans Jr., Luigi Suigo
update players p set depth_order = v.d, depth_set_at = now() from (values (61907, 1), (50492, 2), (50493, 3), (50494, 4), (50495, 5), (50496, 6), (50497, 7), (50500, 8), (50498, 9), (72059, 10), (50499, 11), (72070, 12), (72071, 13), (93659, 14)) v(id, d)
 where p.id = v.id and p.team = 'Villanova';
-- Wake Forest: 0.62 reality, known 0.40, weight 0.22; starters Kevair Kennedy, Gavin Placide, Xander Pintelon, Isaac Carr, Jamari McDowell -> Kevair Kennedy, Gavin Placide, Xander Pintelon, Isaac Carr, Jamari McDowell
update players p set depth_order = v.d, depth_set_at = now() from (values (49891, 1), (49894, 2), (49895, 3), (49897, 4), (49893, 5), (49892, 6), (71432, 7), (69920, 8), (49898, 9), (49896, 10), (92777, 11), (49899, 12), (92778, 13), (49900, 14), (92963, 15), (92965, 16)) v(id, d)
 where p.id = v.id and p.team = 'Wake Forest';
-- Xavier: 0.61 reality, known 0.42, weight 0.21; starters Tru Washington, Jovan Miliecevic, Chance Westrey, Michael Nwoko, Gabriel Pozzato -> Tru Washington, Jovan Miliecevic, Chance Westrey, Michael Nwoko, Gabriel Pozzato
update players p set depth_order = v.d, depth_set_at = now() from (values (50565, 1), (50567, 2), (50564, 3), (50568, 4), (50566, 5), (50569, 6), (50570, 7), (50573, 8), (50571, 9), (72152, 10), (50577, 11), (50575, 12), (50578, 13), (50574, 14), (50576, 15), (50579, 16), (93754, 17), (93755, 18)) v(id, d)
 where p.id = v.id and p.team = 'Xavier';
commit;
