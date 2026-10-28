-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Cincinnati: 1.16 reality, known 0.50, weight 0.32; starters Tylen Riley, MJ Collins, Myles Colvin, Tyler Tejada, Riley Allenspach -> Tylen Riley, MJ Collins, Myles Colvin, Tyler Tejada, Riley Allenspach
update players p set depth_order = v.d, depth_set_at = now() from (values (50405, 1), (50406, 2), (50407, 3), (50408, 4), (50409, 5), (50410, 6), (50411, 7), (50413, 8), (50412, 9), (50414, 10), (50415, 11), (50416, 12), (50417, 13), (50418, 14), (93562, 15), (93563, 16)) v(id, d)
 where p.id = v.id and p.team = 'Cincinnati';
commit;
