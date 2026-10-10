-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Alabama: 0.64 reality, known 0.46, weight 0.50; starters Aden Holloway, Qayden Samuels, Jaxon Richardson, Amari Allen, Drew Fielder -> Aden Holloway, Amari Allen, Qayden Samuels, Jaxon Richardson, Drew Fielder
update players p set depth_order = v.d, depth_set_at = now() from (values (50594, 1), (50597, 2), (50595, 3), (50596, 4), (50598, 5), (50599, 6), (50603, 7), (50601, 8), (50600, 9), (50604, 10), (50605, 11), (50602, 12), (50607, 13), (50606, 14)) v(id, d)
 where p.id = v.id and p.team = 'Alabama';
-- Belmont: 0.80 reality, known 0.56, weight 0.51; starters Jack Smiley, Jabez Jenkins, Kayden Fish, Eoin Dillon, Vincent Neugebauer -> Jack Smiley, Jabez Jenkins, Eoin Dillon, Vincent Neugebauer, Isaiah West
update players p set depth_order = v.d, depth_set_at = now() from (values (89425, 1), (85958, 2), (85961, 3), (85962, 4), (85960, 5), (85963, 6), (85959, 7), (85968, 8), (85965, 9), (85966, 10), (89424, 11), (85957, 12), (85964, 13), (85956, 14), (85967, 15)) v(id, d)
 where p.id = v.id and p.team = 'Belmont';
-- Duke: 0.76 reality, known 0.59, weight 0.49; starters Cayden Boozer, John Blackwell, Dame Sarr, Joaquim Boumtje Boumtje, Patrick Ngongba -> John Blackwell, Cayden Boozer, Dame Sarr, Joaquim Boumtje Boumtje, Patrick Ngongba
update players p set depth_order = v.d, depth_set_at = now() from (values (49774, 1), (49773, 2), (49775, 3), (49776, 4), (49777, 5), (49779, 6), (49781, 7), (49780, 8), (49778, 9), (71310, 10), (49782, 11), (49783, 12), (49784, 13)) v(id, d)
 where p.id = v.id and p.team = 'Duke';
-- Furman: 0.63 reality, known 0.65, weight 0.42; starters Jaxson Bell, Cole Bowser, Charles Johnston, Marcus Kell, Jordan Butler -> Charles Johnston, Jaxson Bell, Cole Bowser, Marcus Kell, Jordan Butler
update players p set depth_order = v.d, depth_set_at = now() from (values (92771, 1), (78386, 2), (78387, 3), (78385, 4), (78393, 5), (78389, 6), (78381, 7), (78388, 8), (78394, 9), (78390, 10), (78391, 11), (78383, 12), (78384, 13), (78382, 14), (78392, 15), (78395, 16)) v(id, d)
 where p.id = v.id and p.team = 'Furman';
-- North Carolina: 0.60 reality, known 0.38, weight 0.52; starters Terrence Brown, Neoklis Avdalas, Maximo Adams, Jarin Stevenson, Alexandros Samodurov -> Terrence Brown, Jarin Stevenson, Neoklis Avdalas, Matt Able, Sayon Keita
update players p set depth_order = v.d, depth_set_at = now() from (values (49800, 1), (49803, 2), (49801, 3), (49805, 4), (49806, 5), (49802, 6), (49804, 7), (58193, 8), (49807, 9), (49808, 10), (49810, 11), (49811, 12), (49809, 13), (49812, 14)) v(id, d)
 where p.id = v.id and p.team = 'North Carolina';
-- UNLV: 0.68 reality, known 0.56, weight 0.47; starters Terrance Ford Jr., AJ Storr, MJ Thomas, Tyrin Jones, Jeremy Foumena -> Tyrin Jones, Terrance Ford Jr., AJ Storr, MJ Thomas, Jeremy Foumena
update players p set depth_order = v.d, depth_set_at = now() from (values (77835, 1), (77834, 2), (77837, 3), (77836, 4), (77844, 5), (77839, 6), (77841, 7), (77833, 8), (77832, 9), (77843, 10), (77845, 11), (77840, 12), (77838, 13), (77842, 14)) v(id, d)
 where p.id = v.id and p.team = 'UNLV';
-- Wake Forest: 0.60 reality, known 0.39, weight 0.52; starters Kevair Kennedy, Justin Ray, Lukas Bojovic, Gavin Placide, Justin Abson -> Kevair Kennedy, Gavin Placide, Xander Pintelon, Isaac Carr, Jamari McDowell
update players p set depth_order = v.d, depth_set_at = now() from (values (49891, 1), (49894, 2), (49895, 3), (49897, 4), (49893, 5), (49892, 6), (71432, 7), (69920, 8), (49898, 9), (49896, 10), (92777, 11), (49899, 12), (92778, 13), (49900, 14)) v(id, d)
 where p.id = v.id and p.team = 'Wake Forest';
-- Xavier: 0.63 reality, known 0.52, weight 0.46; starters Chance Westrey, Tru Washington, Gabriel Pozzato, Jovan Miliecevic, Michael Nwoko -> Tru Washington, Jovan Miliecevic, Chance Westrey, Michael Nwoko, Gabriel Pozzato
update players p set depth_order = v.d, depth_set_at = now() from (values (50565, 1), (50567, 2), (50564, 3), (50568, 4), (50566, 5), (50569, 6), (50570, 7), (50573, 8), (50571, 9), (72152, 10), (50577, 11), (50575, 12), (50578, 13), (50574, 14), (50576, 15), (50579, 16)) v(id, d)
 where p.id = v.id and p.team = 'Xavier';
commit;
