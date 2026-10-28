-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Stetson: 0.72 reality, known 0.67, weight 0.19; starters Daniel Macgregor, Ben Gladieux, Collin Kuhl, Finley Sheridan, Alex Doyle -> Daniel Macgregor, Collin Kuhl, Ben Gladieux, Finley Sheridan, Alex Doyle
update players p set depth_order = v.d, depth_set_at = now() from (values (76072, 1), (76069, 2), (76079, 3), (76070, 4), (76073, 5), (76071, 6), (76074, 7), (76075, 8), (76076, 9), (76077, 10), (76078, 11), (76080, 12), (76066, 13), (76067, 14), (76068, 15)) v(id, d)
 where p.id = v.id and p.team = 'Stetson';
commit;
