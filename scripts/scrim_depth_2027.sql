-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- BYU: 0.71 reality, known 0.55, weight 0.21; starters Robert Wright, Collin Chandler, Bruce Branch, Jake Whalin, Jaxon Kohler -> Robert Wright, Collin Chandler, Bruce Branch, Jake Whalin, Jaxon Kohler
update players p set depth_order = v.d, depth_set_at = now() from (values (50245, 1), (50246, 2), (50247, 3), (50248, 4), (61660, 5), (50250, 6), (50251, 7), (50252, 8), (71810, 9), (50253, 10), (50254, 11), (71802, 12), (50255, 13), (50256, 14), (50257, 15)) v(id, d)
 where p.id = v.id and p.team = 'BYU';
-- Ball State: 0.64 reality, known 0.47, weight 0.21; starters Zaon Collins, Javion Guy-King, Mason Jones, Kai McGrew, Jaden Smith -> Zaon Collins, Javion Guy-King, Mason Jones, Kai McGrew, Jaden Smith
update players p set depth_order = v.d, depth_set_at = now() from (values (77389, 1), (77391, 2), (77388, 3), (77387, 4), (77397, 5), (77390, 6), (77392, 7), (77393, 8), (77394, 9), (77395, 10), (77396, 11), (77399, 12), (77398, 13), (77386, 14)) v(id, d)
 where p.id = v.id and p.team = 'Ball State';
-- California: 0.63 reality, known 0.50, weight 0.20; starters Jordan Ross, Michael Cooper Jr., Jake Wilkins, Dominykas Daubaris, Lee Dort -> Jordan Ross, Michael Cooper Jr., Jake Wilkins, Lee Dort, Dominykas Daubaris
update players p set depth_order = v.d, depth_set_at = now() from (values (49931, 1), (49932, 2), (49933, 3), (49935, 4), (49934, 5), (49936, 6), (49937, 7), (49938, 8), (49939, 9), (71481, 10), (49942, 11), (49943, 12), (49940, 13), (49941, 14), (49944, 15), (93011, 16), (93012, 17), (92996, 18)) v(id, d)
 where p.id = v.id and p.team = 'California';
-- Illinois State: 0.71 reality, known 0.58, weight 0.20; starters Johnny Kinziger, Deng Garang, Louie Semona, Chase Walker, Noah Cleveland -> Johnny Kinziger, Deng Garang, Louie Semona, Chase Walker, Noah Cleveland
update players p set depth_order = v.d, depth_set_at = now() from (values (86002, 1), (86003, 2), (86008, 3), (86006, 4), (86010, 5), (86005, 6), (86004, 7), (86007, 8), (86000, 9), (86009, 10), (85998, 11), (85999, 12), (85997, 13), (86001, 14)) v(id, d)
 where p.id = v.id and p.team = 'Illinois State';
-- Indiana: 1.35 reality, known 0.56, weight 0.34; starters Markus Burton, Bryce Lindsay, Jaeden Mustaf, Aiden Sherrell, Samet Yigitoglu -> Bryce Lindsay, Markus Burton, Jaeden Mustaf, Aiden Sherrell, Samet Yigitoglu
update players p set depth_order = v.d, depth_set_at = now() from (values (50141, 1), (50140, 2), (50142, 3), (50143, 4), (50144, 5), (50145, 6), (70173, 7), (50146, 8), (50147, 9), (50148, 10), (50149, 11), (50150, 12), (50151, 13), (93254, 14), (93255, 15), (93256, 16), (93257, 17)) v(id, d)
 where p.id = v.id and p.team = 'Indiana';
-- Maryland: 1.35 reality, known 0.57, weight 0.33; starters DJ Wagner, Andre Mills, Baba Oladotun, Tomislav Buljan, Pharrel Payne -> DJ Wagner, Andre Mills, Tomislav Buljan, Pharrel Payne, Baba Oladotun
update players p set depth_order = v.d, depth_set_at = now() from (values (50152, 1), (50153, 2), (50155, 3), (50156, 4), (50154, 5), (50158, 6), (50157, 7), (50159, 8), (50160, 9), (61569, 10), (50162, 11), (50163, 12), (50164, 13), (50165, 14), (93272, 15), (93273, 16)) v(id, d)
 where p.id = v.id and p.team = 'Maryland';
-- Northwestern: 0.73 reality, known 0.55, weight 0.22; starters Jake West, LA Pratt, Angelo Ciaravino, Jack Karasinski, Symon Ghai -> Jake West, LA Pratt, Angelo Ciaravino, Jack Karasinski, Symon Ghai
update players p set depth_order = v.d, depth_set_at = now() from (values (50002, 1), (50003, 2), (50004, 3), (50005, 4), (50006, 5), (50007, 6), (50009, 7), (50008, 8), (50010, 9), (50011, 10), (50012, 11), (50013, 12), (50014, 13), (93092, 14)) v(id, d)
 where p.id = v.id and p.team = 'Northwestern';
-- Santa Clara: 0.66 reality, known 0.55, weight 0.20; starters David Castillo, Sasha Gavalyugov, Thierry Darlan, Jake Ensminger, Sidi Gueye -> David Castillo, Sasha Gavalyugov, Jake Ensminger, Thierry Darlan, Sidi Gueye
update players p set depth_order = v.d, depth_set_at = now() from (values (79144, 1), (79145, 2), (79147, 3), (79146, 4), (79148, 5), (79149, 6), (79150, 7), (79151, 8), (79139, 9), (79140, 10), (79141, 11), (79142, 12), (79143, 13)) v(id, d)
 where p.id = v.id and p.team = 'Santa Clara';
commit;
