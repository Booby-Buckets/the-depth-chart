-- ============================================================================
--  MAKE THE COMP CODES WORK — one file, run the whole thing in the Supabase SQL editor.
--  Safe to run as many times as you like. Replaces running promo_codes_comp_2026.sql +
--  fix_profiles_plan_check.sql separately.
--
--  A failed redeem does NOT burn a code: the function runs in one transaction, so an
--  error rolls back the "used" flag too. The codes are still good after this runs.
-- ============================================================================

-- ── 1. profiles.plan must accept 'coach' ────────────────────────────────────
-- The old CHECK predates Coach's Tier, so granting 'coach' raised 23514 and every
-- comp code failed.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and rel.relname = 'profiles' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%plan%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
  alter table public.profiles
    add constraint profiles_plan_check
    check (plan is null or plan in ('free','premium','pro','coach'));
end $$;


-- ── 2. promo_codes can say which tier + "forever" ───────────────────────────
alter table public.promo_codes add column if not exists plan          text    not null default 'premium';
alter table public.promo_codes add column if not exists never_expires boolean not null default false;
alter table public.promo_codes add column if not exists note          text;


-- ── 3. redeem_promo ─────────────────────────────────────────────────────────
-- Same as before, plus: if the account has no profiles row the plan update hit zero rows,
-- the function still said "ok" and the code was burned for nothing. Now that raises,
-- which rolls the whole redeem back and leaves the code unused.
create or replace function public.redeem_promo(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v public.promo_codes;
  v_months  int;
  v_expires timestamptz;
  v_plan    text;
  v_uid     uuid := auth.uid();
begin
  if v_uid is null then return json_build_object('ok', false, 'msg', 'Not signed in'); end if;

  select * into v from public.promo_codes
  where upper(btrim(code)) = upper(btrim(p_code))
  order by used asc                       -- a duplicate row that is still unused wins
  limit 1
  for update;
  if not found then return json_build_object('ok', false, 'msg', 'Code not found'); end if;
  if v.used    then return json_build_object('ok', false, 'msg', 'This code has already been used'); end if;

  v_plan := lower(coalesce(v.plan, 'premium'));
  if v_plan not in ('premium','pro','coach') then v_plan := 'premium'; end if;

  if coalesce(v.never_expires, false) then
    v_months := null; v_expires := null;
  else
    v_months  := case when coalesce(v.duration,'') ilike '%year%' then 12 else 1 end;
    v_expires := now() + (v_months || ' months')::interval;
  end if;

  update public.profiles set plan = v_plan, sub_expires_at = v_expires where id = v_uid;
  if not found then
    raise exception 'No profile row for this account — finish account setup, then redeem again';
  end if;
  update public.promo_codes set used = true, used_by = v_uid, used_at = now() where id = v.id;

  return json_build_object('ok', true, 'plan', v_plan, 'months', v_months,
                           'expires', v_expires, 'forever', coalesce(v.never_expires, false));
end $$;

revoke all on function public.redeem_promo(text) from public;
grant execute on function public.redeem_promo(text) to authenticated;


-- ── 4. the twelve codes (only inserts ones that are missing) ────────────────
insert into public.promo_codes (code, duration, used, plan, never_expires, note)
select c.code, 'forever', false, 'coach', true, 'comp - full access, no expiry'
from (values
    ('DEPTH-9MXW-QMBM'), ('DEPTH-3YL3-L7C9'), ('DEPTH-4MZY-4BFJ'), ('DEPTH-GGM3-Q5SF'),
    ('DEPTH-RWWE-QN5E'), ('DEPTH-DX25-48XT'), ('DEPTH-7BSG-K266'), ('DEPTH-KWHQ-PBF3'),
    ('DEPTH-D3DT-B38E'), ('DEPTH-W5GF-6JQ7'), ('DEPTH-F6DJ-2DST'), ('DEPTH-Q6EZ-6YU3')
) as c(code)
where not exists (select 1 from public.promo_codes p where upper(btrim(p.code)) = c.code);

-- Rows inserted before the plan/never_expires columns existed got the defaults
-- (premium, expiring). Make sure all twelve really are forever-coach.
update public.promo_codes
set plan = 'coach', never_expires = true, note = 'comp - full access, no expiry'
where upper(btrim(code)) in ('DEPTH-9MXW-QMBM','DEPTH-3YL3-L7C9','DEPTH-4MZY-4BFJ','DEPTH-GGM3-Q5SF',
  'DEPTH-RWWE-QN5E','DEPTH-DX25-48XT','DEPTH-7BSG-K266','DEPTH-KWHQ-PBF3',
  'DEPTH-D3DT-B38E','DEPTH-W5GF-6JQ7','DEPTH-F6DJ-2DST','DEPTH-Q6EZ-6YU3')
  and not used;


-- ── 5. VERIFY — expect 12 rows, plan = coach, never_expires = true ──────────
select code, plan, never_expires, used, used_at
from public.promo_codes
where upper(btrim(code)) like 'DEPTH-%'
order by used, code;
