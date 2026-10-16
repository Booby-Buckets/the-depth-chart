-- Wisconsin: Braeden Carrington is on uwbadgers.com's 2026-27 roster (Gr., G, 6-5, returner: 8.3 ppg / 18 mpg in 2025-26)
-- but missing from the site, so nothing links to his page. Added at depth 15 (after the current 14) with his ESPN id
-- (5105820) so his history and stats attach. Wisconsin is a SHEET team: add him to Wisconsin's block in the Google Sheet
-- too, or the next sync removes him. Safe to re-run. Then in the owner console: 🔁 Rebuild projections.
insert into players (name, team, position, class_year, yr, height, hometown,
  espn_id, depth_order, starter, is_addition, is_international, is_injured)
select 'Braeden Carrington', 'Wisconsin', 'SG', 'Gr.', 'Gr.', '6-5', null, 5105820, 15, false, false, false, false
where not exists (select 1 from players p where p.name = 'Braeden Carrington' and p.team = 'Wisconsin');
select name, position, class_year, espn_id, depth_order from players where team = 'Wisconsin' order by depth_order;
