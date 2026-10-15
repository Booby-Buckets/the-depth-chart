-- Maryland: one player, two rows (owner, Oct 15 2026). "Michael McNair" (id 50158) holds his ESPN id, stats and
-- depth-chart slot; "Mike McNair, Jr." (id 93274) is an empty duplicate the Oct 10 sheet sync inserted, with the
-- right name. Keep the good row, give it the right name / class / previous school, and drop the duplicate.
-- The name matches the Sheet's spelling so the next sheet sync updates this row instead of re-adding a copy.
-- Also delete the "Michael McNair" row from the Maryland block in the Google Sheet, or the next sync recreates it.
-- Paste into the Supabase SQL editor and run.
begin;
delete from players where id = 93274 and team = 'Maryland' and name = 'Mike McNair, Jr.';
update players
   set name = 'Mike McNair, Jr.', class_year = 'Gr.', yr = 'Gr.', hometown = 'Boston University'
 where id = 50158 and team = 'Maryland' and name = 'Michael McNair';
commit;
select id, name, class_year, hometown, espn_id, depth_order from players where team = 'Maryland' and name ilike '%mcnair%';
