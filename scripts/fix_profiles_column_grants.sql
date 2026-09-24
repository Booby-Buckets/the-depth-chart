-- Onboarding was completely blocked: "Could not save" on the username step.
--
-- schema_rls_lockdown.sql revokes UPDATE on public.profiles and re-grants it column by column,
-- so a user cannot escalate plan/verified on their own row. Correct — but a PATCH that touches
-- even ONE ungranted column is denied ENTIRELY, and the app was sending two of them:
--
--   updated_at    welcome.html (both steps), profile.html  -> not user data at all
--   banner_color  welcome.html step 2, profile.html        -> genuinely user-editable, just missed
--
-- So step 1 (username), step 2 (team + banner) and profile editing all 403'd. This is the third
-- time this exact shape has bitten: freshman_projections was the first.
--
-- The client no longer sends updated_at (a trigger keeps it, below). This grants the columns a
-- user legitimately owns. Safe to re-run.

-- 1) the user-editable columns that were missed
do $$
declare c text;
begin
  foreach c in array array['banner_color','banner_url'] loop
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='profiles' and column_name=c) then
      execute format('grant update (%I) on public.profiles to authenticated', c);
      raise notice 'granted update(%) on profiles', c;
    end if;
  end loop;
end $$;

-- 2) updated_at maintained server-side, so no client ever has to send it (and so it is honest —
--    a client-supplied timestamp is whatever the client's clock says)
create or replace function public.touch_profiles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_profiles_updated_at();

-- 3) VERIFY — every column a signed-in user may write. Expect: avatar_url, banner_color,
--    banner_url, bio, display_name, favorite_team, freshman_projections, username.
--    plan / verified / email must NOT appear.
select column_name
from information_schema.column_privileges
where table_schema='public' and table_name='profiles'
  and grantee='authenticated' and privilege_type='UPDATE'
order by column_name;
