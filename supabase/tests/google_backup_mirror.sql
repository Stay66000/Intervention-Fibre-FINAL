-- Run after the mirror migration. All fixtures and pg_net wake-ups roll back.
begin;
do $$
declare u uuid; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); r public.interventions%rowtype; n integer; data jsonb;
begin
  if has_function_privilege('authenticated','public.google_backup_source(uuid)','execute') then raise exception 'Source exposed to clients'; end if;
  if has_table_privilege('authenticated','public.google_backup_leases','select') then raise exception 'Lease exposed to clients'; end if;
  if (select count(*) from public.google_backup_connections where status='connected')<>1 then raise exception 'Expected one explicitly connected owner for this regression fixture'; end if;
  select user_id into u from public.google_backup_connections where status='connected';
  if not public.acquire_google_backup_lease(u,a) then raise exception 'Lease acquisition failed'; end if;
  if public.acquire_google_backup_lease(u,b) then raise exception 'Concurrent writer admitted'; end if;
  if public.renew_google_backup_lease(u,b) then raise exception 'Foreign lease renewed'; end if;
  if not public.renew_google_backup_lease(u,a) then raise exception 'Lease renewal failed'; end if;
  perform public.release_google_backup_lease(u,a);
  if not public.acquire_google_backup_lease(u,b) then raise exception 'Lease release failed'; end if;
  select * into r from public.interventions where user_id=u and company_id is null limit 1;
  if r.id is null then raise exception 'No independent fixture template'; end if;
  insert into public.intervention_types(user_id,company_id,team_id,operator,name,amount,active) values(u,null,null,'orange','SYNC REGRESSION ROLLBACK',100,true) returning id into r.intervention_type_id;
  r.operator:='orange';
  r.team_id:=null;r.work_mode:='Personal';r.solo_user_id:=u;r.id:=gen_random_uuid();r.client_event_id:=gen_random_uuid();r.reference:='SYNC REGRESSION ROLLBACK';r.operator_data:='{}'::jsonb;r.created_at:=now();r.updated_at:=now();
  insert into public.interventions select (r).*;
  select count(*) into n from public.google_backup_jobs where intervention_id=r.id and user_id=u and action='upsert';
  if n<>1 then raise exception 'Creation not enqueued exactly once'; end if;
  update public.interventions set address='TEST ADDRESS',intervention_date='2026-11-01' where id=r.id;
  select count(*) into n from public.google_backup_jobs where intervention_id=r.id and user_id=u;
  if n<>2 then raise exception 'Modification not enqueued exactly once'; end if;
  data:=public.google_backup_source(u);
  if not exists(select 1 from jsonb_array_elements(data->'rows') s where s->>'id'=r.id::text and s->>'intervention_date'='2026-11-01') then raise exception 'Canonical source stale'; end if;
  begin
    update public.interventions set id=gen_random_uuid() where id=r.id;
    raise exception 'MUTABLE_PRIMARY_KEY';
  exception when others then
    if sqlerrm='MUTABLE_PRIMARY_KEY' then raise; end if;
    if sqlerrm<>'Intervention ID is immutable' then raise; end if;
  end;
  -- A Google auth outage must not drop update/delete events.
  update public.google_backup_connections set status='error' where user_id=u;
  delete from public.interventions where id=r.id;
  select count(*) into n from public.google_backup_jobs where intervention_id=r.id and user_id=u and action='delete';
  if n<>1 then raise exception 'Delete lost while Google offline'; end if;
  if exists(select 1 from jsonb_array_elements(public.google_backup_source(u)->'rows') s where s->>'id'=r.id::text) then raise exception 'Deleted intervention resurrected by source'; end if;
end $$;
set local role service_role;
do $$ begin
 if jsonb_array_length(public.google_backup_source((select user_id from public.google_backup_connections limit 1))->'rows')=0 then raise exception 'Worker cannot read canonical source'; end if;
end $$;
select jsonb_array_length(public.google_backup_source((select user_id from public.google_backup_connections limit 1))->'rows') as canonical_rows_visible_to_worker;
rollback;
