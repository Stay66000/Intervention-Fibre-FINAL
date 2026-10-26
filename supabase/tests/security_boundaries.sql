-- Run against the existing FIBRE OPS schema after the migration.
-- All fixtures use synthetic accounts; no email is sent. Every change rolls back.
begin;
create temp table security_test_ids(name text primary key,id uuid default gen_random_uuid());
insert into security_test_ids(name) values ('admin_a'),('admin_b'),('tech_a'),('tech_b'),('solo'),('disabled'),('invited'),('company_a'),('company_b'),('type_a'),('type_b'),('intervention_a');
grant select on security_test_ids to authenticated,service_role;
insert into auth.users(id,email,encrypted_password,created_at,raw_user_meta_data,raw_app_meta_data)
select id,id::text||'@security-test.invalid','test-password-hash',now(),'{}','{}'
from security_test_ids where name in ('admin_a','admin_b','tech_a','tech_b','solo','disabled','invited');
update public.profiles set active=false where id=(select id from security_test_ids where name='disabled');
update auth.users set invited_at=now(),encrypted_password='' where id=(select id from security_test_ids where name='invited');
insert into public.companies(id,name) select id,'Security fixture '||name from security_test_ids where name in ('company_a','company_b');
insert into public.company_members(company_id,user_id,role,status,employment_type,hide_prices)
select c.id,u.id,case when u.name like 'admin_%' or u.name='disabled' then 'admin' else 'technician' end,'active',
 case when u.name='tech_a' then 'salaried' else 'auto' end,u.name='tech_a'
from security_test_ids c join security_test_ids u on
 (c.name='company_a' and u.name in ('admin_a','tech_a','disabled')) or
 (c.name='company_b' and u.name in ('admin_b','tech_b'));
-- Sync triggers may update profile roles, but must not reactivate disabled accounts.
update public.profiles set active=false where id=(select id from security_test_ids where name='disabled');
insert into public.user_operators(user_id,operator,active)
select id,'orange',true from security_test_ids where name in ('admin_a','admin_b','tech_a','tech_b','solo');
insert into public.company_operators(company_id,operator,active)
select id,'orange',true from security_test_ids where name in ('company_a','company_b');
insert into public.intervention_types(id,user_id,company_id,operator,name,amount,agency_amount,active)
select t.id,a.id,c.id,'orange','Security fixture '||t.name,100,200,true
from security_test_ids t join security_test_ids a on (t.name='type_a' and a.name='admin_a') or (t.name='type_b' and a.name='admin_b')
join security_test_ids c on (t.name='type_a' and c.name='company_a') or (t.name='type_b' and c.name='company_b');
insert into public.company_technician_tariffs(company_id,intervention_type_id,user_id,amount,active)
select c.id,t.id,u.id,100,true from security_test_ids c join security_test_ids t on (c.name='company_a' and t.name='type_a') or (c.name='company_b' and t.name='type_b')
join security_test_ids u on (c.name='company_a' and u.name='tech_a') or (c.name='company_b' and u.name='tech_b');

