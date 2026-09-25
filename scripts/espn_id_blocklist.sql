-- ============================================================================
--  ESPN id blocklist: stop the sheet sync re-attaching ids we removed by hand.
-- ----------------------------------------------------------------------------
--  After every sync, sheet_sync.gs calls backfill_espn_ids(), which links an espn_id to any
--  non-freshman roster row whose NAME appears exactly once in player_history. That is how the
--  namesake ids got there in the first place, and it would put them straight back:
--  Juan Fernandez (Sr.) -> the 2012 Temple guard, and redshirt freshmen (R-Fr. is not caught
--  by the freshman guard) Trey Thompson -> Arkansas 2018, Bryce Jackson -> North Texas 2018.
--
--  (Correction: the sheet does NOT carry espn_id; the sync omits it on purpose. Blanking ids in
--  the sheet does nothing. This blocklist is what makes a manual clear stick.)
--
--  Run the whole file once in the Supabase SQL editor. Safe to re-run. To block another id
--  later, add a row to espn_id_blocklist; the function reads it on every sync.
-- ============================================================================

create table if not exists public.espn_id_blocklist (
  name    text   not null,          -- players.name as on the roster
  team    text   not null,          -- players.team as on the roster
  espn_id bigint not null,          -- the id this roster row must never get
  note    text,
  primary key (name, team, espn_id)
);
-- server-side only: RLS on with no policies, so the public anon key can neither read nor write it
alter table public.espn_id_blocklist enable row level security;

insert into public.espn_id_blocklist (name, team, espn_id, note) values
  -- cleared 2026-09 (scripts/clear_bad_espn_ids_2026.sql)
  ('Alex Smith',         'Ohio State',     56615,   'Bethune-Cookman 2012-13 namesake'),
  ('Eric Jacobsen',      'Colorado',       61554,   'Arizona State 2013-16 namesake'),
  ('Chase Foster',       'Pittsburgh',     3136525, 'San Francisco 2015-18 namesake'),
  ('Aleksandar Zecevic', 'Penn State',     4397486, 'Florida Atlantic 2019-20 namesake'),
  ('Elijah Williams',    'Baylor',         4600147, 'Howard 2023-24 namesake'),
  ('Ethan Taylor',       'Michigan State', 4903265, 'Air Force 2022-25 namesake'),
  -- cleared 2026-09-25 (scripts/fix_espn_ids_2026b.sql)
  ('Juan Fernandez',     'South Carolina', 45182,   'Temple 2011-12 namesake'),
  ('Christian Collins',  'USC',            58744,   'Towson 2012-13 namesake'),
  ('Isaiah Rogers',      'Stanford',       4284136, 'UMBC 2018-19 namesake'),
  ('Austin Brown',       'Maryland',       4902374, 'Radford 2021-22 namesake'),
  ('Trey Thompson',      'Iowa',           3136175, 'Arkansas 2017-18 namesake'),
  ('Bryce Jackson',      'Houston',        3130710, 'North Texas 2017-18 namesake'),
  -- same-name players on last season's ESPN rosters, confirmed by the owner to be different people
  ('Trey Thompson',      'Iowa',           5311841, 'Iowa 2025-26 ESPN roster: a different Trey Thompson'),
  ('Bryce Jackson',      'Houston',        5144098, 'Houston 2025-26 ESPN roster: a different Bryce Jackson')
on conflict do nothing;


-- Same function as scripts/backfill_espn_ids.sql, plus one rule in steps 1 and 2:
-- never assign a (roster name, roster team, espn_id) that is on the blocklist.
create or replace function backfill_espn_ids() returns integer language plpgsql as $$
declare n integer := 0; m integer; wiped integer;
begin
  -- 0) SELF-HEAL / GUARD: a TRUE freshman has no college history, so any espn_id on one is a
  --    same-name collision. Redshirt freshmen (R-Fr) legitimately keep theirs.
  update players
     set espn_id = null
   where espn_id is not null
     and (coalesce(yr,'') ilike 'fr%' or coalesce(class_year,'') ilike 'fr%')
     and coalesce(yr,'')         not ilike 'r-fr%'
     and coalesce(yr,'')         not ilike 'rfr%'
     and coalesce(yr,'')         not ilike '%redshirt%'
     and coalesce(class_year,'') not ilike 'r-fr%'
     and coalesce(class_year,'') not ilike 'rfr%'
     and coalesce(class_year,'') not ilike '%redshirt%';
  get diagnostics wiped = row_count;
  raise notice 'freshman espn_id guard: cleared % stale/collision id(s)', wiped;

  -- 1) unique-name matches: the name maps to exactly one espn_id across all history
  with uniq as (
    select lower(btrim(name)) as lname, min(espn_id) as espn_id
    from player_history
    where espn_id is not null
    group by lower(btrim(name))
    having count(distinct espn_id) = 1
  )
  update players p
     set espn_id = u.espn_id
    from uniq u
   where p.espn_id is null
     and coalesce(p.yr,'')         not ilike 'fr%'
     and coalesce(p.class_year,'') not ilike 'fr%'
     and lower(btrim(p.name)) = u.lname
     and not exists (select 1 from espn_id_blocklist b
                      where lower(btrim(b.name)) = lower(btrim(p.name))
                        and lower(btrim(b.team)) = lower(btrim(p.team))
                        and b.espn_id = u.espn_id);
  get diagnostics m = row_count; n := n + m;

  -- 2) namesakes: break the tie only when the roster team matches a history team
  with team_uniq as (
    select lower(btrim(name)) as lname, lower(btrim(team)) as lteam, min(espn_id) as espn_id
    from player_history
    where espn_id is not null
    group by lower(btrim(name)), lower(btrim(team))
    having count(distinct espn_id) = 1
  )
  update players p
     set espn_id = t.espn_id
    from team_uniq t
   where p.espn_id is null
     and coalesce(p.yr,'')         not ilike 'fr%'
     and coalesce(p.class_year,'') not ilike 'fr%'
     and lower(btrim(p.name)) = t.lname
     and lower(btrim(p.team)) = t.lteam
     and not exists (select 1 from espn_id_blocklist b
                      where lower(btrim(b.name)) = lower(btrim(p.name))
                        and lower(btrim(b.team)) = lower(btrim(p.team))
                        and b.espn_id = t.espn_id);
  get diagnostics m = row_count; n := n + m;

  return n;   -- number of players re-linked
end;
$$;


-- verify 1: expect 14 rows
select count(*) as blocked_pairs from public.espn_id_blocklist;

-- verify 2: dry run of what step 1 WOULD assign to the blocked rows now. Expect ZERO rows.
with uniq as (
  select lower(btrim(name)) as lname, min(espn_id) as espn_id
  from player_history where espn_id is not null
  group by lower(btrim(name)) having count(distinct espn_id) = 1
)
select p.id, p.name, p.team, u.espn_id as would_assign
from players p join uniq u on lower(btrim(p.name)) = u.lname
where p.espn_id is null
  and coalesce(p.yr,'') not ilike 'fr%' and coalesce(p.class_year,'') not ilike 'fr%'
  and exists (select 1 from espn_id_blocklist b where lower(btrim(b.name)) = lower(btrim(p.name)) and lower(btrim(b.team)) = lower(btrim(p.team)))
  and not exists (select 1 from espn_id_blocklist b
                   where lower(btrim(b.name)) = lower(btrim(p.name)) and lower(btrim(b.team)) = lower(btrim(p.team)) and b.espn_id = u.espn_id);
