-- Kentucky's coaching staff were filed as players (Oct 10 2026): no class year, no height, and the
-- projection build was handing each of them a few minutes. Run in the Supabase SQL editor.
-- (Arkansas' Ilia Frolov has the same empty row but may be a real player — left alone; check the sheet.)
begin;
delete from players
where team = 'Kentucky'
  and id in (93770, 93771, 93772, 93773, 93774, 93775, 93776)   -- Mark Pope, Mark Fox, Cody Fueger, Mo Williams, Mikhail McLean, Nick Robinson, Keegan Brown
  and coalesce(yr, '') = '' and coalesce(class_year, '') = '' and height is null;
commit;

-- check: should return 0 rows
select id, name from players where team = 'Kentucky' and coalesce(yr, '') = '' and coalesce(class_year, '') = '' and height is null;
