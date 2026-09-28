-- ============================================================================
--  Forum rules + moderation (2026-09-28). Run the whole file once in the Supabase SQL editor.
--  Safe to re-run.
-- ----------------------------------------------------------------------------
--  Everything here is enforced by the DATABASE, so editing the page can't get around it:
--    * author name = the poster's profile username (the browser's value is ignored)
--    * timeouts / bans (forum_bans), checked on every post
--    * rate limits: 1 topic / 10 min and 10 / day; 1 reply / 20 s and 30 / hour
--    * lengths: title 5-120, topic body <= 5,000, reply 2-2,000; at most 2 links a post
--    * new accounts wait 10 minutes; a username is required
--    * blocked words (forum_banned_words, managed from the forum page by the owner)
--    * locked topics take no replies; only the owner can pin or lock
--    * reports (forum_reports): members report, only the owner reads them
--  The owner (blee4824@gmail.com) is exempt from the limits and has moderation functions below.
-- ============================================================================

create or replace function public.tdc_is_owner() returns boolean
language sql stable as $$ select coalesce(auth.jwt() ->> 'email', '') = 'blee4824@gmail.com' $$;

alter table public.forum_topics add column if not exists locked boolean not null default false;

-- ── timeouts / bans ─────────────────────────────────────────────────────────
create table if not exists public.forum_bans (
  user_id    uuid primary key,
  until      timestamptz,              -- null = permanent ban
  reason     text,
  created_at timestamptz not null default now()
);
alter table public.forum_bans enable row level security;
drop policy if exists "ban_owner" on public.forum_bans;
drop policy if exists "ban_self"  on public.forum_bans;
create policy "ban_owner" on public.forum_bans for all to authenticated using (public.tdc_is_owner()) with check (public.tdc_is_owner());
create policy "ban_self"  on public.forum_bans for select to authenticated using (user_id = auth.uid());

-- ── reports ────────────────────────────────────────────────────────────────
create table if not exists public.forum_reports (
  id          bigserial primary key,
  target_type text not null check (target_type in ('topic', 'reply')),
  target_id   bigint not null,
  reporter_id uuid not null default auth.uid(),
  reason      text check (char_length(coalesce(reason, '')) <= 300),
  created_at  timestamptz not null default now(),
  resolved    boolean not null default false,
  unique (target_type, target_id, reporter_id)
);
alter table public.forum_reports enable row level security;
drop policy if exists "rep_insert" on public.forum_reports;
drop policy if exists "rep_owner"  on public.forum_reports;
create policy "rep_insert" on public.forum_reports for insert to authenticated with check (reporter_id = auth.uid());
create policy "rep_owner"  on public.forum_reports for all to authenticated using (public.tdc_is_owner()) with check (public.tdc_is_owner());
grant insert on public.forum_reports to authenticated;
grant usage, select on sequence public.forum_reports_id_seq to authenticated;

-- ── blocked words (owner-managed) ──────────────────────────────────────────
create table if not exists public.forum_banned_words (word text primary key check (char_length(word) between 2 and 40));
alter table public.forum_banned_words enable row level security;
drop policy if exists "words_owner" on public.forum_banned_words;
create policy "words_owner" on public.forum_banned_words for all to authenticated using (public.tdc_is_owner()) with check (public.tdc_is_owner());

