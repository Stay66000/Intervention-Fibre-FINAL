-- Synthetic fixtures only. No email, no persistent data.
begin;
do $$
declare
  a uuid; b uuid; outsider uuid; typ uuid; hist uuid; linked uuid; fuel_row uuid; fuel_before jsonb;
  v_code text; mode text; stale uuid; personal uuid; before_row jsonb; after_row jsonb;
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
    perform set_config('request.jwt.claim.sub',a::text,true);
    fuel_row:=gen_random_uuid();
    insert into public.fuel_expenses(id,user_id,expense_date,amount,paid_by_user_id)
      values(fuel_row,a,current_date,75,a);
    select to_jsonb(f) into fuel_before from public.fuel_expenses f where id=fuel_row;
    select to_jsonb(i) into before_row from public.interventions i where id=hist;
    perform set_config('request.jwt.claim.sub',a::text,true);
    v_code:=public.create_team_invite(b::text||'@team-link-test.invalid');
    insert into private.legacy_team_history_transfers(intervention_id,invite_id,expected_snapshot,source_sheet,source_tab,source_row,queued_at)
    select hist,inv.id,before_row,'fixture','Fixture',2,now()-interval '1 second'
    from public.team_invites inv where inv.code=v_code;
    personal:=gen_random_uuid(); stale:=gen_random_uuid();
    insert into public.interventions(id,user_id,operator,intervention_type_id,result,reference,work_mode,solo_user_id)
    values(personal,a,'orange',typ,'Réussite','PRIVATE_HISTORY','Personal',a),
      (stale,a,'orange',typ,'Réussite','STALE_HISTORY','Personal',a);
    insert into private.legacy_team_history_transfers(intervention_id,invite_id,expected_snapshot,source_sheet,source_tab,source_row,queued_at)
    select stale,inv.id,to_jsonb(i),'fixture','Fixture',3,now()-interval '1 second'
    from public.team_invites inv,public.interventions i where inv.code=v_code and i.id=stale;
    update public.interventions set notes='changed after approval' where id=stale;
    perform set_config('request.jwt.claim.sub',outsider::text,true);
    begin
      perform public.accept_team_invite_with_tariffs(v_code,mode,'[]');
      raise exception 'TEST: third party accepted invitation';
    exception when others then
      if sqlerrm like 'TEST:%' then raise; end if;
      if sqlerrm not like '%ne correspond pas%' then raise; end if;
    end;
    perform set_config('request.jwt.claim.sub',b::text,true);
    linked:=public.accept_team_invite_with_tariffs(v_code,mode,
      '[{"operator":"orange","name":"Historical fixture","amount":160}]');
    if fuel_before is distinct from (select to_jsonb(f) from public.fuel_expenses f where id=fuel_row) then
      raise exception 'TEST: private fuel history changed'; end if;
    if (select count(*) from public.team_members where team_id=linked and status='active')<>2 then
      raise exception 'TEST: pair missing';
    end if;
    if not exists(select 1 from public.intervention_types where team_id=linked and amount=
      case mode when 'inviter' then 112 when 'invitee' then 150 else 160 end) then
      raise exception 'TEST: chosen tariff missing';
    end if;
    select to_jsonb(i) into after_row from public.interventions i where id=hist;
    if (before_row-array['team_id','work_mode','solo_user_id','updated_at']) is distinct from
       (after_row-array['team_id','work_mode','solo_user_id','updated_at']) then raise exception 'TEST: historical financial data changed'; end if;
    if after_row->>'team_id' is distinct from linked::text or after_row->>'work_mode'<>'Binôme'
      or after_row->>'solo_user_id' is not null then raise exception 'TEST: approved history not linked'; end if;
    if exists(select 1 from public.interventions where id in(personal,stale) and team_id is not null) then
      raise exception 'TEST: unapproved or stale history shared'; end if;
    if not exists(select 1 from private.legacy_team_history_transfers where intervention_id=hist and applied_at is not null) then
      raise exception 'TEST: missing transfer audit'; end if;
    if not exists(select 1 from public.get_my_independent_interventions() where id=hist) then
      raise exception 'TEST: partner cannot see shared history';
    end if;
    perform set_config('request.jwt.claim.sub',a::text,true);
    if not exists(select 1 from public.get_my_independent_interventions() where id=hist) then
      raise exception 'TEST: owner lost history';
    end if;
    begin
      update public.interventions set work_mode='Solo',solo_user_id=a where id=hist;
      raise exception 'TEST: financial lock bypassed';
    exception when others then
      if sqlerrm like 'TEST:%' then raise; end if;
      if sqlerrm not like '%verrouillés%' then raise; end if;
    end;
  end loop;
end;
$$;
select 'PASS: approved history shared in all three tariff modes; amounts, authorization, private/stale history and financial locks preserved' as result;
rollback;
