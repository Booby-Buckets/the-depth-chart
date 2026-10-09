-- Players who logged real scrimmage minutes but were missing from our 2026-27 rosters (found by the
-- scrimmage Reality Meter's roster matching, Oct 9 2026). Details from each school's official roster/bio;
-- ESPN ids are their own D-I history (school-matched). Depth: they STARTED their scrimmages, so the
-- two rotation players go high and everyone below shifts down one. Re-order on the team page if needed.
-- Afterwards: owner console -> Rebuild projections -> Republish projected ratings.

-- Utah: Trey Campbell, 5th-year G 6-4, transfer from Northern Iowa (13.7 ppg / 33.5 mpg in 2025-26).
-- Started vs UNLV (26 min, 17 pts).
update players set depth_order = depth_order + 1 where team = 'Utah' and depth_order >= 2
  and not exists (select 1 from players p where p.team = 'Utah' and p.name = 'Trey Campbell');
insert into players (name, team, position, class_year, yr, height, hometown, espn_id, depth_order, starter, is_addition, is_international, is_injured)
select 'Trey Campbell', 'Utah', 'SG', 'Gr.', 'Gr.', '6-4', 'Northern Iowa', 5107887, 2, true, true, false, false
where not exists (select 1 from players p where p.team = 'Utah' and p.name = 'Trey Campbell');

-- Furman: Charles Johnston, 5th-year F 6-11, returner (9.8 ppg / 28.3 mpg in 2025-26).
-- Started vs Alabama (33 min, 16 pts).
update players set depth_order = depth_order + 1 where team = 'Furman' and depth_order >= 3
  and not exists (select 1 from players p where p.team = 'Furman' and p.name = 'Charles Johnston');
insert into players (name, team, position, class_year, yr, height, hometown, espn_id, depth_order, starter, is_addition, is_international, is_injured)
select 'Charles Johnston', 'Furman', 'PF', 'Gr.', 'Gr.', '6-11', null, 5243230, 3, true, false, true, false
where not exists (select 1 from players p where p.team = 'Furman' and p.name = 'Charles Johnston');

-- Georgetown: Mason Moses, Jr. G 6-6, returner (3 games in 2025-26). End of the bench.
insert into players (name, team, position, class_year, yr, height, hometown, espn_id, depth_order, starter, is_addition, is_international, is_injured)
select 'Mason Moses', 'Georgetown', 'SG', 'Jr.', 'Jr.', '6-6', null, 5240523,
       (select coalesce(max(depth_order), 0) + 1 from players where team = 'Georgetown'), false, false, false, false
where not exists (select 1 from players p where p.team = 'Georgetown' and p.name = 'Mason Moses');

-- Georgetown: Michael Van Raaphorst, Jr. G 6-3 (walk-on, #30; 9 games over 2024-26; 1 min vs Wake Forest). End of the bench.
insert into players (name, team, position, class_year, yr, height, hometown, espn_id, depth_order, starter, is_addition, is_international, is_injured)
select 'Michael Van Raaphorst', 'Georgetown', 'SG', 'Jr.', 'Jr.', '6-3', null, 5240525,
       (select coalesce(max(depth_order), 0) + 1 from players where team = 'Georgetown'), false, false, false, false
where not exists (select 1 from players p where p.team = 'Georgetown' and p.name = 'Michael Van Raaphorst');
