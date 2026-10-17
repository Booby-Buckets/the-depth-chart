-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- TCU: 0.77 reality, known 0.69, weight 0.20; starters Brock Harding, Gavin Sykes, Micah Robinson, Xavier Edmonds, Luke Bamgboye -> Brock Harding, Gavin Sykes, Micah Robinson, Xavier Edmonds, Luke Bamgboye
update players p set depth_order = v.d, depth_set_at = now() from (values (50377, 1), (50378, 2), (50380, 3), (50381, 4), (50384, 5), (50382, 6), (50385, 7), (50379, 8), (50383, 9), (50386, 10), (50387, 11), (50388, 12), (50389, 13), (93532, 14), (93518, 15)) v(id, d)
 where p.id = v.id and p.team = 'TCU';
-- Wyoming: 0.89 reality, known 0.65, weight 0.23; starters Renars Sondors, Khaden Bennett, Gavin Gores, Uriyah Rojas, Canin Jefferson -> Khaden Bennett, Renars Sondors, Gavin Gores, Uriyah Rojas, Canin Jefferson
update players p set depth_order = v.d, depth_set_at = now() from (values (94611, 1), (94610, 2), (94612, 3), (94613, 4), (94614, 5), (94615, 6), (94616, 7), (94618, 8), (94617, 9), (94619, 10), (94621, 11), (94620, 12), (94622, 13), (94623, 14), (94624, 15)) v(id, d)
 where p.id = v.id and p.team = 'Wyoming';
commit;
