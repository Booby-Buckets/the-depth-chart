-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Butler: 0.58 reality, known 0.48, weight 0.46; starters Jordan Ellerbee, Samu Adler, Eduardo Klafke, Treyson Anderson, Drayton Jones -> Jordan Ellerbee, Treyson Anderson, Drayton Jones, Samu Adler, Eduardo Klafke
update players p set depth_order = v.d, depth_set_at = now() from (values (50536, 1), (50539, 2), (50540, 3), (50537, 4), (50538, 5), (50541, 6), (50542, 7), (50543, 8), (50545, 9), (50544, 10), (50547, 11), (50546, 12), (93721, 13), (72115, 14), (50548, 15)) v(id, d)
 where p.id = v.id and p.team = 'Butler';
-- Indiana: 0.53 reality, known 0.56, weight 0.41; starters Markus Burton, Bryce Lindsay, Jaeden Mustaf, Aiden Sherrell, Samet Yigitoglu -> Bryce Lindsay, Markus Burton, Jaeden Mustaf, Samet Yigitoglu, Aiden Sherrell
update players p set depth_order = v.d, depth_set_at = now() from (values (50141, 1), (50140, 2), (50142, 3), (50144, 4), (50143, 5), (70173, 6), (50145, 7), (50146, 8), (50147, 9), (50149, 10), (50148, 11), (50151, 12), (50150, 13), (93256, 14), (93255, 15), (93254, 16), (93257, 17)) v(id, d)
 where p.id = v.id and p.team = 'Indiana';
commit;
