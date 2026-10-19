-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- UC San Diego: 0.57 reality, known 0.71, weight 0.15; starters Rahmir Barno, Treysen Eaglestaff, Tom Beattie, Leo Beath, Dimitrije Vukicevic -> Rahmir Barno, Treysen Eaglestaff, Tom Beattie, Leo Beath, Dimitrije Vukicevic
update players p set depth_order = v.d, depth_set_at = now() from (values (76468, 1), (76472, 2), (76469, 3), (76470, 4), (76479, 5), (76476, 6), (76471, 7), (76474, 8), (76473, 9), (76475, 10), (76477, 11), (76478, 12), (76480, 13), (76481, 14), (76482, 15), (76467, 16)) v(id, d)
 where p.id = v.id and p.team = 'UC San Diego';
commit;
