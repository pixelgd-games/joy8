begin read only;
select jsonb_build_object(
'product',(select jsonb_agg(t order by table_name) from (
select 'accounting_commits' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.accounting_commits t
union all
select 'accounting_requests' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.accounting_requests t
union all
select 'ai_accounts' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.ai_accounts t
union all
select 'ai_reservations' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.ai_reservations t
union all
select 'economy_entries' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.economy_entries t
union all
select 'economy_operations' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.economy_operations t
union all
select 'economy_state' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.economy_state t
union all
select 'economy_transfers' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.economy_transfers t
union all
select 'economy_versions' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.economy_versions t
union all
select 'hand_economy' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.hand_economy t
union all
select 'hands' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.hands t
union all
select 'lifecycle_config' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.lifecycle_config t
union all
select 'match_openings' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.match_openings t
union all
select 'match_players' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.match_players t
union all
select 'match_states' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.match_states t
union all
select 'matches' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.matches t
union all
select 'platform_matches' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.platform_matches t
union all
select 'player_profiles' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.player_profiles t
union all
select 'processed_actions' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.processed_actions t
union all
select 'room_operations' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.room_operations t
union all
select 'room_resolution_log' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.room_resolution_log t
union all
select 'room_resolutions' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.room_resolutions t
union all
select 'runtime_operations' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.runtime_operations t
union all
select 'runtime_players' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.runtime_players t
union all
select 'runtime_records' as table_name,count(*)::int as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by md5(to_jsonb(t)::text)),'')) as fingerprint from mahjong_clash.runtime_records t
) t),
'platform_matches',(select coalesce(jsonb_agg(t),'[]') from (select state,count(*)::int as rows from public.joy8_matches where game_id=(select id from public.games where slug='mahjong-clash') group by state) t),
'open_matches',(select count(*) from public.joy8_matches where game_id=(select id from public.games where slug='mahjong-clash') and state='open'),
'held_seats',(select count(*) from public.joy8_match_participants where reserved_amount>0 and match_id in(select id from public.joy8_matches where game_id=(select id from public.games where slug='mahjong-clash') and state='open')),
'foreign_keys',(select jsonb_agg(jsonb_build_object('source',c.conrelid::regclass::text,'target',c.confrelid::regclass::text,'definition',pg_get_constraintdef(c.oid))) from pg_constraint c join pg_class t on t.oid=c.confrelid join pg_namespace n on n.oid=t.relnamespace where c.contype='f' and n.nspname='mahjong_clash')
) as inventory;
commit;
