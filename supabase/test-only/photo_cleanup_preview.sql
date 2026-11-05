-- Preview-only entry points. Existing production deletion behavior stays unchanged.
create table if not exists private.photo_test_cleanup_queue (
  intervention_id uuid primary key,
  created_at timestamptz not null default now(),
  last_processed_at timestamptz
);
revoke all on private.photo_test_cleanup_queue from public, anon, authenticated;
alter table private.photo_test_cleanup_queue enable row level security;
create table if not exists private.photo_test_interventions (
  intervention_id uuid primary key references public.interventions(id) on delete cascade
);
revoke all on private.photo_test_interventions from public, anon, authenticated;
alter table private.photo_test_interventions enable row level security;
create table if not exists private.photo_test_worker_config (
  singleton boolean primary key default true check(singleton),
  secret_hash text not null
);
revoke all on private.photo_test_worker_config from public, anon, authenticated;
alter table private.photo_test_worker_config enable row level security;

create or replace function public.photo_test_register_intervention(p_intervention_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_api_user();
  if not exists(select 1 from public.interventions i where i.id=p_intervention_id and i.user_id=auth.uid() and
    (i.created_at>now()-interval '10 minutes' or
      (i.client_event_id=i.id and i.operator_data->>'offline_event_id'=i.id::text))) then return false; end if;
  insert into private.photo_test_interventions(intervention_id) values(p_intervention_id) on conflict do nothing;
  return true;
end $$;
revoke all on function public.photo_test_register_intervention(uuid) from public, anon;
grant execute on function public.photo_test_register_intervention(uuid) to authenticated;

-- Confirm only the caller's own creation event without granting table SELECT.
create or replace function public.photo_test_find_my_intervention(p_event_id uuid,p_intervention_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  perform private.assert_api_user();
  if auth.uid() is null or p_event_id is null then return null; end if;
  select i.id into result from public.interventions i
  where i.user_id=auth.uid() and i.client_event_id=p_event_id
    and (p_intervention_id is null or i.id=p_intervention_id)
  limit 1;
  return result;
end $$;
revoke all on function public.photo_test_find_my_intervention(uuid,uuid) from public, anon;
grant execute on function public.photo_test_find_my_intervention(uuid,uuid) to authenticated;

create or replace function public.photo_test_delete_intervention(p_intervention_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.interventions%rowtype; v_allowed boolean := false;
begin
  perform private.assert_api_user();
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and active=true) then return false; end if;
  select * into v_row from public.interventions where id=p_intervention_id for update;
  if not found then return false; end if;
  if not exists(select 1 from private.photo_test_interventions t where t.intervention_id=v_row.id) then return false; end if;
  if v_row.company_id is null then
    v_allowed := v_row.user_id=v_uid or (lower(coalesce(v_row.work_mode,'')) in ('binome','binôme') and v_row.team_id is not null and private.was_team_member(v_row.team_id,v_uid));
  elsif not private.fibre_ops_is_platform_admin() and private.is_company_member(v_row.company_id) and private.company_is_active(v_row.company_id) then
    v_allowed := private.is_company_admin(v_row.company_id) or v_row.user_id=v_uid or v_row.solo_user_id=v_uid or (v_row.team_id is not null and private.is_team_member(v_row.team_id,v_uid));
  end if;
  if not coalesce(v_allowed,false) then return false; end if;
  insert into private.photo_test_cleanup_queue(intervention_id) values(v_row.id) on conflict do nothing;
  delete from public.interventions where id=v_row.id;
  return found;
end $$;
revoke all on function public.photo_test_delete_intervention(uuid) from public, anon;
grant execute on function public.photo_test_delete_intervention(uuid) to authenticated;

create or replace function public.photo_test_cleanup_jobs(p_secret text,p_done uuid default null)
returns table(intervention_id uuid,created_at timestamptz) language plpgsql security definer set search_path='' as $$
begin
  if p_secret is null or not exists(select 1 from private.photo_test_worker_config where singleton and secret_hash=encode(extensions.digest(p_secret,'sha256'),'hex')) then raise exception 'unauthorized' using errcode='42501'; end if;
  if p_done is not null then
    delete from private.photo_test_cleanup_queue q where q.intervention_id=p_done and q.created_at < now()-interval '1 day';
    update private.photo_test_cleanup_queue q set last_processed_at=now() where q.intervention_id=p_done;
  end if;
  return query select q.intervention_id,q.created_at from private.photo_test_cleanup_queue q order by q.last_processed_at nulls first,q.created_at limit 100;
end $$;
revoke all on function public.photo_test_cleanup_jobs(text,uuid) from public;
grant execute on function public.photo_test_cleanup_jobs(text,uuid) to anon, authenticated;
