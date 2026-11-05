-- Preview-only photo permissions. No application data or existing policies are changed.
create table if not exists private.photo_preview_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null references public.profiles(id) on delete restrict
);
create table if not exists private.photo_preview_grants (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table private.photo_preview_owner enable row level security;
alter table private.photo_preview_grants enable row level security;
revoke all on private.photo_preview_owner, private.photo_preview_grants from public, anon, authenticated;

create or replace function private.photo_preview_is_owner() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and private.is_active_user()
    and exists(select 1 from private.photo_preview_owner o where o.user_id=auth.uid());
$$;
revoke all on function private.photo_preview_is_owner() from public, anon, authenticated;

create or replace function public.photo_preview_my_access() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and private.is_active_user()
    and exists(select 1 from private.photo_preview_grants g where g.user_id=auth.uid() and g.enabled);
$$;
revoke all on function public.photo_preview_my_access() from public, anon;
grant execute on function public.photo_preview_my_access() to authenticated;

create or replace function public.photo_preview_list_accounts()
returns table(user_id uuid, first_name text, last_name text, email text, active boolean, photo_enabled boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.photo_preview_is_owner() then raise exception 'Accès refusé' using errcode='42501'; end if;
  return query select p.id,p.first_name,p.last_name,p.email,p.active,coalesce(g.enabled,false)
    from public.profiles p left join private.photo_preview_grants g on g.user_id=p.id
    order by lower(coalesce(p.first_name,'')),lower(coalesce(p.last_name,'')),lower(coalesce(p.email,''));
end;
$$;
revoke all on function public.photo_preview_list_accounts() from public, anon;
grant execute on function public.photo_preview_list_accounts() to authenticated;

create or replace function public.photo_preview_set_access(p_user uuid,p_enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if not private.photo_preview_is_owner() then raise exception 'Accès refusé' using errcode='42501'; end if;
  if p_user is null or p_enabled is null or not exists(select 1 from public.profiles p where p.id=p_user) then
    raise exception 'Compte introuvable' using errcode='22023';
  end if;
  insert into private.photo_preview_grants(user_id,enabled,updated_at) values(p_user,p_enabled,now())
    on conflict(user_id) do update set enabled=excluded.enabled,updated_at=excluded.updated_at;
  return p_enabled;
end;
$$;
revoke all on function public.photo_preview_set_access(uuid,boolean) from public, anon;
grant execute on function public.photo_preview_set_access(uuid,boolean) to authenticated;
