select jsonb_build_object(
  'health',public.joy8_platform_health_v1(),
  'old_public_issuer_removed',to_regprocedure('public.create_game_session(text,text,integer,text,uuid)') is null,
  'old_internal_issuer_removed',to_regprocedure('public.joy8_issue_game_session(text,text,integer,text,uuid)') is null,
  'new_public_issuer_present',to_regprocedure('public.create_game_session(text,uuid)') is not null,
  'new_internal_issuer_present',to_regprocedure('public.joy8_issue_game_session(text,uuid)') is not null,
  'browser_session_denied',not has_function_privilege('anon','public.create_game_session(text,uuid)','execute') and not has_function_privilege('authenticated','public.create_game_session(text,uuid)','execute'),
  'service_session_allowed',has_function_privilege('service_role','public.create_game_session(text,uuid)','execute'),
  'internal_issuer_denied',not has_function_privilege('anon','public.joy8_issue_game_session(text,uuid)','execute') and not has_function_privilege('authenticated','public.joy8_issue_game_session(text,uuid)','execute') and not has_function_privilege('service_role','public.joy8_issue_game_session(text,uuid)','execute'),
  'display_name_removed',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='player_accounts' and column_name='display_name'),
  'supports_live_removed',not exists(select 1 from information_schema.columns where table_schema='public' and table_name in ('games','public_games_v1') and column_name='supports_live'),
  'catalog_read_allowed',has_table_privilege('anon','public.public_games_v1','select') and has_function_privilege('anon','public.joy8_public_games_v1()','execute'),
  'catalog_rows',(select count(*) from public.public_games_v1),
  'published_games',(select count(*) from public.games where published),
  'enabled_private_entries',(select count(*) from public.joy8_private_entries where enabled),
  'business',jsonb_build_object('players',(select count(*) from public.player_accounts),'wallets',(select count(*) from public.wallet_accounts),'balance',(select coalesce(sum(balance),0) from public.wallet_accounts),'transactions',(select count(*) from public.wallet_transactions),'matches',(select count(*) from public.joy8_matches),'settlements',(select count(*) from public.joy8_settlements))
) as session_cleanup_postflight;
