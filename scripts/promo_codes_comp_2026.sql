-- ============================================================================
--  TWELVE COMP CODES — full access (Coach's Tier), no expiry, one person each.
--  Run the whole file in the Supabase SQL editor. Safe to run as many times as you like.
--
--   DEPTH-9MXW-QMBM   DEPTH-3YL3-L7C9
--   DEPTH-4MZY-4BFJ   DEPTH-GGM3-Q5SF
--   DEPTH-RWWE-QN5E   DEPTH-DX25-48XT
--   DEPTH-7BSG-K266   DEPTH-KWHQ-PBF3
--   DEPTH-D3DT-B38E   DEPTH-W5GF-6JQ7
--   DEPTH-F6DJ-2DST   DEPTH-Q6EZ-6YU3
--
--  Recipients: create a free account, then enter the code on the Account page
--  ("Redeem Promo Code"). It grants immediately.
-- ============================================================================

-- ── 0. DIAGNOSTIC ───────────────────────────────────────────────────────────
-- If anything below fails, this output says why. Send it to me and I'll fix it in one pass.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'promo_codes'
order by ordinal_position;

select count(*) as codes_in_table from public.promo_codes;


-- ── 1. WHAT A CODE CAN GRANT ────────────────────────────────────────────────
-- The original table could only express "premium, one month" because redeem_promo
-- hardcoded both. Existing rows keep that behaviour via these defaults.
alter table public.promo_codes add column if not exists plan          text    not null default 'premium';
alter table public.promo_codes add column if not exists never_expires boolean not null default false;
alter table public.promo_codes add column if not exists note          text;


-- ── 2. THE REDEEM FUNCTION ──────────────────────────────────────────────────
-- SECURITY DEFINER so it can touch the locked promo_codes table and the plan column,
-- which users cannot. Reports back WHICH plan it granted, so the page stops claiming
-- "Premium" for every code. An unrecognised plan falls back to premium rather than
-- granting a tier the gate does not know — that would read as free.
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
    v_expires := null;                         -- nothing to renew, nothing to lapse
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


-- ── 3. THE TWELVE CODES ─────────────────────────────────────────────────────
-- No ON CONFLICT: that needs a unique index on `code`, which this table does not have,
-- and asking for one raised 42P10 and skipped the insert entirely the first time round.
-- `where not exists` is idempotent without needing any constraint.
-- If this errors on a NOT NULL column, step 0's output names it.
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


-- ── 4. VERIFY ───────────────────────────────────────────────────────────────
-- EXPECT TWELVE ROWS, plan = coach, never_expires = t, used = f.
-- Empty means the insert did not run — the error above it says why.
select code, plan, never_expires, used, used_at
from public.promo_codes
where note = 'comp - full access, no expiry'
order by code;
