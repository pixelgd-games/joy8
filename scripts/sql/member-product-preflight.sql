begin read only;

select jsonb_build_object(
  'snapshot',jsonb_build_object(
    'auth_users',(select count(*) from auth.users),
    'auth_identity_hash',(select md5(coalesce(string_agg(id::text,',' order by id),'')) from auth.users),
    'players',(select count(*) from public.player_accounts),
    'player_hash',(select md5(coalesce(string_agg(row_to_json(p)::text,',' order by p.id),'')) from public.player_accounts p),
    'public_ids',(select count(distinct public_id) from public.player_accounts),
    'player_id_snapshot',(select md5(coalesce(string_agg(id::text||':'||public_id,',' order by id),'')) from public.player_accounts),
    'games',(select count(*) from public.games),
    'catalog_hash',(select md5(coalesce(string_agg(row_to_json(g)::text,',' order by g.id),'')) from public.games g),
    'admins',(select count(*) from public.admin_users),
    'admin_hash',(select md5(coalesce(string_agg(row_to_json(a)::text,',' order by row_to_json(a)::text),'')) from public.admin_users a),
    'wallets',(select count(*) from public.wallet_accounts),
    'wallet_hash',(select md5(coalesce(string_agg(row_to_json(w)::text,',' order by w.id),'')) from public.wallet_accounts w),
    'transactions',(select count(*) from public.wallet_transactions),
    'matches',(select count(*) from public.joy8_matches),
    'settlements',(select count(*) from public.joy8_settlements),
    'sessions',(select count(*) from public.game_sessions)
  ),
  'schemas',(select jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner)) order by nspname)
    from pg_namespace where nspname !~ '^pg_' and nspname<>'information_schema'),
  'adapters',(select jsonb_agg(jsonb_build_object('game',g.slug,'function',p.product_adapter::text,
    'schema',n.nspname,'owner',r.rolname,'superuser',r.rolsuper,'bypass_rls',r.rolbypassrls,
    'security_definer',f.prosecdef,'config',f.proconfig,
    'platform_execute',has_function_privilege((select proowner from pg_proc where oid='public.joy8_product_adapter(regprocedure,text,uuid,jsonb)'::regprocedure),f.oid,'EXECUTE')))
    from public.joy8_game_policies p join public.games g on g.id=p.game_id
    left join pg_proc f on f.oid=p.product_adapter::oid left join pg_namespace n on n.oid=f.pronamespace
    left join pg_roles r on r.oid=f.proowner),
  'product_registry_present',to_regclass('public.joy8_product_schemas') is not null,
  'active_enrollment_transactions',(select count(*) from pg_stat_activity where pid<>pg_backend_pid()
    and state='active' and (query ilike '%joy8_resolve_member%' or query ilike '%player_accounts%'))
) as member_product_preflight;

commit;
