-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- California Baptist: 0.59 reality, known 0.48, weight 0.19; starters Ethan Duncan, Justas Stonkus, Rene D'Amelio, Nick Richart, Marko Kovac -> Ethan Duncan, Justas Stonkus, Nick Richart, Rene D'Amelio, Marko Kovac
update players p set depth_order = v.d, depth_set_at = now() from (values (76397, 1), (76399, 2), (76401, 3), (76400, 4), (76396, 5), (76398, 6), (76402, 7), (76403, 8), (76392, 9), (76393, 10), (76394, 11), (76390, 12), (76395, 13), (76391, 14), (76389, 15)) v(id, d)
 where p.id = v.id and p.team = 'California Baptist';
-- UCLA: 0.61 reality, known 0.69, weight 0.17; starters Jaylen Petty, Trent Perry, Nikola Kusturica, Eric Dailey, Xavier Booker -> Jaylen Petty, Trent Perry, Nikola Kusturica, Eric Dailey, Xavier Booker
update players p set depth_order = v.d, depth_set_at = now() from (values (50089, 1), (50090, 2), (50091, 3), (50092, 4), (50093, 5), (50094, 6), (50095, 7), (50096, 8), (50097, 9), (50098, 10), (50099, 11), (93197, 12), (50100, 13), (50101, 14)) v(id, d)
 where p.id = v.id and p.team = 'UCLA';
commit;
