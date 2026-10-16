-- Scrimmage depth charts (scripts/build_scrim_depth.py). Run in the Supabase SQL editor, then the
-- rebuild-projections job (owner console) re-projects minutes and lines from the new charts.
-- Each team's block stamps depth_set_at, so the sheet sync keeps the new order.
begin;
-- Green Bay: 0.73 reality, known 0.59, weight 0.21; starters Stewart Erhart II, Orlando Lovejoy, Marcus Hall, Henry Gruetzmacher, Maruan Cicic -> Stewart Erhart II, Orlando Lovejoy, Marcus Hall, Henry Gruetzmacher, Maruan Cicic
update players p set depth_order = v.d, depth_set_at = now() from (values (76895, 1), (76888, 2), (76886, 3), (76885, 4), (76891, 5), (76887, 6), (76889, 7), (76890, 8), (76892, 9), (76893, 10), (76898, 11), (76899, 12), (76896, 13), (76894, 14), (76897, 15)) v(id, d)
 where p.id = v.id and p.team = 'Green Bay';
-- Omaha: 0.80 reality, known 0.57, weight 0.23; starters Grant Stubblefield, Cahmai Crosby, Chris Dockery, Isaac Ondekane, Heri Bukinga -> Grant Stubblefield, Cahmai Crosby, Chris Dockery, Isaac Ondekane, Heri Bukinga
update players p set depth_order = v.d, depth_set_at = now() from (values (78722, 1), (78726, 2), (78723, 3), (78724, 4), (78733, 5), (78725, 6), (78727, 7), (78728, 8), (78729, 9), (78730, 10), (78731, 11), (78720, 12), (78732, 13), (78719, 14), (78721, 15)) v(id, d)
 where p.id = v.id and p.team = 'Omaha';
-- Wisconsin: 0.58 reality, known 0.58, weight 0.17; starters Owen Foxwell, Trey Autry, Eian Elmer, Austin Rapp, Nolan Winter -> Owen Foxwell, Eian Elmer, Trey Autry, Nolan Winter, Austin Rapp
update players p set depth_order = v.d, depth_set_at = now() from (values (50102, 1), (50104, 2), (50103, 3), (50106, 4), (50105, 5), (50107, 6), (50108, 7), (50109, 8), (50110, 9), (50111, 10), (50114, 11), (50112, 12), (50113, 13), (50115, 14)) v(id, d)
 where p.id = v.id and p.team = 'Wisconsin';
commit;
