\set ON_ERROR_STOP on
alter table public.interventions add column created_at timestamptz;
update public.interventions set created_at='2026-11-03 12:00:00+00' where created_by='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
update public.interventions set created_at='2026-10-03 12:00:00+00' where created_by is null;
\i supabase/production/platform-last-intervention.sql
set role authenticated;set test.user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
do $$ begin
 if (select last_sign_in_at from public.platform_account_last_intervention() where user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')<>'2026-11-03 12:00:00+00'::timestamptz then raise exception 'Dernière saisie incorrecte'; end if;
 if (select intervention_count from public.platform_account_last_intervention() where user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')<>2 then raise exception 'Nombre incorrect'; end if;
 if (select last_sign_in_at from public.platform_account_last_intervention() where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') is not null then raise exception 'Date inexistante'; end if;
end $$;
set test.user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
do $$ begin begin perform * from public.platform_account_last_intervention();raise exception 'Tiers autorisé'; exception when insufficient_privilege then null; end; end $$;
reset role;
do $$ begin if has_function_privilege('anon','public.platform_account_last_intervention()','execute') then raise exception 'Anonyme autorisé'; end if; end $$;
