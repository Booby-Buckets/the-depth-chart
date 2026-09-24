-- Comp codes: full access, no expiry.
--
-- A promo system already existed (promo_codes + the SECURITY DEFINER redeem_promo, with the
-- table locked to no client access). It could only grant ONE thing: premium, for one month,
-- both hardcoded in the function. This teaches it to grant any tier and to grant it forever,
-- then issues twelve single-use codes at the top tier.
--
-- Run the whole file in the Supabase SQL editor. Safe to re-run: the columns use IF NOT EXISTS,
-- the function is CREATE OR REPLACE, and the insert skips codes that are already there.

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
  select * into v from public.promo_codes where code = upper(btrim(p_code));
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
insert into public.promo_codes (code, plan, never_expires, note) values
  ('DEPTH-9MXW-QMBM', 'coach', true, 'comp — full access, no expiry'),
  ('DEPTH-3YL3-L7C9', 'coach', true, 'comp — full access, no expiry'),
  ('DEPTH-4MZY-4BFJ', 'coach', true, 'comp — full access, no expiry'),
  ('DEPTH-GGM3-Q5SF', 'coach', true, 'comp — full access, no expiry'),
  ('DEPTH-RWWE-QN5E', 'coach', true, 'comp — full access, no expiry'),
  ('DEPTH-DX25-48XT', 'coach', true, 'comp — full access, no expiry'),
  ('DEPTH-7BSG-K266', 'coach', true, 'comp — full access, no expiry'),
  ('DEPTH-KWHQ-PBF3', 'coach', true, 'comp — full access, no expiry'),
  ('DEPTH-D3DT-B38E', 'coach', true, 'comp — full access, no expiry'),
  ('DEPTH-W5GF-6JQ7', 'coach', true, 'comp — full access, no expiry'),
  ('DEPTH-F6DJ-2DST', 'coach', true, 'comp — full access, no expiry'),
  ('DEPTH-Q6EZ-6YU3', 'coach', true, 'comp — full access, no expiry')
on conflict (code) do nothing;

-- what you just created
select code, plan, never_expires, used, note from public.promo_codes
where note = 'comp — full access, no expiry' order by code;
