create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.google_backup_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text,
  spreadsheet_id text,
  spreadsheet_url text,
  status text not null default 'connecting'
    check (status in ('connecting','connected','error','disconnected')),
  known_sheets jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  disconnected_at timestamptz
);

create table if not exists public.google_backup_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  granted_scopes text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

create table if not exists public.google_backup_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.google_backup_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  intervention_id uuid,
  action text not null check (action in ('upsert','delete')),
  snapshot jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','processing','done','dead','cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_backup_worker_config (
  singleton boolean primary key default true check (singleton),
  worker_secret text not null,
  created_at timestamptz not null default now()
);

insert into public.google_backup_worker_config(singleton, worker_secret)
values (true, encode(gen_random_bytes(32), 'hex'))
on conflict (singleton) do nothing;

create index if not exists google_backup_jobs_due_idx
  on public.google_backup_jobs(status, next_attempt_at, created_at);
create index if not exists google_backup_jobs_user_attempt_idx
  on public.google_backup_jobs(user_id, last_attempt_at desc)
  where last_attempt_at is not null;

alter table public.google_backup_connections enable row level security;
alter table public.google_backup_tokens enable row level security;
alter table public.google_backup_oauth_states enable row level security;
alter table public.google_backup_jobs enable row level security;
alter table public.google_backup_worker_config enable row level security;

revoke all on public.google_backup_connections from anon, authenticated, public;
revoke all on public.google_backup_tokens from anon, authenticated, public;
revoke all on public.google_backup_oauth_states from anon, authenticated, public;
revoke all on public.google_backup_jobs from anon, authenticated, public;
revoke all on public.google_backup_worker_config from anon, authenticated, public;

grant select on public.google_backup_connections to authenticated;
grant all on public.google_backup_connections to service_role;
grant all on public.google_backup_tokens to service_role;
grant all on public.google_backup_oauth_states to service_role;
grant all on public.google_backup_jobs to service_role;
grant all on public.google_backup_worker_config to service_role;

drop policy if exists google_backup_connections_select_own on public.google_backup_connections;
create policy google_backup_connections_select_own
on public.google_backup_connections
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_active_user())
);

create or replace function private.enqueue_google_backup_intervention()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user_id uuid;
  v_intervention_id uuid;
  v_snapshot jsonb;
  v_action text;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    v_intervention_id := old.id;
    v_snapshot := to_jsonb(old);
    v_action := 'delete';
  else
    v_user_id := new.user_id;
    v_intervention_id := new.id;
    v_snapshot := to_jsonb(new);
    v_action := 'upsert';
  end if;

  if v_user_id is not null and exists (
    select 1 from public.google_backup_connections c
    where c.user_id = v_user_id and c.status = 'connected'
  ) then
    insert into public.google_backup_jobs(user_id, intervention_id, action, snapshot)
    values (v_user_id, v_intervention_id, v_action, v_snapshot);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

revoke all on function private.enqueue_google_backup_intervention() from public, anon, authenticated;

drop trigger if exists fibre_ops_google_backup_intervention on public.interventions;
create trigger fibre_ops_google_backup_intervention
after insert or update or delete on public.interventions
for each row execute function private.enqueue_google_backup_intervention();

create or replace function public.claim_google_backup_jobs(p_limit integer default 12)
returns setof public.google_backup_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.google_backup_jobs
  set status = case when attempts >= 5 then 'dead' else 'pending' end,
      locked_at = null,
      next_attempt_at = case when attempts >= 5 then next_attempt_at else now() end,
      updated_at = now(),
      last_error = coalesce(last_error, 'Worker interrompu avant finalisation')
  where status = 'processing'
    and locked_at < now() - interval '10 minutes';

  return query
  with candidates as (
    select j.id
    from public.google_backup_jobs j
    join public.google_backup_connections c
      on c.user_id = j.user_id
     and c.status = 'connected'
    where j.status = 'pending'
      and j.next_attempt_at <= now()
      and j.attempts < 5
      and (
        select count(*)
        from public.google_backup_jobs recent
        where recent.user_id = j.user_id
          and recent.last_attempt_at > now() - interval '1 minute'
      ) < 30
      and (
        select count(*)
        from public.google_backup_jobs today
        where today.user_id = j.user_id
          and today.last_attempt_at > now() - interval '24 hours'
      ) < 300
    order by j.next_attempt_at, j.created_at
    for update of j skip locked
    limit greatest(1, least(coalesce(p_limit, 12), 20))
  )
  update public.google_backup_jobs j
  set status = 'processing',
      attempts = j.attempts + 1,
      last_attempt_at = now(),
      locked_at = now(),
      updated_at = now()
  from candidates c
  where j.id = c.id
  returning j.*;
end
$$;

revoke all on function public.claim_google_backup_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_google_backup_jobs(integer) to service_role;

create or replace function private.invoke_google_backup_worker()
returns bigint
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select worker_secret into v_secret
  from public.google_backup_worker_config
  where singleton = true;

  if v_secret is null then
    raise exception 'google backup worker secret missing';
  end if;

  select net.http_post(
    url := 'https://dvvoqfswlqdwvxamfsot.supabase.co/functions/v1/google-drive-backup-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-fibre-worker', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  ) into v_request_id;

  return v_request_id;
end
$$;

revoke all on function private.invoke_google_backup_worker() from public, anon, authenticated;

select cron.schedule(
  'fibre_ops_google_backup_worker',
  '* * * * *',
  $$select private.invoke_google_backup_worker();$$
);