drop policy if exists "Members can upload their own capsule photos" on storage.objects;
create policy "Members can upload their own capsule photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'capsule-photos'
  and exists (
    select 1
    from public.capsules c
    join public.couples co on co.id = c.couple_id
    where c.id::text = (storage.foldername(storage.objects.name))[2]
      and c.couple_id::text = (storage.foldername(storage.objects.name))[1]
      and (select auth.uid())::text = (storage.foldername(storage.objects.name))[3]
      and array_length(storage.foldername(storage.objects.name), 1) = 3
      and c.month = date_trunc('month', now() at time zone co.timezone)::date
      and public.is_couple_member(c.couple_id)
  )
);

drop policy if exists "Members can read photos when their memory is visible" on storage.objects;
create policy "Members can read photos when their memory is visible"
on storage.objects for select to authenticated
using (
  bucket_id = 'capsule-photos'
  and exists (
    select 1
    from public.memories mem
    join public.capsules c on c.id = mem.capsule_id
    where mem.photo_path = storage.objects.name
      and public.is_couple_member(c.couple_id)
      and (mem.author_id = (select auth.uid()) or c.opens_at <= now())
  )
);

drop policy if exists "Authors can remove unused current capsule photos" on storage.objects;
create policy "Authors can remove unused current capsule photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'capsule-photos'
  and (select auth.uid())::text = (storage.foldername(storage.objects.name))[3]
  and exists (
    select 1
    from public.capsules c
    join public.couples co on co.id = c.couple_id
    where c.id::text = (storage.foldername(storage.objects.name))[2]
      and c.couple_id::text = (storage.foldername(storage.objects.name))[1]
      and c.month = date_trunc('month', now() at time zone co.timezone)::date
      and public.is_couple_member(c.couple_id)
  )
  and not exists (
    select 1 from public.memories mem where mem.photo_path = storage.objects.name
  )
);
