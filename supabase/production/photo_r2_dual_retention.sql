-- STAGING ONLY: do not apply automatically. No production data is modified by this file.
-- Apply ONLY after backup configuration, worker secret provision and user approval.
-- Uses the existing per-account photo grants configured by the admin UI.

begin;

create table if not exists private.photo_production_cleanup_queue (
  job_id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null,
  photo_id uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists photo_production_cleanup_unique
  on private.photo_production_cleanup_queue (intervention_id,photo_id) nulls not distinct;
alter table private.photo_production_cleanup_queue enable row level security;
revoke all on private.photo_production_cleanup_queue from public, anon, authenticated;

create table if not exists private.photo_production_worker_config (
  singleton boolean primary key default true check(singleton),
  secret_hash text not null
);
alter table private.photo_production_worker_config enable row level security;
revoke all on private.photo_production_worker_config from public, anon, authenticated;

create or replace function public.photo_my_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.is_active_user()
    and exists(select 1 from private.photo_preview_grants g
               where g.user_id=auth.uid() and g.enabled);
$$;
revoke all on function public.photo_my_access() from public, anon;
grant execute on function public.photo_my_access() to authenticated;

create or replace function public.photo_can_access(p_intervention_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_row public.interventions%rowtype;
begin
  perform private.assert_api_user();
  if v_user is null or not public.photo_my_access() or p_intervention_id is null then return false; end if;
  select * into v_row from public.interventions i where i.id=p_intervention_id;
  if not found then return false; end if;
  if v_row.company_id is null then
    if lower(coalesce(v_row.work_mode,'')) in ('binome','binôme') and v_row.team_id is not null then
      return exists(select 1 from public.team_members tm
                    where tm.team_id=v_row.team_id and tm.user_id=v_user
                      and tm.status in ('active','ended'));
    end if;
    return v_row.user_id=v_user or v_row.solo_user_id=v_user;
  end if;
  if private.fibre_ops_is_platform_admin() or not private.is_company_member(v_row.company_id)
     or not private.company_is_active(v_row.company_id) then return false; end if;
  if lower(coalesce(v_row.work_mode,'')) in ('binome','binôme') and v_row.team_id is not null then
    return private.is_team_member(v_row.team_id,v_user);
  end if;
  return v_row.user_id=v_user or v_row.solo_user_id=v_user;
end $$;
revoke all on function public.photo_can_access(uuid) from public, anon;
grant execute on function public.photo_can_access(uuid) to authenticated;

-- Resolve the newly created intervention by idempotent client event; no broad table SELECT.
create or replace function public.photo_find_my_intervention(p_event_id uuid,p_intervention_id uuid default null)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_id uuid;
begin
  perform private.assert_api_user();
  if auth.uid() is null or p_event_id is null then return null; end if;
  select i.id into v_id from public.interventions i
  where i.user_id=auth.uid() and i.client_event_id=p_event_id
    and (p_intervention_id is null or i.id=p_intervention_id) limit 1;
  return v_id;
end $$;
revoke all on function public.photo_find_my_intervention(uuid,uuid) from public, anon;
grant execute on function public.photo_find_my_intervention(uuid,uuid) to authenticated;

-- Every photo delete gets a durable job BEFORE removing anything from R2.
create or replace function public.photo_enqueue_delete(p_intervention_id uuid,p_photo_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_api_user();
  if p_photo_id is null or not public.photo_can_access(p_intervention_id) then return false; end if;
  insert into private.photo_production_cleanup_queue(intervention_id,photo_id)
    values(p_intervention_id,p_photo_id) on conflict do nothing;
  return true;
end $$;
revoke all on function public.photo_enqueue_delete(uuid,uuid) from public, anon;
grant execute on function public.photo_enqueue_delete(uuid,uuid) to authenticated;

-- AFTER DELETE captures all delete paths, including old UI and authorized binôme actions.
-- Neither this trigger nor this migration deletes any R2 object.
create or replace function private.photo_queue_intervention_deleted()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.photo_production_cleanup_queue(intervention_id,photo_id)
    values(old.id,null) on conflict do nothing;
  return old;
end $$;
revoke all on function private.photo_queue_intervention_deleted() from public, anon, authenticated;
drop trigger if exists photo_cleanup_after_intervention_delete on public.interventions;
create trigger photo_cleanup_after_intervention_delete
  after delete on public.interventions for each row
  execute function private.photo_queue_intervention_deleted();

-- Worker uses a high-entropy secret; provision only its SHA-256 into the private table.
-- No service role credentials or hardcoded plaintext secrets.
create or replace function public.photo_production_cleanup_jobs(p_secret text,p_done uuid default null)
returns table(job_id uuid,intervention_id uuid,photo_id uuid)
language plpgsql security definer set search_path='' as $$
begin
  if p_secret is null or length(p_secret)<32 or not exists(
      select 1 from private.photo_production_worker_config c
      where c.singleton and c.secret_hash=encode(extensions.digest(p_secret,'sha256'),'hex')
    ) then raise exception 'unauthorized' using errcode='42501'; end if;
  if p_done is not null then delete from private.photo_production_cleanup_queue q where q.job_id=p_done; end if;
  return query select q.job_id,q.intervention_id,q.photo_id
    from private.photo_production_cleanup_queue q order by q.created_at limit 20;
end $$;
revoke all on function public.photo_production_cleanup_jobs(text,uuid) from public;
grant execute on function public.photo_production_cleanup_jobs(text,uuid) to anon, authenticated;
-- Real deletion path, not restricted to test-created folders.
-- The AFTER DELETE trigger enqueues cleanup for both R2 buckets atomically.
create or replace function public.photo_delete_intervention(p_intervention_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_row public.interventions%rowtype; v_allowed boolean:=false;
begin
  perform private.assert_api_user();
  if v_uid is null or not private.is_active_user() then return false; end if;
  select * into v_row from public.interventions i where i.id=p_intervention_id for update;
  if not found then return false; end if;
  if v_row.company_id is null then
    v_allowed := v_row.user_id=v_uid or (
      lower(coalesce(v_row.work_mode,'')) in ('binome','binôme')
      and v_row.team_id is not null
      and exists(select 1 from public.team_members tm
                 where tm.team_id=v_row.team_id and tm.user_id=v_uid and tm.status='active')
    );
  elsif not private.fibre_ops_is_platform_admin()
    and private.is_company_member(v_row.company_id)
    and private.company_is_active(v_row.company_id) then
    v_allowed := private.is_company_admin(v_row.company_id)
      or v_row.user_id=v_uid or v_row.solo_user_id=v_uid
      or (v_row.team_id is not null and private.is_team_member(v_row.team_id,v_uid));
  end if;
  if not coalesce(v_allowed,false) then return false; end if;
  delete from public.interventions i where i.id=v_row.id;
  return found;
end $$;
revoke all on function public.photo_delete_intervention(uuid) from public, anon;
grant execute on function public.photo_delete_intervention(uuid) to authenticated;

commit;
