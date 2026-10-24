-- The invoker-rights supplement trigger needs this pure input validator.
-- It reads no table and grants no business access.
grant execute on function private.intervention_supplement_amount(jsonb) to authenticated;
-- Only server-owned entrypoints may detach a technician.
revoke all on function private.detach_company_technician_to_solo(uuid,uuid) from public,anon,authenticated;
