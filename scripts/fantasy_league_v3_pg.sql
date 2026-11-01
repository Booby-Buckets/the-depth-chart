-- ============================================================================
--  Fantasy league v3 (2026-11-01): the point-guard limit. Run AFTER fantasy_league.sql and _v2. Safe to re-run.
-- ----------------------------------------------------------------------------
--  * fl_pg_list: the league's 2026-27 point guards (owner's list, one per pool school; tdc-fantasy-pg.js holds the
--    same list by name). It is the LIST that counts, not players.position.
--  * fl_leagues.max_pg: how many listed PGs one team may roster (default 3; null = no limit). The commissioner can
--    change it under League → rules.
--  * a deferred trigger on fl_rosters checks every team at the end of each draft / pick / pickup / trade, so a trade
--    that swaps one PG for another is fine but no path can leave a team over the limit.
--  A row is a listed PG when its player_id OR its espn_id is on the list (a school change gives a player a new id).
-- ============================================================================

alter table public.fl_leagues add column if not exists max_pg int default 3 check (max_pg is null or max_pg >= 0);
grant select (max_pg) on public.fl_leagues to anon, authenticated;
grant update (max_pg) on public.fl_leagues to authenticated;

create table if not exists public.fl_pg_list (
  season     int    not null,
  player_id  bigint not null,
  espn_id    bigint,
  label      text,
  primary key (season, player_id)
);
alter table public.fl_pg_list enable row level security;
drop policy if exists "fl_pg_read" on public.fl_pg_list;
create policy "fl_pg_read" on public.fl_pg_list for select to anon, authenticated using (true);
grant select on public.fl_pg_list to anon, authenticated;

