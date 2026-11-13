-- Run only after the tier migration, using a privileged database connection.
-- Required psql variables: team_id, user_1, user_2. No real IDs are stored here.
\set ON_ERROR_STOP on
begin;
create temporary table tier_activation_scope on commit drop as
  select :'team_id'::uuid as team_id, :'user_1'::uuid as user_1, :'user_2'::uuid as user_2;
do $$
declare s tier_activation_scope%rowtype; active_count integer;
begin
  select * into strict s from tier_activation_scope;
  if auth.uid() is not null or s.user_1=s.user_2 then raise exception 'Contexte ou comptes invalides'; end if;
  if not exists(select 1 from public.teams t where t.id=s.team_id and t.company_id is null and t.ended_at is null) then raise exception 'Binôme indépendant introuvable'; end if;
  if not private.is_team_member(s.team_id,s.user_1) or not private.is_team_member(s.team_id,s.user_2) then raise exception 'Les deux comptes ne sont pas membres actifs du binôme'; end if;
  select count(*) into active_count from public.team_members m where m.team_id=s.team_id and m.status='active' and m.ended_at is null;
  if active_count<>2 then raise exception 'Le binôme doit contenir exactement deux membres actifs'; end if;
  if (select count(*) from public.profiles p join public.user_settings us on us.user_id=p.id where p.id in(s.user_1,s.user_2) and p.active)<>2 then raise exception 'Profils ou réglages introuvables'; end if;
  if (select count(*) from public.user_settings us where us.user_id in(s.user_1,s.user_2) and us.preferences #>> '{orange_total_discount,team_id}'=s.team_id::text and us.preferences #>> '{orange_total_discount,percent}'='20')<>2 then raise exception 'La réduction Orange à 20 %% doit être configurée pour les deux comptes'; end if;
  if exists(select 1 from private.orange_team_tier_config c where c.team_id=s.team_id) then raise exception 'Paliers déjà configurés : activation annulée'; end if;
  if exists(select 1 from public.intervention_supplement_types x where x.team_id=s.team_id and x.operator='orange' and lower(trim(x.name))='etcfo' and (x.amount<>32.40 or not x.active)) then raise exception 'Un complément ETCFO différent existe déjà : vérifier avant activation'; end if;
end $$;
insert into private.orange_team_tier_config(team_id,allowed_users,schedule,prices)
select s.team_id,array[s.user_1,s.user_2],
 '[{"from":"2026-09-01","tier":2},{"from":"2026-10-01","tier":1}]'::jsonb,
 '{"aerien":{"1":200,"2":180,"3":120},"souterrain":{"1":140,"2":126,"3":84},"immeuble":{"1":68,"2":61,"3":40.8},"sav":{"1":45,"2":40.5,"3":27},"plp":{"1":45,"2":40.5,"3":27},"plp sans client":{"1":15,"2":13.5,"3":9},"apie":{"1":47,"2":42.3,"3":28.2}}'::jsonb
from tier_activation_scope s;
-- Keep the existing Pré visite intervention type and add a separate fixed-price preset.
insert into public.intervention_supplement_types(user_id,team_id,operator,name,amount,active,sort_order)
select s.user_1,s.team_id,'orange','ETCFO',32.40,true,0 from tier_activation_scope s
where not exists(select 1 from public.intervention_supplement_types x where x.team_id=s.team_id and x.operator='orange' and lower(trim(x.name))='etcfo');
update public.user_settings us set preferences=jsonb_set(coalesce(us.preferences,'{}'::jsonb),'{orange_tier_team_id}',to_jsonb(s.team_id::text),true)
from tier_activation_scope s where us.user_id in(s.user_1,s.user_2);
-- Fire the tier trigger only for the agreed team and mapped successful rows.
with updated as (
  update public.interventions i set operator_data=i.operator_data
  from tier_activation_scope s, private.orange_team_tier_config c
  where c.team_id=s.team_id and i.team_id=s.team_id and i.user_id in(s.user_1,s.user_2)
    and i.company_id is null and i.operator='orange' and i.intervention_date>='2026-09-01'
    and lower(coalesce(i.result,'')) in ('réussite','reussite','success')
    and (c.prices ? translate(lower(trim(coalesce(i.intervention_type_name,''))), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc')
      or (c.prices ? 'apie' and (lower(trim(coalesce(i.operator_data #>> '{supplement,comment}','')))='apie' or (case when jsonb_typeof(i.operator_data #> '{supplement,items}')='array' then exists(select 1 from jsonb_array_elements(i.operator_data #> '{supplement,items}') x where lower(trim(coalesce(x->>'comment','')))='apie') else false end))))
  returning i.intervention_type_name
)
select intervention_type_name,count(*) as interventions_recalculees from updated group by intervention_type_name order by intervention_type_name;
commit;
