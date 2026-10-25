-- FIBRE OPS — Société V2
-- SQL de preview à appliquer UNIQUEMENT sur une branche Supabase de développement.
-- Ne pas exécuter directement sur la production avant validation de la preview.

begin;

alter table public.companies add column if not exists legal_name text;
alter table public.companies add column if not exists siret text;
alter table public.companies add column if not exists email text;
alter table public.companies add column if not exists phone text;
alter table public.companies add column if not exists address_line1 text;
alter table public.companies add column if not exists address_line2 text;
alter table public.companies add column if not exists postal_code text;
alter table public.companies add column if not exists city text;
alter table public.companies add column if not exists country text not null default 'France';
alter table public.intervention_types add column if not exists default_technician_amount numeric not null default 0;

do $$ begin
  alter table public.companies add constraint companies_siret_format check (siret is null or siret='' or siret ~ '^[0-9]{14}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.intervention_types add constraint intervention_types_default_technician_amount_check check (default_technician_amount >= 0);
exception when duplicate_object then null; end $$;

create or replace function public.company_v2_create_self_company(
  p_first_name text,
  p_last_name text,
  p_name text,
  p_siret text default null,
  p_phone text default null,
  p_address_line1 text default null,
  p_postal_code text default null,
  p_city text default null,
  p_operators text[] default '{}'::text[]
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_company uuid;
  v_op text;
begin
  perform private.assert_api_user();
  if v_user is null or not private.is_active_user() then raise exception 'Compte invalide'; end if;
  if private.fibre_ops_is_platform_admin() then raise exception 'Le compte plateforme ne peut pas créer une société personnelle'; end if;
  if exists(select 1 from public.company_members where user_id=v_user and status in ('active','disabled')) then raise exception 'Ce compte appartient déjà à une société'; end if;
  if char_length(trim(coalesce(p_first_name,''))) not between 1 and 80 or char_length(trim(coalesce(p_last_name,''))) not between 1 and 80 then raise exception 'Identité invalide'; end if;
  if char_length(trim(coalesce(p_name,''))) not between 2 and 120 then raise exception 'Nom de société invalide'; end if;
  if p_siret is not null and p_siret<>'' and p_siret !~ '^[0-9]{14}$' then raise exception 'SIRET invalide'; end if;
  if coalesce(cardinality(p_operators),0)=0 then raise exception 'Sélectionne au moins un opérateur'; end if;
  if exists(select 1 from unnest(p_operators) x where x not in ('orange','sfr','bouygues','free')) then raise exception 'Opérateur invalide'; end if;

  update public.profiles set first_name=trim(p_first_name),last_name=trim(p_last_name),updated_at=now() where id=v_user;

  insert into public.companies(name,legal_name,siret,phone,address_line1,postal_code,city,created_by)
  values(trim(p_name),trim(p_name),nullif(trim(coalesce(p_siret,'')),''),nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_address_line1,'')),''),nullif(trim(coalesce(p_postal_code,'')),''),nullif(trim(coalesce(p_city,'')),''),v_user)
  returning id into v_company;

  foreach v_op in array array['orange','sfr','bouygues','free'] loop
    insert into public.company_operators(company_id,operator,active)
    values(v_company,v_op,v_op=any(p_operators));
  end loop;

  insert into public.company_members(company_id,user_id,role,status,employment_type,hide_prices)
  values(v_company,v_user,'admin','active','auto',false);

  update public.profiles set role='company_admin',company_id=v_company,onboarding_completed=true,updated_at=now() where id=v_user;
  return v_company;
end;
$$;

revoke all on function public.company_v2_create_self_company(text,text,text,text,text,text,text,text,text[]) from public,anon;
grant execute on function public.company_v2_create_self_company(text,text,text,text,text,text,text,text,text[]) to authenticated;

create or replace function public.company_v2_get_profile()
returns table(id uuid,name text,legal_name text,siret text,email text,phone text,address_line1 text,address_line2 text,postal_code text,city text,country text,status text,is_owner boolean)
language sql stable security definer set search_path=''
as $$
  select c.id,c.name,c.legal_name,c.siret,c.email,c.phone,c.address_line1,c.address_line2,c.postal_code,c.city,c.country,c.status,(c.created_by=auth.uid())
  from public.companies c
  where c.id=private.my_company_id() and private.is_company_admin(c.id) and private.is_active_user();
$$;
revoke all on function public.company_v2_get_profile() from public,anon;
grant execute on function public.company_v2_get_profile() to authenticated;

