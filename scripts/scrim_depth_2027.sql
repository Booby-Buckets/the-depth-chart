-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Baylor: 1.44 reality, known 0.56, weight 0.35; starters Isaac Williams IV, Kayden Mingo, Elijah Williams, Isaac Celiscar, Caden Powell -> Isaac Williams IV, Kayden Mingo, Isaac Celiscar, Elijah Williams, Caden Powell
update players p set depth_order = v.d, depth_set_at = now() from (values (50325, 1), (50326, 2), (50328, 3), (50327, 4), (50329, 5), (50330, 6), (50331, 7), (50332, 8), (50333, 9), (50334, 10), (50335, 11), (50336, 12), (50337, 13), (93470, 14), (93471, 15)) v(id, d)
 where p.id = v.id and p.team = 'Baylor';
commit;
