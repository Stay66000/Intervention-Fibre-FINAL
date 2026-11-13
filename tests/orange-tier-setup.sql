\set ON_ERROR_STOP on
create schema private; create schema auth;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
grant usage on schema private to authenticated;
create table public.teams (id uuid primary key);
create table public.interventions (id uuid primary key, user_id uuid, team_id uuid, company_id uuid, operator text,
  result text, intervention_date date, intervention_type_name text, applied_amount numeric, operator_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
create function private.is_team_member(uuid,uuid) returns boolean language sql stable as $$ select $1='11111111-1111-1111-1111-111111111111'::uuid and $2 in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid) $$;
create function private.intervention_supplement_amount(jsonb) returns numeric language sql immutable as $$ select coalesce(($1 #>> '{supplement,amount}')::numeric,0) $$;
create function private.mock_supplement() returns trigger language plpgsql as $$
begin
 if tg_op='INSERT' then new.applied_amount=coalesce(new.applied_amount,0)+private.intervention_supplement_amount(new.operator_data);
 else new.applied_amount=coalesce(old.applied_amount,0)-private.intervention_supplement_amount(old.operator_data)+private.intervention_supplement_amount(new.operator_data); end if;
 return new;
end $$;
create trigger zz_interventions_apply_supplement before insert or update of operator_data on public.interventions for each row execute function private.mock_supplement();