create or replace function public.company_v2_update_profile(
  p_name text,
  p_siret text default null,
  p_email text default null,
  p_phone text default null,
  p_address_line1 text default null,
  p_postal_code text default null,
  p_city text default null
) returns void
language plpgsql security definer set search_path=''
as $$
declare v_company uuid:=private.my_company_id();
begin
  perform private.assert_api_user();
  if v_company is null or not private.is_company_admin(v_company) then raise exception 'Réservé au patron'; end if;
  if char_length(trim(coalesce(p_name,''))) not between 2 and 120 then raise exception 'Nom invalide'; end if;
  if p_siret is not null and p_siret<>'' and p_siret !~ '^[0-9]{14}$' then raise exception 'SIRET invalide'; end if;
  update public.companies set name=trim(p_name),legal_name=trim(p_name),siret=nullif(trim(coalesce(p_siret,'')),''),email=nullif(trim(coalesce(p_email,'')),''),phone=nullif(trim(coalesce(p_phone,'')),''),address_line1=nullif(trim(coalesce(p_address_line1,'')),''),postal_code=nullif(trim(coalesce(p_postal_code,'')),''),city=nullif(trim(coalesce(p_city,'')),''),updated_at=now() where id=v_company;
end;
$$;
revoke all on function public.company_v2_update_profile(text,text,text,text,text,text,text) from public,anon;
grant execute on function public.company_v2_update_profile(text,text,text,text,text,text,text) to authenticated;

create or replace function public.company_v2_admin_get_types()
returns table(id uuid,operator text,name text,agency_amount numeric,default_technician_amount numeric,active boolean,sort_order integer)
language sql stable security definer set search_path=''
as $$
  select it.id,it.operator,it.name,it.agency_amount,it.default_technician_amount,it.active,it.sort_order
  from public.intervention_types it
  where it.company_id=private.my_company_id() and private.is_company_admin(it.company_id) and private.is_active_user()
  order by it.operator,it.sort_order,it.name;
$$;
revoke all on function public.company_v2_admin_get_types() from public,anon;
grant execute on function public.company_v2_admin_get_types() to authenticated;

create or replace function public.company_v2_set_default_tariff(p_type_id uuid,p_amount numeric)
returns void
language plpgsql security definer set search_path=''
as $$
declare v_company uuid:=private.my_company_id();
begin
  perform private.assert_api_user();
  if v_company is null or not private.is_company_admin(v_company) then raise exception 'Réservé au patron'; end if;
  if p_amount is null or p_amount<0 then raise exception 'Tarif invalide'; end if;
  update public.intervention_types set default_technician_amount=p_amount,updated_at=now() where id=p_type_id and company_id=v_company;
  if not found then raise exception 'Typologie introuvable'; end if;
  insert into public.company_technician_tariffs(company_id,intervention_type_id,user_id,amount,active)
  select v_company,p_type_id,cm.user_id,p_amount,true from public.company_members cm
  where cm.company_id=v_company and cm.role='technician' and cm.status='active'
  on conflict(intervention_type_id,user_id) do nothing;
end;
$$;
revoke all on function public.company_v2_set_default_tariff(uuid,numeric) from public,anon;
grant execute on function public.company_v2_set_default_tariff(uuid,numeric) to authenticated;

