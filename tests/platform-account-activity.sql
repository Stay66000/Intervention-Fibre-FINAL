\set ON_ERROR_STOP on
create schema private;create schema auth;
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
grant usage on schema private to authenticated;
create table public.profiles(id uuid primary key);
create table auth.users(id uuid primary key,last_sign_in_at timestamptz);
create table public.interventions(user_id uuid,created_by uuid);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user_id',true),'')::uuid$$;
create function private.photo_preview_is_owner() returns boolean language sql stable as $$select auth.uid()='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid$$;
create function private.fibre_ops_is_platform_admin() returns boolean language sql stable as $$select auth.uid()='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid$$;
\i supabase/production/platform-account-activity.sql
insert into public.profiles values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),('cccccccc-cccc-cccc-cccc-cccccccccccc');
insert into auth.users values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','2026-10-15 12:30:00+00');
insert into public.interventions values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),('cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),('cccccccc-cccc-cccc-cccc-cccccccccccc',null);
set role authenticated;set test.user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
do $$ begin
 if (select intervention_count from public.platform_account_activity() where user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')<>2 then raise exception 'Nombre saisi incorrect'; end if;
 if (select intervention_count from public.platform_account_activity() where user_id='cccccccc-cccc-cccc-cccc-cccccccccccc')<>1 then raise exception 'Nombre historique incorrect'; end if;
 if (select last_sign_in_at from public.platform_account_activity() where user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')<>'2026-10-15 12:30:00+00'::timestamptz then raise exception 'Connexion incorrecte'; end if;
end $$;
set test.user_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
do $$ begin begin perform * from public.platform_account_activity();raise exception 'Tiers autorisé'; exception when insufficient_privilege then null; end; end $$;
reset role;
do $$ begin if has_function_privilege('anon','public.platform_account_activity()','execute') then raise exception 'Accès anonyme autorisé'; end if; end $$;
