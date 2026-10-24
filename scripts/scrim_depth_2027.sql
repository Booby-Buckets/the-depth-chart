-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Florida State: 0.67 reality, known 0.35, weight 0.25; starters Anthony Robinson ll, Kameron Taylor, Shon Abaev, Sebastian Rancik, Marcus Ponder -> Anthony Robinson ll, Kameron Taylor, Shon Abaev, Sebastian Rancik, Marcus Ponder
update players p set depth_order = v.d, depth_set_at = now() from (values (49853, 1), (49854, 2), (49855, 3), (49856, 4), (49857, 5), (94626, 6), (49858, 7), (49859, 8), (49860, 9), (49861, 10), (49863, 11), (49862, 12), (49864, 13), (49865, 14), (49866, 15), (92921, 16)) v(id, d)
 where p.id = v.id and p.team = 'Florida State';
commit;
