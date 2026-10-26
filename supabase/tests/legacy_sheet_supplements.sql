-- Synthetic fixtures only. Every insert/update is rolled back.
begin;
create temp table sheet_fixture_ids(name text primary key,id uuid default gen_random_uuid());
insert into sheet_fixture_ids(name) values('user_a'),('user_b'),('type_a'),('type_b'),('historical_a'),('historical_b'),('new_a');
grant select on sheet_fixture_ids to authenticated;
insert into auth.users(id,email,encrypted_password,created_at,raw_user_meta_data,raw_app_meta_data)
select id,id::text||'@sheet-test.invalid','test-password-hash',now(),'{}','{}'
from sheet_fixture_ids where name in ('user_a','user_b');
insert into public.user_operators(user_id,operator,active)
select id,'orange',true from sheet_fixture_ids where name in ('user_a','user_b');
insert into public.intervention_types(id,user_id,operator,name,amount,active)
select t.id,u.id,'orange','Souterrain',112,true from sheet_fixture_ids t join sheet_fixture_ids u
on (t.name='type_a' and u.name='user_a') or (t.name='type_b' and u.name='user_b');
-- No APIE note at insert. This simulates historical rows predating detection.
insert into public.interventions(id,user_id,operator,intervention_type_id,result,operator_data)
select i.id,u.id,'orange',t.id,'Réussite','{"legacy_sheet_sync":true,"sandbox_sheet_amount":149.6}'
from sheet_fixture_ids i join sheet_fixture_ids u on
(i.name='historical_a' and u.name='user_a') or (i.name='historical_b' and u.name='user_b')
join sheet_fixture_ids t on (u.name='user_a' and t.name='type_a') or (u.name='user_b' and t.name='type_b');
update public.interventions set notes='Client APIE' where id in(select id from sheet_fixture_ids where name in('historical_a','historical_b'));
select set_config('request.jwt.claim.sub',(select id::text from sheet_fixture_ids where name='user_a'),true);
set local role authenticated;
do $$ declare result jsonb; v jsonb; baseline jsonb; begin
  result:=public.reconcile_my_legacy_sheet_supplements();
  if result->>'corrected_count'<>'1' or (result->>'added_amount')::numeric<>37.6 then raise exception 'Historical reconciliation failed: %',result; end if;
  if (public.reconcile_my_legacy_sheet_supplements()->>'corrected_count')::int<>0 then raise exception 'Correction counted twice'; end if;
  if not exists(select 1 from public.get_my_independent_interventions() where id=(select id from sheet_fixture_ids where name='historical_a') and applied_amount=149.6 and operator_data#>>'{supplement,comment}'='APIE') then raise exception 'Missing real supplement'; end if;
  update public.interventions set notes='Updated APIE note' where id=(select id from sheet_fixture_ids where name='historical_a');
  update public.interventions set operator_data=operator_data-'supplement' where id=(select id from sheet_fixture_ids where name='historical_a');
  if (public.reconcile_my_legacy_sheet_supplements()->>'corrected_count')::int<>0 then raise exception 'Deliberate removal was overridden'; end if;
  if not exists(select 1 from public.get_my_independent_interventions() where id=(select id from sheet_fixture_ids where name='historical_a') and applied_amount=112) then raise exception 'Supplement removal broken'; end if;
  baseline:='{"legacy_sheet_sync":true,"sandbox_sheet_amount":149.6}';
  v:=private.reconcile_legacy_sheet_supplement(baseline,112,'orange','Réussite','APIE');
  if (v#>>'{supplement,amount}')::numeric<>37.6 then raise exception 'Valid proof rejected'; end if;
  if private.reconcile_legacy_sheet_supplement(v,149.6,'orange','Réussite','APIE')<>v then raise exception 'Pure check not idempotent'; end if;
  if private.reconcile_legacy_sheet_supplement(baseline,112,'orange','Échec','APIE')<>baseline then raise exception 'Failure was changed'; end if;
  if private.reconcile_legacy_sheet_supplement(baseline,112,'sfr','Réussite','APIE')<>baseline then raise exception 'Other operator changed'; end if;
  if private.reconcile_legacy_sheet_supplement(baseline,110,'orange','Réussite','APIE')<>baseline then raise exception 'Ambiguous delta changed'; end if;
  if private.reconcile_legacy_sheet_supplement(baseline,112,'orange','Réussite','Sans supplément')<>baseline then raise exception 'Missing evidence accepted'; end if;
  if private.reconcile_legacy_sheet_supplement('{"legacy_sheet_sync":true,"sandbox_sheet_amount":"bad"}',112,'orange','Réussite','APIE') ? 'supplement' then raise exception 'Malformed value accepted'; end if;
  if private.reconcile_legacy_sheet_supplement(baseline||'{"supplement":{"amount":10}}',112,'orange','Réussite','APIE')<>baseline||'{"supplement":{"amount":10}}' then raise exception 'Existing supplement overwritten'; end if;
end $$;
insert into public.interventions(id,user_id,operator,intervention_type_id,result,notes,operator_data)
select i.id,u.id,'orange',t.id,'Réussite','APIE','{"legacy_sheet_sync":true,"sandbox_sheet_amount":149.6}'
from sheet_fixture_ids i,sheet_fixture_ids u,sheet_fixture_ids t
where i.name='new_a' and u.name='user_a' and t.name='type_a';
do $$ begin
  if not exists(select 1 from public.get_my_independent_interventions() where id=(select id from sheet_fixture_ids where name='new_a') and applied_amount=149.6) then raise exception 'Insert detection failed'; end if;
  if has_function_privilege('anon','public.reconcile_my_legacy_sheet_supplements()','execute') then raise exception 'Anonymous RPC exposed'; end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.interventions where id=(select id from sheet_fixture_ids where name='historical_b') and applied_amount=112 and not operator_data ? 'supplement') then raise exception 'Another account was changed'; end if;
end $$;
select 'PASS: corroborated APIE, historical and new rows, ownership, idempotence, failures, malformed evidence, deliberate removal' as sheet_supplement_tests;
rollback;
