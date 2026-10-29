-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Presbyterian: 0.65 reality, known 0.74, weight 0.17; starters Carl Parrish, Triston Wilson, Jaylen Peterson, Erik Taylor, Iverson King -> Carl Parrish, Triston Wilson, Jaylen Peterson, Erik Taylor, Iverson King
update players p set depth_order = v.d, depth_set_at = now() from (values (76306, 1), (76307, 2), (76308, 3), (76309, 4), (76310, 5), (76311, 6), (76313, 7), (76312, 8), (76314, 9), (76315, 10), (76302, 11), (76304, 12), (76305, 13), (94778, 14), (76303, 15)) v(id, d)
 where p.id = v.id and p.team = 'Presbyterian';
commit;
