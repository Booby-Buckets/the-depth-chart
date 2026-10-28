-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Oklahoma State: 1.79 reality, known 0.56, weight 0.40; starters Kanye Clary, Kashie Natt, Luka Bogavac, Jordan Burks, Parsa Fallah -> Kanye Clary, Kashie Natt, Luka Bogavac, Jordan Burks, Parsa Fallah
update players p set depth_order = v.d, depth_set_at = now() from (values (50285, 1), (50286, 2), (50287, 3), (50288, 4), (61702, 5), (50290, 6), (50289, 7), (50291, 8), (50293, 9), (50294, 10), (50295, 11), (50292, 12), (50298, 13), (50296, 14), (50297, 15)) v(id, d)
 where p.id = v.id and p.team = 'Oklahoma State';
-- Wisconsin: 1.10 reality, known 0.58, weight 0.29; starters Owen Foxwell, Eian Elmer, Trey Autry, Nolan Winter, Austin Rapp -> Owen Foxwell, Eian Elmer, Trey Autry, Nolan Winter, Austin Rapp
update players p set depth_order = v.d, depth_set_at = now() from (values (50102, 1), (50104, 2), (50103, 3), (50106, 4), (50105, 5), (50107, 6), (50108, 7), (50109, 8), (50110, 9), (50111, 10), (50114, 11), (94549, 12), (50112, 13), (50113, 14), (50115, 15)) v(id, d)
 where p.id = v.id and p.team = 'Wisconsin';
commit;
