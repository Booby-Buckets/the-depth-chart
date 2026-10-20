-- ============================================================================
--  ESPN id backfill: typo + nickname step, and the prior-school step restored (Oct 20 2026)
-- ----------------------------------------------------------------------------
--  Owner: "two Xavier starters are incorrectly linked … we need to fix that on every team". A roster
--  name the sheet spells differently from our history ("Jovan Miliecevic" for Jovan Milicevic,
--  "Michael Nwoko" for Mike Nwoko, "Kaden Grumbs", "Nasir (Naz) Meyer") never got an espn_id, so the
--  player's page had no history and the projection treated a proven player as a blank newcomer
--  (Xavier's starting PF and C projected 9.8 / 8.6 ppg at a generic 44.6 FG%). Today's 28 were fixed by
--  hand (relink_misspelled_players_2026-10-20.sql); this makes the sync catch the next ones itself.
--
--  backfill_espn_ids() is the function the sheet sync calls after every run. Steps 0-2 are unchanged from
--  backfill_espn_ids_nicknames.sql. Step 3 (the roster's prior school breaks a namesake tie, from
--  link_transfer_namesakes_2026.sql) was dropped when the nickname version replaced the function on
--  Sept 29 — it's back. Step 4 is new:
--
--    4) TYPOS + NICKNAMES. A player still without an id is matched to a history player from the last two
--       seasons when BOTH hold:
--         school — the history school is his roster school or the prior school the sheet lists
--                  (players.hometown), compared as a key: "LSU" = "Louisiana State", "University at
--                  Buffalo" = "Buffalo", "Loyola Maryland" = "Loyola (MD)", "St. John's" = "St. John's (NY)"
--         name   — after dropping punctuation, Jr./II/III and a "(nickname)":
--                  same surname and a first name that's the same / a nickname (Mike-Michael, Will-William,
--                  Rob-Robert, Sasha-Sash) / one typo (Mikhali-Mikhail), or
--                  the same first name and a surname within two typos (Miliecevic-Milicevic, Grumbs-Gumbs,
--                  Mclver-McIver, Ojanwuna-Ojianwuna); a middle name or a hyphenated extra surname is ignored
--       and exactly one such player fits, and his id isn't already on another roster. True freshmen are
--       skipped (step 0's rule). Rejected by these rules (checked on today's data): Illinois' Ethan Brown
--       vs UIC's Ethyn Brown (different school), North Alabama's EJ King vs North Dakota's Eli King, Northern
--       Iowa's Cade vs Chase Courbat (two typos in a first name).
--
--  Dry run on Oct 20 data: step 4 links 24 players — the 28 fixed by hand minus four the sheet lists as
--  "Fr." (fix their class on the sheet; step 0 clears a "freshman's" id). No false matches.
--
--  Run the whole file once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

