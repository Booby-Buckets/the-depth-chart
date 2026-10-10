-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Nebraska: 0.64 reality, known 0.71, weight 0.40; starters Trevan Leonhardt, Pryce Sandfort, Braden Frager, Sam Orme, Boden Kapke -> Pryce Sandfort, Braden Frager, Trevan Leonhardt, Sam Orme, Boden Kapke
update players p set depth_order = v.d, depth_set_at = now() from (values (50052, 1), (50053, 2), (50051, 3), (50054, 4), (50055, 5), (50059, 6), (50057, 7), (50056, 8), (50058, 9), (50064, 10), (50062, 11), (71606, 12), (50060, 13), (50063, 14)) v(id, d)
 where p.id = v.id and p.team = 'Nebraska';
-- North Carolina: 0.70 reality, known 0.38, weight 0.56; starters Terrence Brown, Neoklis Avdalas, Maximo Adams, Jarin Stevenson, Alexandros Samodurov -> Jarin Stevenson, Terrence Brown, Neoklis Avdalas, Alexandros Samodurov, Matt Able
update players p set depth_order = v.d, depth_set_at = now() from (values (49803, 1), (49800, 2), (49801, 3), (49804, 4), (49805, 5), (49802, 6), (49806, 7), (49807, 8), (58193, 9), (49810, 10), (49811, 11), (49808, 12), (49809, 13), (49812, 14)) v(id, d)
 where p.id = v.id and p.team = 'North Carolina';
-- Saint Louis: 0.60 reality, known 0.88, weight 0.34; starters Trey Green, Quentin Jones, Amari McCottry, Kellen Thames, Robbie Avila -> Trey Green, Robbie Avila, Quentin Jones, Amari McCottry, Kellen Thames
update players p set depth_order = v.d, depth_set_at = now() from (values (52982, 1), (72497, 2), (52983, 3), (52984, 4), (52987, 5), (52986, 6), (52988, 7), (52985, 8), (52975, 9), (52989, 10), (52990, 11), (52980, 12), (52979, 13), (52978, 14), (52976, 15), (52977, 16)) v(id, d)
 where p.id = v.id and p.team = 'Saint Louis';
-- USC: 0.71 reality, known 0.63, weight 0.45; starters Rodney Rice, Alijah Arenas, Christian Collins, Jacob Cofie, Eric Reibe -> Rodney Rice, Alijah Arenas, Jacob Cofie, Christian Collins, Eric Reibe
update players p set depth_order = v.d, depth_set_at = now() from (values (50065, 1), (50066, 2), (50068, 3), (50067, 4), (50069, 5), (50073, 6), (50074, 7), (50070, 8), (50072, 9), (50071, 10), (50075, 11), (57086, 12), (50077, 13), (50076, 14)) v(id, d)
 where p.id = v.id and p.team = 'USC';
commit;
