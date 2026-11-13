-- Orange tiers are opt-in and isolated to an explicitly configured team and users.
create table if not exists private.orange_team_tier_config (
  team_id uuid primary key references public.teams(id) on delete cascade,
  allowed_users uuid[] not null,
  schedule jsonb not null check (jsonb_typeof(schedule) = 'array'),
  prices jsonb not null check (jsonb_typeof(prices) = 'object'),
  overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(overrides) = 'object')
);
alter table private.orange_team_tier_config enable row level security;
revoke all on private.orange_team_tier_config from public, anon, authenticated;

create or replace function private.my_orange_team_tiers(p_team_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('schedule',c.schedule,'prices',c.prices,'overrides',c.overrides)
  from private.orange_team_tier_config c
  where c.team_id=p_team_id and auth.uid()=any(c.allowed_users)
    and private.is_team_member(c.team_id,auth.uid())
$$;
revoke all on function private.my_orange_team_tiers(uuid) from public,anon;
grant execute on function private.my_orange_team_tiers(uuid) to authenticated;
create or replace function public.my_orange_team_tiers(p_team_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.my_orange_team_tiers(p_team_id)
$$;
revoke all on function public.my_orange_team_tiers(uuid) from public,anon;
grant execute on function public.my_orange_team_tiers(uuid) to authenticated;

create or replace function private.apply_orange_team_tier()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c private.orange_team_tier_config%rowtype;
  tier text;
  category text;
  base_price numeric;
  extra_price numeric;
  extra_amount numeric;
  updated_items jsonb;
  item jsonb;
  item_amount numeric;
begin
  if new.company_id is not null or new.team_id is null or new.operator<>'orange'
     or lower(coalesce(new.result,'')) not in ('réussite','reussite','success') then return new; end if;
  select * into c from private.orange_team_tier_config
    where team_id=new.team_id and new.user_id=any(allowed_users);
  if not found then return new; end if;
  if auth.uid() is not null and not (auth.uid()=any(c.allowed_users)) then return new; end if;
  tier=c.overrides ->> pg_catalog.to_char(new.intervention_date,'YYYY-MM');
  if tier is null then
    select item->>'tier' into tier from jsonb_array_elements(c.schedule) item
      where (item->>'from')::date<=new.intervention_date
      order by (item->>'from')::date desc limit 1;
  end if;
  if tier is null then return new; end if;
  category=translate(lower(trim(coalesce(new.intervention_type_name,''))), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc');
  base_price=nullif(c.prices -> category ->> tier,'')::numeric;
  extra_amount=private.intervention_supplement_amount(new.operator_data);
  if jsonb_typeof(new.operator_data #> '{supplement,items}')='array' then
    if jsonb_array_length(new.operator_data #> '{supplement,items}') not between 1 and 2 then raise exception 'Un ou deux compléments attendus'; end if;
    updated_items='[]'::jsonb;
    extra_amount=0;
    for item in select value from jsonb_array_elements(new.operator_data #> '{supplement,items}') loop
      item_amount=coalesce(nullif(item->>'amount','')::numeric,0);
      if item_amount<=0 or item_amount>10000 then raise exception 'Montant de complément invalide'; end if;
      if lower(trim(coalesce(item->>'comment','')))='apie' then
        extra_price=nullif(c.prices -> 'apie' ->> tier,'')::numeric;
        if extra_price is not null then item_amount=extra_price; item=jsonb_set(item,'{amount}',to_jsonb(item_amount),false); end if;
      end if;
      extra_amount=extra_amount+item_amount;
      updated_items=updated_items||jsonb_build_array(item);
    end loop;
    if extra_amount>10000 then raise exception 'Total des compléments trop élevé'; end if;
    if base_price is null then new.applied_amount=greatest(0,coalesce(new.applied_amount,0)-private.intervention_supplement_amount(new.operator_data)+extra_amount); end if;
    new.operator_data=jsonb_set(new.operator_data,'{supplement,items}',updated_items,false);
    new.operator_data=jsonb_set(new.operator_data,'{supplement,amount}',to_jsonb(extra_amount),false);
  elsif lower(trim(coalesce(new.operator_data #>> '{supplement,comment}','')))='apie' then
    extra_price=nullif(c.prices -> 'apie' ->> tier,'')::numeric;
    if extra_price is not null then
      new.operator_data=jsonb_set(new.operator_data,'{supplement,amount}',to_jsonb(extra_price),false);
      if base_price is null then new.applied_amount=greatest(0,coalesce(new.applied_amount,0)-extra_amount+extra_price); end if;
      extra_amount=extra_price;
    end if;
  end if;
  if base_price is not null then new.applied_amount=round(base_price+extra_amount,2); end if;
  return new;
end;
$$;
revoke all on function private.apply_orange_team_tier() from public,anon,authenticated;
-- Alphabetically after zz_interventions_apply_supplement, so the tier base is
-- not overwritten and other manual complements are preserved.
create trigger zzz_orange_team_tier before insert or update of intervention_date,operator_data
on public.interventions for each row execute function private.apply_orange_team_tier();

-- An override affects one month only. Existing matching rows are repriced in
-- the same transaction, which also triggers the normal Sheets sync queue.
create or replace function private.set_orange_team_tier(p_team_id uuid,p_month date,p_tier integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c private.orange_team_tier_config%rowtype; changed integer;
begin
  if auth.uid() is null or p_month is null or p_tier is null or p_tier not in (1,2,3)
     or p_month<'2000-01-01'::date or p_month>'2100-12-01'::date
     or p_month<>pg_catalog.date_trunc('month',p_month)::date then
    raise exception 'Mois ou palier invalide';
  end if;
  select * into c from private.orange_team_tier_config where team_id=p_team_id for update;
  if not found or not (auth.uid()=any(c.allowed_users)) or not private.is_team_member(p_team_id,auth.uid()) then
    raise exception 'Accès au binôme refusé';
  end if;
  update private.orange_team_tier_config set overrides=jsonb_set(overrides,array[pg_catalog.to_char(p_month,'YYYY-MM')],to_jsonb(p_tier),true) where team_id=p_team_id;
  update public.interventions i set operator_data=i.operator_data
  where i.team_id=p_team_id and i.user_id=any(c.allowed_users) and i.company_id is null and i.operator='orange'
    and lower(coalesce(i.result,'')) in ('réussite','reussite','success')
    and i.intervention_date>=p_month and i.intervention_date<(p_month+interval '1 month')::date
    and (c.prices ? translate(lower(trim(coalesce(i.intervention_type_name,''))), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc')
      or (c.prices ? 'apie' and (lower(trim(coalesce(i.operator_data #>> '{supplement,comment}','')))='apie' or (case when jsonb_typeof(i.operator_data #> '{supplement,items}')='array' then exists(select 1 from jsonb_array_elements(i.operator_data #> '{supplement,items}') x where lower(trim(coalesce(x->>'comment','')))='apie') else false end))));
  get diagnostics changed = row_count;
  return jsonb_build_object('month',pg_catalog.to_char(p_month,'YYYY-MM'),'tier',p_tier,'updated',changed);
end;
$$;
revoke all on function private.set_orange_team_tier(uuid,date,integer) from public,anon;
grant execute on function private.set_orange_team_tier(uuid,date,integer) to authenticated;
create or replace function public.set_my_orange_team_tier(p_team_id uuid,p_month date,p_tier integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_orange_team_tier(p_team_id,p_month,p_tier)
$$;
revoke all on function public.set_my_orange_team_tier(uuid,date,integer) from public,anon;
grant execute on function public.set_my_orange_team_tier(uuid,date,integer) to authenticated;
