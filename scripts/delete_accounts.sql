-- ============================================================================
--  ACCOUNT DELETION — self-serve "Delete my account" + owner "delete this account".
--  Run the whole file in the Supabase SQL editor. Safe to re-run.
--
--  Deleting a login needs a write to auth.users, which the browser can never do with the
--  public key. These SECURITY DEFINER functions run as the table owner, so they can —
--  but each one checks WHO is calling first:
--    delete_my_account()            → deletes auth.uid(), i.e. only yourself
--    admin_delete_account(p_user)   → owner only (tdc_is_owner(): the owner email in the JWT)
--  The owner account itself can never be deleted by either, so a misclick can't lock you out.
--
--  What goes: the login, the profiles row, and every row in public tables that belongs to
--  the user — found two ways, since several tables were made in the dashboard without FKs:
--    (a) any single-column foreign key that points at auth.users(id) or public.profiles(id)
--    (b) any uuid column named user_id / author_id / follower_id / following_id
--  promo_codes.used_by is set to NULL instead (the code stays used; history is kept).
-- ============================================================================

-- tdc_is_owner() already exists if forum_moderation.sql was run; (re)define so this file
-- stands alone.
create or replace function public.tdc_is_owner() returns boolean
language sql stable as $$ select coalesce(auth.jwt() ->> 'email', '') = 'blee4824@gmail.com' $$;


-- ── the worker: wipe one user everywhere (not callable from the browser) ─────
create or replace function public._tdc_wipe_user(p_user uuid)
returns json language plpgsql security definer set search_path = public, auth as $$
declare
  r record;
  n int;
  v_total int := 0;
  v_todo text[] := '{}';   -- 'schema|table|column'
  v_left text[];
  v_item text;
  v_pass int := 0;
  v_err  text;
begin
  if p_user is null then raise exception 'no user'; end if;
  if exists (select 1 from auth.users where id = p_user and lower(email) = 'blee4824@gmail.com') then
    raise exception 'The owner account cannot be deleted' using errcode = '42501';
  end if;

  -- keep promo history, just forget who used it
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'promo_codes' and column_name = 'used_by') then
    update public.promo_codes set used_by = null where used_by = p_user;
  end if;

  -- (a) FK-linked rows + (b) conventionally-named user columns, in public, except profiles.id
  for r in
    select distinct ns.nspname as sch, cl.relname as tbl, att.attname as col
    from pg_constraint con
    join pg_class cl      on cl.oid = con.conrelid
    join pg_namespace ns  on ns.oid = cl.relnamespace
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f' and array_length(con.conkey, 1) = 1
      and ns.nspname = 'public'
      and con.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
      and not (cl.relname = 'promo_codes' and att.attname = 'used_by')
    union
    select c.table_schema, c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.data_type = 'uuid'
      and c.column_name in ('user_id', 'author_id', 'follower_id', 'following_id')
  loop
    continue when r.tbl = 'profiles';
    v_item := r.sch || '|' || r.tbl || '|' || r.col;
    if not v_item = any(v_todo) then v_todo := v_todo || v_item; end if;
  end loop;

  -- Tables can depend on each other (a reply points at the user's topic), so a delete can
  -- hit a foreign-key error depending on order. Retry the blocked ones in passes; whatever
  -- is still blocked after that is reported by name and the whole delete rolls back.
  while array_length(v_todo, 1) > 0 and v_pass < 6 loop
    v_pass := v_pass + 1;
    v_left := '{}';
    foreach v_item in array v_todo loop
      begin
        execute format('delete from %I.%I where %I = $1',
                       split_part(v_item, '|', 1), split_part(v_item, '|', 2), split_part(v_item, '|', 3))
          using p_user;
        get diagnostics n = row_count;
        v_total := v_total + n;
      exception when foreign_key_violation then
        v_left := v_left || v_item;
        v_err := sqlerrm;
      end;
    end loop;
    exit when v_left = v_todo;              -- no progress this pass
    v_todo := v_left;
  end loop;
  if array_length(v_todo, 1) > 0 then
    raise exception 'Could not remove rows in %: %', array_to_string(v_todo, ', '), v_err;
  end if;

  delete from public.profiles where id = p_user;
  delete from auth.users      where id = p_user;   -- cascades to auth.identities / sessions
  if not found then raise exception 'No such account'; end if;

  return json_build_object('ok', true, 'rows_removed', v_total);
end $$;

revoke all on function public._tdc_wipe_user(uuid) from public, anon, authenticated;


-- ── self-serve ──────────────────────────────────────────────────────────────
create or replace function public.delete_my_account()
returns json language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return json_build_object('ok', false, 'msg', 'Not signed in'); end if;
  return public._tdc_wipe_user(auth.uid());
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;


-- ── owner only ──────────────────────────────────────────────────────────────
create or replace function public.admin_delete_account(p_user uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.tdc_is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  return public._tdc_wipe_user(p_user);
end $$;

revoke all on function public.admin_delete_account(uuid) from public, anon;
grant execute on function public.admin_delete_account(uuid) to authenticated;


-- ── VERIFY — expect three rows ──────────────────────────────────────────────
select proname from pg_proc
where proname in ('_tdc_wipe_user', 'delete_my_account', 'admin_delete_account')
order by proname;
