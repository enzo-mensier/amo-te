create table public.login_pins (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pin_hash text not null check (pin_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);

alter table public.login_pins enable row level security;
revoke all on table public.login_pins from public, anon, authenticated;
grant all on table public.login_pins to service_role;
