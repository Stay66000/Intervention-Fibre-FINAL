-- Déploiement réservé au propriétaire du panneau d'administration.
-- Aucun détail d'intervention, montant ou donnée client n'est exposé.
create or replace function private.platform_account_activity()
returns table(user_id uuid,last_sign_in_at timestamptz,intervention_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.photo_preview_is_owner() or not private.fibre_ops_is_platform_admin() then
    raise exception 'Accès refusé' using errcode='42501';
  end if;
  return query
    select p.id,u.last_sign_in_at,coalesce(c.n,0)::bigint
    from public.profiles p
    left join auth.users u on u.id=p.id
    left join (select coalesce(i.created_by,i.user_id) as actor,count(*) as n
      from public.interventions i group by coalesce(i.created_by,i.user_id)) c on c.actor=p.id;
end;
$$;
revoke all on function private.platform_account_activity() from public,anon;
grant execute on function private.platform_account_activity() to authenticated;
create or replace function public.platform_account_activity()
returns table(user_id uuid,last_sign_in_at timestamptz,intervention_count bigint)
language sql stable security invoker set search_path = '' as $$
  select * from private.platform_account_activity()
$$;
revoke all on function public.platform_account_activity() from public,anon;
grant execute on function public.platform_account_activity() to authenticated;
