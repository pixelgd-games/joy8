select pg_get_functiondef(p.oid) as definition,
  pg_get_expr(p.proargdefaults,0) as scope_default,
  p.prosecdef as security_definer,p.proconfig as settings,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,
  pg_get_functiondef('public.wallet_get_balance(text)'::regprocedure) as balance_caller,
  to_regprocedure('public.joy8_platform_health_v1()') is not null as health_function_present,
  jsonb_build_object(
    'wallets',(select count(*) from public.wallet_accounts),
    'ledger',(select count(*) from public.wallet_transactions),
    'sessions',(select count(*) from public.game_sessions),
    'matches',(select count(*) from public.joy8_matches),
    'settlements',(select count(*) from public.joy8_settlements),
    'players',(select count(*) from public.player_accounts),
    'games',(select count(*) from public.games),
    'admins',(select count(*) from public.admin_users)
  ) as record_counts
from pg_proc p where p.oid='public.joy8_active_session(text,text)'::regprocedure;
