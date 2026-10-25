-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Arkansas: 0.61 reality, known 0.25, weight 0.26; starters Jordan Smith, Abdou Toure, Billy Richmond, Miikka Muurinen, Cooper Bowser -> Jordan Smith, Billy Richmond, Abdou Toure, Miikka Muurinen, Cooper Bowser
update players p set depth_order = v.d, depth_set_at = now() from (values (50666, 1), (50668, 2), (50667, 3), (50669, 4), (50670, 5), (50671, 6), (50672, 7), (50674, 8), (50673, 9), (50675, 10), (72256, 11), (50677, 12), (50676, 13), (50678, 14)) v(id, d)
 where p.id = v.id and p.team = 'Arkansas';
-- Gonzaga: 0.81 reality, known 0.56, weight 0.23; starters Javon Bennett, Xaivian Lee, Davis Fogle, Braden Huff, Massamba Diop -> Javon Bennett, Xaivian Lee, Davis Fogle, Braden Huff, Massamba Diop
update players p set depth_order = v.d, depth_set_at = now() from (values (59191, 1), (63625, 2), (52889, 3), (52890, 4), (52891, 5), (59196, 6), (52892, 7), (54248, 8), (54249, 9), (52885, 10), (94546, 11), (52886, 12), (52887, 13), (94547, 14), (94548, 15)) v(id, d)
 where p.id = v.id and p.team = 'Gonzaga';
commit;
