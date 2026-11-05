-- Exclude interventions deliberately hidden by a recipient from that recipient's
-- Google Sheets mirror, without deleting the shared intervention for teammates.
-- Idempotent: safe if rerun by Supabase migration deployment.
create or replace function private.google_backup_recipient(i public.interventions, u uuid)
returns boolean language sql stable set search_path='' as $$
  select (
    i.user_id=u or i.solo_user_id=u or exists(
      select 1 from public.team_members tm
      where tm.team_id=i.team_id and tm.user_id=u
        and tm.status in ('active','ended')
        and i.created_at>=tm.joined_at
        and (tm.ended_at is null or i.created_at<=tm.ended_at)
    )
  ) and not exists(
    select 1 from public.intervention_user_hidden h
    where h.intervention_id=i.id and h.user_id=u
  );
$$;
revoke all on function private.google_backup_recipient(public.interventions,uuid) from public,anon,authenticated;
grant execute on function private.google_backup_recipient(public.interventions,uuid) to service_role;

-- Guard against accidentally including any hidden row in its owner's backup.
do $check$
begin
  if exists (
    select 1 from public.intervention_user_hidden h
    join public.interventions i on i.id=h.intervention_id
    where private.google_backup_recipient(i,h.user_id)
  ) then
    raise exception 'Hidden intervention still eligible for recipient backup';
  end if;
end
$check$;
