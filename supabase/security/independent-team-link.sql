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

  -- Joining a team must never rewrite the financial identity of historical rows.
  -- Imported history is reconciled separately against the source, with explicit scope.

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

