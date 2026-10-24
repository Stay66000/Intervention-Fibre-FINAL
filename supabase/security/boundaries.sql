create table private.technician_invitation_attempts(
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null, company_id uuid not null, email text not null,
  created_at timestamptz not null default now(),
  status text not null default 'reserved' check(status in ('reserved','sent','failed')),
  invited_user_id uuid
);
create index on private.technician_invitation_attempts(company_id,created_at);
create unique index technician_invitation_email_pending on private.technician_invitation_attempts(email) where status='reserved';
alter table private.technician_invitation_attempts enable row level security;
revoke all on private.technician_invitation_attempts from public,anon,authenticated;

-- Track Auth-created invitations by server-owned timestamps and reservation.
-- A user cannot clear this barrier by editing their metadata.
create or replace function private.track_invited_account()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.invited_at is not null then
    update private.technician_invitation_attempts set invited_user_id=new.id
    where email=lower(new.email) and status='reserved' and created_at<=new.created_at
      and created_at>now()-interval '10 minutes' and invited_user_id is null;
  end if;
  return new;
end;
$$;
revoke all on function private.track_invited_account() from public,anon,authenticated;
create trigger fibre_track_invited_account after insert or update of invited_at on auth.users
for each row execute function private.track_invited_account();

-- Invited accounts cannot use the business API before setting their password.
-- invited_at/encrypted_password are maintained by Auth, never by user_metadata.
create or replace function private.account_ready(p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_user and p.active
      and (u.invited_at is null or coalesce(u.encrypted_password,'')<>'')
      and not exists(select 1 from private.technician_invitation_attempts a where a.invited_user_id=p.id and a.status<>'sent'));
$$;
revoke all on function private.account_ready(uuid) from public,anon,authenticated;

create or replace function private.is_active_user()
returns boolean language sql stable security definer set search_path='' as $$
  select private.account_ready(auth.uid());
$$;

create or replace function private.assert_api_user()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_active_user() then
    raise exception 'Compte inactif ou création du mot de passe requise' using errcode='42501';
  end if;
end;
$$;
revoke all on function private.assert_api_user() from public,anon,authenticated;

create or replace function public.get_my_password_setup_status()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('password_required',u.invited_at is not null and coalesce(u.encrypted_password,'')='',
    'provisioning_pending',exists(select 1 from private.technician_invitation_attempts a where a.invited_user_id=u.id and a.status<>'sent'))
  from auth.users u where u.id=auth.uid();
$$;
revoke all on function public.get_my_password_setup_status() from public,anon;
grant execute on function public.get_my_password_setup_status() to authenticated;

-- Every public table has an additional restrictive account check. Existing
-- permissive policies cannot bypass this condition by OR-combination.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('create policy account_must_be_ready on public.%I as restrictive for all to authenticated using ((select private.is_active_user())) with check ((select private.is_active_user()))',t.tablename);
  end loop;
end $$;

