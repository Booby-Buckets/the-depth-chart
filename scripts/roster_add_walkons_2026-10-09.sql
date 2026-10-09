-- Walk-ons who played in 2026-27 scrimmages but were missing from our rosters (found by the scrimmage
-- roster matching, Oct 9 2026). Details from each school's official roster bio; ESPN ids are their own
-- history at the same school. All go to the end of the bench (depth = current max + 1), so no one moves.
-- Safe to re-run. The projections rebuild + rankings republish now run automatically (next run ~6:30 ET),
-- or press Rebuild projections on the owner console to apply it right away.

-- Michigan State: Matthew Watkins (Perrysburg, Ohio; walk-on, new)
insert into players (name, team, position, class_year, yr, height, hometown, espn_id, depth_order, starter, is_addition, is_international, is_injured)
select 'Matthew Watkins', 'Michigan State', 'SG', 'Sr.', 'Sr.', '6-4', null, null,
       (select coalesce(max(depth_order), 0) + 1 from players where team = 'Michigan State'), false, true, false, false
where not exists (select 1 from players p where p.team = 'Michigan State' and p.name = 'Matthew Watkins');

-- Michigan State: Brennan Walton (walk-on returner, 12 games in 2025-26)
insert into players (name, team, position, class_year, yr, height, hometown, espn_id, depth_order, starter, is_addition, is_international, is_injured)
select 'Brennan Walton', 'Michigan State', 'PF', 'R-So.', 'R-So.', '6-8', null, 5239563,
       (select coalesce(max(depth_order), 0) + 1 from players where team = 'Michigan State'), false, false, false, false
where not exists (select 1 from players p where p.team = 'Michigan State' and p.name = 'Brennan Walton');

-- Michigan State: Colin Walton (walk-on returner, 12 games in 2025-26)
insert into players (name, team, position, class_year, yr, height, hometown, espn_id, depth_order, starter, is_addition, is_international, is_injured)
select 'Colin Walton', 'Michigan State', 'PF', 'R-So.', 'R-So.', '6-8', null, 5239564,
       (select coalesce(max(depth_order), 0) + 1 from players where team = 'Michigan State'), false, false, false, false
where not exists (select 1 from players p where p.team = 'Michigan State' and p.name = 'Colin Walton');

-- Wake Forest: Vincent Ricchiuti (walk-on returner)
insert into players (name, team, position, class_year, yr, height, hometown, espn_id, depth_order, starter, is_addition, is_international, is_injured)
select 'Vincent Ricchiuti', 'Wake Forest', 'SF', 'Sr.', 'Sr.', '6-6', null, 5174580,
       (select coalesce(max(depth_order), 0) + 1 from players where team = 'Wake Forest'), false, false, false, false
where not exists (select 1 from players p where p.team = 'Wake Forest' and p.name = 'Vincent Ricchiuti');

-- Wake Forest: Anson Beard Jr. (walk-on returner, 3 games in 2025-26)
insert into players (name, team, position, class_year, yr, height, hometown, espn_id, depth_order, starter, is_addition, is_international, is_injured)
select 'Anson Beard Jr.', 'Wake Forest', 'SG', 'So.', 'So.', '6-5', null, 5312296,
       (select coalesce(max(depth_order), 0) + 1 from players where team = 'Wake Forest'), false, false, false, false
where not exists (select 1 from players p where p.team = 'Wake Forest' and p.name = 'Anson Beard Jr.');

-- Dayton: Evan Dickey (walk-on returner)
insert into players (name, team, position, class_year, yr, height, hometown, espn_id, depth_order, starter, is_addition, is_international, is_injured)
select 'Evan Dickey', 'Dayton', 'SG', 'Sr.', 'Sr.', '6-3', null, 5174575,
       (select coalesce(max(depth_order), 0) + 1 from players where team = 'Dayton'), false, false, false, false
where not exists (select 1 from players p where p.team = 'Dayton' and p.name = 'Evan Dickey');

-- Wichita State: Henry Thengvall (walk-on returner, 11 games in 2025-26)
insert into players (name, team, position, class_year, yr, height, hometown, espn_id, depth_order, starter, is_addition, is_international, is_injured)
select 'Henry Thengvall', 'Wichita State', 'PF', 'R-Sr.', 'R-Sr.', '6-7', null, 5106651,
       (select coalesce(max(depth_order), 0) + 1 from players where team = 'Wichita State'), false, false, false, false
where not exists (select 1 from players p where p.team = 'Wichita State' and p.name = 'Henry Thengvall');
