begin read only;
select jsonb_build_object(
  'hook_installed',to_regprocedure('public.joy8_before_user_created(jsonb)') is not null,
  'access_installed',to_regprocedure('public.joy8_assert_play_access(uuid)') is not null,
  'admins_covered',exists(select 1 from public.admin_users) and not exists(
    select 1 from public.admin_users a where not exists(
      select 1 from public.joy8_email_allowlist w where w.email=lower(btrim(a.email)))),
  'admin_google_valid',not exists(select 1 from public.admin_users a where not exists(
    select 1 from auth.users u join auth.identities i on i.user_id=u.id and i.provider='google'
    where lower(u.email)=lower(a.email) and not u.is_anonymous and u.email_confirmed_at is not null
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))),
  'hook_execute',has_function_privilege('supabase_auth_admin','public.joy8_before_user_created(jsonb)','EXECUTE'),
  'hook_private',not has_function_privilege('anon','public.joy8_before_user_created(jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.joy8_before_user_created(jsonb)','EXECUTE'),
  'rls',(select relrowsecurity from pg_class where oid='public.joy8_email_allowlist'::regclass)
) as allowlist_status;
commit;
