-- Owner-confirmed identity (Oct 3 2026): UNC Wilmington's Tyler Nelson is the former Navy Tyler Nelson.
-- Only fires while the row is still unlinked. Run in the Supabase SQL editor.
update public.players set espn_id = 4593139 where id = 76678 and name = 'Tyler Nelson' and team = 'UNC Wilmington' and espn_id is null;
select id, name, team, espn_id from public.players where id = 76678;
-- NOT the same people (owner, Oct 3 2026) — leave unlinked: Elijah Thomas (Longwood) ≠ Eastern Washington's;
-- Mike James (Alabama State) ≠ Louisville / Vanderbilt's.
-- revert: update public.players set espn_id = null where id = 76678 and espn_id = 4593139;
