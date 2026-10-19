-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Indiana State: 0.83 reality, known 0.20, weight 0.34; starters Karmani Gregory, Maguire Mitchell, Jackson Cooper, Aleksa Vlajic, Alessio Calamita -> Karmani Gregory, Maguire Mitchell, Jackson Cooper, Aleksa Vlajic, Alessio Calamita
update players p set depth_order = v.d, depth_set_at = now() from (values (86047, 1), (86049, 2), (86055, 3), (86052, 4), (86056, 5), (86048, 6), (86053, 7), (86050, 8), (86051, 9), (86054, 10), (86043, 11), (86046, 12), (86042, 13), (86044, 14), (86041, 15), (86045, 16)) v(id, d)
 where p.id = v.id and p.team = 'Indiana State';
commit;
