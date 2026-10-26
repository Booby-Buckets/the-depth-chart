-- TDC Bet arb alerts: storage + the every-minute trigger for api/arb-scan.js.
-- Run once in the Supabase SQL editor (safe to re-run).
--
--   arb_alert_kv     the scanner's state (seen opportunities, credits used today, push subscriptions, alert
--                    settings, its VAPID keys) + the cron key. RLS on with no policies: nobody reads it directly.
--   arb_sightings    every sure bet / no-lose middle the scanner saw, from first to last sighting (how long they
--                    last, how big they get).
--   arb_kv_get / arb_kv_set / arb_sightings_add / arb_sightings_recent
--                    the only way in: the caller passes the cron key (the scanner, which gets it from the cron job's
--                    request) or is signed in as the owner (the Arbs page). Nothing needs a service key.
--   cron job         pg_cron + pg_net call https://www.thedepthchartcbb.com/api/arb-scan every minute with the key.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.arb_alert_kv (
  k text primary key,
  v jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.arb_alert_kv enable row level security;

create table if not exists public.arb_sightings (
  id bigserial primary key,
  key text not null,
  kind text not null,            -- 'arb' | 'middle'
  sport text,
  game text,
  market text,
  legs jsonb,
  best_ret numeric,              -- arb: best guaranteed return; middle: best EV per $1
  first_ret numeric,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  commence timestamptz,
  alerted boolean not null default false
);
alter table public.arb_sightings enable row level security;
create index if not exists arb_sightings_first on public.arb_sightings (first_seen desc);

-- one random key, made here so it never leaves the database (the cron job reads it at run time)
insert into public.arb_alert_kv (k, v)
values ('cron_key', to_jsonb(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')))
on conflict (k) do nothing;

create or replace function public.arb_alert_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select (p_secret is not null and p_secret = (select v #>> '{}' from public.arb_alert_kv where k = 'cron_key'))
      or lower(coalesce(auth.jwt() ->> 'email', '')) = 'blee4824@gmail.com'
$$;

create or replace function public.arb_kv_get(p_secret text, p_keys text[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.arb_alert_ok(p_secret) then raise exception 'not allowed'; end if;
  return (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from public.arb_alert_kv where k = any(p_keys) and k <> 'cron_key');
end $$;

create or replace function public.arb_kv_set(p_secret text, p_vals jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.arb_alert_ok(p_secret) then raise exception 'not allowed'; end if;
  insert into public.arb_alert_kv (k, v, updated_at)
  select e.key, e.value, now() from jsonb_each(p_vals) e where e.key <> 'cron_key'
  on conflict (k) do update set v = excluded.v, updated_at = now();
end $$;

create or replace function public.arb_sightings_add(p_secret text, p_rows jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.arb_alert_ok(p_secret) then raise exception 'not allowed'; end if;
  insert into public.arb_sightings (key, kind, sport, game, market, legs, best_ret, first_ret, first_seen, last_seen, commence, alerted)
  select r.key, r.kind, r.sport, r.game, r.market, r.legs, r.best_ret, r.first_ret, r.first_seen, r.last_seen, r.commence, coalesce(r.alerted, false)
  from jsonb_to_recordset(p_rows) as r(key text, kind text, sport text, game text, market text, legs jsonb, best_ret numeric,
    first_ret numeric, first_seen timestamptz, last_seen timestamptz, commence timestamptz, alerted boolean);
end $$;

create or replace function public.arb_sightings_recent(p_secret text, p_limit int default 50) returns setof public.arb_sightings
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.arb_alert_ok(p_secret) then raise exception 'not allowed'; end if;
  return query select * from public.arb_sightings order by first_seen desc limit least(coalesce(p_limit, 50), 500);
end $$;

revoke all on function public.arb_alert_ok(text) from public;
grant execute on function public.arb_kv_get(text, text[]), public.arb_kv_set(text, jsonb),
  public.arb_sightings_add(text, jsonb), public.arb_sightings_recent(text, int) to anon, authenticated;

-- the trigger: every minute (re-running this replaces the job)
select cron.unschedule('tdc-arb-scan') where exists (select 1 from cron.job where jobname = 'tdc-arb-scan');
select cron.schedule('tdc-arb-scan', '* * * * *', $job$
  select net.http_get(
    url := 'https://www.thedepthchartcbb.com/api/arb-scan?cron=1',
    headers := jsonb_build_object('x-cron-key', (select v #>> '{}' from public.arb_alert_kv where k = 'cron_key')),
    timeout_milliseconds := 58000
  )
$job$);
