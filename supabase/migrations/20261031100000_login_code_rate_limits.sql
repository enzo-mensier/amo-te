create table public.login_code_rate_limits (
  bucket_hash text primary key check (bucket_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 5)
);

alter table public.login_code_rate_limits enable row level security;
revoke all on table public.login_code_rate_limits from public, anon, authenticated;

create or replace function public.consume_login_code_attempt(p_bucket_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_started_at timestamptz;
  v_attempts integer;
begin
  if p_bucket_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit key.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_bucket_hash, 0));

  delete from public.login_code_rate_limits
  where window_started_at < pg_catalog.now() - interval '1 day';

  select r.window_started_at, r.attempts
  into v_window_started_at, v_attempts
  from public.login_code_rate_limits r
  where r.bucket_hash = p_bucket_hash;

  if not found or v_window_started_at < pg_catalog.now() - interval '15 minutes' then
    insert into public.login_code_rate_limits (bucket_hash, window_started_at, attempts)
    values (p_bucket_hash, pg_catalog.now(), 1)
    on conflict (bucket_hash) do update
      set window_started_at = excluded.window_started_at,
          attempts = excluded.attempts;
    return true;
  end if;

  if v_attempts >= 5 then
    return false;
  end if;

  update public.login_code_rate_limits
  set attempts = attempts + 1
  where bucket_hash = p_bucket_hash;
  return true;
end;
$$;

revoke all on function public.consume_login_code_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_login_code_attempt(text) to service_role;
