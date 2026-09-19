begin read only;
select jsonb_build_object(
  'product_schema',to_regnamespace('mahjong_clash') is not null,
  'runtime_contract',(select jsonb_agg(jsonb_build_object(
    'function',p.oid::regprocedure::text,'returns',format_type(p.prorettype,null),
    'body_md5',md5(p.prosrc),'security_definer',p.prosecdef,'settings',p.proconfig,
    'runtime_execute',has_function_privilege('mahjong_clash_server',p.oid,'EXECUTE'),
    'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
    'member_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'gateway_execute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='mahjong_clash' and p.proname in ('runtime_balance','runtime_readiness','lock_runtime_economy')),
  'continuous',exists(select 1 from information_schema.columns where table_schema='public' and table_name='joy8_matches' and column_name='settlement_count'),
  'catalog',coalesce((select jsonb_agg(jsonb_build_object('id',id,'slug',slug,'published',published,'launch_url',launch_url)) from public.games where slug='mahjong-clash'),'[]'::jsonb),
  'game_policies',(select count(*) from public.joy8_game_policies p join public.games g on g.id=p.game_id where g.slug='mahjong-clash'),
  'backend_keys',(select count(*) from public.joy8_backend_keys k join public.games g on g.id=k.game_id where g.slug='mahjong-clash'),
  'open_matches',(select count(*) from public.joy8_matches where state='open'),
  'wallet_rows',(select count(*) from public.wallet_accounts),
  'nonzero_wallets',(select count(*) from public.wallet_accounts where balance<>0 or locked_balance<>0)
) as mahjong_readiness;
commit;