create or replace function private.independent_team_access(p_team uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select p_team is null or exists(select 1 from public.teams t
    join public.team_members tm on tm.team_id=t.id
    where t.id=p_team and t.company_id is null and tm.user_id=auth.uid()
      and ((not p_write and tm.status in ('active','ended'))
        or (p_write and tm.status='active' and tm.ended_at is null and t.ended_at is null)));
$$;
revoke all on function private.independent_team_access(uuid,boolean) from public,anon;
grant execute on function private.independent_team_access(uuid,boolean) to authenticated;

-- Personal and company scopes are mutually exclusive on every API path.
do $$ declare tbl text; read_scope text; write_scope text; begin
  foreach tbl in array array['interventions','fuel_expenses','intervention_types'] loop
    read_scope := '(company_id is null and private.independent_team_access(team_id,false)) or (company_id is not null and private.company_is_active(company_id) and private.is_company_member(company_id) and not private.fibre_ops_is_platform_admin())';
    write_scope := '(company_id is null and private.independent_team_access(team_id,true)) or (company_id is not null and private.company_is_active(company_id) and private.is_company_member(company_id) and not private.fibre_ops_is_platform_admin())';
    if tbl='intervention_types' then
      write_scope := '(company_id is null and private.independent_team_access(team_id,true)) or (company_id is not null and private.company_is_active(company_id) and private.is_company_admin(company_id) and not private.fibre_ops_is_platform_admin())';
    end if;
    execute format('create policy scope_read_boundary on public.%I as restrictive for select to authenticated using (%s)',tbl,read_scope);
    execute format('create policy scope_insert_boundary on public.%I as restrictive for insert to authenticated with check (%s)',tbl,write_scope);
    execute format('create policy scope_update_boundary on public.%I as restrictive for update to authenticated using (%s) with check (%s)',tbl,write_scope,write_scope);
    execute format('create policy scope_delete_boundary on public.%I as restrictive for delete to authenticated using (%s)',tbl,write_scope);
  end loop;
end $$;

create policy payment_company_boundary on public.intervention_payments as restrictive for select to authenticated
using (company_id is null or (private.is_company_member(company_id) and private.company_is_active(company_id) and not private.fibre_ops_is_platform_admin()));

create policy operator_team_boundary on public.user_operators as restrictive for all to authenticated
using (private.independent_team_access(team_id,false)) with check (private.independent_team_access(team_id,true));
create policy supplement_team_boundary on public.intervention_supplement_types as restrictive for all to authenticated
using (private.independent_team_access(team_id,false)) with check (private.independent_team_access(team_id,true));

-- Keep historical binôme rows read-only through the dedicated history RPC.
-- Personal ownership alone must never permit attaching a row to an arbitrary team.
create or replace function private.validate_business_scope()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then return new; end if;
  perform private.assert_api_user();
  if tg_op='UPDATE' and (new.company_id is distinct from old.company_id
     or new.user_id is distinct from old.user_id or new.team_id is distinct from old.team_id) then
    raise exception 'Le rattachement de cette ligne est verrouillé' using errcode='42501';
  end if;
  if new.company_id is null then
    if not private.independent_team_access(new.team_id,true) then
      raise exception 'Binôme personnel invalide' using errcode='42501';
    end if;
  elsif not private.company_is_active(new.company_id) or not private.is_company_member(new.company_id) then
    raise exception 'Accès société refusé' using errcode='42501';
  elsif tg_table_name='intervention_types' and not private.is_company_admin(new.company_id) then
    raise exception 'Catalogue réservé à l’administrateur société' using errcode='42501';
  end if;
  if tg_op='INSERT' then new.created_by := auth.uid(); end if;
  return new;
end;
$$;
revoke all on function private.validate_business_scope() from public,anon,authenticated;
-- intervention_types has no created_by; its policy already restricts writes to admins.
create trigger zzz_fuel_business_scope before insert or update on public.fuel_expenses
for each row execute function private.validate_business_scope();

-- Administrative audit contains identifiers/statuses, never passwords or tokens.
create table private.security_audit_events(
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(), actor_id uuid,
  table_name text not null, operation text not null, record_id text,
  company_id uuid, old_status text, new_status text
);
alter table private.security_audit_events enable row level security;
revoke all on private.security_audit_events from public,anon,authenticated;
create or replace function private.audit_security_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare before_row jsonb; after_row jsonb; item jsonb;
begin
  if tg_op<>'INSERT' then before_row:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_row:=to_jsonb(new); end if;
  item:=coalesce(after_row,before_row);
  insert into private.security_audit_events(actor_id,table_name,operation,record_id,company_id,old_status,new_status)
  values(auth.uid(),tg_table_name,tg_op,coalesce(item->>'id',item->>'user_id'),
    case when tg_table_name='companies' then (item->>'id')::uuid else (item->>'company_id')::uuid end,
    before_row->>'status',after_row->>'status');
  return coalesce(new,old);
end;
$$;
revoke all on function private.audit_security_change() from public,anon,authenticated;
do $$ declare tbl text; begin
  foreach tbl in array array['companies','company_members','company_invites','company_technician_tariffs'] loop
    execute format('create trigger security_audit after insert or update or delete on public.%I for each row execute function private.audit_security_change()',tbl);
  end loop;
end $$;
