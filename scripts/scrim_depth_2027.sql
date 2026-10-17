-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Oklahoma State: 0.53 reality, known 0.56, weight 0.16; starters Kanye Clary, Kashie Natt, Luka Bogavac, Jordan Burks, Parsa Fallah -> Kanye Clary, Luka Bogavac, Jordan Burks, Kashie Natt, Parsa Fallah
update players p set depth_order = v.d, depth_set_at = now() from (values (50285, 1), (50287, 2), (50288, 3), (50286, 4), (61702, 5), (50290, 6), (50289, 7), (50291, 8), (50293, 9), (50294, 10), (50292, 11), (50295, 12), (50296, 13), (50297, 14), (50298, 15)) v(id, d)
 where p.id = v.id and p.team = 'Oklahoma State';
-- Tennessee: 0.52 reality, known 0.50, weight 0.17; starters Dai Dai Ames, Terrence Hill Jr., Juke Harris, Jalen Haralson, Jalen Washington -> Dai Dai Ames, Terrence Hill Jr., Juke Harris, Jalen Haralson, Jalen Washington
update players p set depth_order = v.d, depth_set_at = now() from (values (50739, 1), (50740, 2), (50741, 3), (50742, 4), (50743, 5), (50744, 6), (50747, 7), (50745, 8), (50746, 9), (50748, 10), (50749, 11), (50750, 12), (50751, 13), (50752, 14), (50753, 15), (50754, 16), (93961, 17), (93962, 18)) v(id, d)
 where p.id = v.id and p.team = 'Tennessee';
-- Xavier: 1.16 reality, known 0.42, weight 0.34; starters Tru Washington, Jovan Miliecevic, Chance Westrey, Michael Nwoko, Gabriel Pozzato -> Tru Washington, Jovan Miliecevic, Chance Westrey, Michael Nwoko, Gabriel Pozzato
update players p set depth_order = v.d, depth_set_at = now() from (values (50565, 1), (50567, 2), (50564, 3), (50568, 4), (50566, 5), (50569, 6), (50570, 7), (50573, 8), (50571, 9), (72152, 10), (50574, 11), (50577, 12), (50575, 13), (50578, 14), (50576, 15), (50579, 16), (93754, 17), (93755, 18)) v(id, d)
 where p.id = v.id and p.team = 'Xavier';
commit;