delete from public.fl_pg_list where season = 2027;
insert into public.fl_pg_list (season, player_id, espn_id, label) values
  (2027, 49759, 5144105, 'Acaden Lewis · Miami'),
  (2027, 49773, 5041937, 'Cayden Boozer · Duke'),
  (2027, 49790, 5105672, 'Braeden Smith · Notre Dame'),
  (2027, 49801, 5311829, 'Neoklis Avdalas · North Carolina'),
  (2027, 49813, 5150404, 'Chance Mallory · Virginia'),
  (2027, 49827, 5106280, 'Rowan Brumbaugh · SMU'),
  (2027, 49839, 5142618, 'Christian Bliss · Stanford'),
  (2027, 49853, 5054085, 'Anthony Robinson ll · Florida State'),
  (2027, 49867, 4873105, 'Ben Hammond · Virginia Tech'),
  (2027, 49880, 4845361, 'Jackson Shelstad · Louisville'),
  (2027, 49891, 5314298, 'Kevair Kennedy · Wake Forest'),
  (2027, 49902, 5236222, 'Preston Edmead · NC-State'),
  (2027, 49918, 5177148, 'Armoni Zeigler · Boston College'),
  (2027, 49945, 5077373, 'Garwey Dual · Syracuse'),
  (2027, 49959, 5174557, 'Naithan George · Pittsburgh'),
  (2027, 49974, 5176315, 'Colby Garland · Georgia Tech'),
  (2027, 49988, 4869764, 'Elliot Cadeau · Michigan'),
  (2027, 50002, 5221322, 'Jake West · Northwestern'),
  (2027, 50015, 4684268, 'Fred Payne · Oregon'),
  (2027, 50026, 4711255, 'Jeremy Fears Jr. · Michigan State'),
  (2027, 50038, 5312035, 'Omer Mayer · Purdue'),
  (2027, 50051, 5105468, 'Trevan Leonhardt · Nebraska'),
  (2027, 50065, 4684634, 'Rodney Rice · USC'),
  (2027, 50078, 5311991, 'Stefan Vaaks · Illinois'),
  (2027, 50089, 5221321, 'Jaylen Petty · UCLA'),
  (2027, 50102, null, 'Owen Foxwell · Wisconsin'),
  (2027, 50117, 5060708, 'John Mobley Jr. · Ohio State'),
  (2027, 50128, 5176280, 'Kael Combs · Iowa'),
  (2027, 50140, 5101623, 'Markus Burton · Indiana'),
  (2027, 50152, 4683777, 'DJ Wagner · Maryland'),
  (2027, 50166, 5093253, 'Kyan Evans · Minnesota'),
  (2027, 50179, 5176425, 'Ryan Beasley · Washington'),
  (2027, 50192, 5105801, 'Dasante Bowen · Penn State'),
  (2027, 50206, 5142358, 'Jamichael Davis · Rutgers'),
  (2027, 50219, 5107198, 'Cruz Davis · Texas Tech'),
  (2027, 50232, 4873093, 'Dedan Thomas Jr. · Houston'),
  (2027, 50245, 5060709, 'Robert Wright · BYU'),
  (2027, 50258, 5144097, 'Derek Dixon · Arizona'),
  (2027, 50285, 5105844, 'Kanye Clary · Oklahoma State'),
  (2027, 50312, null, 'Miles Sadler · West Virginia'),
  (2027, 50326, 5144108, 'Kayden Mingo · Baylor'),
  (2027, 50338, 4712832, 'Barrington Hargress · Colorado'),
  (2027, 50351, 5103590, 'Brandon Rechsteiner · Kansas State'),
  (2027, 50364, 5106868, 'Arturo Dean · UCF'),
  (2027, 50377, 5103589, 'Brock Harding · TCU'),
  (2027, 50390, 5314722, 'Joel Foxwell · Arizona State'),
  (2027, 50405, 5178210, 'Tylen Riley · Cincinnati'),
  (2027, 50419, null, 'Noam Yaacov · Utah'),
  (2027, 50435, 5054083, 'Silas Demary Jr. · UConn'),
  (2027, 50449, 5144086, 'Nigel James Jr. · Marquette'),
  (2027, 50464, 5144380, 'Austin Swartz · Creighton'),
  (2027, 50476, null, 'Quinn Ellis · St. John''s'),
  (2027, 50496, 5060703, 'Elijah Crawford · Villanova'),
  (2027, 50501, 4683785, 'Simeon Wilcher · Seton Hall'),
  (2027, 50514, 4684270, 'Jaland Lowe · Georgetown'),
  (2027, 50525, 5175952, 'Malik Mack · Providence'),
  (2027, 50541, 5107876, 'Jalen Jackson · Butler'),
  (2027, 50549, 4845358, 'Layden Blocker · DePaul'),
  (2027, 50564, 4683680, 'Chance Westrey · Xavier'),
  (2027, 50580, 5060705, 'Zoom Diallo · Kentucky'),
  (2027, 50594, 4684276, 'Aden Holloway · Alabama'),
  (2027, 50609, 5187600, 'Tyler Tanner · Vanderbilt'),
  (2027, 50623, 5238195, 'Boogie Fland · Florida'),
  (2027, 50637, 5254159, 'Isaiah Johnson · Texas'),
  (2027, 50666, null, 'Jordan Smith · Arkansas'),
  (2027, 50679, null, 'Jason Crowe Jr. · Missouri'),
  (2027, 50695, 5239784, 'George Kimble lll · Auburn'),
  (2027, 50726, 4895740, 'Josh Hubbard · Mississippi State'),
  (2027, 50739, 4845373, 'Dai Dai Ames · Tennessee'),
  (2027, 50755, 5174633, 'Xzayvier Brown · Oklahoma'),
  (2027, 50766, 5175671, 'Kory Mincy · South Carolina'),
  (2027, 62549, 5105445, 'Dillon Hunter · Clemson'),
  (2027, 63534, 5107782, 'Donovan Dent · LSU'),
  (2027, 70302, 5106254, 'Tamin Lipsey · Iowa State'),
  (2027, 71860, 5177301, 'Melvin Council Jr. · Kansas'),
  (2027, 72231, 5105624, 'Jordan Pope · Texas A&M'),
  (2027, 72288, 5177275, 'Adam "Budd" Clark · Ole Miss'),
  (2027, 72371, 5176681, 'Marcus "Smurf" Millender · Georgia');

create or replace function public.fl_is_pg(p_season int, p_player bigint, p_espn bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from fl_pg_list where season = p_season
                 and (player_id = p_player or (p_espn is not null and espn_id = p_espn)));
$$;

create or replace function public.fl_pg_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare lg record; n int;
begin
  select id, season, max_pg into lg from fl_leagues where id = new.league_id;
  if lg.max_pg is null or new.end_date is not null then return null; end if;
  select count(*) into n from fl_rosters r
   where r.league_id = new.league_id and r.user_id = new.user_id and r.end_date is null
     and public.fl_is_pg(coalesce(lg.season, 2027), r.player_id, r.espn_id);
  if n > lg.max_pg then
    raise exception 'That team would have % point guards from the league PG list (the limit is %).', n, lg.max_pg;
  end if;
  return null;
end $$;

drop trigger if exists fl_pg_guard on public.fl_rosters;
create constraint trigger fl_pg_guard after insert or update on public.fl_rosters
  deferrable initially deferred for each row execute function public.fl_pg_guard();