create or replace function private.company_v2_seed_member_tariffs()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.role='technician' and new.status='active' then
    insert into public.company_technician_tariffs(company_id,intervention_type_id,user_id,amount,active)
    select new.company_id,it.id,new.user_id,it.default_technician_amount,it.active
    from public.intervention_types it where it.company_id=new.company_id
    on conflict(intervention_type_id,user_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists company_v2_seed_member_tariffs on public.company_members;
create trigger company_v2_seed_member_tariffs after insert or update of status,role on public.company_members for each row execute function private.company_v2_seed_member_tariffs();

create or replace function private.company_v2_seed_type_tariffs()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.company_id is not null then
    insert into public.company_technician_tariffs(company_id,intervention_type_id,user_id,amount,active)
    select new.company_id,new.id,cm.user_id,new.default_technician_amount,new.active
    from public.company_members cm where cm.company_id=new.company_id and cm.role='technician' and cm.status='active'
    on conflict(intervention_type_id,user_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists company_v2_seed_type_tariffs on public.intervention_types;
create trigger company_v2_seed_type_tariffs after insert on public.intervention_types for each row execute function private.company_v2_seed_type_tariffs();

create or replace function public.company_v2_update_my_intervention(
  p_intervention_id uuid,
  p_date date,
  p_reference text,
  p_address text,
  p_notes text,
  p_operator_data jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid();v_company uuid:=private.my_company_id();
begin
  perform private.assert_api_user();
  if v_user is null or v_company is null or not private.is_company_member(v_company) or not private.company_is_active(v_company) then raise exception 'Accès société refusé'; end if;
  if not exists(
    select 1 from public.interventions i where i.id=p_intervention_id and i.company_id=v_company and
      (i.user_id=v_user or i.solo_user_id=v_user or (i.team_id is not null and private.is_team_member(i.team_id,v_user)))
  ) then raise exception 'Intervention inaccessible'; end if;
  update public.interventions set intervention_date=coalesce(p_date,intervention_date),reference=nullif(trim(coalesce(p_reference,'')),''),address=nullif(trim(coalesce(p_address,'')),''),notes=nullif(trim(coalesce(p_notes,'')),''),operator_data=coalesce(p_operator_data,'{}'::jsonb),updated_at=now() where id=p_intervention_id and company_id=v_company;
end;
$$;
revoke all on function public.company_v2_update_my_intervention(uuid,date,text,text,text,jsonb) from public,anon;
grant execute on function public.company_v2_update_my_intervention(uuid,date,text,text,text,jsonb) to authenticated;

-- Les techniciens société lisent désormais leur catalogue et leurs interventions via les RPC safe.
-- L'accès direct aux lignes contenant les colonnes prix agence / snapshots est réservé au patron.
drop policy if exists intervention_types_company_select on public.intervention_types;
create policy intervention_types_company_select on public.intervention_types for select to authenticated
using (company_id is not null and private.company_is_active(company_id) and private.is_company_admin(company_id));

drop policy if exists interventions_company_select on public.interventions;
create policy interventions_company_select on public.interventions for select to authenticated
using (company_id is not null and private.company_is_active(company_id) and private.is_company_admin(company_id) and not private.fibre_ops_is_platform_admin());

drop policy if exists interventions_select_own on public.interventions;
create policy interventions_select_own on public.interventions for select to authenticated
using (auth.uid()=user_id and company_id is null and private.is_active_user());

drop policy if exists interventions_team_select on public.interventions;
create policy interventions_team_select on public.interventions for select to authenticated
using (company_id is null and team_id is not null and private.is_active_user() and private.was_team_member(team_id,auth.uid()) and private.fibre_ops_team_business_allowed(team_id));

-- Le job Google ne stocke plus les montants lorsqu'une société masque les prix du technicien.
create or replace function private.enqueue_google_backup_intervention()
returns trigger
language plpgsql security definer
set search_path to 'public','private','pg_temp'
as $$
declare
  v_user_id uuid;
  v_intervention_id uuid;
  v_snapshot jsonb;
  v_action text;
  v_hidden boolean:=false;
  v_company uuid;
begin
  if tg_op='DELETE' then
    v_user_id:=old.user_id;v_intervention_id:=old.id;v_snapshot:=to_jsonb(old);v_action:='delete';v_company:=old.company_id;
  else
    v_user_id:=new.user_id;v_intervention_id:=new.id;v_snapshot:=to_jsonb(new);v_action:='upsert';v_company:=new.company_id;
  end if;
  if v_company is not null then
    select coalesce(cm.hide_prices,false) into v_hidden from public.company_members cm where cm.company_id=v_company and cm.user_id=v_user_id and cm.status='active' limit 1;
  end if;
  if v_hidden then
    v_snapshot:=v_snapshot - 'applied_amount' - 'agency_amount_snapshot';
    v_snapshot:=jsonb_set(v_snapshot,'{operator_data}',coalesce(v_snapshot->'operator_data','{}'::jsonb)-'supplement_amount'-'amount'-'price'-'agency_amount',true);
    v_snapshot:=v_snapshot||jsonb_build_object('backup_price_visibility','hidden');
  else
    v_snapshot:=v_snapshot||jsonb_build_object('backup_price_visibility','visible');
  end if;
  if v_user_id is not null and exists(select 1 from public.google_backup_connections c where c.user_id=v_user_id and c.status='connected') then
    insert into public.google_backup_jobs(user_id,intervention_id,action,snapshot) values(v_user_id,v_intervention_id,v_action,v_snapshot);
  end if;
  if tg_op='DELETE' then return old; end if;return new;
end;
$$;

commit;
