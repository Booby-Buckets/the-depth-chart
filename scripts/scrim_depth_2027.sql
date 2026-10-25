-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- James Madison: 0.71 reality, known 0.49, weight 0.22; starters Gage Lattimore, Cavan Reilly, Preston Fowler, Jacob Hogarth, Garrett Sundra -> Cavan Reilly, Gage Lattimore, Preston Fowler, Jacob Hogarth, Garrett Sundra
update players p set depth_order = v.d, depth_set_at = now() from (values (78878, 1), (78889, 2), (78877, 3), (78876, 4), (78879, 5), (78880, 6), (78881, 7), (78882, 8), (78883, 9), (78884, 10), (78890, 11), (78885, 12), (78887, 13), (78888, 14), (78886, 15)) v(id, d)
 where p.id = v.id and p.team = 'James Madison';
-- VCU: 1.47 reality, known 0.82, weight 0.30; starters Nyk Lewis, Brandon Jennings, Blake Harper, Torey Alston, Lazar Djokovic -> Nyk Lewis, Brandon Jennings, Blake Harper, Torey Alston, Lazar Djokovic
update players p set depth_order = v.d, depth_set_at = now() from (values (52995, 1), (52996, 2), (52997, 3), (52998, 4), (52999, 5), (53000, 6), (53001, 7), (53002, 8), (53003, 9), (52991, 10), (53004, 11), (52992, 12), (52993, 13), (53005, 14)) v(id, d)
 where p.id = v.id and p.team = 'VCU';
commit;
