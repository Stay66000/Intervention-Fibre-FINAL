-- Server-only approvals from a verified source. No client may enqueue transfers.
create table private.legacy_team_history_transfers (
  intervention_id uuid primary key references public.interventions(id) on delete cascade,
  invite_id uuid not null references public.team_invites(id) on delete cascade,
  expected_snapshot jsonb not null,
  source_sheet text not null,
  source_tab text not null,
  source_row integer not null check(source_row>1),
  queued_at timestamptz not null default now(),
  applied_at timestamptz,
  target_team_id uuid references public.teams(id)
);
alter table private.legacy_team_history_transfers enable row level security;
revoke all on private.legacy_team_history_transfers from public,anon,authenticated;
create index legacy_team_history_pending on private.legacy_team_history_transfers(invite_id) where applied_at is null;

-- This private definer reads approvals unavailable to API users. It only authorizes
-- an exact Personal -> Binôme transition, without any other historical changes.
create or replace function private.is_approved_legacy_team_transfer(
  p_old public.interventions,p_new public.interventions
) returns boolean language sql volatile security definer set search_path='' as $$
  select p_old.company_id is null and p_old.team_id is null
    and p_old.work_mode='Personal' and p_old.solo_user_id=p_old.user_id
    and p_new.team_id is not null and p_new.work_mode='Binôme' and p_new.solo_user_id is null
    and (to_jsonb(p_new)-array['team_id','work_mode','solo_user_id','updated_at'])
      = (to_jsonb(p_old)-array['team_id','work_mode','solo_user_id','updated_at'])
    and private.is_active_user()
    and exists (
      select 1 from private.legacy_team_history_transfers q
      join public.team_invites inv on inv.id=q.invite_id
      join public.teams t on t.id=p_new.team_id
      where q.intervention_id=p_old.id and q.applied_at is null
        and q.expected_snapshot=to_jsonb(p_old)
        and inv.status='accepted' and inv.inviter_user_id=p_old.user_id
        and auth.uid()=inv.invitee_user_id
        and t.company_id is null and t.ended_at is null and t.created_by=inv.inviter_user_id
        and t.created_at>=q.queued_at
        and not exists(select 1 from public.company_members cm
          where cm.user_id in(inv.inviter_user_id,inv.invitee_user_id) and cm.status in('active','disabled'))
        and exists(select 1 from public.team_members tm where tm.team_id=t.id
          and tm.user_id=inv.inviter_user_id and tm.status='active' and tm.ended_at is null)
        and exists(select 1 from public.team_members tm where tm.team_id=t.id
          and tm.user_id=inv.invitee_user_id and tm.status='active' and tm.ended_at is null)
    );
$$;
revoke all on function private.is_approved_legacy_team_transfer(public.interventions,public.interventions) from public,anon;
grant execute on function private.is_approved_legacy_team_transfer(public.interventions,public.interventions) to authenticated;

create or replace function private.apply_verified_legacy_team_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_team uuid;
begin
  if old.status is distinct from 'pending' or new.status is distinct from 'accepted'
     or auth.uid() is distinct from new.invitee_user_id then return new; end if;
  select t.id into v_team from public.teams t
  join public.team_members a on a.team_id=t.id and a.user_id=new.inviter_user_id
    and a.status='active' and a.ended_at is null
  join public.team_members b on b.team_id=t.id and b.user_id=new.invitee_user_id
    and b.status='active' and b.ended_at is null
  where t.company_id is null and t.ended_at is null and t.created_by=new.inviter_user_id;
  if v_team is null then return new; end if;

  -- Changed rows fail closed: do not guess or overwrite subsequent edits.
  update public.interventions i set team_id=v_team,work_mode='Binôme',solo_user_id=null
  from private.legacy_team_history_transfers q
  where q.invite_id=new.id and q.applied_at is null and q.intervention_id=i.id
    and q.expected_snapshot=to_jsonb(i) and i.user_id=new.inviter_user_id
    and i.company_id is null and i.team_id is null and i.work_mode='Personal';

  update private.legacy_team_history_transfers q set applied_at=now(),target_team_id=v_team
  from public.interventions i where q.intervention_id=i.id and q.invite_id=new.id
    and q.applied_at is null and i.team_id=v_team and i.work_mode='Binôme'
    and i.solo_user_id is null;
  return new;
end;
$$;
revoke all on function private.apply_verified_legacy_team_history() from public,anon,authenticated;
create trigger team_invite_apply_verified_history after update of status on public.team_invites
for each row execute function private.apply_verified_legacy_team_history();

CREATE OR REPLACE FUNCTION private.protect_intervention_financial_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if private.is_approved_legacy_team_transfer(old,new) then return new; end if;
  if new.user_id is distinct from old.user_id
     or new.company_id is distinct from old.company_id
     or new.team_id is distinct from old.team_id
     or new.work_mode is distinct from old.work_mode
     or new.solo_user_id is distinct from old.solo_user_id
     or new.operator is distinct from old.operator
     or new.result is distinct from old.result then
    raise exception 'Les éléments financiers d’une intervention enregistrée sont verrouillés. Duplique ou crée une nouvelle intervention pour corriger le tarif, le résultat, l’opérateur, la typologie ou le mode de travail.';
  end if;

  if new.intervention_type_id is distinct from old.intervention_type_id then
    if not (
      old.intervention_type_id is not null
      and new.intervention_type_id is null
      and new.intervention_type_name is not distinct from old.intervention_type_name
      and new.applied_amount is not distinct from old.applied_amount
    ) then
      raise exception 'Les éléments financiers d’une intervention enregistrée sont verrouillés. Duplique ou crée une nouvelle intervention pour corriger le tarif, le résultat, l’opérateur, la typologie ou le mode de travail.';
    end if;
  end if;

  return new;
end;
$function$
;
