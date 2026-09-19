begin read only;
do $$
begin
  if not exists(select 1 from public.games g join mahjong_clash.lifecycle_config c on c.game_id=g.id
    join public.joy8_wallet_policies w on w.game_id=g.id
    where g.slug='mahjong-clash' and not g.published and g.launch_url is null and not w.enabled and w.initial_credit=0)
    or not exists(select 1 from mahjong_clash.economy_state where environment='operational') then
    raise exception 'MAHJONG_DISABLED_REGISTRATION_INVALID';
  end if;
  if exists(select 1 from public.joy8_game_policies p join public.games g on g.id=p.game_id where g.slug='mahjong-clash')
    or exists(select 1 from public.joy8_backend_keys k join public.games g on g.id=k.game_id where g.slug='mahjong-clash')
    or exists(select 1 from mahjong_clash.matches) or exists(select 1 from mahjong_clash.ai_accounts) then
    raise exception 'MAHJONG_UNEXPECTED_ACTIVATION';
  end if;
  if exists(select 1 from pg_roles where rolname in ('mahjong_clash_runtime','mahjong_clash_server','mahjong_clash_accounting_owner','mahjong_clash_lifecycle_owner')
    and (rolcanlogin or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb)) then
    raise exception 'MAHJONG_ROLE_ATTRIBUTES_INVALID';
  end if;
  if exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role')
    and has_schema_privilege(oid,'mahjong_clash','USAGE')) then raise exception 'MAHJONG_BROWSER_ACCESS'; end if;
  if exists(select 1 from pg_roles where rolname in ('mahjong_clash_server','mahjong_clash_accounting_owner','mahjong_clash_lifecycle_owner')
    and has_schema_privilege(oid,'mahjong_clash','CREATE')) then raise exception 'MAHJONG_UNEXPECTED_SCHEMA_CREATE'; end if;
  if exists(select 1 from pg_roles r cross join pg_class c join pg_namespace n on n.oid=c.relnamespace
    where r.rolname in ('mahjong_clash_server','mahjong_clash_accounting_owner','mahjong_clash_lifecycle_owner')
    and n.nspname in ('public','auth') and c.relkind in ('r','p')
    and has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')) then
    raise exception 'MAHJONG_PLATFORM_TABLE_ACCESS';
  end if;
  if has_function_privilege('mahjong_clash_server','mahjong_clash.platform_accounting(text,uuid,jsonb)','EXECUTE') then
    raise exception 'MAHJONG_RUNTIME_CALLBACK_ACCESS';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='mahjong_clash' and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'],false)) then
    raise exception 'MAHJONG_DEFINER_SEARCH_PATH';
  end if;
end;
$$;
select jsonb_build_object(
  'tables',(select jsonb_agg(tablename order by tablename) from pg_tables where schemaname='mahjong_clash'),
  'roles',(select jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'superuser',rolsuper,'bypass_rls',rolbypassrls)) from pg_roles where rolname like 'mahjong_clash_%'),
  'continuous',(select exists(select 1 from information_schema.columns where table_schema='public' and table_name='joy8_matches' and column_name='settlement_count')),
  'ledger_match_ref',(select exists(select 1 from information_schema.columns where table_schema='public' and table_name='wallet_transactions' and column_name='match_ref')),
  'legacy_ledger_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='wallet_transactions' and column_name in ('round_id','metadata')),
  'temporary_owner_memberships',(select jsonb_agg(jsonb_build_object('role',r.rolname,'set',m.set_option,'inherit',m.inherit_option)) from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member=(select proowner from pg_proc where oid='public.joy8_product_adapter(regprocedure,text,uuid,jsonb)'::regprocedure) and r.rolname in ('mahjong_clash_accounting_owner','mahjong_clash_lifecycle_owner')),
  'platform_can_call_adapter',has_function_privilege((select proowner from pg_proc where oid='public.joy8_product_adapter(regprocedure,text,uuid,jsonb)'::regprocedure),'mahjong_clash.platform_accounting(text,uuid,jsonb)','EXECUTE')
) as mahjong_installation;
commit;
