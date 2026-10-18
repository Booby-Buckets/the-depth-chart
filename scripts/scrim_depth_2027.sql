-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Old Dominion: 0.88 reality, known 0.51, weight 0.26; starters Adante' Holiman, Bubu Benjamin, Jared Turner, Kylan Howze, Ben Nacey -> Adante' Holiman, Bubu Benjamin, Kylan Howze, Jared Turner, Ben Nacey
update players p set depth_order = v.d, depth_set_at = now() from (values (78922, 1), (78924, 2), (78928, 3), (78923, 4), (78929, 5), (78925, 6), (78926, 7), (78927, 8), (78930, 9), (78931, 10), (78932, 11), (78937, 12), (78933, 13), (78935, 14), (78936, 15), (78934, 16)) v(id, d)
 where p.id = v.id and p.team = 'Old Dominion';
-- VCU: 0.76 reality, known 0.82, weight 0.18; starters Nyk Lewis, Brandon Jennings, Blake Harper, Torey Alston, Lazar Djokovic -> Nyk Lewis, Brandon Jennings, Blake Harper, Torey Alston, Lazar Djokovic
update players p set depth_order = v.d, depth_set_at = now() from (values (52995, 1), (52996, 2), (52997, 3), (52998, 4), (52999, 5), (53000, 6), (53001, 7), (53003, 8), (53002, 9), (52991, 10), (53004, 11), (52992, 12), (52993, 13), (53005, 14)) v(id, d)
 where p.id = v.id and p.team = 'VCU';
commit;
