-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Oklahoma State: 1.07 reality, known 0.56, weight 0.28; starters Kanye Clary, Kashie Natt, Luka Bogavac, Jordan Burks, Parsa Fallah -> Kanye Clary, Kashie Natt, Luka Bogavac, Jordan Burks, Parsa Fallah
update players p set depth_order = v.d, depth_set_at = now() from (values (50285, 1), (50286, 2), (50287, 3), (50288, 4), (61702, 5), (50290, 6), (50289, 7), (50291, 8), (50293, 9), (50294, 10), (50295, 11), (50292, 12), (50296, 13), (50298, 14), (50297, 15)) v(id, d)
 where p.id = v.id and p.team = 'Oklahoma State';
commit;
