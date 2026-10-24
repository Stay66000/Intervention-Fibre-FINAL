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