select set_config('request.jwt.claim.sub',(select id::text from security_test_ids where name='tech_a'),true);
set local role authenticated;
insert into public.interventions(id,user_id,company_id,operator,intervention_type_id,result,reference)
select i.id,u.id,c.id,'orange',t.id,'Réussite','SECURITY_FIXTURE_A'
from security_test_ids u,security_test_ids c,security_test_ids t,security_test_ids i where u.name='tech_a' and c.name='company_a' and t.name='type_a' and i.name='intervention_a';
do $$ declare changed integer; target uuid; begin
  select id into target from security_test_ids where name='intervention_a';
  if exists(select 1 from public.interventions where id=target) then raise exception 'Technician direct price read accepted'; end if;
  if exists(select 1 from public.intervention_types where company_id=(select id from security_test_ids where name='company_a')) then raise exception 'Technician direct agency catalog read accepted'; end if;
  if exists(select 1 from public.intervention_payments where intervention_id=target) then raise exception 'Hidden technician payment read accepted'; end if;
  if exists(select 1 from public.company_technician_tariffs where user_id=auth.uid()) then raise exception 'Hidden technician tariff read accepted'; end if;
  update public.interventions set notes='direct bypass' where id=target;
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Technician direct update bypass accepted'; end if;
  if not public.company_v2_update_my_intervention(target,current_date,'SECURITY_FIXTURE_A','Updated terrain','Updated note','{"price":999,"terrain":"kept"}') then raise exception 'V2 terrain edit failed'; end if;
  if not exists(select 1 from public.company_v2_get_my_interventions() where id=target and address='Updated terrain' and operator_data->>'terrain'='kept' and not operator_data ? 'price') then raise exception 'V2 terrain edit or masking failed'; end if;
  if exists(select 1 from public.company_get_my_interventions() where id=target and operator_data ? 'price') then raise exception 'Legacy RPC leaked price'; end if;
  if not exists(select 1 from public.company_get_my_catalog() where id=(select id from security_test_ids where name='type_a') and amount=0) then raise exception 'Masked catalogue unavailable'; end if;
  if not exists(select 1 from public.company_get_my_interventions() where reference='SECURITY_FIXTURE_A' and my_payout=0) then raise exception 'Current prices must be hidden'; end if;
  if not exists(select 1 from public.get_my_company_intervention_history() where reference='SECURITY_FIXTURE_A' and my_payout=0) then raise exception 'Historical prices must be hidden'; end if;
  if exists(select 1 from public.company_admin_get_interventions()) then raise exception 'Technician reached admin RPC'; end if;
  begin
    insert into public.fuel_expenses(user_id,company_id,amount) select u.id,c.id,42 from security_test_ids u,security_test_ids c where u.name='tech_a' and c.name='company_b';
    raise exception 'Cross-company fuel insert accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.intervention_types(user_id,company_id,operator,name,amount) select u.id,c.id,'orange','Malicious type',1 from security_test_ids u,security_test_ids c where u.name='tech_a' and c.name='company_b';
    raise exception 'Cross-company catalog insert accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.reserve_company_technician_invitation('no-send@security-test.invalid');
    raise exception 'Technician can reserve admin invitation';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select id::text from security_test_ids where name='tech_b'),true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.interventions where reference='SECURITY_FIXTURE_A') then raise exception 'Cross-company direct read accepted'; end if;
  if exists(select 1 from public.get_my_company_intervention_history() where reference='SECURITY_FIXTURE_A') then raise exception 'Cross-company history read accepted'; end if;
  if public.delete_my_intervention((select id from security_test_ids where name='intervention_a')) then raise exception 'Cross-company deletion accepted'; end if;
end $$;
reset role;

-- A former company member retains masked history, never mutation permissions.
update public.company_members set status='removed' where user_id=(select id from security_test_ids where name='tech_a');
select set_config('request.jwt.claim.sub',(select id::text from security_test_ids where name='tech_a'),true);
set local role authenticated;
do $$ declare target uuid; changed integer; begin
  select id into target from public.get_my_company_intervention_history() where reference='SECURITY_FIXTURE_A';
  if target is null then raise exception 'Read-only history was lost'; end if;
  if exists(select 1 from public.get_my_company_intervention_history() where reference='SECURITY_FIXTURE_A' and my_payout<>0) then raise exception 'Removed member can see hidden prices'; end if;
  if public.delete_my_intervention(target) then raise exception 'Removed member can delete history via RPC'; end if;
  delete from public.interventions where id=target; get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Removed member can delete history directly'; end if;
  update public.interventions set notes='tampered' where id=target; get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Removed member can update history'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select id::text from security_test_ids where name='disabled'),true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.get_my_company_intervention_history()) then raise exception 'Disabled account has history access'; end if;
  begin perform public.reserve_company_technician_invitation('no-send@security-test.invalid'); raise exception 'Disabled account can invite'; exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select id::text from security_test_ids where name='invited'),true);
