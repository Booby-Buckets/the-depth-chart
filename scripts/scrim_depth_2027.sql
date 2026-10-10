-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Furman: 0.91 reality, known 0.65, weight 0.51; starters Jaxson Bell, Cole Bowser, Charles Johnston, Marcus Kell, Jordan Butler -> Charles Johnston, Jaxson Bell, Cole Bowser, Marcus Kell, Abijah Franklin
update players p set depth_order = v.d, depth_set_at = now() from (values (92771, 1), (78386, 2), (78387, 3), (78385, 4), (78389, 5), (78381, 6), (78388, 7), (78394, 8), (78393, 9), (78391, 10), (78390, 11), (78383, 12), (78384, 13), (78382, 14), (78392, 15), (78395, 16)) v(id, d)
 where p.id = v.id and p.team = 'Furman';
-- Georgetown: 0.71 reality, known 0.66, weight 0.44; starters Jaland Lowe, Vyctorius Miller, Caleb Williams, NJ Benson, Vince Iwuchukwu -> Jaland Lowe, Vince Iwuchukwu, Vyctorius Miller, NJ Benson, Caleb Williams
update players p set depth_order = v.d, depth_set_at = now() from (values (50514, 1), (72093, 2), (50515, 3), (60539, 4), (50517, 5), (50516, 6), (50519, 7), (50520, 8), (50518, 9), (50523, 10), (50522, 11), (50521, 12), (72088, 13), (92773, 14), (92772, 15), (50524, 16)) v(id, d)
 where p.id = v.id and p.team = 'Georgetown';
-- Incarnate Word: 0.70 reality, known 0.21, weight 0.66; starters Brandon McCreesh, Ismail Habib, D'Arrae Goodwin, Kaleb Spencer, Drew Barbee -> Brandon McCreesh, D'Arrae Goodwin, Ismail Habib, Mekhi Connor, Drew Barbee
update players p set depth_order = v.d, depth_set_at = now() from (values (92663, 1), (92665, 2), (92664, 3), (92672, 4), (92667, 5), (92666, 6), (92674, 7), (92671, 8), (92670, 9), (92668, 10), (92669, 11), (92677, 12), (92673, 13), (92675, 14), (92676, 15)) v(id, d)
 where p.id = v.id and p.team = 'Incarnate Word';
-- UNLV: 0.82 reality, known 0.56, weight 0.51; starters Terrance Ford Jr., AJ Storr, MJ Thomas, Tyrin Jones, Jeremy Foumena -> Tyrin Jones, Terrance Ford Jr., AJ Storr, Sebastian Mack, MJ Thomas
update players p set depth_order = v.d, depth_set_at = now() from (values (77835, 1), (77834, 2), (77837, 3), (77839, 4), (77836, 5), (77841, 6), (77844, 7), (77832, 8), (77833, 9), (77843, 10), (77845, 11), (77840, 12), (77838, 13), (77842, 14)) v(id, d)
 where p.id = v.id and p.team = 'UNLV';
-- Utah: 0.78 reality, known 0.35, weight 0.60; starters Noam Yaacov, Trey Campbell, Taison Chatman, Lucas Langarita, Jackson Holcombe -> Noam Yaacov, Trey Campbell, Taison Chatman, Jackson Holcombe, Alec Anigbata
update players p set depth_order = v.d, depth_set_at = now() from (values (50419, 1), (92770, 2), (50420, 3), (50422, 4), (50426, 5), (50424, 6), (50421, 7), (50427, 8), (50423, 9), (50430, 10), (50425, 11), (50428, 12), (50434, 13), (50432, 14), (50431, 15), (50433, 16), (50429, 17)) v(id, d)
 where p.id = v.id and p.team = 'Utah';
-- Xavier: 0.80 reality, known 0.52, weight 0.52; starters Chance Westrey, Tru Washington, Gabriel Pozzato, Jovan Miliecevic, Michael Nwoko -> Tru Washington, Jovan Miliecevic, Michael Nwoko, Chance Westrey, Ruben Dominguez
update players p set depth_order = v.d, depth_set_at = now() from (values (50565, 1), (50567, 2), (50568, 3), (50564, 4), (50570, 5), (50569, 6), (50566, 7), (50573, 8), (72152, 9), (50571, 10), (50577, 11), (50575, 12), (50578, 13), (50574, 14), (50576, 15), (50579, 16)) v(id, d)
 where p.id = v.id and p.team = 'Xavier';
commit;
