begin;

create or replace function public.is_joy8_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    join public.admin_users a on lower(a.email)=lower(u.email)
    where u.id=auth.uid() and not coalesce(u.is_anonymous,false)
      and u.email_confirmed_at is not null and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
      and auth.jwt()->'app_metadata'->>'provider'='google'
      and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google')
  );
$$;

revoke all on function public.is_joy8_admin() from public,anon,authenticated,service_role;
grant execute on function public.is_joy8_admin() to authenticated,service_role;
drop policy if exists games_admin_delete on public.games;
revoke delete on public.games from authenticated;
select public.joy8_validate_product_adapters();

commit;
