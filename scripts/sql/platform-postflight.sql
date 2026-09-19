begin read only;
select jsonb_build_object(
  'wallets',(select count(*) from public.wallet_accounts),
  'transactions',(select count(*) from public.wallet_transactions),
  'sessions',(select count(*) from public.game_sessions),
  'matches',(select count(*) from public.joy8_matches),
  'settlements',(select count(*) from public.joy8_settlements),
  'game_policies',(select count(*) from public.joy8_game_policies),
  'backend_keys',(select count(*) from public.joy8_backend_keys),
  'old_round_table_removed',to_regclass('public.game_rounds') is null,
  'old_rpc_count',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('wallet_bet','wallet_payout','wallet_refund',
      'close_game_round','joy8_apply_wallet_transaction','exchange_game_launch_code','record_demo_wallet_initial_credit')),
  'browser_rpc_grants',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('create_game_session','wallet_get_balance','joy8_server_session_v1',
      'joy8_open_match_v1','joy8_settle_match_v1','joy8_match_status_v1','joy8_platform_health_v1')
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))),
  'new_table_rls_disabled',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname like 'joy8_%' and not c.relrowsecurity),
  'health_function_present',to_regprocedure('public.joy8_platform_health_v1()') is not null
) as postflight;
commit;
