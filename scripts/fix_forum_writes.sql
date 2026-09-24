-- Make sure a signed-in member can actually post on the forum.
--
-- The RLS lockdown gave forum_topics / forum_replies the right POLICIES — read all, write rows
-- where author_id is you — but policies are only half of it: PostgREST also needs the table
-- GRANT, and a `revoke` earlier in the lockdown can leave a table with perfect policies and no
-- privileges. The symptom is a 401/403 on insert that looks like a login problem.
--
-- Also installs trg_reply_count if it is missing. forum.html used to PATCH forum_topics.reply_count
-- from the client, which could never work on someone else's thread (RLS only allows writing your
-- own rows) and would double-count on your own once the trigger existed. The client no longer
-- touches it, so the trigger has to be there or replies stop being counted at all.
--
-- Run in the Supabase SQL editor. Safe to re-run.

-- 0) DIAGNOSTIC — policies and privileges as they stand
select tablename, policyname, cmd, roles
from pg_policies
where schemaname='public' and tablename in ('forum_topics','forum_replies')
order by tablename, policyname;

select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema='public' and table_name in ('forum_topics','forum_replies')
  and grantee in ('anon','authenticated')
group by table_name, grantee
order by table_name, grantee;

-- 1) privileges. RLS still decides WHICH rows; these decide whether the role may try at all.
grant select on public.forum_topics,  public.forum_replies to anon, authenticated;
grant insert, update, delete on public.forum_topics,  public.forum_replies to authenticated;

-- 2) the reply counter, server-side
create or replace function public.bump_reply_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.forum_topics
       set reply_count = coalesce(reply_count,0) + 1, updated_at = now()
     where id = new.topic_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.forum_topics
       set reply_count = greatest(coalesce(reply_count,0) - 1, 0)
     where id = old.topic_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists trg_reply_count on public.forum_replies;
create trigger trg_reply_count
  after insert or delete on public.forum_replies
  for each row execute function public.bump_reply_count();

-- 3) resync any counts that drifted while the client was doing it
update public.forum_topics t
   set reply_count = (select count(*) from public.forum_replies r where r.topic_id = t.id)
 where coalesce(t.reply_count,0) <> (select count(*) from public.forum_replies r where r.topic_id = t.id);

-- 4) VERIFY — authenticated should now hold INSERT on both tables.
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema='public' and table_name in ('forum_topics','forum_replies')
  and grantee in ('anon','authenticated')
group by table_name, grantee
order by table_name, grantee;
