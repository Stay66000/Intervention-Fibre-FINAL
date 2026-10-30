-- Supabase remains authoritative; leases serialize every writer to a workbook.
alter table public.google_backup_connections
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists last_reconcile_report jsonb,
  add column if not exists reconcile_requested boolean not null default false,
  add column if not exists reconcile_next_attempt_at timestamptz not null default now(),
  add column if not exists reconcile_attempts integer not null default 0 check(reconcile_attempts between 0 and 5);
create table public.google_backup_leases (
  spreadsheet_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.google_backup_leases enable row level security;
revoke all on public.google_backup_leases from public,anon,authenticated;
grant all on public.google_backup_leases to service_role;
create index if not exists google_backup_jobs_user_due_v2 on public.google_backup_jobs(user_id,next_attempt_at,created_at) where status='pending';

create or replace function private.google_backup_recipient(i public.interventions, u uuid)
returns boolean language sql stable set search_path='' as $$
  select i.user_id=u or i.solo_user_id=u or exists(
    select 1 from public.team_members tm where tm.team_id=i.team_id and tm.user_id=u
      and tm.status in ('active','ended') and i.created_at>=tm.joined_at
      and (tm.ended_at is null or i.created_at<=tm.ended_at)
  );
$$;
create or replace function private.google_backup_snapshot(i public.interventions, u uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare s jsonb; h boolean; payout numeric;
begin
  s:=to_jsonb(i)-'agency_amount_snapshot';
  select coalesce(bool_or(cm.hide_prices),false) into h from public.company_members cm
    where cm.company_id=i.company_id and cm.user_id=u;
  if i.company_id is not null then
    select ip.payout_amount_snapshot into payout from public.intervention_payments ip where ip.intervention_id=i.id and ip.user_id=u limit 1;
    payout:=coalesce(payout,case when i.user_id=u then i.applied_amount else 0 end,0);
  elsif i.work_mode='Binôme' then payout:=coalesce(i.applied_amount,0)/2;
  elsif i.work_mode='Solo' then payout:=case when i.solo_user_id=u then coalesce(i.applied_amount,0) else 0 end;
  else payout:=case when i.user_id=u then coalesce(i.applied_amount,0) else 0 end;
  end if;
  if h then
    s:=s-'applied_amount';
    s:=jsonb_set(s,'{operator_data}',coalesce(s->'operator_data','{}'::jsonb)-array['supplement','supplement_amount','amount','price','unit_price','agency_amount','technician_amount']::text[],true);
    s:=s||jsonb_build_object('backup_price_hidden',true);
  else s:=s||jsonb_build_object('backup_personal_amount',payout);
  end if;
  return s;
end $$;
revoke all on function private.google_backup_recipient(public.interventions,uuid),private.google_backup_snapshot(public.interventions,uuid) from public,anon,authenticated;
grant execute on function private.google_backup_recipient(public.interventions,uuid),private.google_backup_snapshot(public.interventions,uuid) to service_role;

create or replace function private.google_backup_source(p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('rows',coalesce((select jsonb_agg(private.google_backup_snapshot(i,p_user_id) order by i.id)
    from public.interventions i where private.google_backup_recipient(i,p_user_id)),'[]'::jsonb),
    'hide_prices',exists(select 1 from public.company_members cm where cm.user_id=p_user_id and cm.hide_prices and cm.status='active'));
$$;
revoke all on function private.google_backup_source(uuid) from public,anon,authenticated;
grant execute on function private.google_backup_source(uuid) to service_role;
create or replace function public.google_backup_source(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.google_backup_source(p_user_id); $$;
revoke all on function public.google_backup_source(uuid) from public,anon,authenticated;
grant execute on function public.google_backup_source(uuid) to service_role;

create or replace function public.acquire_google_backup_lease(p_user_id uuid,p_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare sid text; claimed uuid;
begin
  select spreadsheet_id into sid from public.google_backup_connections where user_id=p_user_id and status='connected';
  if sid is null then return false; end if;
  insert into public.google_backup_leases as l(spreadsheet_id,user_id,token,expires_at)
    values(sid,p_user_id,p_token,now()+interval '4 minutes')
    on conflict(spreadsheet_id) do update set token=excluded.token,user_id=excluded.user_id,expires_at=excluded.expires_at
    where l.expires_at<now() returning token into claimed;
  return claimed=p_token;
end $$;
create or replace function public.renew_google_backup_lease(p_user_id uuid,p_token uuid)
returns boolean language sql security invoker set search_path='' as $$
  with renewed as(update public.google_backup_leases l set expires_at=now()+interval '4 minutes'
    where l.user_id=p_user_id and l.token=p_token and l.expires_at>now()
    and exists(select 1 from public.google_backup_connections c where c.user_id=p_user_id and c.spreadsheet_id=l.spreadsheet_id and c.status='connected') returning 1)
  select exists(select 1 from renewed);
$$;
create or replace function public.claim_google_backup_jobs_v2(p_user_id uuid,p_token uuid,p_limit integer default 100)
returns setof public.google_backup_jobs language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.google_backup_leases where user_id=p_user_id and token=p_token and expires_at>now()) then raise exception 'BACKUP_LEASE_REQUIRED'; end if;
  -- A crashed process cannot write after the lease expires; recover only under a new lease.
  update public.google_backup_jobs set status=case when attempts>=5 then 'dead' else 'pending' end,locked_at=null
    where user_id=p_user_id and status='processing' and locked_at<now()-interval '4 minutes';
  return query with candidates as(
    select id from public.google_backup_jobs where user_id=p_user_id and status='pending' and attempts<5 and next_attempt_at<=now()
      order by created_at,id for update skip locked limit greatest(1,least(p_limit,100))
  ) update public.google_backup_jobs j set status='processing',attempts=j.attempts+1,locked_at=now(),last_attempt_at=now(),updated_at=now()
    from candidates c where j.id=c.id returning j.*;
end $$;

create or replace function private.enqueue_google_backup_intervention()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.interventions%rowtype; u uuid; s jsonb; action text;
begin
  if tg_op='DELETE' then r:=old; action:='delete'; else r:=new; action:='upsert'; end if;
  for u in select c.user_id from public.google_backup_connections c
    where private.google_backup_recipient(r,c.user_id)
       or (tg_op='UPDATE' and private.google_backup_recipient(old,c.user_id))
  loop
    s:=private.google_backup_snapshot(r,u);
    insert into public.google_backup_jobs(user_id,intervention_id,action,snapshot) values(u,r.id,action,s);
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
-- Stable even if a privileged client tries to change the PK.
create or replace function private.google_backup_immutable_id()
returns trigger language plpgsql set search_path='' as $$
begin if new.id is distinct from old.id then raise exception 'Intervention ID is immutable'; end if; return new; end $$;
create trigger google_backup_immutable_id before update of id on public.interventions for each row execute function private.google_backup_immutable_id();
revoke all on function private.google_backup_immutable_id() from public,anon,authenticated;

-- Statement-level wake-up: pg_net starts after COMMIT, Google is never in the save path.
create or replace function private.invoke_google_backup_worker()
returns bigint language plpgsql security definer set search_path='' as $$
declare secret text; request_id bigint;
begin
  if not exists(select 1 from public.google_backup_connections c where c.status='connected' and
    ((c.reconcile_requested and c.reconcile_next_attempt_at<=now() and c.reconcile_attempts<5) or exists(select 1 from public.google_backup_jobs j where j.user_id=c.user_id and
      ((j.status='pending' and j.attempts<5 and j.next_attempt_at<=now()) or (j.status='processing' and j.locked_at<now()-interval '4 minutes'))))) then return null; end if;
  select worker_secret into secret from public.google_backup_worker_config where singleton;
  if secret is null then return null; end if;
  select net.http_post(url:='https://dvvoqfswlqdwvxamfsot.supabase.co/functions/v1/google-drive-backup-worker',
    headers:=jsonb_build_object('Content-Type','application/json','x-fibre-worker',secret),body:='{}'::jsonb,timeout_milliseconds:=90000) into request_id;
  return request_id;
exception when others then
  -- The queue row remains durable; cron is the fallback if pg_net is unavailable.
  return null;
end $$;
create or replace function private.google_backup_wake_on_jobs()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('fibre_ops.google_backup_woken',true) is distinct from '1' then
    perform set_config('fibre_ops.google_backup_woken','1',true);
    perform private.invoke_google_backup_worker();
  end if;
  return null;
end $$;
create trigger google_backup_wake_on_jobs after insert on public.google_backup_jobs for each statement execute function private.google_backup_wake_on_jobs();
revoke all on function private.google_backup_wake_on_jobs() from public,anon,authenticated;

create or replace function public.release_google_backup_lease(p_user_id uuid,p_token uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  delete from public.google_backup_leases where user_id=p_user_id and token=p_token;
  -- Work enqueued while this process held the lease must get its own fresh snapshot/read.
  perform private.invoke_google_backup_worker();
end $$;
grant execute on function private.invoke_google_backup_worker() to service_role;
create or replace function public.google_backup_wake()
returns void language sql security invoker set search_path='' as $$ select private.invoke_google_backup_worker(); $$;
revoke all on function public.google_backup_wake(),public.acquire_google_backup_lease(uuid,uuid),public.renew_google_backup_lease(uuid,uuid),public.release_google_backup_lease(uuid,uuid),public.claim_google_backup_jobs_v2(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.google_backup_wake(),public.acquire_google_backup_lease(uuid,uuid),public.renew_google_backup_lease(uuid,uuid),public.release_google_backup_lease(uuid,uuid),public.claim_google_backup_jobs_v2(uuid,uuid,integer) to service_role;
-- Privacy is applied by the serialized mirror writer on changes/reconciliation.
select cron.unschedule(jobid) from cron.job where jobname='fibre_ops_google_backup_privacy_worker';
create or replace function public.google_backup_due_users()
returns table(user_id uuid,reconcile boolean) language sql stable security invoker set search_path='' as $$
  select c.user_id,(c.reconcile_requested and c.reconcile_next_attempt_at<=now() and c.reconcile_attempts<5) from public.google_backup_connections c where c.status='connected'
    and ((c.reconcile_requested and c.reconcile_next_attempt_at<=now() and c.reconcile_attempts<5) or exists(select 1 from public.google_backup_jobs j where j.user_id=c.user_id and
      ((j.status='pending' and j.attempts<5 and j.next_attempt_at<=now()) or (j.status='processing' and j.locked_at<now()-interval '4 minutes'))))
    and not exists(select 1 from public.google_backup_leases l where l.spreadsheet_id=c.spreadsheet_id and l.expires_at>now())
  order by c.last_success_at nulls first limit 10;
$$;
revoke all on function public.google_backup_due_users() from public,anon,authenticated;
grant execute on function public.google_backup_due_users() to service_role;
grant usage on schema private to service_role;
-- Retired workers cannot claim jobs outside the workbook lease during a rollout.
create or replace function public.claim_google_backup_jobs(p_limit integer default 12)
returns setof public.google_backup_jobs language sql security invoker set search_path='' as $$
  select j.* from public.google_backup_jobs j where false;
$$;
