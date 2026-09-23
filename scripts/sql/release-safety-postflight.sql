with admin_claims as materialized (
  select set_config('request.jwt.claim.sub',(select u.id::text from auth.users u join public.admin_users a on lower(a.email)=lower(u.email) where u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false) and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google') limit 1),true),
    set_config('request.jwt.claims','{"app_metadata":{"provider":"google"}}',true)
), google_result as materialized (
  select public.is_joy8_admin() allowed from admin_claims
), email_claims as materialized (
  select allowed,set_config('request.jwt.claims','{"app_metadata":{"provider":"email"}}',true) from google_result
), verified as materialized (
  select allowed,not public.is_joy8_admin() email_denied from email_claims
)
select jsonb_build_object(
  'business',jsonb_build_object('players',(select count(*) from public.player_accounts),'wallets',(select count(*) from public.wallet_accounts),'balance',(select coalesce(sum(balance),0) from public.wallet_accounts),'locked',(select coalesce(sum(locked_balance),0) from public.wallet_accounts),'transactions',(select count(*) from public.wallet_transactions),'matches',(select count(*) from public.joy8_matches),'settlements',(select count(*) from public.joy8_settlements)),
  'hidden_entries_paused',(select count(*)=2 and bool_and(not e.enabled) from public.joy8_private_entries e join public.games g on g.id=e.game_id where g.slug in ('mahjong-clash','monster-lab')),
  'google_admin_allowed',verified.allowed,
  'email_admin_denied',verified.email_denied,
  'browser_delete_revoked',not has_table_privilege('authenticated','public.games','DELETE'),
  'budget_rows',(select count(*) from public.joy8_payout_budgets),
  'budget_triggers',(select count(*) from pg_trigger where not tgisinternal and tgname in ('joy8_reserve_payout_budget','joy8_consume_payout_budget','joy8_release_payout_budget') and tgenabled='O'),
  'recovery_service_role_denied',not has_function_privilege('service_role','public.joy8_operator_cancel_match(uuid,text,integer,text,text)','EXECUTE'),
  'recovery_browser_denied',not has_function_privilege('authenticated','public.joy8_operator_cancel_match(uuid,text,integer,text,text)','EXECUTE') and not has_function_privilege('anon','public.joy8_operator_cancel_match(uuid,text,integer,text,text)','EXECUTE'),
  'cleanup_job',(select jsonb_build_object('active',active,'schedule',schedule,'command',command) from cron.job where jobname='joy8-runtime-cleanup'),
  'cleanup_runs',(select coalesce(jsonb_agg(r),'[]'::jsonb) from (select d.status,d.return_message,d.start_time,d.end_time from cron.job_run_details d join cron.job j on j.jobid=d.jobid where j.jobname='joy8-runtime-cleanup' order by d.start_time desc limit 3) r)
) as release_safety_postflight from verified;
