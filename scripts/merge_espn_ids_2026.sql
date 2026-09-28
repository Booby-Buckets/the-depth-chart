-- ============================================================================
--  Merge a player's duplicate ESPN ids into one (2026-09-28).
-- ----------------------------------------------------------------------------
--  ESPN sometimes gives a transfer a NEW athlete id at his new school. Our pages load a career by
--  espn_id, so the seasons under the old id disappear from his page, grade history and development.
--
--    Justin Abson   old 5107252 (App State 2022-23, 2023-24)  ->  5238204 (Georgia 2024-25, 2025-26; Wake Forest now)
--
--  The 2014-15 Campbell "Justin Abson" (3129897) is a different, older player and is NOT touched.
--
--  Each merge only runs when the two ids never share a season (so two different people can never be
--  folded together), and it moves every row keyed by the old id: season stats, advanced stats, box
--  scores and (if present) shots. Run the whole file once in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

create or replace function public.merge_espn_id(p_old bigint, p_new bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare n_h int := 0; n_a int := 0; n_b int := 0; n_s int := 0;
begin
  if exists (select 1 from player_history a join player_history b on a.season_year = b.season_year
             where a.espn_id = p_old and b.espn_id = p_new) then
    raise exception 'ids % and % share a season, not merging', p_old, p_new;
  end if;
  update player_history  set espn_id = p_new where espn_id = p_old; get diagnostics n_h = row_count;
  update player_advanced set espn_id = p_new where espn_id = p_old; get diagnostics n_a = row_count;
  update box_scores      set espn_id = p_new where espn_id = p_old; get diagnostics n_b = row_count;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shots' and column_name = 'espn_id') then
    execute 'update shots set espn_id = $1 where espn_id = $2' using p_new, p_old; get diagnostics n_s = row_count;
  end if;
  return format('%s -> %s: %s season rows, %s advanced rows, %s box scores, %s shots', p_old, p_new, n_h, n_a, n_b, n_s);
end;
$$;
revoke all on function public.merge_espn_id(bigint, bigint) from public, anon, authenticated;

select public.merge_espn_id(5107252, 5238204);   -- Justin Abson: App State -> Georgia / Wake Forest

-- verify: all four seasons under one id (Campbell 2015 stays separate)
select season_year, team, espn_id, gp, mpg, ppg from player_history where name = 'Justin Abson' order by season_year;