-- name key: lower case, no "nickname" / (nickname), no Jr./Sr./II-V, hyphens as spaces, letters only
create or replace function tdc_name_key(n text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(replace(replace(
           regexp_replace(regexp_replace(lower(coalesce(n,'')), '\s*["“”(][^"“”)]*["“”)]\s*', ' ', 'g'),
                          '\m(jr|sr|ii|iii|iv|v)\M\.?', ' ', 'g'),
           '-', ' '), '''', ''), '[^a-z ]', '', 'g'), '\s+', ' ', 'g'))
$$;

-- school key: the sheet's short names and the history's long names onto one spelling
create or replace function tdc_school_key(t text) returns text language plpgsql immutable as $$
declare k text := lower(coalesce(t,''));
begin
  k := regexp_replace(k, '\s*\(\d\d-\d\d\)\s*', '', 'g');                         -- "Baylor (24-25)"
  k := replace(replace(replace(k, 'university at ', ''), 'university of ', ''), ' university', '');
  k := regexp_replace(k, '\mstate\M', 'st', 'g');
  k := regexp_replace(k, '\msaint\M', 'st', 'g');
  k := regexp_replace(k, '[^a-z]', '', 'g');
  return case k
    when 'lsu' then 'louisianast'           when 'smu' then 'southernmethodist'   when 'ncst' then 'northcarolinast'
    when 'usc' then 'southerncalifornia'    when 'byu' then 'brighamyoung'        when 'tcu' then 'texaschristian'
    when 'uconn' then 'connecticut'         when 'olemiss' then 'mississippi'     when 'vcu' then 'virginiacommonwealth'
    when 'loyolachicago' then 'loyolail'    when 'fau' then 'floridaatlantic'     when 'ualbany' then 'albany'
    when 'umbc' then 'marylandbaltimorecounty' when 'umasslowell' then 'massachusettslowell' when 'uic' then 'illinoischicago'
    when 'unlv' then 'nevadalasvegas'       when 'utmartin' then 'tennesseemartin' when 'americanuniversity' then 'american'
    when 'loyolamaryland' then 'loyolamd'   when 'nicholls' then 'nichollsst'     when 'selouisiana' then 'southeasternlouisiana'
    when 'appst' then 'appalachianst'       when 'southernmiss' then 'southernmississippi' when 'ulmonroe' then 'louisianamonroe'
    when 'ecu' then 'eastcarolina'          when 'umass' then 'massachusetts'     when 'penn' then 'pennsylvania'
    when 'pitt' then 'pittsburgh'           when 'utrgv' then 'texasriograndevalley' when 'utriograndevalley' then 'texasriograndevalley'
    when 'charleston' then 'collegeofcharleston' when 'fiu' then 'floridainternational' when 'unf' then 'northflorida'
    when 'uncw' then 'uncwilmington'
    else k end;
end $$;

-- the same school: equal keys, or the history adds only a state tag ("Miami" / "Miami (FL)", "St. John's" / "St. John's (NY)")
create or replace function tdc_school_ok(hk text, pk text) returns boolean language sql immutable as $$
  select coalesce(length(pk) >= 3 and (hk = pk or (left(hk, length(pk)) = pk
           and substr(hk, length(pk) + 1) in ('fl','oh','ny','md','il','pa','ca','la'))), false)
$$;

-- edit distance with an adjacent swap counted once ("Mikhali" / "Mikhail" = 1)
create or replace function tdc_osa(a text, b text) returns integer language plpgsql immutable as $$
declare la int := length(a); lb int := length(b); w int := length(b) + 1; d int[]; i int; j int; c int; v int;
begin
  if a = b then return 0; end if;
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  d := array_fill(0, array[(la + 1) * w]);
  for i in 0..la loop d[i * w + 1] := i; end loop;
  for j in 0..lb loop d[j + 1] := j; end loop;
  for i in 1..la loop
    for j in 1..lb loop
      c := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      v := least(d[(i - 1) * w + j + 1] + 1, d[i * w + j] + 1, d[(i - 1) * w + j] + c);
      if i > 1 and j > 1 and substr(a, i, 1) = substr(b, j - 1, 1) and substr(a, i - 1, 1) = substr(b, j, 1) then
        v := least(v, d[(i - 2) * w + (j - 2) + 1] + 1);
      end if;
      d[i * w + j + 1] := v;
    end loop;
  end loop;
  return d[la * w + lb + 1];
end $$;

create or replace function tdc_nick(f text) returns text language sql immutable as $$
  select case f
    when 'mike' then 'michael' when 'chris' then 'christopher' when 'nick' then 'nicholas' when 'matt' then 'matthew'
    when 'will' then 'william' when 'bill' then 'william' when 'alex' then 'alexander' when 'tony' then 'anthony'
    when 'jon' then 'jonathan' when 'josh' then 'joshua' when 'dan' then 'daniel' when 'danny' then 'daniel'
    when 'zach' then 'zachary' when 'zack' then 'zachary' when 'sam' then 'samuel' when 'ben' then 'benjamin'
    when 'tom' then 'thomas' when 'tommy' then 'thomas' when 'jake' then 'jacob' when 'joe' then 'joseph'
    when 'joey' then 'joseph' when 'dave' then 'david' when 'rob' then 'robert' when 'bob' then 'robert'
    when 'bobby' then 'robert' when 'jim' then 'james' when 'jimmy' then 'james' when 'andy' then 'andrew'
    when 'drew' then 'andrew' when 'cam' then 'cameron' when 'nate' then 'nathan' when 'ed' then 'edward'
    when 'eddie' then 'edward' when 'greg' then 'gregory' when 'jeff' then 'jeffrey' when 'ken' then 'kenneth'
    when 'kenny' then 'kenneth' when 'steve' then 'steven' when 'pat' then 'patrick' when 'gabe' then 'gabriel'
    when 'nik' then 'nikolaos' when 'nikos' then 'nikolaos'
    else f end
$$;

-- a and b are name keys (tdc_name_key)
create or replace function tdc_name_ok(a text, b text) returns boolean language plpgsql immutable as $$
declare fa text; fb text; la text; lb text; same_first boolean;
begin
  if coalesce(a,'') = '' or coalesce(b,'') = '' then return false; end if;
  if a = b then return true; end if;                       -- equal once punctuation / suffixes / (nicknames) are dropped
  fa := split_part(a, ' ', 1); fb := split_part(b, ' ', 1);
  la := regexp_replace(a, '^.* ', ''); lb := regexp_replace(b, '^.* ', '');
  same_first := fa = fb or tdc_nick(fa) = tdc_nick(fb)
                or (least(length(fa), length(fb)) >= 3 and (left(fa, length(fb)) = fb or left(fb, length(fa)) = fa));
  if la = lb and (same_first or tdc_osa(fa, fb) <= 1) then return true; end if;               -- surname equal, first a nickname / one typo
  if same_first and left(la, 1) = left(lb, 1) and tdc_osa(la, lb) <= 2 then return true; end if; -- first equal, surname within two typos
  return false;
end $$;
alter function tdc_name_ok(text, text) cost 500;   -- let the planner test the cheap school match first

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

  -- 3) namesakes, round two (restored): the prior school on the roster (players.hometown, e.g. "Fairfield"
  --    or "George Mason (24-25)") names the one history team this player came from.
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
      on lower(btrim(h.name)) = tdc_plain_name(pr.name)
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

  -- 4) TYPOS + NICKNAMES (see the header): same school (roster or prior) and a name within a typo / nickname,
  --    one candidate only, last two seasons of history, id not already on a roster
  --    Joined on the school key (a hash join, not every player against every history row — the first version
  --    timed out in the Supabase SQL editor): each player brings his roster key, his prior-school key and
  --    those keys + the state tags history adds ("miami" -> "miamifl"), then only same-school pairs test names.
  with ps as (
    select p.id, tdc_name_key(p.name) as nk, tdc_school_key(p.team) as k1,
           case when coalesce(p.hometown,'') <> '' then tdc_school_key(p.hometown) end as k2
    from players p
    where p.espn_id is null
      and coalesce(p.yr,'')         not ilike 'fr%'
      and coalesce(p.class_year,'') not ilike 'fr%'
      and coalesce(p.name,'') not in ('', '—', '-')
  ), pk as (
    select distinct ps.id, ps.nk, k.key || s.sfx as key
    from ps
    cross join lateral (values (ps.k1), (ps.k2)) as k(key)
    cross join (values (''), ('fl'), ('oh'), ('ny'), ('md'), ('il'), ('pa'), ('ca'), ('la')) as s(sfx)
    where k.key is not null and length(k.key) >= 3
  ), hs as (
    select distinct on (espn_id) espn_id, tdc_name_key(name) as nk, tdc_school_key(team) as hk
    from player_history
    where espn_id is not null
      and season_year >= (select max(season_year) - 1 from player_history)
    order by espn_id, season_year desc
  ), cand as (
    select pk.id, min(hs.espn_id) as espn_id
    from pk
    join hs on hs.hk = pk.key
    where tdc_name_ok(pk.nk, hs.nk)
      and not exists (select 1 from players q where q.espn_id = hs.espn_id)
    group by pk.id
    having count(distinct hs.espn_id) = 1
  )
  update players p
     set espn_id = c.espn_id
    from cand c
   where p.id = c.id
     and p.espn_id is null
     and not exists (select 1 from espn_id_blocklist b
                      where lower(btrim(b.name)) = lower(btrim(p.name))
                        and lower(btrim(b.team)) = lower(btrim(p.team))
                        and b.espn_id = c.espn_id);
  get diagnostics m = row_count; n := n + m;
  raise notice 'typo / nickname step linked % player(s)', m;

  return n;   -- number of players re-linked
end;
$$;

-- run it now (the sync also calls it after every run)
select backfill_espn_ids() as relinked;

-- check: Xavier's two starters should now have ids (5101673, 4895795)
select name, team, espn_id from players where team = 'Xavier' and name in ('Jovan Miliecevic', 'Michael Nwoko');