set local role authenticated;
do $$ begin
  if not (public.get_my_password_setup_status()->>'password_required')::boolean then raise exception 'Password setup not detected'; end if;
  if exists(select 1 from public.profiles) then raise exception 'Invited account accesses business before password setup'; end if;
  begin perform public.create_team_invite('no-send@security-test.invalid'); raise exception 'Password setup bypassed via RPC'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update auth.users set encrypted_password='test-password-hash',raw_user_meta_data='{"invited_by_company":false}' where id=(select id from security_test_ids where name='invited');
set local role authenticated;
do $$ begin
 if (public.get_my_password_setup_status()->>'password_required')::boolean then raise exception 'Password setup did not unlock account'; end if;
 if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Password setup did not unlock profile'; end if;
end $$;
reset role;

-- Quotas are atomic and persistent; nothing is actually emailed by this test.
select set_config('request.jwt.claim.sub',(select id::text from security_test_ids where name='admin_a'),true);
set local role authenticated;
do $$ declare i integer; begin
 for i in 1..10 loop perform public.reserve_company_technician_invitation('quota-'||i||'@security-test.invalid'); end loop;
 begin perform public.reserve_company_technician_invitation('quota-overflow@security-test.invalid'); raise exception 'Quota bypassed' using errcode='P9999'; exception when raise_exception then null; end;
end $$;
reset role;

-- Finalization is service-only and rechecks current administrator privileges.
select set_config('request.jwt.claim.sub',(select id::text from security_test_ids where name='admin_b'),true);
set local role authenticated;
do $$ declare attempt jsonb; begin
 attempt:=public.reserve_company_technician_invitation('finalize@security-test.invalid');
 perform set_config('security.test_attempt',attempt->>'attempt_id',true);
 begin
  perform public.finalize_company_technician_invitation((attempt->>'attempt_id')::uuid,gen_random_uuid(),'T','','auto',false);
  raise exception 'Authenticated user can finalize invitation';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into security_test_ids(name) values('new_invited');
insert into auth.users(id,email,created_at,invited_at,encrypted_password,raw_user_meta_data,raw_app_meta_data)
select id,'finalize@security-test.invalid',now(),now(),'',jsonb_build_object('fibre_invitation_id',current_setting('security.test_attempt')),'{}'
from security_test_ids where name='new_invited';
-- A pending invitation remains blocked even after the user sets a password
-- and clears all user-editable invitation metadata.
update auth.users set encrypted_password='test-password-hash',raw_user_meta_data='{}'
where id=(select id from security_test_ids where name='new_invited');
select set_config('request.jwt.claim.sub',(select id::text from security_test_ids where name='new_invited'),true);
set local role authenticated;
do $$ begin
 if not (public.get_my_password_setup_status()->>'provisioning_pending')::boolean then raise exception 'Missing server provisioning barrier'; end if;
 if exists(select 1 from public.profiles) then raise exception 'Pending provisioning metadata bypass'; end if;
end $$;
reset role;
update auth.users set raw_user_meta_data=jsonb_build_object('fibre_invitation_id',current_setting('security.test_attempt'))
where id=(select id from security_test_ids where name='new_invited');
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select public.finalize_company_technician_invitation(current_setting('security.test_attempt')::uuid,(select id from security_test_ids where name='new_invited'),'Test','','salaried',true);
reset role;
do $$ begin
 if not exists(select 1 from public.company_members where user_id=(select id from security_test_ids where name='new_invited') and company_id=(select id from security_test_ids where name='company_b') and hide_prices) then raise exception 'Finalization failed to create scoped membership'; end if;
end $$;

select 'PASS: company isolation, hidden prices, removal, disabled accounts, password setup, invitation quotas and finalization' as security_tests;
rollback;
