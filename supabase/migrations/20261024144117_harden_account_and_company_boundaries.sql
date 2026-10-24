-- Account and tenant boundary hardening; no business data is deleted.

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


CREATE OR REPLACE FUNCTION private.detach_company_technician_to_solo(p_company uuid, p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_team_ids uuid[];
  v_type record;
  v_existing uuid;
begin
  if p_company is null or p_user is null then
    raise exception 'Société ou technicien invalide';
  end if;

  if not exists (
    select 1
    from public.company_members cm
    where cm.company_id = p_company
      and cm.user_id = p_user
      and cm.role = 'technician'
      and cm.status in ('active','disabled')
  ) then
    raise exception 'Technicien société introuvable';
  end if;

  -- Si le technicien est dans un binôme société actif, le binôme est terminé
  -- pour les deux membres. L'historique et les snapshots restent intacts.
  select array_agg(distinct t.id)
  into v_team_ids
  from public.teams t
  join public.team_members me on me.team_id = t.id
  where t.company_id = p_company
    and t.ended_at is null
    and me.user_id = p_user
    and me.status = 'active'
    and me.ended_at is null;

  if coalesce(cardinality(v_team_ids),0) > 0 then
    update public.team_members tm
    set status = 'ended',
        ended_at = now(),
        ended_on = current_date
    where tm.team_id = any(v_team_ids)
      and tm.status = 'active'
      and tm.ended_at is null;

    update public.teams t
    set ended_at = now(),
        ended_on = current_date
    where t.id = any(v_team_ids)
      and t.ended_at is null;
  end if;

  -- Copie des opérateurs société vers l'espace personnel.
  insert into public.user_operators(user_id,team_id,operator,active)
  select p_user,null,co.operator,co.active
  from public.company_operators co
  where co.company_id = p_company
  on conflict (user_id,operator)
  do update set
    team_id = null,
    active = excluded.active,
    updated_at = now();

  -- Copie uniquement des tarifs personnels du technicien.
  -- Le prix agence n'est jamais copié ni exposé.
  for v_type in
    select
      it.operator,
      it.name,
      case when exists(select 1 from public.company_members cm where cm.company_id=p_company and cm.user_id=p_user and cm.hide_prices=true) then 0 else ct.amount end as amount,
      (it.active and ct.active) as active,
      it.sort_order
    from public.intervention_types it
    join public.company_technician_tariffs ct
      on ct.intervention_type_id = it.id
     and ct.company_id = p_company
     and ct.user_id = p_user
    where it.company_id = p_company
    order by it.operator,it.sort_order,it.name
  loop
    v_existing := null;

    select pit.id
    into v_existing
    from public.intervention_types pit
    where pit.user_id = p_user
      and pit.company_id is null
      and pit.team_id is null
      and pit.operator = v_type.operator
      and lower(trim(pit.name)) = lower(trim(v_type.name))
    limit 1;

    if v_existing is not null then
      update public.intervention_types
      set amount = v_type.amount,
          active = v_type.active,
          sort_order = v_type.sort_order,
          agency_amount = null,
          updated_at = now()
      where id = v_existing;
    else
      insert into public.intervention_types(
        user_id,team_id,company_id,operator,name,amount,agency_amount,active,sort_order
      ) values (
        p_user,null,null,v_type.operator,v_type.name,v_type.amount,null,v_type.active,v_type.sort_order
      );
    end if;
  end loop;

  update public.company_members
  set status = 'removed',
      updated_at = now()
  where company_id = p_company
    and user_id = p_user
    and role = 'technician';

  update public.profiles
  set company_id = null,
      role = 'technician',
      onboarding_completed = true
  where id = p_user;
end;
$function$;


CREATE OR REPLACE FUNCTION public.accept_company_invite(p_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid:=auth.uid();
  v_email text;
  v_invite public.company_invites%rowtype;
  v_old record;
begin
  perform private.assert_api_user();
  if v_user is null then raise exception 'Non authentifié'; end if;
  select lower(email) into v_email from public.profiles where id=v_user and active=true;
  if v_email is null then raise exception 'Profil inaccessible'; end if;

  select * into v_invite from public.company_invites
  where upper(code)=upper(trim(p_code)) and status='pending' and expires_at>now()
  for update;
  if not found then raise exception 'Code invalide ou expiré'; end if;
  if lower(v_invite.email)<>v_email then raise exception 'Cette invitation correspond à une autre adresse e-mail'; end if;
  if not private.company_is_active(v_invite.company_id) then raise exception 'Cette société n’est pas active'; end if;

  if exists(select 1 from public.company_members where user_id=v_user and status in ('active','disabled') and company_id<>v_invite.company_id) then
    raise exception 'Ce compte appartient déjà à une autre société';
  end if;

  if v_invite.role='admin' then
    for v_old in select cm.user_id from public.company_members cm
      where cm.company_id=v_invite.company_id and cm.role='admin' and cm.user_id<>v_user and cm.status in ('active','disabled')
    loop
      update public.company_members set role='technician',employment_type='auto',hide_prices=false,updated_at=now()
      where company_id=v_invite.company_id and user_id=v_old.user_id;
      update public.profiles set role='technician',company_id=v_invite.company_id,updated_at=now()
      where id=v_old.user_id and role<>'platform_admin';
    end loop;
  end if;

  insert into public.company_members(company_id,user_id,role,status,employment_type,hide_prices)
  values(
    v_invite.company_id,v_user,v_invite.role,'active',
    case when v_invite.role='technician' then v_invite.employment_type else 'auto' end,
    case when v_invite.role='technician' and v_invite.employment_type='salaried' then v_invite.hide_prices else false end
  )
  on conflict(company_id,user_id)
  do update set role=excluded.role,status='active',employment_type=excluded.employment_type,hide_prices=excluded.hide_prices,updated_at=now();

  update public.profiles
  set role=case when v_invite.role='admin' then 'company_admin' else 'technician' end,
      company_id=v_invite.company_id,onboarding_completed=true,updated_at=now()
  where id=v_user;

  update public.company_invites set status='accepted',accepted_at=now() where id=v_invite.id;
  return v_invite.company_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.accept_team_invite_with_tariffs(p_code text, p_mode text, p_custom jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me uuid := auth.uid();
  v_inv public.team_invites%rowtype;
  v_team uuid;
  v_source uuid;
  v_inviter_name text;
  v_invitee_name text;
  v_item jsonb;
  v_op text;
  v_name text;
  v_amount numeric;
  v_order integer;
  v_existing uuid;
begin
  perform private.assert_api_user();
  if v_me is null then raise exception 'Non authentifié'; end if;
  if not private.is_active_user() then raise exception 'Compte désactivé'; end if;
  if p_mode not in ('inviter','invitee','custom') then raise exception 'Choix tarifaire invalide'; end if;

  select * into v_inv
  from public.team_invites
  where upper(code)=upper(trim(p_code))
    and status='pending'
    and expires_at>now()
  for update;

  if not found then raise exception 'Code invalide ou expiré'; end if;
  if v_inv.invitee_user_id<>v_me then raise exception 'Cette invitation ne correspond pas à ton compte'; end if;

  if exists(select 1 from public.company_members where user_id in (v_inv.inviter_user_id,v_me) and status in ('active','disabled')) then
    raise exception 'Les binômes société sont gérés par le patron';
  end if;

  if exists(select 1 from public.team_members where user_id in (v_inv.inviter_user_id,v_me) and status='active' and ended_at is null) then
    raise exception 'Un des deux comptes est déjà lié';
  end if;

  select coalesce(nullif(trim(first_name),''),'Technicien') into v_inviter_name from public.profiles where id=v_inv.inviter_user_id;
  select coalesce(nullif(trim(first_name),''),'Technicien') into v_invitee_name from public.profiles where id=v_me;

  insert into public.teams(name,created_by,company_id)
  values(v_inviter_name||' + '||v_invitee_name,v_inv.inviter_user_id,null)
  returning id into v_team;

  insert into public.team_members(team_id,user_id,status)
  values(v_team,v_inv.inviter_user_id,'active'),(v_team,v_me,'active');

  if p_mode in ('inviter','invitee') then
    v_source := case when p_mode='inviter' then v_inv.inviter_user_id else v_me end;

    update public.user_operators
    set team_id=v_team,updated_at=now()
    where user_id=v_source and team_id is null;

    update public.intervention_types
    set team_id=v_team,updated_at=now()
    where user_id=v_source and team_id is null and company_id is null;

  else
    if jsonb_typeof(coalesce(p_custom,'[]'::jsonb)) <> 'array' then
      raise exception 'Tarifs personnalisés invalides';
    end if;

    for v_item in select value from jsonb_array_elements(coalesce(p_custom,'[]'::jsonb))
    loop
      v_op := lower(trim(v_item->>'operator'));
      v_name := trim(v_item->>'name');
      v_amount := nullif(v_item->>'amount','')::numeric;
      v_order := coalesce(nullif(v_item->>'sort_order','')::integer,0);

      if v_op not in ('orange','bouygues','sfr','free') or coalesce(v_name,'')='' or v_amount is null or v_amount<0 then
        raise exception 'Tarif personnalisé invalide';
      end if;

      insert into public.user_operators(user_id,team_id,operator,active)
      values(v_inv.inviter_user_id,v_team,v_op,true)
      on conflict (user_id,operator)
      do update set team_id=v_team,active=true,updated_at=now();

      v_existing := null;
      select it.id into v_existing
      from public.intervention_types it
      where it.user_id=v_inv.inviter_user_id
        and it.team_id is null
        and it.company_id is null
        and it.operator=v_op
        and lower(trim(it.name))=lower(v_name)
      limit 1;

      if v_existing is not null then
        update public.intervention_types
        set team_id=v_team,amount=v_amount,active=true,sort_order=v_order,updated_at=now()
        where id=v_existing;
      else
        insert into public.intervention_types(user_id,team_id,company_id,operator,name,amount,active,sort_order)
        values(v_inv.inviter_user_id,v_team,null,v_op,v_name,v_amount,true,v_order);
      end if;
    end loop;
  end if;

  update public.interventions
  set team_id=v_team,work_mode='Solo',solo_user_id=user_id
  where user_id in (v_inv.inviter_user_id,v_me)
    and team_id is null
    and company_id is null;

  update public.fuel_expenses
  set team_id=v_team,paid_by_user_id=coalesce(paid_by_user_id,user_id)
  where user_id in (v_inv.inviter_user_id,v_me)
    and team_id is null
    and company_id is null;

  update public.team_invites
  set status='accepted',accepted_at=now()
  where id=v_inv.id;

  return v_team;
end;
$function$;


CREATE OR REPLACE FUNCTION public.company_add_type(p_operator text, p_name text, p_agency_amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_company uuid := private.my_company_id();
    v_id uuid;
    v_order integer;
begin
  perform private.assert_api_user();
    if v_company is null or not private.is_company_admin(v_company) then
        raise exception 'Réservé au patron';
    end if;

    if not private.company_is_active(v_company) then
        raise exception 'Société suspendue';
    end if;

    if p_operator not in ('orange','bouygues','sfr','free')
       or char_length(trim(coalesce(p_name,''))) = 0
       or p_agency_amount is null
       or p_agency_amount < 0 then
        raise exception 'Typologie invalide';
    end if;

    if not exists (
        select 1 from public.company_operators co
        where co.company_id = v_company
          and co.operator = p_operator
          and co.active = true
    ) then
        raise exception 'Cet opérateur est désactivé pour la société';
    end if;

    -- Compatibilité avec l'ancien FK intervention_types(user_id,operator).
    -- Cette ligne technique reste inactive dans l'espace personnel du patron.
    insert into public.user_operators(user_id,team_id,operator,active)
    values (auth.uid(),null,p_operator,false)
    on conflict (user_id,operator) do nothing;

    select coalesce(max(sort_order),-1) + 1
    into v_order
    from public.intervention_types
    where company_id = v_company
      and operator = p_operator;

    insert into public.intervention_types(
        user_id,company_id,operator,name,amount,agency_amount,active,sort_order
    )
    values (
        auth.uid(),v_company,p_operator,trim(p_name),0,p_agency_amount,true,v_order
    )
    returning id into v_id;

    return v_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_add_technician(p_email text)
 RETURNS TABLE(assigned boolean, invite_code text, technician_user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company uuid:=private.my_company_id();
  v_user uuid;
  v_code text;
begin
  perform private.assert_api_user();
  if v_company is null or not private.is_company_admin(v_company) then
    raise exception 'Réservé au patron';
  end if;
  if not private.company_is_active(v_company) then raise exception 'Société suspendue'; end if;
  if position('@' in coalesce(p_email,''))=0 then raise exception 'E-mail invalide'; end if;

  select p.id into v_user
  from public.profiles p
  where lower(p.email)=lower(trim(p_email))
    and p.active=true
    and p.role<>'platform_admin'
  limit 1;

  if v_user is not null then
    if exists(
      select 1 from public.company_members cm
      where cm.user_id=v_user
        and cm.company_id=v_company
        and cm.status in ('active','disabled')
    ) then
      raise exception 'Ce technicien appartient déjà à ta société';
    end if;

    if exists(
      select 1 from public.company_members cm
      where cm.user_id=v_user
        and cm.company_id<>v_company
        and cm.status in ('active','disabled')
    ) then
      raise exception 'Ce compte appartient déjà à une autre société';
    end if;
  end if;

  v_code:=public.company_create_invite(p_email,'technician');
  assigned:=false;
  invite_code:=v_code;
  technician_user_id:=v_user;
  return next;
end;
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_add_technician_v2(p_email text, p_employment_type text DEFAULT 'auto'::text, p_hide_prices boolean DEFAULT false)
 RETURNS TABLE(assigned boolean, invite_code text, technician_user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company uuid:=private.my_company_id();
  v_user uuid;
  v_code text;
  v_type text:=lower(trim(coalesce(p_employment_type,'auto')));
  v_hide boolean:=coalesce(p_hide_prices,false);
begin
  perform private.assert_api_user();
  if v_company is null or not private.is_company_admin(v_company) then raise exception 'Réservé au patron'; end if;
  if not private.company_is_active(v_company) then raise exception 'Société suspendue'; end if;
  if position('@' in coalesce(p_email,''))=0 then raise exception 'E-mail invalide'; end if;
  if v_type not in ('auto','salaried') then raise exception 'Statut technicien invalide'; end if;
  if v_type='auto' then v_hide:=false; end if;

  select p.id into v_user
  from public.profiles p
  where lower(p.email)=lower(trim(p_email)) and p.active=true and p.role<>'platform_admin'
  limit 1;

  if v_user is not null then
    if exists(select 1 from public.company_members cm where cm.user_id=v_user and cm.company_id=v_company and cm.status in ('active','disabled')) then
      raise exception 'Ce technicien appartient déjà à ta société';
    end if;
    if exists(select 1 from public.company_members cm where cm.user_id=v_user and cm.company_id<>v_company and cm.status in ('active','disabled')) then
      raise exception 'Ce compte appartient déjà à une autre société';
    end if;
  end if;

  update public.company_invites
  set status='cancelled'
  where company_id=v_company and lower(email)=lower(trim(p_email)) and status='pending';

  loop
    v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    exit when not exists(select 1 from public.company_invites where code=v_code);
  end loop;

  insert into public.company_invites(company_id,email,role,code,created_by,employment_type,hide_prices)
  values(v_company,lower(trim(p_email)),'technician',v_code,auth.uid(),v_type,v_hide);

  assigned:=false;invite_code:=v_code;technician_user_id:=v_user;return next;
end;
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_cancel_invite(p_invite_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company uuid:=private.my_company_id();
begin
  perform private.assert_api_user();
  if v_company is null or not private.is_company_admin(v_company) then
    raise exception 'Réservé au patron';
  end if;

  update public.company_invites
  set status='cancelled'
  where id=p_invite_id
    and company_id=v_company
    and status in ('pending','expired');

  if not found then
    raise exception 'Invitation introuvable ou déjà terminée';
  end if;
end;
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_create_team_with_tariffs(p_user_a uuid, p_user_b uuid, p_mode text, p_custom jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_team uuid;
begin
  perform private.assert_api_user();
  v_team := public.company_admin_create_team(p_user_a,p_user_b);
  perform public.company_admin_harmonize_pair_tariffs(p_user_a,p_user_b,p_mode,p_custom);
  return v_team;
end;
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_end_team(p_team_id uuid, p_effective_date date DEFAULT CURRENT_DATE)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_company uuid := private.my_company_id();
begin
  perform private.assert_api_user();
    if v_company is null or not private.is_company_admin(v_company) then
        raise exception 'Réservé au patron';
    end if;

    if not exists (
        select 1
        from public.teams t
        where t.id = p_team_id
          and t.company_id = v_company
          and t.ended_at is null
    ) then
        raise exception 'Binôme actif introuvable';
    end if;

    update public.team_members
    set status = 'ended',
        ended_at = now(),
        ended_on = coalesce(p_effective_date,current_date)
    where team_id = p_team_id
      and status = 'active'
      and ended_at is null;

    update public.teams
    set ended_at = now(),
        ended_on = coalesce(p_effective_date,current_date)
    where id = p_team_id
      and company_id = v_company;

    -- Aucun recalcul :
    -- les anciennes interventions et les snapshots de paiement restent intacts.
end;
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_get_fuel()
 RETURNS TABLE(id uuid, user_id uuid, company_id uuid, team_id uuid, paid_by_user_id uuid, created_by uuid, expense_date date, amount numeric, liters numeric, price_per_liter numeric, mileage integer, station text, notes text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select
    f.id,f.user_id,f.company_id,f.team_id,f.paid_by_user_id,f.created_by,
    f.expense_date,f.amount,f.liters,f.price_per_liter,f.mileage,
    f.station,f.notes,f.created_at,f.updated_at
  from public.fuel_expenses f
  where f.company_id=private.my_company_id()
    and private.is_company_admin(f.company_id)
  order by f.expense_date,f.created_at
  ) as secured_result where private.is_active_user() and private.company_is_active(private.my_company_id());
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_get_interventions()
 RETURNS TABLE(id uuid, user_id uuid, company_id uuid, team_id uuid, work_mode text, solo_user_id uuid, created_by uuid, intervention_date date, operator text, intervention_type_id uuid, intervention_type_name text, applied_amount numeric, agency_amount_snapshot numeric, result text, reference text, address text, notes text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select
        i.id,i.user_id,i.company_id,i.team_id,i.work_mode,i.solo_user_id,i.created_by,
        i.intervention_date,i.operator,i.intervention_type_id,i.intervention_type_name,
        i.applied_amount,i.agency_amount_snapshot,i.result,i.reference,i.address,i.notes,
        i.created_at,i.updated_at
    from public.interventions i
    where i.company_id = private.my_company_id()
      and private.is_company_admin(i.company_id)
    order by i.intervention_date,i.created_at
  ) as secured_result where private.is_active_user() and private.company_is_active(private.my_company_id());
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_get_operators()
 RETURNS TABLE(company_id uuid, operator text, active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select co.company_id,co.operator,co.active
  from public.company_operators co
  where co.company_id=private.my_company_id()
    and private.is_company_admin(co.company_id)
  order by co.operator
  ) as secured_result where private.is_active_user() and private.company_is_active(private.my_company_id());
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_get_payment_details()
 RETURNS TABLE(intervention_id uuid, user_id uuid, first_name text, last_name text, email text, payout_amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select
    ip.intervention_id,
    ip.user_id,
    p.first_name,
    p.last_name,
    p.email,
    ip.payout_amount_snapshot::numeric
  from public.intervention_payments ip
  join public.profiles p on p.id=ip.user_id
  where ip.company_id=private.my_company_id()
    and private.is_company_admin(ip.company_id)
  order by ip.created_at, ip.user_id
  ) as secured_result where private.is_active_user() and private.company_is_active(private.my_company_id());
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_get_tariffs()
 RETURNS TABLE(company_id uuid, intervention_type_id uuid, user_id uuid, amount numeric, active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select ct.company_id,ct.intervention_type_id,ct.user_id,ct.amount,ct.active
  from public.company_technician_tariffs ct
  where ct.company_id=private.my_company_id()
    and private.is_company_admin(ct.company_id)
  order by ct.user_id,ct.intervention_type_id
  ) as secured_result where private.is_active_user() and private.company_is_active(private.my_company_id());
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_get_types()
 RETURNS TABLE(id uuid, operator text, name text, agency_amount numeric, active boolean, sort_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select it.id,it.operator,it.name,it.agency_amount,it.active,it.sort_order
    from public.intervention_types it
    where it.company_id = private.my_company_id()
      and private.is_company_admin(it.company_id)
    order by it.operator,it.sort_order,it.name
  ) as secured_result where private.is_active_user() and private.company_is_active(private.my_company_id());
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_list_invites()
 RETURNS TABLE(invite_id uuid, email text, invite_role text, code text, invite_status text, expires_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select
    ci.id,
    ci.email,
    ci.role,
    ci.code,
    case when ci.status='pending' and ci.expires_at<=now() then 'expired' else ci.status end,
    ci.expires_at,
    ci.created_at
  from public.company_invites ci
  where ci.company_id=private.my_company_id()
    and private.is_company_admin(ci.company_id)
    and ci.status in ('pending','expired','declined','cancelled')
  order by
    case when ci.status='pending' and ci.expires_at>now() then 0 else 1 end,
    ci.created_at desc
  limit 100
  ) as secured_result where private.is_active_user() and private.company_is_active(private.my_company_id());
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_list_invites_v2()
 RETURNS TABLE(invite_id uuid, email text, invite_role text, code text, invite_status text, expires_at timestamp with time zone, created_at timestamp with time zone, employment_type text, hide_prices boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select ci.id,ci.email,ci.role,ci.code,
    case when ci.status='pending' and ci.expires_at<=now() then 'expired' else ci.status end,
    ci.expires_at,ci.created_at,ci.employment_type,ci.hide_prices
  from public.company_invites ci
  where ci.company_id=private.my_company_id()
    and private.is_company_admin(ci.company_id)
    and ci.status in ('pending','expired','declined','cancelled')
  order by case when ci.status='pending' and ci.expires_at>now() then 0 else 1 end,ci.created_at desc
  limit 100
  ) as secured_result where private.is_active_user() and private.company_is_active(private.my_company_id());
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_list_teams()
 RETURNS TABLE(team_id uuid, team_name text, active boolean, ended_on date, member1_id uuid, member1_name text, member1_email text, member2_id uuid, member2_name text, member2_email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
with my_company as (
        select private.my_company_id() as company_id
    )
    select
        t.id,
        t.name,
        (t.ended_at is null) as active,
        t.ended_on,
        (
            select tm.user_id
            from public.team_members tm
            where tm.team_id = t.id
            order by tm.joined_at, tm.user_id
            limit 1
        ) as member1_id,
        (
            select coalesce(
                nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),
                p.email
            )
            from public.team_members tm
            join public.profiles p on p.id = tm.user_id
            where tm.team_id = t.id
            order by tm.joined_at,tm.user_id
            limit 1
        ) as member1_name,
        (
            select p.email
            from public.team_members tm
            join public.profiles p on p.id = tm.user_id
            where tm.team_id = t.id
            order by tm.joined_at,tm.user_id
            limit 1
        ) as member1_email,
        (
            select tm.user_id
            from public.team_members tm
            where tm.team_id = t.id
            order by tm.joined_at, tm.user_id
            offset 1 limit 1
        ) as member2_id,
        (
            select coalesce(
                nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),
                p.email
            )
            from public.team_members tm
            join public.profiles p on p.id = tm.user_id
            where tm.team_id = t.id
            order by tm.joined_at,tm.user_id
            offset 1 limit 1
        ) as member2_name,
        (
            select p.email
            from public.team_members tm
            join public.profiles p on p.id = tm.user_id
            where tm.team_id = t.id
            order by tm.joined_at,tm.user_id
            offset 1 limit 1
        ) as member2_email
    from public.teams t, my_company mc
    where t.company_id = mc.company_id
      and private.is_company_admin(mc.company_id)
    order by
        case when t.ended_at is null then 0 else 1 end,
        t.created_at desc
  ) as secured_result where private.is_active_user() and private.company_is_active(private.my_company_id());
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_renew_invite(p_invite_id uuid)
 RETURNS TABLE(invite_code text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company uuid:=private.my_company_id();
  v_code text;
  v_exp timestamptz:=now()+interval '7 days';
begin
  perform private.assert_api_user();
  if v_company is null or not private.is_company_admin(v_company) then
    raise exception 'Réservé au patron';
  end if;
  if not private.company_is_active(v_company) then
    raise exception 'La société doit être active pour renouveler une invitation';
  end if;

  if not exists(
    select 1 from public.company_invites ci
    where ci.id=p_invite_id and ci.company_id=v_company and ci.status<>'accepted'
  ) then
    raise exception 'Invitation introuvable ou déjà acceptée';
  end if;

  loop
    v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    exit when not exists(select 1 from public.company_invites where code=v_code);
  end loop;

  update public.company_invites
  set code=v_code,status='pending',expires_at=v_exp,accepted_at=null
  where id=p_invite_id and company_id=v_company;

  invite_code:=v_code;
  expires_at:=v_exp;
  return next;
end;
$function$;


CREATE OR REPLACE FUNCTION public.company_admin_set_technician_work_settings(p_user_id uuid, p_employment_type text, p_hide_prices boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company uuid:=private.my_company_id();
  v_type text:=lower(trim(coalesce(p_employment_type,'')));
  v_hide boolean:=coalesce(p_hide_prices,false);
begin
  perform private.assert_api_user();
  if v_company is null or not private.is_company_admin(v_company) then raise exception 'Réservé au patron'; end if;
  if v_type not in ('auto','salaried') then raise exception 'Statut technicien invalide'; end if;
  if v_type='auto' then v_hide:=false; end if;

  update public.company_members
  set employment_type=v_type,hide_prices=v_hide,updated_at=now()
  where company_id=v_company and user_id=p_user_id and role='technician' and status='active';
  if not found then raise exception 'Technicien actif introuvable'; end if;
end;
$function$;


CREATE OR REPLACE FUNCTION public.company_get_my_catalog()
 RETURNS TABLE(id uuid, operator text, name text, amount numeric, active boolean, sort_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select it.id,it.operator,it.name,
    case when coalesce(cm.hide_prices,false) then 0 else coalesce(ct.amount,0) end::numeric as amount,
    (coalesce(co.active,false) and it.active and coalesce(ct.active,false)) as active,
    it.sort_order
  from public.intervention_types it
  join public.company_operators co on co.company_id=it.company_id and co.operator=it.operator
  join public.company_members cm on cm.company_id=it.company_id and cm.user_id=auth.uid() and cm.status='active'
  left join public.company_technician_tariffs ct on ct.intervention_type_id=it.id and ct.user_id=auth.uid()
  where it.company_id=private.my_company_id()
    and private.company_is_active(it.company_id)
    and private.is_company_member(it.company_id)
  order by it.operator,it.sort_order,it.name
  ) as secured_result where private.is_active_user();
$function$;


CREATE OR REPLACE FUNCTION public.company_get_my_interventions()
 RETURNS TABLE(id uuid, user_id uuid, company_id uuid, team_id uuid, work_mode text, solo_user_id uuid, created_by uuid, intervention_date date, operator text, intervention_type_id uuid, intervention_type_name text, my_payout numeric, result text, reference text, address text, notes text, operator_data jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select i.id,i.user_id,i.company_id,i.team_id,i.work_mode,i.solo_user_id,i.created_by,
    i.intervention_date,i.operator,i.intervention_type_id,i.intervention_type_name,
    case when coalesce(cm.hide_prices,false) then 0 else coalesce(ip.payout_amount_snapshot,0) end::numeric as my_payout,
    i.result,i.reference,i.address,i.notes,i.operator_data,i.created_at,i.updated_at
  from public.interventions i
  join public.company_members cm on cm.company_id=i.company_id and cm.user_id=auth.uid() and cm.status='active'
  left join public.intervention_payments ip on ip.intervention_id=i.id and ip.user_id=auth.uid()
  where i.company_id=private.my_company_id()
    and private.company_is_active(i.company_id)
    and private.is_company_member(i.company_id)
    and (i.user_id=auth.uid() or i.solo_user_id=auth.uid() or (i.team_id is not null and private.was_team_member(i.team_id,auth.uid())))
  order by i.intervention_date,i.created_at
  ) as secured_result where private.is_active_user();
$function$;


CREATE OR REPLACE FUNCTION public.company_get_my_work_status()
 RETURNS TABLE(employment_type text, hide_prices boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select cm.employment_type,cm.hide_prices
  from public.company_members cm
  where cm.user_id=auth.uid()
    and cm.role='technician'
    and cm.status='active'
  order by cm.joined_at desc
  limit 1
  ) as secured_result where private.is_active_user();
$function$;


CREATE OR REPLACE FUNCTION public.company_list_members()
 RETURNS TABLE(user_id uuid, email text, first_name text, last_name text, member_role text, member_status text, joined_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select
        p.id,
        p.email,
        p.first_name,
        p.last_name,
        cm.role,
        cm.status,
        cm.joined_at
    from public.company_members cm
    join public.profiles p on p.id = cm.user_id
    where cm.company_id = private.my_company_id()
      and private.is_company_admin(cm.company_id)
      and cm.status <> 'removed'
    order by
        case when cm.role = 'admin' then 0 else 1 end,
        lower(coalesce(nullif(p.first_name,''),p.email))
  ) as secured_result where private.is_active_user() and private.company_is_active(private.my_company_id());
$function$;


CREATE OR REPLACE FUNCTION public.company_list_members_v2()
 RETURNS TABLE(user_id uuid, email text, first_name text, last_name text, member_role text, member_status text, joined_at timestamp with time zone, employment_type text, hide_prices boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select p.id,p.email,p.first_name,p.last_name,cm.role,cm.status,cm.joined_at,cm.employment_type,cm.hide_prices
  from public.company_members cm
  join public.profiles p on p.id=cm.user_id
  where cm.company_id=private.my_company_id()
    and private.is_company_admin(cm.company_id)
    and cm.status<>'removed'
  order by case when cm.role='admin' then 0 else 1 end,lower(coalesce(nullif(p.first_name,''),p.email))
  ) as secured_result where private.is_active_user() and private.company_is_active(private.my_company_id());
$function$;


CREATE OR REPLACE FUNCTION public.company_set_member_status(p_user_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company uuid:=private.my_company_id();
  v_role text;
begin
  perform private.assert_api_user();
  if v_company is null or not private.is_company_admin(v_company) then raise exception 'Réservé au patron'; end if;
  if not private.company_is_active(v_company) then raise exception 'Société non active'; end if;
  if p_status<>'removed' then raise exception 'La désactivation temporaire est désactivée. Retire le technicien de la société pour qu’il repasse en solo.'; end if;

  select cm.role into v_role
  from public.company_members cm
  where cm.company_id=v_company and cm.user_id=p_user_id and cm.status in ('active','disabled');
  if not found then raise exception 'Technicien introuvable'; end if;
  if p_user_id=auth.uid() then raise exception 'Tu ne peux pas modifier ton propre accès ici'; end if;
  if v_role='admin' then raise exception 'Le patron principal ne peut pas être retiré depuis cette liste'; end if;

  perform private.detach_company_technician_to_solo(v_company,p_user_id);
end;
$function$;


CREATE OR REPLACE FUNCTION public.company_set_operator_active(p_operator text, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_company uuid := private.my_company_id();
begin
  perform private.assert_api_user();
    if v_company is null or not private.is_company_admin(v_company) then
        raise exception 'Réservé au patron';
    end if;

    if not private.company_is_active(v_company) then
        raise exception 'Société suspendue';
    end if;

    if p_operator not in ('orange','bouygues','sfr','free') then
        raise exception 'Opérateur invalide';
    end if;

    insert into public.company_operators(company_id,operator,active)
    values (v_company,p_operator,p_active)
    on conflict (company_id,operator)
    do update set active = excluded.active;
end;
$function$;


CREATE OR REPLACE FUNCTION public.company_set_technician_tariff(p_type_id uuid, p_user_id uuid, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company uuid:=private.my_company_id();
begin
  perform private.assert_api_user();
  if v_company is null or not private.is_company_admin(v_company) then raise exception 'Réservé au patron'; end if;
  if not private.company_is_active(v_company) then raise exception 'Société non active'; end if;
  if p_amount is null or p_amount<0 then raise exception 'Tarif invalide'; end if;
  if not exists(select 1 from public.company_members cm where cm.company_id=v_company and cm.user_id=p_user_id and cm.role='technician' and cm.status='active') then raise exception 'Technicien invalide'; end if;
  if not exists(select 1 from public.intervention_types it where it.id=p_type_id and it.company_id=v_company and it.active=true) then raise exception 'Typologie invalide'; end if;

  insert into public.company_technician_tariffs(company_id,intervention_type_id,user_id,amount,active)
  values(v_company,p_type_id,p_user_id,p_amount,true)
  on conflict(intervention_type_id,user_id)
  do update set amount=excluded.amount,active=true;
end;
$function$;


CREATE OR REPLACE FUNCTION public.company_update_type(p_type_id uuid, p_name text, p_agency_amount numeric, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company uuid:=private.my_company_id();
begin
  perform private.assert_api_user();
  if v_company is null or not private.is_company_admin(v_company) then raise exception 'Réservé au patron'; end if;
  if not private.company_is_active(v_company) then raise exception 'Société non active'; end if;
  if char_length(trim(coalesce(p_name,'')))=0 or p_agency_amount is null or p_agency_amount<0 then raise exception 'Valeurs invalides'; end if;

  update public.intervention_types
  set name=trim(p_name),agency_amount=p_agency_amount,active=coalesce(p_active,true)
  where id=p_type_id and company_id=v_company;
  if not found then raise exception 'Typologie introuvable'; end if;
end;
$function$;


CREATE OR REPLACE FUNCTION public.complete_fibre_ops_onboarding(p_first_name text, p_last_name text, p_theme text, p_accent_color text, p_compact_mode boolean, p_configuration jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_user_id uuid := auth.uid();
    v_operator jsonb;
    v_type jsonb;

    v_operator_name text;
    v_type_name text;
    v_amount numeric(10,2);
    v_sort_order integer;
begin
  perform private.assert_api_user();

    -- ============================================
    -- UTILISATEUR CONNECTE
    -- ============================================

    if v_user_id is null then
        raise exception 'Utilisateur non authentifié';
    end if;


    -- ============================================
    -- COMPTE ACTIF
    -- ============================================

    if not exists (
        select 1
        from public.profiles
        where id = v_user_id
        and active = true
    ) then
        raise exception 'Compte inactif';
    end if;


    -- ============================================
    -- ONBOARDING DEJA TERMINE
    -- ============================================

    if exists (
        select 1
        from public.profiles
        where id = v_user_id
        and onboarding_completed = true
    ) then
        raise exception 'Configuration déjà terminée';
    end if;


    -- ============================================
    -- SECURITE : PAS D'INTERVENTION EXISTANTE
    -- ============================================

    if exists (
        select 1
        from public.interventions
        where user_id = v_user_id
    ) then
        raise exception
        'Impossible de refaire la configuration : des interventions existent déjà';
    end if;


    -- ============================================
    -- NOM / PRENOM
    -- ============================================

    if char_length(trim(coalesce(p_first_name, ''))) not between 1 and 80 then
        raise exception 'Prénom invalide';
    end if;

    if char_length(trim(coalesce(p_last_name, ''))) not between 1 and 80 then
        raise exception 'Nom invalide';
    end if;


    -- ============================================
    -- THEME
    -- ============================================

    if p_theme not in ('system', 'light', 'dark') then
        raise exception 'Thème invalide';
    end if;


    -- ============================================
    -- COULEURS AUTORISEES
    -- ============================================

    if p_accent_color not in (
        'blue',
        'orange',
        'green',
        'purple',
        'red'
    ) then
        raise exception 'Couleur invalide';
    end if;


    -- ============================================
    -- CONFIGURATION OPERATEURS
    -- ============================================

    if jsonb_typeof(p_configuration) <> 'array' then
        raise exception 'Configuration opérateurs invalide';
    end if;

    if jsonb_array_length(p_configuration) < 1 then
        raise exception 'Sélectionnez au moins un opérateur';
    end if;

    if jsonb_array_length(p_configuration) > 4 then
        raise exception 'Trop d''opérateurs';
    end if;


    -- On nettoie une éventuelle tentative précédente incomplète.

    delete from public.intervention_types
    where user_id = v_user_id;

    delete from public.user_operators
    where user_id = v_user_id;


    -- ============================================
    -- PARCOURS DES OPERATEURS
    -- ============================================

    for v_operator in
        select value
        from jsonb_array_elements(p_configuration)
    loop

        v_operator_name :=
            lower(trim(v_operator ->> 'operator'));


        if v_operator_name not in (
            'orange',
            'bouygues',
            'sfr',
            'free'
        ) then
            raise exception
            'Opérateur invalide : %',
            v_operator_name;
        end if;


        if jsonb_typeof(v_operator -> 'types') <> 'array' then
            raise exception
            'Typologies invalides pour %',
            v_operator_name;
        end if;


        if jsonb_array_length(v_operator -> 'types') < 1 then
            raise exception
            'Ajoutez au moins une typologie pour %',
            v_operator_name;
        end if;


        if jsonb_array_length(v_operator -> 'types') > 100 then
            raise exception
            'Trop de typologies pour %',
            v_operator_name;
        end if;


        insert into public.user_operators (
            user_id,
            operator,
            active
        )
        values (
            v_user_id,
            v_operator_name,
            true
        );


        v_sort_order := 0;


        -- ========================================
        -- TYPOLOGIES DE L'OPERATEUR
        -- ========================================

        for v_type in
            select value
            from jsonb_array_elements(
                v_operator -> 'types'
            )
        loop

            v_type_name :=
                trim(v_type ->> 'name');


            if char_length(v_type_name)
                not between 1 and 80
            then
                raise exception
                'Nom de typologie invalide pour %',
                v_operator_name;
            end if;


            begin

                v_amount :=
                    (v_type ->> 'amount')::numeric(10,2);

            exception
                when others then

                    raise exception
                    'Tarif invalide pour la typologie %',
                    v_type_name;

            end;


            if v_amount < 0 then
                raise exception
                'Le tarif ne peut pas être négatif';
            end if;


            insert into public.intervention_types (
                user_id,
                operator,
                name,
                amount,
                active,
                sort_order
            )
            values (
                v_user_id,
                v_operator_name,
                v_type_name,
                v_amount,
                true,
                v_sort_order
            );


            v_sort_order :=
                v_sort_order + 1;

        end loop;

    end loop;


    -- ============================================
    -- PARAMETRES VISUELS
    -- ============================================

    update public.user_settings
    set
        theme = p_theme,
        accent_color = p_accent_color,
        compact_mode = coalesce(
            p_compact_mode,
            false
        )
    where user_id = v_user_id;


    -- ============================================
    -- PROFIL
    -- ============================================

    update public.profiles
    set
        first_name = trim(p_first_name),
        last_name = trim(p_last_name),
        onboarding_completed = true
    where id = v_user_id;

end;
$function$;


CREATE OR REPLACE FUNCTION public.create_team_invite(p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me uuid := auth.uid();
  v_target uuid;
  v_code text;
begin
  perform private.assert_api_user();
  if v_me is null then raise exception 'Non authentifié'; end if;
  if not private.is_active_user() then raise exception 'Compte désactivé'; end if;

  if exists(select 1 from public.company_members where user_id=v_me and status in ('active','disabled')) then
    raise exception 'Les binômes société sont gérés par le patron';
  end if;

  if exists(select 1 from public.team_members where user_id=v_me and status='active' and ended_at is null) then
    raise exception 'Ton compte est déjà lié à un binôme';
  end if;

  select p.id into v_target
  from public.profiles p
  where lower(p.email)=lower(trim(p_email))
    and p.active=true
    and p.onboarding_completed=true
    and p.id<>v_me
  limit 1;

  if v_target is null then raise exception 'Technicien introuvable ou non disponible'; end if;

  if exists(select 1 from public.company_members where user_id=v_target and status in ('active','disabled')) then
    raise exception 'Ce technicien appartient à une société';
  end if;

  if exists(select 1 from public.team_members where user_id=v_target and status='active' and ended_at is null) then
    raise exception 'Ce technicien est déjà lié à un binôme';
  end if;

  update public.team_invites set status='cancelled'
  where inviter_user_id=v_me and status='pending';

  v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.team_invites(code,inviter_user_id,invitee_user_id)
  values(v_code,v_me,v_target);

  return v_code;
end;
$function$;


CREATE OR REPLACE FUNCTION public.delete_intervention_supplement_type(p_supplement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_item public.intervention_supplement_types%rowtype;
begin
  perform private.assert_api_user();
  if v_user is null then
    raise exception 'Non authentifié';
  end if;

  select * into v_item
  from public.intervention_supplement_types
  where id = p_supplement_id;

  if not found then
    raise exception 'Complément introuvable';
  end if;

  if v_item.team_id is not null then
    if not private.is_team_member(v_item.team_id, v_user) then
      raise exception 'Action non autorisée';
    end if;
  elsif v_item.user_id is distinct from v_user then
    raise exception 'Action non autorisée';
  end if;

  delete from public.intervention_supplement_types where id = p_supplement_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.delete_intervention_type(p_type_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_type public.intervention_types%rowtype;
begin
  perform private.assert_api_user();
  if v_user is null then
    raise exception 'Non authentifié';
  end if;

  select * into v_type
  from public.intervention_types
  where id = p_type_id;

  if not found then
    raise exception 'Typologie introuvable';
  end if;

  if v_type.company_id is not null then
    if not private.is_company_admin(v_type.company_id, v_user)
       and not private.is_company_admin_for(v_type.company_id) then
      raise exception 'Action non autorisée';
    end if;
  elsif v_type.team_id is not null then
    if not private.is_team_member(v_type.team_id, v_user) then
      raise exception 'Action non autorisée';
    end if;
  elsif v_type.user_id is distinct from v_user then
    raise exception 'Action non autorisée';
  end if;

  delete from public.intervention_types where id = p_type_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.delete_my_intervention(p_intervention_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.interventions%rowtype;
begin
  perform private.assert_api_user();
  if v_uid is null then
    return false;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.active = true
  ) then
    return false;
  end if;

  select * into v_row
  from public.interventions i
  where i.id = p_intervention_id;

  if not found then
    return false;
  end if;

  -- Espace indépendant : le propriétaire supprime réellement la ligne.
  if v_row.company_id is null then
    if v_row.user_id = v_uid then
      delete from public.interventions where id = v_row.id;
      return found;
    end if;

    -- Ancien binôme : on retire seulement l'intervention de l'historique
    -- de l'utilisateur courant afin de ne pas effacer les données du partenaire.
    if v_row.team_id is not null
       and private.was_team_member(v_row.team_id, v_uid) then
      insert into public.intervention_user_hidden(intervention_id,user_id)
      values (v_row.id,v_uid)
      on conflict (intervention_id,user_id) do nothing;
      return true;
    end if;

    return false;
  end if;

  -- Les données métier d'une société restent invisibles au platform admin.
  if private.fibre_ops_is_platform_admin() then
    return false;
  end if;

  if not private.is_company_member(v_row.company_id)
     or not private.company_is_active(v_row.company_id) then
    return false;
  end if;

  if private.is_company_admin(v_row.company_id)
     or v_row.user_id = v_uid
     or v_row.solo_user_id = v_uid
     or (v_row.team_id is not null and private.is_team_member(v_row.team_id,v_uid)) then
    delete from public.interventions where id = v_row.id;
    return found;
  end if;

  return false;
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_my_company_context()
 RETURNS TABLE(company_id uuid, company_name text, member_role text, member_status text, company_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select cm.company_id,c.name,cm.role,cm.status,c.status
  from public.company_members cm
  join public.companies c on c.id=cm.company_id
  where cm.user_id=auth.uid()
    and cm.status in ('active','disabled')
  order by case when cm.status='active' then 0 else 1 end, cm.joined_at desc
  limit 1
  ) as secured_result where private.is_active_user();
$function$;


CREATE OR REPLACE FUNCTION public.get_my_company_intervention_history()
 RETURNS TABLE(id uuid, user_id uuid, company_id uuid, company_name text, team_id uuid, work_mode text, solo_user_id uuid, created_by uuid, intervention_date date, operator text, intervention_type_id uuid, intervention_type_name text, my_payout numeric, result text, reference text, address text, notes text, operator_data jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select
    i.id,
    i.user_id,
    i.company_id,
    c.name,
    i.team_id,
    i.work_mode,
    i.solo_user_id,
    i.created_by,
    i.intervention_date,
    i.operator,
    i.intervention_type_id,
    i.intervention_type_name,
    case when coalesce(history_member.hide_prices,false) then 0 else coalesce(
      ip.payout_amount_snapshot,
      case
        when i.solo_user_id = auth.uid() or i.user_id = auth.uid()
          then i.applied_amount
        else 0
      end,
      0
    ) end::numeric as my_payout,
    i.result,
    i.reference,
    i.address,
    i.notes,
    i.operator_data,
    i.created_at,
    i.updated_at
  from public.interventions i
  join public.companies c on c.id = i.company_id
  join public.company_members history_member on history_member.company_id=i.company_id and history_member.user_id=auth.uid()
  left join public.intervention_payments ip
    on ip.intervention_id = i.id
   and ip.user_id = auth.uid()
  where i.company_id is not null
    and not private.fibre_ops_is_platform_admin()
    and private.company_is_active(i.company_id)
    and (
      ip.user_id = auth.uid()
      or i.user_id = auth.uid()
      or i.solo_user_id = auth.uid()
      or exists (
        select 1
        from public.team_members tm
        where tm.team_id = i.team_id
          and tm.user_id = auth.uid()
          and tm.status in ('active','ended')
          and i.created_at >= tm.joined_at
          and (tm.ended_at is null or i.created_at <= tm.ended_at)
      )
    )
  order by i.intervention_date,i.created_at
  ) as secured_result where private.is_active_user();
$function$;


CREATE OR REPLACE FUNCTION public.get_my_company_invites()
 RETURNS TABLE(invite_id uuid, company_id uuid, company_name text, invite_role text, code text, expires_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select ci.id,ci.company_id,c.name,ci.role,ci.code,ci.expires_at,ci.created_at
  from public.company_invites ci
  join public.companies c on c.id=ci.company_id
  join public.profiles p on p.id=auth.uid()
  where lower(ci.email)=lower(p.email)
    and ci.status='pending'
    and ci.expires_at>now()
    and p.active=true
    and c.status='active'
  order by ci.created_at desc
  ) as secured_result where private.is_active_user();
$function$;


CREATE OR REPLACE FUNCTION public.get_my_company_invites_v2()
 RETURNS TABLE(invite_id uuid, company_id uuid, company_name text, invite_role text, code text, expires_at timestamp with time zone, created_at timestamp with time zone, employment_type text, hide_prices boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select ci.id,ci.company_id,c.name,ci.role,ci.code,ci.expires_at,ci.created_at,ci.employment_type,ci.hide_prices
  from public.company_invites ci
  join public.companies c on c.id=ci.company_id
  join public.profiles p on p.id=auth.uid()
  where lower(ci.email)=lower(p.email)
    and ci.status='pending'
    and ci.expires_at>now()
    and p.active=true
    and c.status='active'
  order by ci.created_at desc
  ) as secured_result where private.is_active_user();
$function$;


CREATE OR REPLACE FUNCTION public.get_my_independent_interventions()
 RETURNS TABLE(id uuid, user_id uuid, team_id uuid, work_mode text, solo_user_id uuid, created_by uuid, intervention_date date, operator text, intervention_type_id uuid, intervention_type_name text, applied_amount numeric, result text, reference text, address text, notes text, operator_data jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select
    i.id,i.user_id,i.team_id,i.work_mode,i.solo_user_id,i.created_by,
    i.intervention_date,i.operator,i.intervention_type_id,
    i.intervention_type_name,i.applied_amount,i.result,i.reference,
    i.address,i.notes,i.operator_data,i.created_at,i.updated_at
  from public.interventions i
  where i.company_id is null
    and not exists (
      select 1
      from public.intervention_user_hidden h
      where h.intervention_id = i.id
        and h.user_id = auth.uid()
    )
    and (
      (i.team_id is null and i.user_id = auth.uid())
      or i.team_id in (
        select tm.team_id
        from public.team_members tm
        where tm.user_id = auth.uid()
          and tm.status in ('active','ended')
      )
    )
  order by i.intervention_date,i.created_at
  ) as secured_result where private.is_active_user();
$function$;


CREATE OR REPLACE FUNCTION public.get_my_team()
 RETURNS TABLE(team_id uuid, team_name text, partner_user_id uuid, partner_first_name text, partner_last_name text, partner_email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select
        t.id,
        t.name,
        p.id,
        p.first_name,
        p.last_name,
        p.email
    from public.team_members me
    join public.teams t
      on t.id = me.team_id
     and t.ended_at is null
    join public.team_members other
      on other.team_id = me.team_id
     and other.user_id <> me.user_id
     and other.status = 'active'
     and other.ended_at is null
    join public.profiles p on p.id = other.user_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and me.ended_at is null
    limit 1
  ) as secured_result where private.is_active_user();
$function$;


CREATE OR REPLACE FUNCTION public.get_my_team_invite()
 RETURNS TABLE(code text, invitee_email text, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select ti.code, p.email, ti.expires_at
    from public.team_invites ti
    join public.profiles p on p.id = ti.invitee_user_id
    where ti.inviter_user_id = auth.uid()
      and ti.status = 'pending'
      and ti.expires_at > now()
    order by ti.created_at desc
    limit 1
  ) as secured_result where private.is_active_user();
$function$;


CREATE OR REPLACE FUNCTION public.get_team_invite_tariff_options(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me uuid := auth.uid();
  v_inv public.team_invites%rowtype;
  v_result jsonb;
begin
  perform private.assert_api_user();
  if v_me is null then raise exception 'Non authentifié'; end if;

  select * into v_inv
  from public.team_invites
  where upper(code)=upper(trim(p_code))
    and status='pending'
    and expires_at>now();

  if not found then raise exception 'Code invalide ou expiré'; end if;
  if v_inv.invitee_user_id<>v_me then raise exception 'Cette invitation ne correspond pas à ton compte'; end if;

  if exists(select 1 from public.company_members where user_id in (v_inv.inviter_user_id,v_inv.invitee_user_id) and status in ('active','disabled')) then
    raise exception 'Les binômes société sont gérés par le patron';
  end if;

  select jsonb_build_object(
    'inviter',jsonb_build_object(
      'id',pi.id,
      'name',coalesce(nullif(trim(concat_ws(' ',pi.first_name,pi.last_name)),''),pi.email),
      'email',pi.email,
      'catalog',coalesce((
        select jsonb_agg(jsonb_build_object(
          'operator',it.operator,'name',it.name,'amount',it.amount,'active',it.active,'sort_order',it.sort_order
        ) order by it.operator,it.sort_order,it.name)
        from public.intervention_types it
        where it.user_id=pi.id and it.company_id is null and it.team_id is null
      ),'[]'::jsonb)
    ),
    'invitee',jsonb_build_object(
      'id',pe.id,
      'name',coalesce(nullif(trim(concat_ws(' ',pe.first_name,pe.last_name)),''),pe.email),
      'email',pe.email,
      'catalog',coalesce((
        select jsonb_agg(jsonb_build_object(
          'operator',it.operator,'name',it.name,'amount',it.amount,'active',it.active,'sort_order',it.sort_order
        ) order by it.operator,it.sort_order,it.name)
        from public.intervention_types it
        where it.user_id=pe.id and it.company_id is null and it.team_id is null
      ),'[]'::jsonb)
    )
  ) into v_result
  from public.profiles pi
  join public.profiles pe on pe.id=v_inv.invitee_user_id
  where pi.id=v_inv.inviter_user_id;

  return v_result;
end;
$function$;


CREATE OR REPLACE FUNCTION public.invoice_cancel(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_api_user();
  if not private.fibre_ops_can_invoice_solo(auth.uid()) then raise exception 'La facturation est réservée au compte indépendant'; end if;
  update public.invoices set status='cancelled',updated_at=now()
  where id=p_invoice_id and user_id=auth.uid() and status in ('draft','issued');
  if not found then raise exception 'Facture introuvable ou déjà payée'; end if;
end;
$function$;


CREATE OR REPLACE FUNCTION public.invoice_delete_reconciliation(p_month date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_api_user();
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  delete from public.invoice_reconciliations
  where user_id=auth.uid() and reconciliation_month=date_trunc('month',p_month)::date;
end;
$function$;


CREATE OR REPLACE FUNCTION public.invoice_issue(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.invoices%rowtype;
  v_siret text;
  v_client_siret text;
begin
  perform private.assert_api_user();
  if not private.fibre_ops_can_invoice_solo(auth.uid()) then
    raise exception 'La facturation n’est pas disponible pour ce statut';
  end if;

  select * into v
  from public.invoices
  where id=p_invoice_id and user_id=auth.uid() and status='draft'
  for update;

  if not found then raise exception 'Brouillon introuvable ou déjà validé'; end if;
  if coalesce(v.total_amount,0) <= 0 then raise exception 'Le montant doit être supérieur à 0 €'; end if;
  if v.due_date < v.issue_date then raise exception 'L’échéance ne peut pas être antérieure à la date de facture'; end if;

  if nullif(trim(coalesce(v.seller_snapshot->>'business_name','')),'') is null then raise exception 'Raison sociale émetteur obligatoire'; end if;
  if nullif(trim(coalesce(v.seller_snapshot->>'address_line1','')),'') is null then raise exception 'Adresse émetteur obligatoire'; end if;
  if nullif(trim(coalesce(v.seller_snapshot->>'postal_code','')),'') is null then raise exception 'Code postal émetteur obligatoire'; end if;
  if nullif(trim(coalesce(v.seller_snapshot->>'city','')),'') is null then raise exception 'Ville émetteur obligatoire'; end if;
  v_siret:=regexp_replace(coalesce(v.seller_snapshot->>'siret',''),'[^0-9]','','g');
  if v_siret !~ '^[0-9]{14}$' then raise exception 'SIRET émetteur obligatoire (14 chiffres)'; end if;

  if nullif(trim(coalesce(v.client_snapshot->>'name','')),'') is null then raise exception 'Nom du client obligatoire'; end if;
  v_client_siret:=regexp_replace(coalesce(v.client_snapshot->>'siret',''),'[^0-9]','','g');
  if v_client_siret<>'' and v_client_siret !~ '^[0-9]{14}$' then raise exception 'SIRET client invalide'; end if;

  update public.invoices
  set status='issued', issued_at=coalesce(issued_at,now()), updated_at=now()
  where id=p_invoice_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.invoice_mark_paid(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.assert_api_user();
  if not private.fibre_ops_can_invoice_solo(auth.uid()) then raise exception 'La facturation n’est pas disponible pour ce statut'; end if;
  update public.invoices set status='paid',paid_at=coalesce(paid_at,now()),updated_at=now()
  where id=p_invoice_id and user_id=auth.uid() and status='issued';
  if not found then raise exception 'Facture émise introuvable'; end if;
end;
$function$;


CREATE OR REPLACE FUNCTION public.invoice_save_client(p_client_id uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_address_line1 text DEFAULT NULL::text, p_address_line2 text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country text DEFAULT 'France'::text, p_siret text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid:=auth.uid();
  v_id uuid;
  v_siret text:=regexp_replace(coalesce(p_siret,''),'[^0-9]','','g');
begin
  perform private.assert_api_user();
  if not private.fibre_ops_can_invoice_solo(v_user) then
    raise exception 'La création ou modification de clients est réservée au compte indépendant';
  end if;
  if char_length(trim(coalesce(p_name,'')))=0 then raise exception 'Nom du client obligatoire'; end if;
  if v_siret<>'' and v_siret !~ '^[0-9]{14}$' then raise exception 'Le SIRET client doit contenir 14 chiffres'; end if;

  if p_client_id is null then
    insert into public.invoice_clients(user_id,name,address_line1,address_line2,postal_code,city,country,siret,email,phone,contact_name)
    values(v_user,trim(p_name),nullif(trim(coalesce(p_address_line1,'')),''),nullif(trim(coalesce(p_address_line2,'')),''),nullif(trim(coalesce(p_postal_code,'')),''),nullif(trim(coalesce(p_city,'')),''),coalesce(nullif(trim(coalesce(p_country,'')),''),'France'),nullif(v_siret,''),nullif(trim(coalesce(p_email,'')),''),nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_contact_name,'')),''))
    returning id into v_id;
  else
    update public.invoice_clients set
      name=trim(p_name),address_line1=nullif(trim(coalesce(p_address_line1,'')),''),address_line2=nullif(trim(coalesce(p_address_line2,'')),''),postal_code=nullif(trim(coalesce(p_postal_code,'')),''),city=nullif(trim(coalesce(p_city,'')),''),country=coalesce(nullif(trim(coalesce(p_country,'')),''),'France'),siret=nullif(v_siret,''),email=nullif(trim(coalesce(p_email,'')),''),phone=nullif(trim(coalesce(p_phone,'')),''),contact_name=nullif(trim(coalesce(p_contact_name,'')),''),updated_at=now()
    where id=p_client_id and user_id=v_user
    returning id into v_id;
    if v_id is null then raise exception 'Client introuvable'; end if;
  end if;
  return v_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.invoice_save_draft(p_invoice_id uuid DEFAULT NULL::uuid, p_client_id uuid DEFAULT NULL::uuid, p_issue_date date DEFAULT CURRENT_DATE, p_due_date date DEFAULT NULL::date, p_billing_month date DEFAULT NULL::date, p_period_label text DEFAULT NULL::text, p_operation_type text DEFAULT 'Bien et services'::text, p_description text DEFAULT 'Bien et services'::text, p_amount numeric DEFAULT 0, p_payment_terms_days integer DEFAULT NULL::integer)
 RETURNS TABLE(invoice_id uuid, invoice_number integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid:=auth.uid();
  v_profile public.invoice_profiles%rowtype;
  v_client public.invoice_clients%rowtype;
  v_id uuid;
  v_no integer;
  v_terms integer;
  v_due date;
  v_seller jsonb;
  v_client_json jsonb;
begin
  perform private.assert_api_user();
  if not private.fibre_ops_can_invoice_solo(v_user) then raise exception 'La facturation n’est pas disponible pour ce statut'; end if;
  if p_client_id is null then raise exception 'Sélectionne une société cliente'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Le montant doit être supérieur à 0 €'; end if;

  select * into v_profile from public.invoice_profiles where user_id=v_user;
  if not found then raise exception 'Renseigne d’abord les informations de ta société'; end if;
  select * into v_client from public.invoice_clients where id=p_client_id and user_id=v_user;
  if not found then raise exception 'Client introuvable'; end if;

  v_terms:=coalesce(p_payment_terms_days,v_profile.default_payment_terms_days,7);
  if v_terms not between 0 and 120 then raise exception 'Délai de paiement invalide'; end if;
  v_due:=coalesce(p_due_date,coalesce(p_issue_date,current_date)+v_terms);
  if v_due < coalesce(p_issue_date,current_date) then raise exception 'Échéance invalide'; end if;

  v_seller:=jsonb_build_object(
    'business_name',v_profile.business_name,'owner_name',v_profile.owner_name,'address_line1',v_profile.address_line1,'address_line2',v_profile.address_line2,
    'postal_code',v_profile.postal_code,'city',v_profile.city,'country',v_profile.country,'siret',v_profile.siret,'email',v_profile.email,'phone',v_profile.phone,
    'legal_status',v_profile.legal_status,'vat_number',v_profile.vat_number,'vat_exempt',v_profile.vat_exempt
  );
  v_client_json:=jsonb_build_object(
    'name',v_client.name,'address_line1',v_client.address_line1,'address_line2',v_client.address_line2,'postal_code',v_client.postal_code,'city',v_client.city,
    'country',v_client.country,'siret',v_client.siret,'email',v_client.email,'phone',v_client.phone,'contact_name',v_client.contact_name
  );

  if p_invoice_id is null then
    perform pg_advisory_xact_lock(hashtextextended(v_user::text,314159));
    select coalesce(max(i.invoice_number),0)+1 into v_no from public.invoices i where i.user_id=v_user;
    insert into public.invoices(
      user_id,client_id,invoice_number,issue_date,due_date,billing_month,period_label,operation_type,description,quantity,unit,unit_price,total_amount,
      seller_snapshot,client_snapshot,vat_note,payment_terms_days,late_penalty_text,recovery_fee,status
    ) values (
      v_user,p_client_id,v_no,coalesce(p_issue_date,current_date),v_due,p_billing_month,nullif(trim(coalesce(p_period_label,'')),''),coalesce(nullif(trim(coalesce(p_operation_type,'')),''),'Bien et services'),coalesce(nullif(trim(coalesce(p_description,'')),''),'Bien et services'),1,'pce',round(p_amount,2),round(p_amount,2),
      v_seller,v_client_json,case when v_profile.vat_exempt then 'TVA non applicable, art. 293 B du CGI.' else null end,v_terms,v_profile.late_penalty_text,v_profile.recovery_fee,'draft'
    ) returning id,public.invoices.invoice_number into v_id,v_no;
  else
    update public.invoices set
      client_id=p_client_id,issue_date=coalesce(p_issue_date,current_date),due_date=v_due,billing_month=p_billing_month,period_label=nullif(trim(coalesce(p_period_label,'')),''),
      operation_type=coalesce(nullif(trim(coalesce(p_operation_type,'')),''),'Bien et services'),description=coalesce(nullif(trim(coalesce(p_description,'')),''),'Bien et services'),
      quantity=1,unit='pce',unit_price=round(p_amount,2),total_amount=round(p_amount,2),seller_snapshot=v_seller,client_snapshot=v_client_json,
      vat_note=case when v_profile.vat_exempt then 'TVA non applicable, art. 293 B du CGI.' else null end,payment_terms_days=v_terms,late_penalty_text=v_profile.late_penalty_text,recovery_fee=v_profile.recovery_fee,updated_at=now()
    where id=p_invoice_id and user_id=v_user and status='draft'
    returning id,public.invoices.invoice_number into v_id,v_no;
    if v_id is null then raise exception 'Brouillon introuvable ou facture déjà validée'; end if;
  end if;

  invoice_id:=v_id; invoice_number:=v_no; return next;
end;
$function$;


CREATE OR REPLACE FUNCTION public.invoice_save_profile(p_business_name text, p_owner_name text DEFAULT NULL::text, p_address_line1 text DEFAULT NULL::text, p_address_line2 text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country text DEFAULT 'France'::text, p_siret text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_legal_status text DEFAULT NULL::text, p_vat_number text DEFAULT NULL::text, p_vat_exempt boolean DEFAULT true, p_default_payment_terms_days integer DEFAULT 7)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid:=auth.uid();
  v_siret text:=regexp_replace(coalesce(p_siret,''),'[^0-9]','','g');
begin
  perform private.assert_api_user();
  if not private.fibre_ops_can_invoice_solo(v_user) then
    raise exception 'La création ou modification de factures est réservée au compte indépendant';
  end if;
  if char_length(trim(coalesce(p_business_name,'')))=0 then raise exception 'Nom de société obligatoire'; end if;
  if v_siret<>'' and v_siret !~ '^[0-9]{14}$' then raise exception 'Le SIRET doit contenir 14 chiffres'; end if;
  if coalesce(p_default_payment_terms_days,7) not between 0 and 120 then raise exception 'Délai de paiement invalide'; end if;

  insert into public.invoice_profiles(
    user_id,business_name,owner_name,address_line1,address_line2,postal_code,city,country,siret,email,phone,legal_status,vat_number,vat_exempt,default_payment_terms_days
  ) values (
    v_user,trim(p_business_name),nullif(trim(coalesce(p_owner_name,'')),''),nullif(trim(coalesce(p_address_line1,'')),''),nullif(trim(coalesce(p_address_line2,'')),''),nullif(trim(coalesce(p_postal_code,'')),''),nullif(trim(coalesce(p_city,'')),''),coalesce(nullif(trim(coalesce(p_country,'')),''),'France'),nullif(v_siret,''),nullif(trim(coalesce(p_email,'')),''),nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_legal_status,'')),''),nullif(trim(coalesce(p_vat_number,'')),''),coalesce(p_vat_exempt,true),coalesce(p_default_payment_terms_days,7)
  )
  on conflict (user_id) do update set
    business_name=excluded.business_name,
    owner_name=excluded.owner_name,
    address_line1=excluded.address_line1,
    address_line2=excluded.address_line2,
    postal_code=excluded.postal_code,
    city=excluded.city,
    country=excluded.country,
    siret=excluded.siret,
    email=excluded.email,
    phone=excluded.phone,
    legal_status=excluded.legal_status,
    vat_number=excluded.vat_number,
    vat_exempt=excluded.vat_exempt,
    default_payment_terms_days=excluded.default_payment_terms_days,
    updated_at=now();
end;
$function$;


CREATE OR REPLACE FUNCTION public.invoice_save_reconciliation(p_month date, p_filename text, p_rows jsonb, p_mapping jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  perform private.assert_api_user();
  if not private.fibre_ops_can_invoice_solo(auth.uid()) then
    raise exception 'La comparaison de récapitulatifs est réservée aux techniciens autorisés à facturer';
  end if;
  if p_month is null then raise exception 'Mois invalide'; end if;
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then raise exception 'Données importées invalides'; end if;
  if jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 10000 then raise exception 'Récapitulatif trop volumineux'; end if;

  insert into public.invoice_reconciliations(user_id,reconciliation_month,source_filename,source_rows,column_mapping)
  values(auth.uid(),date_trunc('month',p_month)::date,nullif(trim(coalesce(p_filename,'')),''),coalesce(p_rows,'[]'::jsonb),coalesce(p_mapping,'{}'::jsonb))
  on conflict(user_id,reconciliation_month)
  do update set source_filename=excluded.source_filename,source_rows=excluded.source_rows,column_mapping=excluded.column_mapping,updated_at=now()
  returning id into v_id;
  return v_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.leave_company_to_solo()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_company uuid;
begin
  perform private.assert_api_user();
  if v_user is null then
    raise exception 'Non authentifié';
  end if;

  if not private.is_active_user() then
    raise exception 'Compte désactivé';
  end if;

  select cm.company_id
  into v_company
  from public.company_members cm
  where cm.user_id = v_user
    and cm.role = 'technician'
    and cm.status in ('active','disabled')
  order by cm.updated_at desc nulls last, cm.joined_at desc
  limit 1;

  if v_company is null then
    raise exception 'Ton compte n’est rattaché à aucune société active';
  end if;

  perform private.detach_company_technician_to_solo(v_company,v_user);
  return v_company;
end;
$function$;


CREATE OR REPLACE FUNCTION public.platform_assign_company_admin(p_company_id uuid, p_admin_email text)
 RETURNS TABLE(assigned boolean, invite_code text, admin_user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid;
  v_code text;
  v_old record;
begin
  perform private.assert_api_user();
  if not private.is_platform_admin() then raise exception 'Accès plateforme refusé'; end if;
  if not exists(select 1 from public.companies c where c.id=p_company_id and c.status<>'archived') then raise exception 'Société introuvable ou archivée'; end if;
  if position('@' in coalesce(p_admin_email,''))=0 then raise exception 'E-mail patron invalide'; end if;

  select p.id into v_user
  from public.profiles p
  where lower(p.email)=lower(trim(p_admin_email)) and p.active=true and p.role<>'platform_admin'
  limit 1;

  if v_user is not null then
    if exists(select 1 from public.company_members cm where cm.user_id=v_user and cm.company_id<>p_company_id and cm.status in ('active','disabled')) then
      raise exception 'Ce compte appartient déjà à une autre société';
    end if;

    -- L'ancien patron reste dans la société comme technicien, sans droit d'administration.
    for v_old in
      select cm.user_id
      from public.company_members cm
      where cm.company_id=p_company_id and cm.role='admin' and cm.user_id<>v_user and cm.status in ('active','disabled')
    loop
      update public.company_members set role='technician',updated_at=now()
      where company_id=p_company_id and user_id=v_old.user_id;
      update public.profiles set role='technician',company_id=p_company_id,updated_at=now()
      where id=v_old.user_id and role<>'platform_admin';
    end loop;

    insert into public.company_members(company_id,user_id,role,status)
    values(p_company_id,v_user,'admin','active')
    on conflict(company_id,user_id)
    do update set role='admin',status='active',updated_at=now();

    update public.profiles
    set role='company_admin',company_id=p_company_id,onboarding_completed=true,updated_at=now()
    where id=v_user;

    update public.company_invites set status='cancelled'
    where company_id=p_company_id and lower(email)=lower(trim(p_admin_email)) and status='pending';

    assigned:=true; invite_code:=null; admin_user_id:=v_user;
    return next; return;
  end if;

  update public.company_invites set status='cancelled'
  where company_id=p_company_id and role='admin' and status='pending';

  loop
    v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    exit when not exists(select 1 from public.company_invites where code=v_code);
  end loop;

  insert into public.company_invites(company_id,email,role,code,created_by)
  values(p_company_id,lower(trim(p_admin_email)),'admin',v_code,auth.uid());

  assigned:=false; invite_code:=v_code; admin_user_id:=null;
  return next;
end;
$function$;


CREATE OR REPLACE FUNCTION public.platform_create_empty_company(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company uuid;
begin
  perform private.assert_api_user();
  if not private.is_platform_admin() then raise exception 'Accès plateforme refusé'; end if;
  if char_length(trim(coalesce(p_name,'')))<2 then raise exception 'Nom de société invalide'; end if;

  insert into public.companies(name,created_by)
  values(trim(p_name),auth.uid())
  returning id into v_company;

  insert into public.company_operators(company_id,operator,active)
  values
    (v_company,'orange',false),(v_company,'bouygues',false),
    (v_company,'sfr',false),(v_company,'free',false)
  on conflict(company_id,operator) do nothing;

  return v_company;
end;
$function$;


CREATE OR REPLACE FUNCTION public.platform_list_companies()
 RETURNS TABLE(id uuid, name text, status text, admin_email text, member_count bigint, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select
    c.id,
    c.name,
    c.status,
    null::text as admin_email,
    (
      select count(*)
      from public.company_members cm
      where cm.company_id = c.id
        and cm.status = 'active'
    ) as member_count,
    c.created_at
  from public.companies c
  where private.is_platform_admin()
  order by c.created_at desc
  ) as secured_result where private.is_active_user();
$function$;


CREATE OR REPLACE FUNCTION public.platform_set_company_status(p_company_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user record;
begin
  perform private.assert_api_user();
  if not private.is_platform_admin() then raise exception 'Accès plateforme refusé'; end if;
  if p_status not in ('active','suspended','archived') then raise exception 'Statut invalide'; end if;
  if not exists(select 1 from public.companies where id=p_company_id) then raise exception 'Société introuvable'; end if;

  if p_status='archived' then
    -- Les techniciens retrouvent automatiquement un espace solo avec leurs propres tarifs.
    for v_user in
      select cm.user_id
      from public.company_members cm
      where cm.company_id=p_company_id
        and cm.role='technician'
        and cm.status in ('active','disabled')
    loop
      perform private.detach_company_technician_to_solo(p_company_id,v_user.user_id);
    end loop;

    update public.company_invites
    set status='cancelled'
    where company_id=p_company_id and status='pending';
  end if;

  update public.companies set status=p_status,updated_at=now() where id=p_company_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.reject_company_invite(p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid:=auth.uid();
  v_email text;
  v_invite public.company_invites%rowtype;
begin
  perform private.assert_api_user();
  if v_user is null then raise exception 'Non authentifié'; end if;

  select lower(email) into v_email
  from public.profiles
  where id=v_user and active=true;

  if v_email is null then raise exception 'Profil inaccessible'; end if;

  select * into v_invite
  from public.company_invites
  where upper(code)=upper(trim(p_code))
    and status='pending'
    and expires_at>now()
  for update;

  if not found then raise exception 'Code invalide ou expiré'; end if;
  if lower(v_invite.email)<>v_email then raise exception 'Cette invitation correspond à une autre adresse e-mail'; end if;

  update public.company_invites
  set status='declined'
  where id=v_invite.id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.set_operator_active(p_operator text, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_user uuid := auth.uid();
    v_team uuid;
    v_updated integer;
begin
  perform private.assert_api_user();
    if v_user is null then
        raise exception 'Non authentifié';
    end if;

    if not private.is_active_user() then
        raise exception 'Compte désactivé';
    end if;

    if p_operator not in ('orange','bouygues','sfr','free') then
        raise exception 'Opérateur invalide';
    end if;

    select tm.team_id
    into v_team
    from public.team_members tm
    where tm.user_id = v_user
      and tm.status = 'active'
    limit 1;

    if v_team is not null then
        update public.user_operators uo
        set active = p_active,
            updated_at = now()
        where uo.team_id = v_team
          and uo.operator = p_operator;

        get diagnostics v_updated = row_count;
    else
        update public.user_operators uo
        set active = p_active,
            updated_at = now()
        where uo.user_id = v_user
          and uo.team_id is null
          and uo.operator = p_operator;

        get diagnostics v_updated = row_count;
    end if;

    if v_updated = 0 then
        raise exception 'Opérateur introuvable dans ta configuration';
    end if;
end;
$function$;


CREATE OR REPLACE FUNCTION public.set_operator_supplements_enabled(p_operator text, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_user uuid := auth.uid();
    v_team uuid;
    v_updated integer;
begin
  perform private.assert_api_user();
    if v_user is null then
        raise exception 'Non authentifié';
    end if;

    if not private.is_active_user() then
        raise exception 'Compte désactivé';
    end if;

    if p_operator not in ('orange','bouygues','sfr','free') then
        raise exception 'Opérateur invalide';
    end if;

    select tm.team_id
      into v_team
      from public.team_members tm
     where tm.user_id = v_user
       and tm.status = 'active'
     limit 1;

    if v_team is not null then
        if not private.fibre_ops_team_business_allowed(v_team) then
            raise exception 'Configuration binôme non autorisée';
        end if;

        update public.user_operators uo
           set supplements_enabled = p_enabled,
               updated_at = now()
         where uo.team_id = v_team
           and uo.operator = p_operator;

        get diagnostics v_updated = row_count;
    else
        update public.user_operators uo
           set supplements_enabled = p_enabled,
               updated_at = now()
         where uo.user_id = v_user
           and uo.team_id is null
           and uo.operator = p_operator;

        get diagnostics v_updated = row_count;
    end if;

    if v_updated = 0 then
        raise exception 'Opérateur introuvable dans ta configuration';
    end if;
end;
$function$;


create or replace function public.reserve_company_technician_invitation(p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid; attempt_id uuid; normalized_email text:=lower(trim(p_email)); company_name text;
begin
  perform private.assert_api_user();
  cid:=private.my_company_id();
  if cid is null or not private.is_company_admin(cid) or not private.company_is_active(cid) then
    raise exception 'Accès société refusé' using errcode='42501';
  end if;
  if char_length(normalized_email)>254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'E-mail invalide' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(cid::text,0));
  perform pg_advisory_xact_lock(hashtextextended(normalized_email,1));
  if (select count(*) from private.technician_invitation_attempts a where a.company_id=cid and a.created_at>now()-interval '10 minutes')>=10
     or (select count(*) from private.technician_invitation_attempts a where a.company_id=cid and a.created_at>now()-interval '1 day')>=50 then
    raise exception 'Limite d’invitations atteinte. Réessaie plus tard.' using errcode='P0001';
  end if;
  if exists(select 1 from auth.users u where lower(u.email)=normalized_email)
     or exists(select 1 from public.profiles p where lower(p.email)=normalized_email) then
    raise exception 'Invitation impossible pour cette adresse. Utilise le parcours compte existant.' using errcode='23505';
  end if;
  update private.technician_invitation_attempts set status='failed'
    where email=normalized_email and status='reserved' and created_at<=now()-interval '10 minutes';
  if exists(select 1 from private.technician_invitation_attempts a where a.email=normalized_email and a.status='reserved') then
    raise exception 'Invitation déjà en cours' using errcode='23505';
  end if;
  insert into private.technician_invitation_attempts(actor_id,company_id,email)
    values(auth.uid(),cid,normalized_email) returning id into attempt_id;
  select c.name into company_name from public.companies c where c.id=cid;
  return jsonb_build_object('attempt_id',attempt_id,'company_id',cid,'company_name',company_name);
end;
$$;
revoke all on function public.reserve_company_technician_invitation(text) from public,anon;
grant execute on function public.reserve_company_technician_invitation(text) to authenticated;

-- Auth email delivery is external. The database portion is a single transaction;
-- ownership of a newly-created invitation is verified before any provisioning.
create or replace function public.finalize_company_technician_invitation(
  p_attempt_id uuid,p_user_id uuid,p_first_name text,p_last_name text,
  p_employment_type text,p_hide_prices boolean)
returns void language plpgsql security definer set search_path='' as $$
declare attempt private.technician_invitation_attempts%rowtype;
begin
  select * into attempt from private.technician_invitation_attempts where id=p_attempt_id for update;
  if not found or attempt.status<>'reserved' or attempt.created_at<now()-interval '10 minutes' then
    raise exception 'Invitation invalide' using errcode='42501';
  end if;
  perform 1 from public.companies where id=attempt.company_id and status='active' for share;
  if not found then raise exception 'Société inactive' using errcode='42501'; end if;
  perform 1 from public.company_members where company_id=attempt.company_id and user_id=attempt.actor_id and role='admin' and status='active' for share;
  if not found or not private.account_ready(attempt.actor_id) then
    raise exception 'Administrateur inactif' using errcode='42501';
  end if;
  if not exists(select 1 from auth.users u where u.id=p_user_id and lower(u.email)=attempt.email
    and u.created_at>=attempt.created_at and u.invited_at>=attempt.created_at
    and attempt.invited_user_id=u.id) then
    raise exception 'Ce compte ne provient pas de cette invitation' using errcode='42501';
  end if;
  if p_employment_type not in ('auto','salaried') or char_length(trim(p_first_name)) not between 1 and 80
    or char_length(coalesce(p_last_name,''))>80 then raise exception 'Paramètres invalides' using errcode='22023'; end if;
  if exists(select 1 from public.company_members where user_id=p_user_id and status in ('active','disabled')) then
    raise exception 'Compte déjà rattaché' using errcode='23505';
  end if;
  update public.profiles set first_name=trim(p_first_name),last_name=trim(coalesce(p_last_name,'')),
    role='technician',active=true,onboarding_completed=true,company_id=attempt.company_id where id=p_user_id;
  if not found then raise exception 'Profil non créé'; end if;
  insert into public.company_members(company_id,user_id,role,status,employment_type,hide_prices)
    values(attempt.company_id,p_user_id,'technician','active',p_employment_type,p_employment_type='salaried' and coalesce(p_hide_prices,false));
  update public.company_invites set status='cancelled'
    where company_id=attempt.company_id and lower(email)=attempt.email and status='pending';
  update private.technician_invitation_attempts set status='sent',invited_user_id=p_user_id where id=p_attempt_id;
  insert into private.security_audit_events(actor_id,table_name,operation,record_id,company_id,new_status)
    values(attempt.actor_id,'technician_invitation_attempts','INVITE_SENT',p_attempt_id::text,attempt.company_id,'sent');
end;
$$;
revoke all on function public.finalize_company_technician_invitation(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.finalize_company_technician_invitation(uuid,uuid,text,text,text,boolean) to service_role;

create or replace function public.abort_company_technician_invitation(p_attempt_id uuid,p_user_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare attempt private.technician_invitation_attempts%rowtype; owned_user uuid;
begin
  select * into attempt from private.technician_invitation_attempts where id=p_attempt_id for update;
  if not found or attempt.status<>'reserved' then return null; end if;
  select u.id into owned_user from auth.users u where u.id=p_user_id and lower(u.email)=attempt.email
    and u.created_at>=attempt.created_at and u.invited_at>=attempt.created_at
    and attempt.invited_user_id=u.id;
  -- Revoke business access before attempting external Auth cleanup.
  if owned_user is not null then update public.profiles set active=false where id=owned_user; end if;
  update private.technician_invitation_attempts set status='failed',invited_user_id=owned_user where id=p_attempt_id;
  insert into private.security_audit_events(actor_id,table_name,operation,record_id,company_id,new_status)
    values(attempt.actor_id,'technician_invitation_attempts','INVITE_FAILED',p_attempt_id::text,attempt.company_id,'failed');
  return owned_user;
end;
$$;
revoke all on function public.abort_company_technician_invitation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.abort_company_technician_invitation(uuid,uuid) to service_role;
