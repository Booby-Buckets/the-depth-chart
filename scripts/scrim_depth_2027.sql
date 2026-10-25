-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Washington State: 0.57 reality, known 0.34, weight 0.22; starters Sebastian Aikins, RJ Jones, Jaylen Harrell, Ronnie Harrison, Tyler Kropp -> Sebastian Aikins, RJ Jones, Jaylen Harrell, Ronnie Harrison, Tyler Kropp
update players p set depth_order = v.d, depth_set_at = now() from (values (52955, 1), (52956, 2), (52957, 3), (52958, 4), (52959, 5), (52960, 6), (52961, 7), (52963, 8), (52962, 9), (52952, 10), (52954, 11), (52953, 12)) v(id, d)
 where p.id = v.id and p.team = 'Washington State';
commit;
