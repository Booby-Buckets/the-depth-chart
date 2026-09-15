-- ============================================================================
--  Supabase advisor clean-up (2026-09-15). Run in the SQL editor. Idempotent.
--
--  1. "RLS Disabled in Public" — player_history_backup_20260814 is a bare backup
--     table: with no RLS anyone holding the public key can read AND write it.
--     Lock it (no policies = no API access; service_role still bypasses).
--     Drop it later once you're sure player_history is fine:
--       drop table public.player_history_backup_20260814;
--
--  2. "Auth RLS Initialization Plan" — every policy that calls auth.uid() /
--     auth.jwt() directly makes Postgres re-evaluate the function PER ROW.
--     Wrapping the call as (select auth.uid()) evaluates it once per query.
--     Same access rules, just faster. This rewrites every such policy in place.
--
--  3. "Disk IO budget" is the bulk shot upload (3.2M inserts with index
--     maintenance); it clears on its own once the upload finishes.
-- ============================================================================

-- 1 ── lock the backup table
alter table if exists public.player_history_backup_20260814 enable row level security;
revoke all on public.player_history_backup_20260814 from anon, authenticated;

-- 2 ── rewrite auth.*() calls inside policies as initplan subselects
do $$
declare
  p record;
  q text; w text; role_list text; sql text;
begin
  for p in
    select schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual,'') || coalesce(with_check,'')) ~ '(?<!select\s)auth\.(uid|jwt|role|email)\(\)'
  loop
    q := regexp_replace(p.qual,       '(?<!select\s)(auth\.(uid|jwt|role|email)\(\))', '(select \1)', 'g');
    w := regexp_replace(p.with_check, '(?<!select\s)(auth\.(uid|jwt|role|email)\(\))', '(select \1)', 'g');
    role_list := array_to_string(p.roles, ', ');
    sql := format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    execute sql;
    sql := format('create policy %I on %I.%I as %s for %s to %s',
                  p.policyname, p.schemaname, p.tablename,
                  case when p.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
                  lower(p.cmd), role_list);
    if q is not null then sql := sql || ' using (' || q || ')'; end if;
    if w is not null then sql := sql || ' with check (' || w || ')'; end if;
    execute sql;
    raise notice 'rewrote %.% / %', p.tablename, p.policyname, p.cmd;
  end loop;
end $$;

-- verify: should return 0 rows
select tablename, policyname
  from pg_policies
 where schemaname = 'public'
   and (coalesce(qual,'') || coalesce(with_check,'')) ~ '(?<!select\s)auth\.(uid|jwt|role|email)\(\)';
