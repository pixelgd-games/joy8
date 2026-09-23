select jsonb_build_object(
  'business', jsonb_build_object('players',(select count(*) from public.player_accounts),'wallets',(select count(*) from public.wallet_accounts),'balance',(select coalesce(sum(balance),0) from public.wallet_accounts),'locked',(select coalesce(sum(locked_balance),0) from public.wallet_accounts),'transactions',(select count(*) from public.wallet_transactions),'matches',(select count(*) from public.joy8_matches),'settlements',(select count(*) from public.joy8_settlements)),
  'entries', (select jsonb_agg(jsonb_build_object('slug',g.slug,'published',g.published,'enabled',e.enabled,'origin',e.entry_origin)) from public.joy8_private_entries e join public.games g on g.id=e.game_id),
  'open_matches', (select count(*) from public.joy8_matches where state='open'),
  'pg_cron_installed', exists(select 1 from pg_extension where extname='pg_cron'),
  'verified_google_admins', (select count(distinct u.id) from auth.users u join public.admin_users a on lower(a.email)=lower(u.email) join auth.identities i on i.user_id=u.id and i.provider='google' where u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())),
  'active_financial_keys', (select count(*) from public.joy8_backend_keys where revoked_at is null and expires_at>now() and scopes && array['open','settle','cancel']::text[]),
  'admin_function', pg_get_functiondef('public.is_joy8_admin()'::regprocedure),
  'runtime_cleanup', pg_get_functiondef('public.joy8_cleanup_gateway_runtime()'::regprocedure),
  'mahjong_history_constraint', (select pg_get_constraintdef(oid) from pg_constraint where conrelid='mahjong_clash.processed_actions'::regclass and conname='processed_actions_history_limit')
) as release_safety_preflight;
