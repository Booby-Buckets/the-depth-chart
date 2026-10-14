-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Arizona: 0.53 reality, known 0.47, weight 0.18; starters Derek Dixon, Caleb Holt, Ivan Kharchenkov, RJ Godfrey, Motiejus Krivas -> Derek Dixon, Caleb Holt, Ivan Kharchenkov, RJ Godfrey, Motiejus Krivas
update players p set depth_order = v.d, depth_set_at = now() from (values (50258, 1), (50259, 2), (50260, 3), (50261, 4), (50262, 5), (50263, 6), (50264, 7), (50265, 8), (50267, 9), (50266, 10), (50268, 11), (50269, 12), (50270, 13), (93392, 14), (93393, 15), (93378, 16)) v(id, d)
 where p.id = v.id and p.team = 'Arizona';
-- San Francisco: 0.57 reality, known 0.24, weight 0.25; starters Aidan Braccia, Abdul Bashir, Ndewedo Newbury, Žiga Daneu, Ismaila Diagne -> Aidan Braccia, Abdul Bashir, Ndewedo Newbury, Žiga Daneu, Ismaila Diagne
update players p set depth_order = v.d, depth_set_at = now() from (values (79233, 1), (79231, 2), (79229, 3), (79227, 4), (79232, 5), (79230, 6), (79225, 7), (79222, 8), (79218, 9), (79223, 10), (79228, 11), (79226, 12), (79219, 13), (79224, 14), (79220, 15), (79221, 16)) v(id, d)
 where p.id = v.id and p.team = 'San Francisco';
commit;
