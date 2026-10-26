-- Reconcile corroborated legacy APIE amounts without importing rows from Sheets.
-- No data backfill and no user IDs are embedded in this schema change.
create or replace function private.reconcile_legacy_sheet_supplement(
  p_data jsonb, p_amount numeric, p_operator text, p_result text, p_notes text
) returns jsonb language plpgsql immutable set search_path='' as $$
declare
  v_data jsonb:=coalesce(p_data,'{}'::jsonb);
  v_sheet numeric;
begin
  -- An explicit supplement (even zero) or a previous reconciliation is authoritative.
  if v_data ? 'supplement' or v_data ? 'sheet_reconciliation'
    or v_data->'legacy_sheet_sync' is distinct from 'true'::jsonb
    or p_operator is distinct from 'orange' or p_result is distinct from 'Réussite'
    or p_amount is null or p_amount < 0
    or coalesce(p_notes,'') !~* '(^|[^[:alnum:]_])APIE([^[:alnum:]_]|$)'
    or jsonb_typeof(v_data->'sandbox_sheet_amount') is distinct from 'number'
  then return v_data; end if;
  v_sheet:=(v_data->>'sandbox_sheet_amount')::numeric;
  if v_sheet-p_amount <> 37.60 then return v_data; end if;
  return v_data || jsonb_build_object(
    'supplement',jsonb_build_object('amount',37.60,'comment','APIE'),
    'sheet_reconciliation',jsonb_build_object('version',1,'source','legacy_sheet_amount',
      'base_amount',p_amount,'sheet_amount',v_sheet,'supplement_amount',37.60)
  );
end;
$$;
revoke all on function private.reconcile_legacy_sheet_supplement(jsonb,numeric,text,text,text) from public,anon;
grant execute on function private.reconcile_legacy_sheet_supplement(jsonb,numeric,text,text,text) to authenticated;

create or replace function private.detect_legacy_sheet_supplement()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.company_id is null and new.team_id is null then
    -- Preserve historical amounts on updates; never consult today's tariff.
    new.operator_data:=private.reconcile_legacy_sheet_supplement(
      new.operator_data,case when tg_op='UPDATE' then old.applied_amount else new.applied_amount end,
      new.operator,new.result,new.notes);
  end if;
  return new;
end;
$$;
revoke all on function private.detect_legacy_sheet_supplement() from public,anon,authenticated;
create trigger zy_interventions_detect_sheet_supplement
before insert or update of operator_data on public.interventions
for each row execute function private.detect_legacy_sheet_supplement();

create or replace function public.reconcile_my_legacy_sheet_supplements()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  perform private.assert_api_user();
  if auth.uid() is null then raise exception 'Authentification requise' using errcode='42501'; end if;
  if private.my_company_id() is not null then
    return jsonb_build_object('corrected_count',0,'added_amount',0);
  end if;
  update public.interventions i set operator_data=private.reconcile_legacy_sheet_supplement(
    i.operator_data,i.applied_amount,i.operator,i.result,i.notes)
  where i.user_id=auth.uid() and i.company_id is null and i.team_id is null
    and private.reconcile_legacy_sheet_supplement(i.operator_data,i.applied_amount,i.operator,i.result,i.notes)
      is distinct from coalesce(i.operator_data,'{}'::jsonb);
  get diagnostics v_count=row_count;
  return jsonb_build_object('corrected_count',v_count,'added_amount',v_count*37.60);
end;
$$;
revoke all on function public.reconcile_my_legacy_sheet_supplements() from public,anon;
grant execute on function public.reconcile_my_legacy_sheet_supplements() to authenticated;
