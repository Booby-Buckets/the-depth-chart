-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Kent State: 0.69 reality, known 0.43, weight 0.23; starters Chansey Willis Jr., Christian Henry, Cameron Williams, Godslove Nwabude, Latif Diouf -> Chansey Willis Jr., Christian Henry, Cameron Williams, Godslove Nwabude, Latif Diouf
update players p set depth_order = v.d, depth_set_at = now() from (values (77463, 1), (77462, 2), (77464, 3), (77467, 4), (77468, 5), (77465, 6), (77466, 7), (77469, 8), (77470, 9), (77471, 10), (77472, 11), (77459, 12), (77473, 13), (77461, 14), (77460, 15), (77474, 16)) v(id, d)
 where p.id = v.id and p.team = 'Kent State';
-- Texas Tech: 0.84 reality, known 0.49, weight 0.25; starters Cruz Davis, Donovan Atwell, DaKari Spear, Darrion Williams, JT Toppin -> Cruz Davis, Donovan Atwell, Darrion Williams, JT Toppin, DaKari Spear
update players p set depth_order = v.d, depth_set_at = now() from (values (50219, 1), (50220, 2), (50222, 3), (50231, 4), (50221, 5), (50223, 6), (50224, 7), (50225, 8), (60235, 9), (50226, 10), (50227, 11), (50228, 12), (50229, 13), (50230, 14)) v(id, d)
 where p.id = v.id and p.team = 'Texas Tech';
-- Xavier: 2.10 reality, known 0.63, weight 0.42; starters Tru Washington, Jovan Miliecevic, Chance Westrey, Michael Nwoko, Gabriel Pozzato -> Tru Washington, Jovan Miliecevic, Michael Nwoko, Chance Westrey, Gabriel Pozzato
update players p set depth_order = v.d, depth_set_at = now() from (values (50565, 1), (50567, 2), (50568, 3), (50564, 4), (50566, 5), (50569, 6), (50570, 7), (50573, 8), (50571, 9), (72152, 10), (50574, 11), (50577, 12), (50575, 13), (50578, 14), (50576, 15), (50579, 16), (93754, 17), (93755, 18)) v(id, d)
 where p.id = v.id and p.team = 'Xavier';
commit;
