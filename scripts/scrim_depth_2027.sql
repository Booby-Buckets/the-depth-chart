-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Cincinnati: 1.12 reality, known 0.49, weight 0.31; starters Tylen Riley, MJ Collins, Myles Colvin, Tyler Tejada, Riley Allenspach -> Tylen Riley, MJ Collins, Tyler Tejada, Myles Colvin, Riley Allenspach
update players p set depth_order = v.d, depth_set_at = now() from (values (50405, 1), (50406, 2), (50408, 3), (50407, 4), (50409, 5), (50410, 6), (50413, 7), (50411, 8), (50412, 9), (50414, 10), (50415, 11), (50416, 12), (50417, 13), (50418, 14), (93562, 15), (93563, 16), (94687, 17)) v(id, d)
 where p.id = v.id and p.team = 'Cincinnati';
-- Drexel: 1.22 reality, known 0.53, weight 0.32; starters Josh Reed, Dillon Tingler, Panagiotis Pagonis, Martin de LaPorterie, Ralph Akuta -> Josh Reed, Dillon Tingler, Panagiotis Pagonis, Martin de LaPorterie, Ralph Akuta
update players p set depth_order = v.d, depth_set_at = now() from (values (76548, 1), (76551, 2), (76549, 3), (76550, 4), (76552, 5), (76553, 6), (76554, 7), (76555, 8), (76545, 9), (76556, 10), (76544, 11), (76543, 12), (94701, 13), (76546, 14), (76547, 15)) v(id, d)
 where p.id = v.id and p.team = 'Drexel';
-- Green Bay: 0.74 reality, known 0.60, weight 0.21; starters Stewart Erhart II, Orlando Lovejoy, Marcus Hall, Henry Gruetzmacher, Maruan Cicic -> Stewart Erhart II, Orlando Lovejoy, Marcus Hall, Henry Gruetzmacher, Maruan Cicic
update players p set depth_order = v.d, depth_set_at = now() from (values (76895, 1), (76888, 2), (76886, 3), (76885, 4), (76891, 5), (76889, 6), (76887, 7), (76890, 8), (76892, 9), (76893, 10), (76898, 11), (76899, 12), (76896, 13), (76894, 14), (76897, 15), (94719, 16), (94720, 17), (94721, 18)) v(id, d)
 where p.id = v.id and p.team = 'Green Bay';
-- Illinois State: 0.81 reality, known 0.60, weight 0.22; starters Johnny Kinziger, Deng Garang, Louie Semona, Chase Walker, Noah Cleveland -> Johnny Kinziger, Deng Garang, Louie Semona, Chase Walker, Noah Cleveland
update players p set depth_order = v.d, depth_set_at = now() from (values (86002, 1), (86003, 2), (86008, 3), (86006, 4), (86010, 5), (86005, 6), (86004, 7), (86007, 8), (86000, 9), (86009, 10), (94722, 11), (85998, 12), (85999, 13), (85997, 14), (86001, 15)) v(id, d)
 where p.id = v.id and p.team = 'Illinois State';
-- Missouri: 0.78 reality, known 0.46, weight 0.25; starters Jason Crowe Jr., Kennard Davis Jr., Jamier Jones, Bryson Tiller, Mark Mitchell -> Jason Crowe Jr., Kennard Davis Jr., Jamier Jones, Bryson Tiller, Mark Mitchell
update players p set depth_order = v.d, depth_set_at = now() from (values (50679, 1), (50680, 2), (50681, 3), (50683, 4), (67704, 5), (50684, 6), (50682, 7), (50685, 8), (50686, 9), (50687, 10), (50688, 11), (50690, 12), (50692, 13), (50689, 14), (50691, 15), (50693, 16), (94762, 17)) v(id, d)
 where p.id = v.id and p.team = 'Missouri';
-- Monmouth: 0.73 reality, known 0.30, weight 0.28; starters O'Marion Harvey, Jakai Sanders, Stefanos Spartalis, Torrey Brooks Jr., Stephen Osei -> O'Marion Harvey, Jakai Sanders, Stefanos Spartalis, Torrey Brooks Jr., Stephen Osei
update players p set depth_order = v.d, depth_set_at = now() from (values (76613, 1), (76609, 2), (76611, 3), (76605, 4), (76615, 5), (76610, 6), (76614, 7), (76612, 8), (76619, 9), (76616, 10), (76608, 11), (76617, 12), (76618, 13), (76607, 14), (76606, 15), (94763, 16), (94764, 17)) v(id, d)
 where p.id = v.id and p.team = 'Monmouth';
-- Santa Clara: 0.66 reality, known 0.68, weight 0.18; starters David Castillo, Sasha Gavalyugov, Jake Ensminger, Thierry Darlan, Sidi Gueye -> David Castillo, Sasha Gavalyugov, Jake Ensminger, Thierry Darlan, Sidi Gueye
update players p set depth_order = v.d, depth_set_at = now() from (values (79144, 1), (79145, 2), (79147, 3), (79146, 4), (79148, 5), (79149, 6), (79150, 7), (79151, 8), (79139, 9), (79140, 10), (79141, 11), (79142, 12), (94804, 13), (79143, 14), (94802, 15), (94803, 16)) v(id, d)
 where p.id = v.id and p.team = 'Santa Clara';
-- Seattle: 0.65 reality, known 0.56, weight 0.19; starters Tyler Boston, Mason Williams, Junseok Yeo, Yuto Kawashima, Halvine Dzellat -> Tyler Boston, Mason Williams, Junseok Yeo, Yuto Kawashima, Halvine Dzellat
update players p set depth_order = v.d, depth_set_at = now() from (values (79237, 1), (79240, 2), (79238, 3), (79244, 4), (79243, 5), (79239, 6), (79241, 7), (79242, 8), (79245, 9), (79248, 10), (79235, 11), (79234, 12), (79246, 13), (79247, 14), (79236, 15), (94805, 16)) v(id, d)
 where p.id = v.id and p.team = 'Seattle';
commit;
