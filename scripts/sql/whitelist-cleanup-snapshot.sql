begin read only;
select jsonb_agg(to_jsonb(t)) as snapshot from (select 'public.player_accounts' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from public.player_accounts t where true
union all
select 'public.wallet_accounts' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from public.wallet_accounts t where true
union all
select 'public.wallet_transactions' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from public.wallet_transactions t where true
union all
select 'public.game_sessions' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from public.game_sessions t where true
union all
select 'public.joy8_matches' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from public.joy8_matches t where true
union all
select 'public.joy8_match_participants' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from public.joy8_match_participants t where true
union all
select 'public.joy8_settlements' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from public.joy8_settlements t where true
union all
select 'public.joy8_settlement_entries' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from public.joy8_settlement_entries t where true
union all
select 'public.joy8_match_recoveries' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from public.joy8_match_recoveries t where true
union all
select 'public.joy8_mail_messages' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from public.joy8_mail_messages t where true
union all
select 'public.joy8_mail_recipients' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from public.joy8_mail_recipients t where true
union all
select 'public.joy8_fee_accounts' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from public.joy8_fee_accounts t where true
union all
select 'auth.users' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from auth.users t where id<>'ac5cb167-7cdc-4e49-ba50-47a8a5220b88'::uuid
union all
select 'auth.identities' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from auth.identities t where user_id<>'ac5cb167-7cdc-4e49-ba50-47a8a5220b88'::uuid
union all
select 'auth.sessions' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from auth.sessions t where user_id<>'ac5cb167-7cdc-4e49-ba50-47a8a5220b88'::uuid
union all
select 'auth.refresh_tokens' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from auth.refresh_tokens t where user_id is distinct from 'ac5cb167-7cdc-4e49-ba50-47a8a5220b88'::uuid::text
union all
select 'auth.flow_state' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from auth.flow_state t where user_id is distinct from 'ac5cb167-7cdc-4e49-ba50-47a8a5220b88'::uuid
union all
select 'auth.mfa_amr_claims' as table_name,count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) as fingerprint from auth.mfa_amr_claims t where session_id in (select id from auth.sessions where user_id<>'ac5cb167-7cdc-4e49-ba50-47a8a5220b88'::uuid)) t;
commit;
