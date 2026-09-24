-- Comp codes: full access, no expiry.
--
-- A promo system already existed (promo_codes + the SECURITY DEFINER redeem_promo, with the
-- table locked to no client access). It could only grant ONE thing: premium, for one month,
-- both hardcoded in the function. This teaches it to grant any tier and to grant it forever,
-- then issues twelve single-use codes at the top tier.
--
-- Run the whole file in the Supabase SQL editor. Safe to re-run.
--
-- FIX 2026-09-23: the first version ended with `on conflict (code) do nothing`, which needs a
-- unique constraint on promo_codes.code. Without one Postgres raises 42P10 and the INSERT never
-- runs — the columns and the function were created, the codes were not, and redeeming returned
-- "Code not found". The insert below needs no constraint.

-- 0) what is actually in there right now (check this output if anything looks wrong)
select count(*) as total_codes, count(*) filter (where used) as used_codes from public.promo_codes;

-- 1) what a code grants. Existing rows keep today's behaviour: premium, one month.
alter table public.promo_codes add column if not exists plan          text    not null default 'premium';
alter table public.promo_codes add column if not exists never_expires boolean not null default false;
alter table public.promo_codes add column if not exists note          text;

-- 2) redeem_promo honours them, and reports back WHICH plan it granted so the page can say so
--    instead of always claiming "Premium". Unknown plan values fall back to premium rather than
--    granting something the gate does not recognise (which would read as free).
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
  select * into v from public.promo_codes where upper(btrim(code)) = upper(btrim(p_code));
  if not found then return json_build_object('ok', false, 'msg', 'Code not found'); end if;
  if v.used    then return json_build_object('ok', false, 'msg', 'This code has already been used'); end if;

  v_plan := lower(coalesce(v.plan, 'premium'));
  if v_plan not in ('premium','pro','coach') then v_plan := 'premium'; end if;

  if coalesce(v.never_expires, false) then
    v_months  := null;
    v_expires := null;                                  -- nothing to renew, nothing to lapse
  else
    v_months  := case when coalesce(v.duration,'') ilike '%year%' then 12 else 1 end;
    v_expires := now() + (v_months || ' months')::interval;
  end if;

  update public.promo_codes set used = true, used_by = v_uid, used_at = now() where id = v.id;
  update public.profiles     set plan = v_plan, sub_expires_at = v_expires where id = v_uid;

  return json_build_object('ok', true, 'plan', v_plan, 'months', v_months,
                           'expires', v_expires, 'forever', coalesce(v.never_expires, false));
end $$;
revoke all on function public.redeem_promo(text) from public;
grant execute on function public.redeem_promo(text) to authenticated;

-- 3) the codes. Single use each (redeem_promo marks `used`), so one per person.
--    NOT NULL columns the original table may have (e.g. duration) are filled explicitly.
insert into public.promo_codes (code, duration, used, plan, never_expires, note)
select c.code, 'forever', false, 'coach', true, 'comp - full access, no expiry'
from (values
    ('DEPTH-9MXW-QMBM'),
    ('DEPTH-3YL3-L7C9'),
    ('DEPTH-4MZY-4BFJ'),
    ('DEPTH-GGM3-Q5SF'),
    ('DEPTH-RWWE-QN5E'),
    ('DEPTH-DX25-48XT'),
    ('DEPTH-7BSG-K266'),
    ('DEPTH-KWHQ-PBF3'),
    ('DEPTH-D3DT-B38E'),
    ('DEPTH-W5GF-6JQ7'),
    ('DEPTH-F6DJ-2DST'),
    ('DEPTH-Q6EZ-6YU3')
) as c(code)
where not exists (
  select 1 from public.promo_codes p where upper(btrim(p.code)) = c.code
);

-- 4) VERIFY — you should see twelve rows, plan=coach, never_expires=t, used=f.
--    If this comes back empty, the insert did not run: read the error above it.
select code, plan, never_expires, used, note
from public.promo_codes
where note = 'comp - full access, no expiry'
order by code;
