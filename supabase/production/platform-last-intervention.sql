-- La structure de retour existante est conservée pour le panneau actuel.
-- Le champ historique last_sign_in_at porte ici la date de saisie de la dernière intervention.
create or replace function private.platform_account_last_intervention()
returns table(user_id uuid,last_sign_in_at timestamptz,intervention_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.photo_preview_is_owner() or not private.fibre_ops_is_platform_admin() then
  raise exception 'Accès refusé' using errcode='42501';
 end if;
 return query
 select p.id,c.last_created,coalesce(c.n,0)::bigint
 from public.profiles p
 left join (select coalesce(i.created_by,i.user_id) actor,max(i.created_at) last_created,count(*) n
            from public.interventions i group by coalesce(i.created_by,i.user_id)) c on c.actor=p.id;
end $$;

revoke all on function private.platform_account_last_intervention() from public,anon;
grant execute on function private.platform_account_last_intervention() to authenticated;
create or replace function public.platform_account_last_intervention()
returns table(user_id uuid,last_sign_in_at timestamptz,intervention_count bigint)
language sql stable security invoker set search_path='' as $$ select * from private.platform_account_last_intervention() $$;
revoke all on function public.platform_account_last_intervention() from public,anon;
grant execute on function public.platform_account_last_intervention() to authenticated;
