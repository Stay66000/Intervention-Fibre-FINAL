-- FIBRE OPS — rollback ciblé avant durcissement backend du 2026-10-23
-- Ne restaure aucune donnée métier. Restaure uniquement les objets modifiés par cette passe.

create or replace function public.platform_list_companies()
returns table(id uuid, name text, status text, admin_email text, member_count bigint, created_at timestamptz)
language sql
stable
security definer
set search_path to ''
as $function$
    select
        c.id,
        c.name,
        c.status,
        (
            select p.email
            from public.company_members cm
            join public.profiles p on p.id = cm.user_id
            where cm.company_id = c.id
              and cm.role = 'admin'
              and cm.status = 'active'
            order by cm.joined_at
            limit 1
        ) as admin_email,
        (
            select count(*)
            from public.company_members cm2
            where cm2.company_id = c.id
              and cm2.status = 'active'
        ) as member_count,
        c.created_at
    from public.companies c
    where private.is_platform_admin()
    order by c.created_at desc;
$function$;

revoke all on function public.platform_list_companies() from public, anon, authenticated;
grant execute on function public.platform_list_companies() to postgres;

drop policy if exists profiles_company_peer_select on public.profiles;
create policy profiles_company_peer_select on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.company_members me
    join public.company_members other on other.company_id = me.company_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and other.user_id = profiles.id
      and other.status in ('active','disabled')
  )
);

drop policy if exists profiles_select_team_peer on public.profiles;
create policy profiles_select_team_peer on public.profiles
for select to authenticated
using (private.is_active_user() and (id = auth.uid() or private.same_team(auth.uid(), id)));
