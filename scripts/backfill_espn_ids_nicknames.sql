-- ============================================================
-- ESPN id backfill: ignore quoted nicknames (Sept 29 2026)
-- ------------------------------------------------------------
-- The sheet writes nicknames in quotes — Marcus "Smurf" Millender, Adam "Budd" Clark — and the
-- post-sync backfill matched the FULL string against player_history, so those players never got
-- their espn_id: no stats, no projection, and their team's rating ignored them. Renaming a
-- returner this way also dropped the id he already had (the sync keys players on name+team).
-- Same function as scripts/espn_id_blocklist.sql, with the roster name compared after stripping
-- a quoted nickname ("..." or curly quotes) in steps 1 and 2. Run the whole file once in the
-- Supabase SQL editor; the sync keeps calling the function after every run.
-- ============================================================

create or replace function tdc_plain_name(n text) returns text language sql immutable as $$
  select lower(btrim(regexp_replace(regexp_replace(coalesce(n,''), '\s*["“”][^"“”]*["“”]\s*', ' ', 'g'), '\s+', ' ', 'g')))
$$;

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

  -- 1) unique-name matches: the name (nickname stripped) maps to exactly one espn_id across all history
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
     and tdc_plain_name(p.name) = u.lname
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
     and tdc_plain_name(p.name) = t.lname
     and lower(btrim(p.team)) = t.lteam
     and not exists (select 1 from espn_id_blocklist b
                      where lower(btrim(b.name)) = lower(btrim(p.name))
                        and lower(btrim(b.team)) = lower(btrim(p.team))
                        and b.espn_id = t.espn_id);
  get diagnostics m = row_count; n := n + m;

  return n;   -- number of players re-linked
end;
$$;

-- first names that differ from ESPN's (checked by last season's team): link by hand
update players set espn_id = 5239600 where espn_id is null and name = 'Dez Lindsay'       and team = 'Kansas State';  -- ESPN "Dezdrick Lindsay", Oregon 2025-26
update players set espn_id = 5175001 where espn_id is null and name = 'Nikos Chitikoudis' and team = 'Xavier';        -- ESPN "Nikolaos Chitikoudis", Robert Morris 2025-26

-- run it now (the sync also calls it after every run)
select backfill_espn_ids() as relinked;

-- check: the nickname players should now have ids
select name, team, espn_id from players where name like '%"%' order by team, name;
