-- ============================================================
-- player_history: whole rosters filed under the wrong school (Sept 30 2026)
-- ------------------------------------------------------------
-- The loader matched team names by prefix, so a school whose name starts another school's
-- name swallowed its roster, and 2025-26 got four more cross-wired pairs. Found by comparing
-- each player_history row against the team in his box scores (player_advanced, ESPN names):
--   2012-2025  Southern Miss            -> filed as "Southern"
--   2012-2025  Maryland Eastern Shore   -> filed as "Maryland"
--   2012-2025  St. Thomas (MN)          -> filed as "William & Mary"
--   2026       LSU                      -> filed as "Nevada-Las Vegas"  (Jalen Reece)
--   2026       St. John's               -> filed as "Providence"
--   2026       UMass Lowell             -> filed as "Mercer"
--   2026       UT Rio Grande Valley     -> filed as "Rhode Island"
-- Each row moves only when that player's box scores for that season are ALL with the other
-- school, so the real Maryland / Providence / UNLV players stay put. Run the whole file once in
-- the Supabase SQL editor.
-- ============================================================

create or replace view _tdc_team_fix as
select * from (values
  ('Southern',         'Southern Miss Golden Eagles',   'Southern Mississippi',     2010, 2025),
  ('Maryland',         'Maryland Eastern Shore Hawks',  'Maryland-Eastern Shore',   2010, 2025),
  ('William & Mary',   'St. Thomas-Minnesota Tommies',  'St. Thomas',               2010, 2025),
  ('Nevada-Las Vegas', 'LSU Tigers',                    'Louisiana State',          2026, 2026),
  ('Providence',       'St. John''s Red Storm',         'St. John''s (NY)',         2026, 2026),
  ('Mercer',           'UMass Lowell River Hawks',      'Massachusetts-Lowell',     2026, 2026),
  ('Rhode Island',     'UT Rio Grande Valley Vaqueros', 'Texas-Rio Grande Valley',  2026, 2026)
) v(wrong, espn_team, correct, y0, y1);

update player_history h
   set team = f.correct
  from _tdc_team_fix f
 where h.team = f.wrong
   and h.season_year between f.y0 and f.y1
   and exists     (select 1 from player_advanced a where a.espn_id = h.espn_id and a.season_year = h.season_year and a.team = f.espn_team)
   and not exists (select 1 from player_advanced a where a.espn_id = h.espn_id and a.season_year = h.season_year and a.team <> f.espn_team);

drop view _tdc_team_fix;

-- check: Jalen Reece's 2025-26 line should now read Louisiana State
select name, team, season_year, gp, mpg, ppg from player_history where espn_id = 5101776;
