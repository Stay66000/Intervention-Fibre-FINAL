-- Société V2 production cutover: company technicians read through masked RPCs.
-- Existing independent and company-admin policies continue to apply.
create policy company_v2_rpc_read_boundary on public.interventions
 as restrictive for select to authenticated
 using (company_id is null or private.is_company_admin(company_id));
create policy company_v2_rpc_update_boundary on public.interventions
 as restrictive for update to authenticated
 using (company_id is null or private.is_company_admin(company_id))
 with check (company_id is null or private.is_company_admin(company_id));
create policy company_v2_catalog_read_boundary on public.intervention_types
 as restrictive for select to authenticated
 using (company_id is null or private.is_company_admin(company_id));

CREATE OR REPLACE FUNCTION public.company_get_my_interventions()
 RETURNS TABLE(id uuid, user_id uuid, company_id uuid, team_id uuid, work_mode text, solo_user_id uuid, created_by uuid, intervention_date date, operator text, intervention_type_id uuid, intervention_type_name text, my_payout numeric, result text, reference text, address text, notes text, operator_data jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select * from public.company_v2_get_my_interventions();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_company_intervention_history()
 RETURNS TABLE(id uuid, user_id uuid, company_id uuid, company_name text, team_id uuid, work_mode text, solo_user_id uuid, created_by uuid, intervention_date date, operator text, intervention_type_id uuid, intervention_type_name text, my_payout numeric, result text, reference text, address text, notes text, operator_data jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select secured_result.* from (
select
    i.id,
    i.user_id,
    i.company_id,
    c.name,
    i.team_id,
    i.work_mode,
    i.solo_user_id,
    i.created_by,
    i.intervention_date,
    i.operator,
    i.intervention_type_id,
    i.intervention_type_name,
    case when coalesce(history_member.hide_prices,false) then 0 else coalesce(
      ip.payout_amount_snapshot,
      case
        when i.solo_user_id = auth.uid() or i.user_id = auth.uid()
          then i.applied_amount
        else 0
      end,
      0
    ) end::numeric as my_payout,
    i.result,
    i.reference,
    i.address,
    i.notes,
    case when coalesce(history_member.hide_prices,false)
      then coalesce(i.operator_data,'{}'::jsonb) - array['supplement_amount','amount','price','unit_price','agency_amount','technician_amount']::text[]
      else i.operator_data end as operator_data,
    i.created_at,
    i.updated_at
  from public.interventions i
  join public.companies c on c.id = i.company_id
  join public.company_members history_member on history_member.company_id=i.company_id and history_member.user_id=auth.uid()
  left join public.intervention_payments ip
    on ip.intervention_id = i.id
   and ip.user_id = auth.uid()
  where i.company_id is not null
    and not private.fibre_ops_is_platform_admin()
    and private.company_is_active(i.company_id)
    and (
      ip.user_id = auth.uid()
      or i.user_id = auth.uid()
      or i.solo_user_id = auth.uid()
      or exists (
        select 1
        from public.team_members tm
        where tm.team_id = i.team_id
          and tm.user_id = auth.uid()
          and tm.status in ('active','ended')
          and i.created_at >= tm.joined_at
          and (tm.ended_at is null or i.created_at <= tm.ended_at)
      )
    )
  order by i.intervention_date,i.created_at
  ) as secured_result where private.is_active_user();
$function$;
