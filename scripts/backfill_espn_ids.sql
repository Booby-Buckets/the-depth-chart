-- ============================================================
-- Backfill players.espn_id from player_history
-- ------------------------------------------------------------
-- The Google Sheet → Supabase sync wipes & re-inserts `players`
-- WITHOUT espn_id (the sheet doesn't carry it). That breaks ESPN
-- headshots AND the projection's recruiting-pedigree / versatility
-- joins (both keyed by espn_id), which skews the rankings.
--
-- This restores the id by matching name → player_history using the
-- SAME safe rule player.html uses:
--   1. a name that maps to exactly ONE espn_id in history wins
--   2. namesakes are broken only when the roster team matches a
--      history team
--   3. still-ambiguous names are left NULL — never guessed (a wrong
--      id = a wrong face / wrong player's pedigree)
-- Freshmen (yr/class 'Fr.') are skipped so an incoming freshman can't
-- inherit a same-named former player's id.
--
-- Run this whole file once in the Supabase SQL editor. It creates a
-- reusable function AND runs it. The sync then calls it automatically
-- via RPC after every re-sync (see scripts/sheet_sync.gs).
-- ============================================================

create or replace function backfill_espn_ids() returns integer language plpgsql as $$
declare n integer := 0; m integer;
begin
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
     and lower(btrim(p.name)) = u.lname;
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
     and lower(btrim(p.team)) = t.lteam;
  get diagnostics m = row_count; n := n + m;

  return n;   -- number of players re-linked
end;
$$;

-- run it now to fix the current (post-sync) state:
select backfill_espn_ids() as players_relinked;


-- ============================================================
-- Backfill players box stats from player_history (runs AFTER espn_id)
-- ------------------------------------------------------------
-- A statless roster row (returner whose sheet line wasn't autofilled)
-- gets its most-recent real season line from player_history, matched
-- by the now-restored espn_id. Only fills NULLs — never clobbers stats
-- the sheet already provided. Freshmen (no espn_id / no history) stay
-- blank, which is correct.
-- ============================================================

create or replace function backfill_player_stats() returns integer language plpgsql as $$
declare n integer;
begin
  with recent as (
    select distinct on (espn_id)
           espn_id, ppg, rpg, apg, mpg, fg_pct, tp_pct, ft_pct,
           stl, blk, tovs, oreb, dreb, gp, fgm, fga, tpm, tpa, ftm, fta
    from player_history
    where espn_id is not null
    order by espn_id, season_year desc          -- most-recent season = last demonstrated line
  )
  update players p
     set ppg=r.ppg, rpg=r.rpg, apg=r.apg, mpg=r.mpg,
         fg_pct=r.fg_pct, tp_pct=r.tp_pct, ft_pct=r.ft_pct,
         stl=r.stl, blk=r.blk, tovs=r.tovs, oreb=r.oreb, dreb=r.dreb,
         gp=r.gp, fgm=r.fgm, fga=r.fga, tpm=r.tpm, tpa=r.tpa, ftm=r.ftm, fta=r.fta
    from recent r
   where p.espn_id = r.espn_id
     and p.ppg is null;                          -- only statless rows
  get diagnostics n = row_count;
  return n;   -- number of players given a stat line
end;
$$;

select backfill_player_stats() as players_statfilled;
