-- Part 2 of fan_sites.sql: image uploads (run after part 1).
-- ── image uploads: public bucket, writers upload into their own folder ─────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fan-media', 'fan-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fan_media_read"   on storage.objects;
drop policy if exists "fan_media_upload" on storage.objects;
drop policy if exists "fan_media_delete" on storage.objects;
create policy "fan_media_read" on storage.objects for select using (bucket_id = 'fan-media');
create policy "fan_media_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'fan-media' and (storage.foldername(name))[1] = auth.uid()::text and public.fan_is_any_writer());
create policy "fan_media_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'fan-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.tdc_is_owner()));

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select tablename, policyname, cmd from pg_policies
 where schemaname = 'public' and tablename like 'fan_%' order by tablename, policyname;
