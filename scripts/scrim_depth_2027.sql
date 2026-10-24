-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Creighton: 1.31 reality, known 0.77, weight 0.28; starters Wes Enis, Austin Swartz, Hudson Greer, Jackson McAndrew, Oswin Erhunmwunse -> Wes Enis, Austin Swartz, Hudson Greer, Jackson McAndrew, Oswin Erhunmwunse
update players p set depth_order = v.d, depth_set_at = now() from (values (50463, 1), (50464, 2), (50465, 3), (50466, 4), (50467, 5), (50468, 6), (50469, 7), (50470, 8), (60491, 9), (50471, 10), (50472, 11), (50473, 12), (50474, 13), (50475, 14), (93627, 15)) v(id, d)
 where p.id = v.id and p.team = 'Creighton';
-- Kansas State: 0.72 reality, known 0.52, weight 0.22; starters Brandon Rechsteiner, Jaden Schutt, Dez Lindsay, Isaiah Abraham, JT Rock -> Brandon Rechsteiner, Jaden Schutt, Dez Lindsay, Isaiah Abraham, JT Rock
update players p set depth_order = v.d, depth_set_at = now() from (values (50351, 1), (50352, 2), (71917, 3), (50354, 4), (50355, 5), (50356, 6), (50357, 7), (50359, 8), (50358, 9), (50360, 10), (50361, 11), (50363, 12), (50362, 13), (93488, 14)) v(id, d)
 where p.id = v.id and p.team = 'Kansas State';
-- Missouri: 0.77 reality, known 0.46, weight 0.24; starters Jason Crowe Jr., Kennard Davis Jr., Jamier Jones, Mark Mitchell, Bryson Tiller -> Jason Crowe Jr., Kennard Davis Jr., Jamier Jones, Bryson Tiller, Mark Mitchell
update players p set depth_order = v.d, depth_set_at = now() from (values (50679, 1), (50680, 2), (50681, 3), (50683, 4), (67704, 5), (50684, 6), (50682, 7), (50685, 8), (50686, 9), (50687, 10), (50688, 11), (50689, 12), (50690, 13), (50692, 14), (50691, 15), (50693, 16)) v(id, d)
 where p.id = v.id and p.team = 'Missouri';
commit;
