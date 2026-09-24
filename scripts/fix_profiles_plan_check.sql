-- profiles.plan rejects 'coach'.
--
-- Redeeming a Coach's Tier code failed with 23514 (check_violation): the CHECK constraint on
-- profiles.plan predates Coach's Tier and does not list it. The site has understood four tiers
-- for a while — tdc-gate.js ranks free < premium < pro < coach — but the column was never
-- widened to match.
--
-- This is NOT only a comp-code problem. stripe-webhook/index.ts sets plan = 'coach' for a
-- coach checkout (planKey containing "coach") and would have hit exactly the same wall, so the
-- first real Coach's Tier sale would have failed the same way. If the check also omits 'pro',
-- Pro purchases were failing too; the constraint below covers all four either way.
--
-- Run in the Supabase SQL editor. Safe to re-run.

-- 0) what the constraint says today (keep this output)
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public' and rel.relname = 'profiles' and con.contype = 'c';

-- 1) anything currently stored that the new constraint would reject (expect zero rows)
select plan, count(*) from public.profiles
where plan is not null and plan not in ('free','premium','pro','coach')
group by plan;

-- 2) replace every CHECK on profiles that mentions plan, with one that knows all four tiers
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
    raise notice 'dropped check constraint %', c.conname;
  end loop;

  execute $q$
    alter table public.profiles
      add constraint profiles_plan_check
      check (plan is null or plan in ('free','premium','pro','coach'))
  $q$;
  raise notice 'added profiles_plan_check (free, premium, pro, coach)';
end $$;

-- 3) VERIFY — expect one row: profiles_plan_check, listing all four tiers.
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public' and rel.relname = 'profiles' and con.contype = 'c';
