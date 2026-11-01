create table public.couples (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Notre capsule',
  timezone text not null default 'Europe/Paris' check (length(timezone) > 0),
  created_at timestamptz not null default now()
);

create table public.memberships (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'partner')),
  display_name text not null,
  created_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);

create unique index memberships_one_admin_per_couple_idx
on public.memberships(couple_id)
where role = 'admin';

create table public.capsules (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  month date not null,
  opens_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (couple_id, month)
);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  capsule_id uuid not null references public.capsules(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  note text not null default '' check (length(note) <= 2000),
  photo_path text,
  created_at timestamptz not null default now(),
  constraint memory_has_content check (length(trim(note)) > 0 or photo_path is not null)
);

create index capsules_couple_month_idx on public.capsules(couple_id, month desc);
create index memories_capsule_created_idx on public.memories(capsule_id, created_at);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'capsule-photos',
  'capsule-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.is_couple_member(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.couple_id = p_couple_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_couple_admin(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.couple_id = p_couple_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
  );
$$;

revoke all on function public.is_couple_member(uuid) from public;
revoke all on function public.is_couple_admin(uuid) from public;
grant execute on function public.is_couple_member(uuid) to authenticated;
grant execute on function public.is_couple_admin(uuid) to authenticated;

create or replace function public.get_current_capsule(p_couple_id uuid)
returns setof public.capsules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_month date;
  v_previous_month date;
  v_capsule public.capsules;
begin
  if not public.is_couple_member(p_couple_id) then
    raise exception 'You are not a member of this couple.';
  end if;

  select c.timezone into v_timezone
  from public.couples c
  where c.id = p_couple_id;

  if v_timezone is null then
    raise exception 'Couple was not found.';
  end if;

  v_month := date_trunc('month', now() at time zone v_timezone)::date;
  v_previous_month := (v_month - interval '1 month')::date;

  insert into public.capsules (couple_id, month, opens_at)
  values (
    p_couple_id,
    v_previous_month,
    ((v_month + 24)::timestamp at time zone v_timezone)
  ), (
    p_couple_id,
    v_month,
    (((v_month + interval '1 month')::date + 24)::timestamp at time zone v_timezone)
  )
  on conflict (couple_id, month) do nothing;

  select c.* into v_capsule
  from public.capsules c
  where c.couple_id = p_couple_id and c.month = v_month;

  return next v_capsule;
end;
$$;

create or replace function public.get_capsule_progress(p_capsule_id uuid)
returns table(user_id uuid, display_name text, entry_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_couple_id uuid;
begin
  select c.couple_id into v_couple_id
  from public.capsules c
  where c.id = p_capsule_id;

  if v_couple_id is null or not public.is_couple_admin(v_couple_id) then
    raise exception 'Administrator access is required.';
  end if;

  return query
  select m.user_id, m.display_name, count(mem.id)::bigint
  from public.memberships m
  left join public.memories mem
    on mem.author_id = m.user_id and mem.capsule_id = p_capsule_id
  where m.couple_id = v_couple_id
  group by m.user_id, m.display_name
  order by m.display_name;
end;
$$;

revoke all on function public.get_current_capsule(uuid) from public;
revoke all on function public.get_capsule_progress(uuid) from public;
grant execute on function public.get_current_capsule(uuid) to authenticated;
grant execute on function public.get_capsule_progress(uuid) to authenticated;

alter table public.couples enable row level security;
alter table public.memberships enable row level security;
alter table public.capsules enable row level security;
alter table public.memories enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "Couple members can read their couple"
on public.couples for select to authenticated
using (public.is_couple_member(id));

create policy "Couple members can read membership names"
on public.memberships for select to authenticated
using (public.is_couple_member(couple_id));

create policy "Couple members can read capsule dates"
on public.capsules for select to authenticated
using (public.is_couple_member(couple_id));

create policy "Authors and unlocked capsule members can read memories"
on public.memories for select to authenticated
using (
  author_id = (select auth.uid())
  or exists (
    select 1
    from public.capsules c
    where c.id = capsule_id
      and c.opens_at <= now()
      and public.is_couple_member(c.couple_id)
  )
);

create policy "Members can add memories to the current capsule"
on public.memories for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1
    from public.capsules c
    join public.couples co on co.id = c.couple_id
    where c.id = capsule_id
      and c.month = date_trunc('month', now() at time zone co.timezone)::date
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

create policy "Users can read their own push subscriptions"
on public.push_subscriptions for select to authenticated
using (user_id = (select auth.uid()));

create policy "Members can register their own push subscriptions"
on public.push_subscriptions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_couple_member(couple_id)
);

create policy "Users can update their own push subscriptions"
on public.push_subscriptions for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and public.is_couple_member(couple_id)
);

create policy "Users can remove their own push subscriptions"
on public.push_subscriptions for delete to authenticated
using (user_id = (select auth.uid()));

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

grant select on public.couples, public.memberships, public.capsules to authenticated;
grant select, insert on public.memories to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
