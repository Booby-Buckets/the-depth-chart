-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Michigan: 1.53 reality, known 0.49, weight 0.38; starters Elliot Cadeau, Brandon McCoy Jr., Trey Mckenney, JP Estrella, Moustapha Thiam -> Elliot Cadeau, Brandon McCoy Jr., Trey Mckenney, JP Estrella, Moustapha Thiam
update players p set depth_order = v.d, depth_set_at = now() from (values (49988, 1), (49989, 2), (49990, 3), (49991, 4), (49992, 5), (49994, 6), (49995, 7), (49996, 8), (64203, 9), (49997, 10), (49998, 11), (49999, 12), (50001, 13), (50000, 14), (93076, 15), (93077, 16), (93078, 17)) v(id, d)
 where p.id = v.id and p.team = 'Michigan';
commit;
