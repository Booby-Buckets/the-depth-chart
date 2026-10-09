-- Dynasty account saves (Oct 2026). Each signed-in user's dynasties, synced from the browser so a dynasty
-- follows the account across devices and survives a cleared browser. The browser keeps its own IndexedDB copy
-- (instant, offline); this table is the account copy. `data` is the dehydrated league JSON, gzip'd + base64
-- by js/dynasty/ui/cloud.js (~3 MB of JSON -> well under 1 MB).
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists public.dynasty_saves (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  slot       text        not null check (char_length(slot) between 1 and 64),
  meta       jsonb       not null default '{}'::jsonb,                 -- {team, year, w, l, phase, coach}
  data       text        not null check (octet_length(data) <= 8000000),
  size       integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

alter table public.dynasty_saves enable row level security;

-- every row belongs to exactly one account: you can only see and change your own
drop policy if exists "dynasty_saves own select" on public.dynasty_saves;
drop policy if exists "dynasty_saves own insert" on public.dynasty_saves;
drop policy if exists "dynasty_saves own update" on public.dynasty_saves;
drop policy if exists "dynasty_saves own delete" on public.dynasty_saves;
create policy "dynasty_saves own select" on public.dynasty_saves for select to authenticated using (user_id = auth.uid());
create policy "dynasty_saves own insert" on public.dynasty_saves for insert to authenticated with check (user_id = auth.uid());
create policy "dynasty_saves own update" on public.dynasty_saves for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dynasty_saves own delete" on public.dynasty_saves for delete to authenticated using (user_id = auth.uid());

revoke all on public.dynasty_saves from anon;
grant select, insert, update, delete on public.dynasty_saves to authenticated;

-- at most 10 dynasties per account (each is up to a few hundred KB compressed)
create or replace function public.dynasty_saves_cap() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- an upsert of an EXISTING dynasty fires BEFORE INSERT too (before the conflict is found) — never block those
  if exists (select 1 from public.dynasty_saves where user_id = new.user_id and slot = new.slot) then return new; end if;
  if (select count(*) from public.dynasty_saves where user_id = new.user_id) >= 10 then
    raise exception 'You can keep up to 10 dynasties on your account. Delete one to start another.';
  end if;
  return new;
end $$;
drop trigger if exists dynasty_saves_cap on public.dynasty_saves;
create trigger dynasty_saves_cap before insert on public.dynasty_saves for each row execute function public.dynasty_saves_cap();

create index if not exists dynasty_saves_user_updated on public.dynasty_saves (user_id, updated_at desc);
