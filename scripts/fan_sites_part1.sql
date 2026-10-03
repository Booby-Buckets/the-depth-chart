-- ============================================================================
--  Team fan sites (2026-10-02). Run the whole file once in the Supabase SQL editor.
--  Safe to re-run. Needs forum_moderation.sql first (tdc_is_owner, forum_bans).
-- ----------------------------------------------------------------------------
--  Every team gets a fan page at fan.html?team=<teams.name>:
--    * a publication (fan_sites): name, tagline, about — run by its editors
--    * a masthead (fan_writers): editor = runs the site + approves writers, writer = publishes
--    * articles (fan_articles): drafts are private to the author + editors, published are public
--    * applications (fan_applications): any member can apply to write for a team
--    * a team forum: forum_topics.team (all the forum rules in forum_guard still apply)
--    * image uploads: storage bucket fan-media, each writer uploads into their own <uid>/ folder
--  The owner (blee4824@gmail.com) is an editor of every site.
-- ============================================================================

-- ── tables ──────────────────────────────────────────────────────────────────
create table if not exists public.fan_sites (
  team       text primary key,                 -- teams.name ("Notre Dame")
  name       text not null check (char_length(name) between 3 and 60),
  tagline    text check (char_length(coalesce(tagline, '')) <= 140),
  about      text check (char_length(coalesce(about, '')) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fan_writers (
  team       text not null,
  user_id    uuid not null,
  role       text not null default 'writer' check (role in ('editor', 'writer')),
  created_at timestamptz not null default now(),
  primary key (team, user_id)
);

create table if not exists public.fan_applications (
  id         bigserial primary key,
  team       text not null,
  user_id    uuid not null default auth.uid(),
  pitch      text not null check (char_length(pitch) between 20 and 1500),
  sample_url text check (sample_url is null or sample_url ~* '^https?://'),
  status     text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  unique (team, user_id)
);

create table if not exists public.fan_articles (
  id           bigserial primary key,
  team         text not null,
  author_id    uuid not null default auth.uid(),
  author_name  text,
  title        text not null check (char_length(title) between 5 and 140),
  dek          text check (char_length(coalesce(dek, '')) <= 280),
  body         text not null default '' check (char_length(body) <= 60000),
  cover_url    text check (cover_url is null or cover_url ~* '^https://'),
  status       text not null default 'draft' check (status in ('draft', 'published')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists fan_articles_team_pub on public.fan_articles (team, status, published_at desc);

alter table public.forum_topics add column if not exists team text;
create index if not exists forum_topics_team on public.forum_topics (team);

-- ── who may do what ─────────────────────────────────────────────────────────
-- security definer so the checks can read fan_writers regardless of the caller's RLS
create or replace function public.fan_is_editor(p_team text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tdc_is_owner()
      or exists (select 1 from fan_writers where team = p_team and user_id = auth.uid() and role = 'editor')
$$;
create or replace function public.fan_can_write(p_team text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tdc_is_owner()
      or exists (select 1 from fan_writers where team = p_team and user_id = auth.uid())
$$;
create or replace function public.fan_is_any_writer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.tdc_is_owner() or exists (select 1 from fan_writers where user_id = auth.uid())
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.fan_sites        enable row level security;
alter table public.fan_writers      enable row level security;
alter table public.fan_applications enable row level security;
alter table public.fan_articles     enable row level security;

drop policy if exists "fs_read"   on public.fan_sites;
drop policy if exists "fs_edit"   on public.fan_sites;
drop policy if exists "fs_insert" on public.fan_sites;
drop policy if exists "fs_delete" on public.fan_sites;
create policy "fs_read"   on public.fan_sites for select using (true);
create policy "fs_insert" on public.fan_sites for insert to authenticated with check (public.fan_is_editor(team));
create policy "fs_edit"   on public.fan_sites for update to authenticated using (public.fan_is_editor(team)) with check (public.fan_is_editor(team));
create policy "fs_delete" on public.fan_sites for delete to authenticated using (public.tdc_is_owner());

drop policy if exists "fw_read"  on public.fan_writers;
drop policy if exists "fw_write" on public.fan_writers;
drop policy if exists "fw_leave" on public.fan_writers;
create policy "fw_read"  on public.fan_writers for select using (true);
create policy "fw_write" on public.fan_writers for all to authenticated using (public.fan_is_editor(team)) with check (public.fan_is_editor(team));
create policy "fw_leave" on public.fan_writers for delete to authenticated using (user_id = auth.uid());

drop policy if exists "fa_insert" on public.fan_applications;
drop policy if exists "fa_read"   on public.fan_applications;
drop policy if exists "fa_review" on public.fan_applications;
drop policy if exists "fa_delete" on public.fan_applications;
create policy "fa_insert" on public.fan_applications for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
create policy "fa_read"   on public.fan_applications for select to authenticated using (user_id = auth.uid() or public.fan_is_editor(team));
create policy "fa_review" on public.fan_applications for update to authenticated using (public.fan_is_editor(team)) with check (public.fan_is_editor(team));
create policy "fa_delete" on public.fan_applications for delete to authenticated using (user_id = auth.uid() or public.fan_is_editor(team));

drop policy if exists "art_read"   on public.fan_articles;
drop policy if exists "art_insert" on public.fan_articles;
drop policy if exists "art_update" on public.fan_articles;
drop policy if exists "art_delete" on public.fan_articles;
create policy "art_read"   on public.fan_articles for select
  using (status = 'published' or author_id = auth.uid() or public.fan_is_editor(team));
create policy "art_insert" on public.fan_articles for insert to authenticated
  with check (author_id = auth.uid() and public.fan_can_write(team));
create policy "art_update" on public.fan_articles for update to authenticated
  using ((author_id = auth.uid() and public.fan_can_write(team)) or public.fan_is_editor(team))
  with check ((author_id = auth.uid() and public.fan_can_write(team)) or public.fan_is_editor(team));
create policy "art_delete" on public.fan_articles for delete to authenticated
  using (author_id = auth.uid() or public.fan_is_editor(team));

grant select on public.fan_sites, public.fan_writers, public.fan_articles to anon, authenticated;
grant select, insert, update, delete on public.fan_sites, public.fan_writers, public.fan_applications, public.fan_articles to authenticated;
grant usage, select on sequence public.fan_articles_id_seq, public.fan_applications_id_seq to authenticated;

-- ── article guard: byline from the profile, timestamps, bans ───────────────
create or replace function public.fan_article_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  if tg_op = 'UPDATE' then
    new.author_id  := old.author_id;          -- an article never changes hands
    new.team       := old.team;
    new.created_at := old.created_at;
  end if;
  select username into uname from profiles where id = new.author_id;
  if coalesce(uname, '') = '' then raise exception 'Set a username on your profile before writing.'; end if;
  new.author_name := uname;
  if not public.tdc_is_owner() and exists (select 1 from forum_bans where user_id = auth.uid() and (until is null or until > now())) then
    raise exception 'Your account is on a timeout.';
  end if;
  new.updated_at := now();
  if new.status = 'published' and new.published_at is null then new.published_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_fan_article_guard on public.fan_articles;
create trigger trg_fan_article_guard before insert or update on public.fan_articles
  for each row execute function public.fan_article_guard();

create or replace function public.fan_site_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_fan_site_touch on public.fan_sites;
create trigger trg_fan_site_touch before update on public.fan_sites for each row execute function public.fan_site_touch();

-- ── RPCs ────────────────────────────────────────────────────────────────────
-- approve / decline an application (editor of that team, or the owner)
create or replace function public.fan_review_application(p_id bigint, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare a fan_applications;
begin
  select * into a from fan_applications where id = p_id;
  if a.id is null then raise exception 'That application no longer exists.'; end if;
  if not public.fan_is_editor(a.team) then raise exception 'Only an editor of this site can review applications.'; end if;
  update fan_applications set status = case when p_approve then 'approved' else 'declined' end where id = p_id;
  if p_approve then
    insert into fan_writers (team, user_id, role) values (a.team, a.user_id, 'writer') on conflict do nothing;
  end if;
end $$;

-- the owner launches a site (or re-names it) and can hand the editor role to anyone by username
create or replace function public.fan_add_writer(p_team text, p_username text, p_role text default 'writer')
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.fan_is_editor(p_team) then raise exception 'Only an editor of this site can add writers.'; end if;
  select id into uid from profiles where lower(username) = lower(trim(p_username));
  if uid is null then raise exception 'No member has the username "%".', p_username; end if;
  insert into fan_writers (team, user_id, role) values (p_team, uid, coalesce(p_role, 'writer'))
    on conflict (team, user_id) do update set role = excluded.role;
end $$;

grant execute on function public.fan_review_application(bigint, boolean) to authenticated;
grant execute on function public.fan_add_writer(text, text, text) to authenticated;
grant execute on function public.fan_is_editor(text), public.fan_can_write(text), public.fan_is_any_writer() to anon, authenticated;

