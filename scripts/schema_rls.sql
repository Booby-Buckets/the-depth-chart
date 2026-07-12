-- Fix the CRITICAL "RLS Disabled in Public" advisories on the new game-data
-- tables. Enable Row Level Security and allow PUBLIC READ only — writes are then
-- blocked for the anon/publishable key, while the service key (loaders) bypasses
-- RLS and can still write. Run once in the Supabase SQL editor.

alter table public.games            enable row level security;
alter table public.box_scores       enable row level security;
alter table public.team_seasons     enable row level security;
alter table public.postseason_games enable row level security;
alter table public.awards           enable row level security;

create policy "public read" on public.games            for select using (true);
create policy "public read" on public.box_scores       for select using (true);
create policy "public read" on public.team_seasons     for select using (true);
create policy "public read" on public.postseason_games for select using (true);
create policy "public read" on public.awards           for select using (true);
