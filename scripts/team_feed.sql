-- ============================================================================
--  TEAM FEED — Instagram-style posts + Substack-style articles on every team page (2026-10-18)
-- ----------------------------------------------------------------------------
--  Builds on the fan-site tables (scripts/fan_sites.sql, already run):
--    * fan_articles gains `kind` ('article' | 'post') and `media` (jsonb list of blocks:
--        {"t":"img","url":"https://…"}  {"t":"video","url":"https://youtube.com/…"}
--        {"t":"chart","c":"trend"|"shots"|"look","team":…,"full":…,"tid":…,"season":…})
--      A post needs no title (caption lives in `body`, ≤ 2,200 chars like Instagram); an article still needs one.
--    * fan_likes     — one heart per member per post/article
--    * fan_comments  — comments under a post/article (byline from the profile; bans + rate limits like the forum)
--  Who posts: the owner everywhere + that team's approved fan-site writers (unchanged fan_can_write()).
--  Who likes / comments: any signed-in member with a username who isn't timed out.
--
--  HOW TO RUN: Supabase → SQL Editor (project izlqhnxowdhtdofkwrho) → paste ALL of this with nothing
--  highlighted → Run. Safe to re-run. The last query lists the new columns/tables so you can see it worked.
-- ============================================================================

-- ── fan_articles: kind + media; title optional for posts ─────────────────────
alter table public.fan_articles add column if not exists kind  text  not null default 'article';
alter table public.fan_articles add column if not exists media jsonb not null default '[]'::jsonb;
alter table public.fan_articles drop constraint if exists fan_articles_kind_check;
alter table public.fan_articles add  constraint fan_articles_kind_check check (kind in ('article', 'post'));
alter table public.fan_articles alter column title drop not null;
alter table public.fan_articles drop constraint if exists fan_articles_title_check;
alter table public.fan_articles drop constraint if exists fan_articles_title_kind;
alter table public.fan_articles add  constraint fan_articles_title_kind check (
  (kind = 'article' and char_length(coalesce(title, '')) between 5 and 140)
  or (kind = 'post' and char_length(coalesce(title, '')) <= 140));
alter table public.fan_articles drop constraint if exists fan_articles_post_body;
alter table public.fan_articles add  constraint fan_articles_post_body check (kind = 'article' or char_length(body) <= 2200);
alter table public.fan_articles drop constraint if exists fan_articles_media_size;
alter table public.fan_articles add  constraint fan_articles_media_size check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 10);
create index if not exists fan_articles_feed on public.fan_articles (team, status, kind, published_at desc);

-- ── likes ────────────────────────────────────────────────────────────────────
create table if not exists public.fan_likes (
  article_id bigint not null references public.fan_articles(id) on delete cascade,
  user_id    uuid   not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (article_id, user_id)
);
alter table public.fan_likes enable row level security;
drop policy if exists "fl_read"   on public.fan_likes;
drop policy if exists "fl_insert" on public.fan_likes;
drop policy if exists "fl_delete" on public.fan_likes;
create policy "fl_read"   on public.fan_likes for select using (true);
create policy "fl_insert" on public.fan_likes for insert to authenticated with check (user_id = auth.uid());
create policy "fl_delete" on public.fan_likes for delete to authenticated using (user_id = auth.uid());

-- ── comments ─────────────────────────────────────────────────────────────────
create table if not exists public.fan_comments (
  id          bigserial primary key,
  article_id  bigint not null references public.fan_articles(id) on delete cascade,
  author_id   uuid   not null default auth.uid(),
  author_name text,
  body        text   not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists fan_comments_article on public.fan_comments (article_id, created_at);
alter table public.fan_comments enable row level security;
drop policy if exists "fc_read"   on public.fan_comments;
drop policy if exists "fc_insert" on public.fan_comments;
drop policy if exists "fc_delete" on public.fan_comments;
create policy "fc_read"   on public.fan_comments for select using (true);
create policy "fc_insert" on public.fan_comments for insert to authenticated with check (author_id = auth.uid());
-- the author, that team's editors, or the owner can remove a comment
create policy "fc_delete" on public.fan_comments for delete to authenticated using (
  author_id = auth.uid() or public.tdc_is_owner()
  or exists (select 1 from fan_articles a where a.id = article_id and public.fan_is_editor(a.team)));

-- byline from the profile, bans, the forum's banned words, and a rate limit (owner exempt)
create or replace function public.fan_comment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  select username into uname from profiles where id = new.author_id;
  if coalesce(uname, '') = '' then raise exception 'Set a username on your profile before commenting.'; end if;
  new.author_name := uname;
  new.created_at  := now();
  if not public.tdc_is_owner() then
    if exists (select 1 from forum_bans where user_id = new.author_id and (until is null or until > now())) then
      raise exception 'Your account is on a timeout.'; end if;
    if exists (select 1 from fan_comments where author_id = new.author_id and created_at > now() - interval '15 seconds') then
      raise exception 'Slow down — one comment every 15 seconds.'; end if;
    if (select count(*) from fan_comments where author_id = new.author_id and created_at > now() - interval '1 hour') >= 40 then
      raise exception 'Comment limit reached — try again in a bit.'; end if;
    if exists (select 1 from forum_banned_words w where position(lower(w.word) in lower(new.body)) > 0) then
      raise exception 'That comment contains a blocked word.'; end if;
  end if;
  if not exists (select 1 from fan_articles where id = new.article_id and status = 'published') then
    raise exception 'You can only comment on published posts.'; end if;
  return new;
end $$;
drop trigger if exists trg_fan_comment_guard on public.fan_comments;
create trigger trg_fan_comment_guard before insert on public.fan_comments
  for each row execute function public.fan_comment_guard();

grant select on public.fan_likes, public.fan_comments to anon, authenticated;
grant insert, delete on public.fan_likes, public.fan_comments to authenticated;
grant usage, select on sequence public.fan_comments_id_seq to authenticated;

-- ── check: you should see kind + media on fan_articles, and both new tables ──
select table_name, string_agg(column_name, ', ' order by ordinal_position) as columns
from information_schema.columns
where table_schema = 'public' and table_name in ('fan_articles', 'fan_likes', 'fan_comments')
group by table_name order by table_name;
