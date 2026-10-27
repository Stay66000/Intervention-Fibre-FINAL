-- Synthetic fixtures only. No email, no persistent data.
begin;
do $$
declare
  a uuid; b uuid; outsider uuid; typ uuid; hist uuid; linked uuid;
  code text; mode text; before_row jsonb; after_row jsonb;
begin
  foreach mode in array array['inviter','invitee','custom'] loop
    a:=gen_random_uuid(); b:=gen_random_uuid(); outsider:=gen_random_uuid();
    typ:=gen_random_uuid(); hist:=gen_random_uuid();
    insert into auth.users(id,email,encrypted_password,created_at,raw_user_meta_data,raw_app_meta_data)
    select u,u::text||'@team-link-test.invalid','test-hash',now(),'{}','{}'
    from unnest(array[a,b,outsider]) u;
    update public.profiles set active=true,onboarding_completed=true where id in(a,b,outsider);
    insert into public.user_operators(user_id,operator,active) values(a,'orange',true),(b,'orange',true);
    insert into public.intervention_types(id,user_id,operator,name,amount,active)
    values(typ,a,'orange','Historical fixture',112,true),
      (gen_random_uuid(),b,'orange','Partner fixture',150,true);
    insert into public.interventions(id,user_id,operator,intervention_type_id,result,reference,work_mode,solo_user_id)
    values(hist,a,'orange',typ,'Réussite','TEAM_LINK_FIXTURE','Personal',a);
    select to_jsonb(i) into before_row from public.interventions i where id=hist;
    perform set_config('request.jwt.claim.sub',a::text,true);
    code:=public.create_team_invite(b::text||'@team-link-test.invalid');
    perform set_config('request.jwt.claim.sub',outsider::text,true);
    begin
      perform public.accept_team_invite_with_tariffs(code,mode,'[]');
      raise exception 'TEST: third party accepted invitation';
    exception when others then
      if sqlerrm like 'TEST:%' then raise; end if;
      if sqlerrm not like '%ne correspond pas%' then raise; end if;
    end;
    perform set_config('request.jwt.claim.sub',b::text,true);
    linked:=public.accept_team_invite_with_tariffs(code,mode,
      '[{"operator":"orange","name":"Historical fixture","amount":160}]');
    if (select count(*) from public.team_members where team_id=linked and status='active')<>2 then
      raise exception 'TEST: pair missing';
    end if;
    if not exists(select 1 from public.intervention_types where team_id=linked and amount=
      case mode when 'inviter' then 112 when 'invitee' then 150 else 160 end) then
      raise exception 'TEST: chosen tariff missing';
    end if;
    select to_jsonb(i) into after_row from public.interventions i where id=hist;
    if before_row is distinct from after_row then raise exception 'TEST: historical row changed'; end if;
    if exists(select 1 from public.get_my_independent_interventions() where id=hist) then
      raise exception 'TEST: private history shared without explicit reconciliation';
    end if;
    perform set_config('request.jwt.claim.sub',a::text,true);
    if not exists(select 1 from public.get_my_independent_interventions() where id=hist) then
      raise exception 'TEST: owner lost history';
    end if;
    begin
      update public.interventions set work_mode='Binôme',team_id=linked,solo_user_id=null where id=hist;
      raise exception 'TEST: financial lock bypassed';
    exception when others then
      if sqlerrm like 'TEST:%' then raise; end if;
      if sqlerrm not like '%verrouillés%' then raise; end if;
    end;
  end loop;
end;
$$;
select 'PASS: all tariff choices, historical preservation, authorization and financial lock' as result;
rollback;
