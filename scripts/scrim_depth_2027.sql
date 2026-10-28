-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Purdue: 2.12 reality, known 0.61, weight 0.43; starters Omer Mayer, Antione West Jr., Gicarri Harris, Caden Pierce, Daniel Jacobsen -> Omer Mayer, Gicarri Harris, Caden Pierce, Antione West Jr., Daniel Jacobsen
update players p set depth_order = v.d, depth_set_at = now() from (values (50038, 1), (50046, 2), (50040, 3), (50043, 4), (50042, 5), (50039, 6), (50044, 7), (50041, 8), (70066, 9), (50045, 10), (50048, 11), (50047, 12), (50049, 13), (50050, 14), (93137, 15), (93138, 16), (93139, 17)) v(id, d)
 where p.id = v.id and p.team = 'Purdue';
commit;
