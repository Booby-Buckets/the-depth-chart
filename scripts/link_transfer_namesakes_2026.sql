-- ============================================================================
--  Link 7 transfers whose name is shared with another player (2026-09-27).
-- ----------------------------------------------------------------------------
--  backfill_espn_ids() only links a name that maps to ONE espn_id (step 1) or whose history team
--  equals the NEW school (step 2). A transfer with a namesake fails both, so his page showed no
--  history and the projection treated him as a newcomer (Brandon Benjamin: 14.2/10.4 at Fairfield
--  last season, projected like a freshman). Each id below is the history row at the prior school
--  the roster sheet lists for him.
--
--  Part B adds a step 3 to backfill_espn_ids() that does this matching on every sync from now on.
--  Run the whole file once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

-- A) the seven, keyed on id AND espn_id still null (no-op if anything changed)
update players set espn_id = 5311734 where id = 49921 and espn_id is null;  -- Brandon Benjamin, Boston College  <- Fairfield 2025-26 (not the San Diego one, 5313158)
update players set espn_id = 5176186 where id = 50731 and espn_id is null;  -- RJ Johnson, Mississippi State     <- Kennesaw State (not Rhode Island, 5108122)
update players set espn_id = 4709151 where id = 53017 and espn_id is null;  -- Jalen Haynes, Dayton              <- George Mason 2024-25 (not Southern Illinois, 5313875)
update players set espn_id = 5106056 where id = 53030 and espn_id is null;  -- Elijah Jones, George Mason        <- UTEP (not Longwood/Green Bay, 5176811)
update players set espn_id = 5179291 where id = 63911 and espn_id is null;  -- Josh Smith, Duquesne              <- West Georgia (not Liberty, 4700859)
update players set espn_id = 5174319 where id = 68143 and espn_id is null;  -- Mike Williams, Tulsa              <- Seton Hall / LSU (not Jackson State, 5314764)
update players set espn_id = 4711262 where id = 68146 and espn_id is null;  -- Jeremiah Johnson, Tulsa           <- Campbell (sheet says "Campell"; not Howard, 5316218)

-- B) backfill_espn_ids() with step 3 (prior-school match); steps 0-2 unchanged from espn_id_blocklist.sql
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

  -- 3) namesakes, round two: the roster's prior school (players.hometown carries it for transfers,
  --    e.g. "Fairfield" or "George Mason (24-25)") names the one history team this player came from.
  --    Brandon Benjamin (Boston College, from Fairfield) shared his name with a San Diego player, so
  --    steps 1 and 2 both passed him over and his page showed no history.
  with prior as (
    select p.id, p.name, p.team,
           regexp_replace(lower(replace(regexp_replace(p.hometown, '\s*\(.*$', ''), 'State', 'St')), '[^a-z]', '', 'g') as pk
    from players p
    where p.espn_id is null
      and coalesce(p.yr,'')         not ilike 'fr%'
      and coalesce(p.class_year,'') not ilike 'fr%'
      and coalesce(p.hometown,'') <> ''
  ), cand as (
    select pr.id, min(h.espn_id) as espn_id
    from prior pr
    join player_history h
      on lower(btrim(h.name)) = lower(btrim(pr.name))
     and h.espn_id is not null
     and length(pr.pk) >= 4
     and regexp_replace(lower(replace(h.team, 'State', 'St')), '[^a-z]', '', 'g') like pr.pk || '%'
    group by pr.id
    having count(distinct h.espn_id) = 1
  )
  update players p
     set espn_id = c.espn_id
    from cand c
   where p.id = c.id
     and p.espn_id is null
     and not exists (select 1 from players q where q.espn_id = c.espn_id)
     and not exists (select 1 from espn_id_blocklist b
                      where lower(btrim(b.name)) = lower(btrim(p.name))
                        and lower(btrim(b.team)) = lower(btrim(p.team))
                        and b.espn_id = c.espn_id);
  get diagnostics m = row_count; n := n + m;

  return n;   -- number of players re-linked
end;
$$;

-- verify: expect all seven linked
select id, name, team, hometown, espn_id from players
where id in (49921, 50731, 53017, 53030, 63911, 68143, 68146) order by id;
