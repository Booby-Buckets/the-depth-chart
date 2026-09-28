-- Follow-up to merge_espn_ids_2026.sql (2026-09-28): the merge missed bbref_seasons, so the
-- development build still found Justin Abson's App State seasons under his old id 5107252 and listed
-- him twice. This adds bbref_seasons to merge_espn_id() for future merges and moves his two rows.
-- Run the whole file in the Supabase SQL editor. Safe to re-run.

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
  update bbref_seasons   set espn_id = p_new where espn_id = p_old;   -- the development build reads this too
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shots' and column_name = 'espn_id') then
    execute 'update shots set espn_id = $1 where espn_id = $2' using p_new, p_old; get diagnostics n_s = row_count;
  end if;
  return format('%s -> %s: %s season rows, %s advanced rows, %s box scores, %s shots', p_old, p_new, n_h, n_a, n_b, n_s);
end;
$$;
revoke all on function public.merge_espn_id(bigint, bigint) from public, anon, authenticated;

select public.merge_espn_id(5107252, 5238204);   -- Justin Abson: now also moves bbref_seasons

-- verify: both App State seasons under 5238204
select season_year, school, espn_id, tdc_grade from bbref_seasons where espn_id in (5107252, 5238204) order by season_year;
