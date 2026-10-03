-- 2026-27 head coaches the `teams` table still had wrong (2026 coaching carousel; scripts/data/coach_changes_2026.json).
-- Each update only fires if the row still holds the old value. Run in the Supabase SQL editor.
update public.teams set head_coach = 'Joe Crispin'   where name = 'Air Force' and head_coach = 'Joe Scott';
update public.teams set head_coach = 'Nevada Smith'  where name = 'Siena'     and head_coach = 'Jamion Christian';
update public.teams set head_coach = 'Eric Reveno'   where name = 'Brown'     and head_coach = 'Tyson Wheeler';
update public.teams set head_coach = 'Darion Brown'  where name = 'Nicholls'  and head_coach = 'TBD';
update public.teams set head_coach = 'Ronald Nored'  where name = 'Butler'    and head_coach = 'Ronald Norad';
select name, head_coach from public.teams where name in ('Air Force','Siena','Brown','Nicholls','Butler') order by name;
-- revert: swap the two names in each line above
