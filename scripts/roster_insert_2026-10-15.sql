-- Gonzaga: the three players on gozags.com's 2026-27 roster that are missing from the site (2026-10-15).
-- From scripts/build_roster_diff.py (school roster scraped 2026-10-15), trimmed by hand:
--   * only the missing names — "Juwan Ekanga" on the school site is our "Juwan Ekanga-Ehawa" (same player), so he is NOT added;
--   * depth slots 13-15, after the existing 12-man depth chart (reorder on team.html if you want them higher).
-- Gonzaga is a SHEET team: add the same three rows to Gonzaga's block in the Google Sheet as well, or the next sheet sync's
-- departed-player cleanup deletes them again. Safe to re-run. Run in the Supabase SQL editor, then in the owner console:
-- 🔁 Rebuild projections → ⚡ Republish projected ratings.
insert into players (name, team, position, class_year, yr, height, hometown,
  espn_id, depth_order, starter, is_addition, is_international, is_injured)
select v.name, v.team, v.position, v.class_year, v.yr, v.height, v.hometown::text,
  v.espn_id::bigint, v.depth_order, v.starter, v.is_addition, v.is_international, v.is_injured from (values
  ('Nathan De Sousa', 'Gonzaga', 'SG', 'Gr.', 'Gr.', '6-3', null, null, 13, false, true, true, false),
  ('Alonzo Metz', 'Gonzaga', 'PG', 'So.', 'So.', '5-11', null, null, 14, false, true, false, false),
  ('Carter Nilson', 'Gonzaga', 'SG', 'Fr.', 'Fr.', '6-5', null, null, 15, false, true, false, false)
) as v(name, team, position, class_year, yr, height,
  hometown, espn_id, depth_order, starter, is_addition, is_international, is_injured)
where not exists (select 1 from players p where p.name = v.name and p.team = v.team);
select name, position, class_year, height, depth_order from players where team = 'Gonzaga' order by depth_order;