-- ── the posting guard ──────────────────────────────────────────────────────
create or replace function public.forum_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); b record; uname text; n int; txt text; w text;
begin
  select username into uname from profiles where id = uid;

  if tg_op = 'UPDATE' then
    if not public.tdc_is_owner() then            -- members can edit their words, not the flags
      new.pinned := old.pinned; new.locked := old.locked;
      new.author_id := old.author_id; new.author_name := old.author_name;
    end if;
    return new;
  end if;

  if public.tdc_is_owner() then
    if uname is not null then new.author_name := uname; end if;
    return new;
  end if;

  if uid is null or new.author_id is distinct from uid then
    raise exception 'Sign in to post.' using errcode = '42501';
  end if;
  select * into b from forum_bans where user_id = uid and (until is null or until > now());
  if found then
    if b.until is null then raise exception 'Your account is banned from the forum.' using errcode = '42501'; end if;
    raise exception 'You are on a timeout until % ET.', to_char(b.until at time zone 'America/New_York', 'Mon DD, HH12:MI AM') using errcode = '42501';
  end if;
  if uname is null or btrim(uname) = '' then raise exception 'Pick a username on your profile before posting.'; end if;
  if exists (select 1 from profiles where id = uid and created_at > now() - interval '10 minutes') then
    raise exception 'New accounts can post 10 minutes after signing up.';
  end if;
  new.author_name := uname;                      -- server truth, not what the browser sent

  if tg_table_name = 'forum_topics' then
    new.pinned := false; new.locked := false; new.reply_count := 0;
    new.title := btrim(coalesce(new.title, ''));
    new.body  := nullif(btrim(coalesce(new.body, '')), '');
    if char_length(new.title) < 5 or char_length(new.title) > 120 then raise exception 'Titles need 5 to 120 characters.'; end if;
    if char_length(coalesce(new.body, '')) > 5000 then raise exception 'Posts are limited to 5,000 characters.'; end if;
    if coalesce(new.category, '') not in ('General', 'Transfer Portal', 'Recruiting', 'Game Talk') then raise exception 'Pick a category.'; end if;
    select count(*) into n from forum_topics where author_id = uid and created_at > now() - interval '10 minutes';
    if n >= 1 then raise exception 'You can start one topic every 10 minutes.'; end if;
    select count(*) into n from forum_topics where author_id = uid and created_at > now() - interval '1 day';
    if n >= 10 then raise exception 'You have reached the daily limit of 10 topics.'; end if;
    txt := new.title || ' ' || coalesce(new.body, '');
  else
    new.body := btrim(coalesce(new.body, ''));
    if char_length(new.body) < 2 or char_length(new.body) > 2000 then raise exception 'Replies need 2 to 2,000 characters.'; end if;
    if exists (select 1 from forum_topics where id = new.topic_id and locked) then raise exception 'This topic is locked.'; end if;
    select count(*) into n from forum_replies where author_id = uid and created_at > now() - interval '20 seconds';
    if n >= 1 then raise exception 'Slow down: one reply every 20 seconds.'; end if;
    select count(*) into n from forum_replies where author_id = uid and created_at > now() - interval '1 hour';
    if n >= 30 then raise exception 'You have reached the limit of 30 replies an hour.'; end if;
    txt := new.body;
  end if;

  if (select count(*) from regexp_matches(txt, '(https?://|www\.)', 'gi')) > 2 then
    raise exception 'Posts can include at most 2 links.';
  end if;
  for w in select word from forum_banned_words loop
    if position(lower(w) in lower(txt)) > 0 then
      raise exception 'That post includes a word that is not allowed here.';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_forum_guard on public.forum_topics;
drop trigger if exists trg_forum_guard on public.forum_replies;
create trigger trg_forum_guard before insert or update on public.forum_topics  for each row execute function public.forum_guard();
create trigger trg_forum_guard before insert or update on public.forum_replies for each row execute function public.forum_guard();

-- ── owner moderation ───────────────────────────────────────────────────────
-- timeout for p_minutes (null or 0 = permanent ban); replaces any current one
create or replace function public.mod_timeout(p_user uuid, p_minutes int, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.tdc_is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  insert into forum_bans (user_id, until, reason)
  values (p_user, case when coalesce(p_minutes, 0) > 0 then now() + make_interval(mins => p_minutes) end, p_reason)
  on conflict (user_id) do update set until = excluded.until, reason = excluded.reason, created_at = now();
  return 'ok';
end; $$;

create or replace function public.mod_lift(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.tdc_is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  delete from forum_bans where user_id = p_user;
  return 'ok';
end; $$;

-- delete a whole topic with its replies (owner, or the topic's own author)
create or replace function public.forum_delete_topic(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not (public.tdc_is_owner() or exists (select 1 from forum_topics where id = p_id and author_id = auth.uid())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from forum_replies where topic_id = p_id;
  delete from forum_topics  where id = p_id;
  update forum_reports set resolved = true where target_type = 'topic' and target_id = p_id;
  return 'ok';
end; $$;

create or replace function public.forum_delete_reply(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not (public.tdc_is_owner() or exists (select 1 from forum_replies where id = p_id and author_id = auth.uid())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from forum_replies where id = p_id;
  update forum_reports set resolved = true where target_type = 'reply' and target_id = p_id;
  return 'ok';
end; $$;

create or replace function public.mod_set_topic(p_id bigint, p_pinned boolean, p_locked boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.tdc_is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  update forum_topics set pinned = coalesce(p_pinned, pinned), locked = coalesce(p_locked, locked) where id = p_id;
  return 'ok';
end; $$;

revoke all on function public.mod_timeout(uuid, int, text)          from public, anon;
revoke all on function public.mod_lift(uuid)                        from public, anon;
revoke all on function public.forum_delete_topic(bigint)            from public, anon;
revoke all on function public.forum_delete_reply(bigint)            from public, anon;
revoke all on function public.mod_set_topic(bigint, boolean, boolean) from public, anon;
grant execute on function public.mod_timeout(uuid, int, text)          to authenticated;
grant execute on function public.mod_lift(uuid)                        to authenticated;
grant execute on function public.forum_delete_topic(bigint)            to authenticated;
grant execute on function public.forum_delete_reply(bigint)            to authenticated;
grant execute on function public.mod_set_topic(bigint, boolean, boolean) to authenticated;

-- verify: expect the three tables and the five functions
select table_name from information_schema.tables where table_schema = 'public' and table_name in ('forum_bans', 'forum_reports', 'forum_banned_words');
select proname from pg_proc where proname in ('forum_guard', 'mod_timeout', 'mod_lift', 'forum_delete_topic', 'forum_delete_reply', 'mod_set_topic');
