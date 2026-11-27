alter table public.capsules
add column if not exists opened_at timestamptz;

update public.capsules c
set opens_at = ((c.month + 24)::timestamp at time zone co.timezone)
from public.couples co
where co.id = c.couple_id
  and c.opened_at is null;

delete from public.capsules c
using public.couples co
where co.id = c.couple_id
  and c.month > date_trunc('month', now() at time zone co.timezone)::date
  and not exists (
    select 1
    from public.memories mem
    where mem.capsule_id = c.id
  );

create or replace function public.get_current_capsule(p_couple_id uuid)
returns setof public.capsules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_month date;
  v_capsule public.capsules;
begin
  if not public.is_couple_member(p_couple_id) then
    raise exception 'Tu ne fais pas partie de ce couple.';
  end if;

  select c.timezone into v_timezone
  from public.couples c
  where c.id = p_couple_id;

  if v_timezone is null then
    raise exception 'Le couple est introuvable.';
  end if;

  select c.* into v_capsule
  from public.capsules c
  where c.couple_id = p_couple_id
    and c.opened_at is null
  order by c.month asc
  limit 1;

  if found then
    return next v_capsule;
    return;
  end if;

  select c.* into v_capsule
  from public.capsules c
  where c.couple_id = p_couple_id
  order by c.month desc
  limit 1;

  if found then
    return next v_capsule;
    return;
  end if;

  v_month := date_trunc('month', now() at time zone v_timezone)::date;
  insert into public.capsules (couple_id, month, opens_at)
  values (
    p_couple_id,
    v_month,
    ((v_month + 24)::timestamp at time zone v_timezone)
  )
  on conflict (couple_id, month) do nothing;

  select c.* into v_capsule
  from public.capsules c
  where c.couple_id = p_couple_id
    and c.month = v_month;

  return next v_capsule;
end;
$$;

create or replace function public.open_capsule(p_capsule_id uuid)
returns setof public.capsules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capsule public.capsules;
begin
  select c.* into v_capsule
  from public.capsules c
  where c.id = p_capsule_id
    and public.is_couple_member(c.couple_id)
  for update;

  if not found then
    raise exception 'Capsule introuvable ou accès refusé.';
  end if;

  if v_capsule.opened_at is null and v_capsule.opens_at > now() then
    raise exception 'Cette capsule n’est pas encore prête à être ouverte.';
  end if;

  update public.capsules
  set opened_at = coalesce(opened_at, now())
  where id = p_capsule_id
  returning * into v_capsule;

  return next v_capsule;
end;
$$;

create or replace function public.start_next_capsule(p_capsule_id uuid)
returns setof public.capsules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.capsules;
  v_timezone text;
  v_month date;
  v_next public.capsules;
begin
  select c.* into v_previous
  from public.capsules c
  where c.id = p_capsule_id
    and public.is_couple_member(c.couple_id)
  for update;

  if not found then
    raise exception 'Capsule introuvable ou accès refusé.';
  end if;

  if v_previous.opened_at is null then
    raise exception 'Ouvre la capsule actuelle avant d’en démarrer une autre.';
  end if;

  select co.timezone into v_timezone
  from public.couples co
  where co.id = v_previous.couple_id;

  v_month := date_trunc('month', now() at time zone v_timezone)::date;
  if v_month <= v_previous.month then
    v_month := (v_previous.month + interval '1 month')::date;
  end if;

  if exists (
    select 1
    from public.capsules c
    where c.couple_id = v_previous.couple_id
      and c.opened_at is null
      and c.month <> v_month
  ) then
    raise exception 'Une capsule est déjà en cours.';
  end if;

  insert into public.capsules (couple_id, month, opens_at)
  values (
    v_previous.couple_id,
    v_month,
    ((v_month + 24)::timestamp at time zone v_timezone)
  )
  on conflict (couple_id, month) do nothing;

  select c.* into v_next
  from public.capsules c
  where c.couple_id = v_previous.couple_id
    and c.month = v_month
    and c.opened_at is null;

  if not found then
    raise exception 'La prochaine capsule n’a pas pu être démarrée.';
  end if;

  return next v_next;
end;
$$;

revoke all on function public.get_current_capsule(uuid) from public;
revoke all on function public.open_capsule(uuid) from public;
revoke all on function public.start_next_capsule(uuid) from public;
grant execute on function public.get_current_capsule(uuid) to authenticated;
grant execute on function public.open_capsule(uuid) to authenticated;
grant execute on function public.start_next_capsule(uuid) to authenticated;

drop policy if exists "Authors and unlocked capsule members can read memories" on public.memories;
create policy "Authors and opened capsule members can read memories"
on public.memories for select to authenticated
using (
  author_id = (select auth.uid())
  or exists (
    select 1
    from public.capsules c
    where c.id = capsule_id
      and c.opened_at is not null
      and public.is_couple_member(c.couple_id)
  )
);

drop policy if exists "Members can add memories to the current capsule" on public.memories;
create policy "Members can add memories to the current capsule"
on public.memories for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1
    from public.capsules c
    where c.id = capsule_id
      and c.opened_at is null
      and public.is_couple_member(c.couple_id)
      and (
        photo_path is null
        or (
          (storage.foldername(photo_path))[1] = c.couple_id::text
          and (storage.foldername(photo_path))[2] = c.id::text
          and (storage.foldername(photo_path))[3] = (select auth.uid())::text
          and array_length(storage.foldername(photo_path), 1) = 3
        )
      )
  )
);

drop policy if exists "Members can upload their own capsule photos" on storage.objects;
create policy "Members can upload their own capsule photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'capsule-photos'
  and exists (
    select 1
    from public.capsules c
    where c.id::text = (storage.foldername(storage.objects.name))[2]
      and c.couple_id::text = (storage.foldername(storage.objects.name))[1]
      and (select auth.uid())::text = (storage.foldername(storage.objects.name))[3]
      and array_length(storage.foldername(storage.objects.name), 1) = 3
      and c.opened_at is null
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
      and (mem.author_id = (select auth.uid()) or c.opened_at is not null)
  )
);
