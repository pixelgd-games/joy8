begin isolation level read committed;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local timezone='UTC';
do $$
begin
  if not pg_try_advisory_xact_lock(1296123978,1) then raise exception 'Stop Mahjong authority before cleanup'; end if;
  if (select id from public.games where slug='mahjong-clash') is distinct from 'faaa45eb-7d7d-40b5-9081-3dd73482adfa'::uuid then raise exception 'Mahjong game changed'; end if;
end $$;
lock table mahjong_clash.accounting_commits,
  mahjong_clash.accounting_requests,
  mahjong_clash.ai_accounts,
  mahjong_clash.ai_reservations,
  mahjong_clash.economy_entries,
  mahjong_clash.economy_operations,
  mahjong_clash.economy_state,
  mahjong_clash.economy_transfers,
  mahjong_clash.economy_versions,
  mahjong_clash.hand_economy,
  mahjong_clash.hands,
  mahjong_clash.lifecycle_config,
  mahjong_clash.match_openings,
  mahjong_clash.match_players,
  mahjong_clash.match_states,
  mahjong_clash.matches,
  mahjong_clash.platform_matches,
  mahjong_clash.player_profiles,
  mahjong_clash.processed_actions,
  mahjong_clash.room_operations,
  mahjong_clash.room_resolution_log,
  mahjong_clash.room_resolutions,
  mahjong_clash.runtime_operations,
  mahjong_clash.runtime_players,
  mahjong_clash.runtime_records in access exclusive mode;
create temporary table mahjong_cleanup_review(table_name text primary key,expected_rows bigint,fingerprint text) on commit drop;
insert into mahjong_cleanup_review values
('accounting_commits',49,'6af2bc0fbb3ccb84b866a3d98d5bd4f3'),
('accounting_requests',49,'50992ea07a9d55a42e5a1ea68e784d96'),
('ai_accounts',6,'a17a6c3a86019cd0d4d995d67c54e11d'),
('ai_reservations',63,'bbada9b1fd3318121e72621ec534d52d'),
('economy_entries',180,'a6be1a6249e102e05ff9c2078db12431'),
('economy_operations',55,'97a8a3f31cbb20d147661e40a4d693ae'),
('economy_state',1,'16065da199f4b5db4151b94848123965'),
('economy_transfers',50,'c32f462198027d96bf8fc003f80f86d7'),
('economy_versions',1,'9e37b510f2e6c8c100cbd2260cf46dd3'),
('hand_economy',49,'85b5a105f3595b700732e08486494083'),
('hands',49,'469190e6e861f9d643b7b226cf22ca3d'),
('lifecycle_config',1,'6f8b22869389293e429d072b097d33ef'),
('match_openings',21,'196ca7924e0133a904029e548155c557'),
('match_players',84,'a73c9381cb905c566ee7ab19d25696a4'),
('match_states',21,'8f92225aa4113129a56bdc88ab89b1df'),
('matches',21,'fdfd516b48c92b7372a919b92a85795a'),
('platform_matches',21,'7ccf1e99adce01362aa71b27031168d0'),
('player_profiles',6,'7ff6bb7e9edc3a80dc6c5944a381609c'),
('processed_actions',4941,'566563778a35525b69b61634d16c3ca0'),
('room_operations',0,'d41d8cd98f00b204e9800998ecf8427e'),
('room_resolution_log',0,'d41d8cd98f00b204e9800998ecf8427e'),
('room_resolutions',0,'d41d8cd98f00b204e9800998ecf8427e'),
('runtime_operations',5107,'ed54473c3444c128279653d0ba44ff2e'),
('runtime_players',7,'f6cb1693e980df1166315641224cc153'),
('runtime_records',8,'5fc2b53e675b6aedbe4440d60f101700');
do $$
declare item record; actual_rows bigint; actual_fingerprint text;
begin
  for item in select * from mahjong_cleanup_review loop
    execute format('select count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by md5(to_jsonb(t)::text)),'''')) from mahjong_clash.%I t',item.table_name) into actual_rows,actual_fingerprint;
    if actual_rows<>item.expected_rows or actual_fingerprint<>item.fingerprint then raise exception 'Cleanup inventory changed: %',item.table_name; end if;
  end loop;
  if exists(select 1 from public.joy8_matches where game_id='faaa45eb-7d7d-40b5-9081-3dd73482adfa' and state='open') then raise exception 'Mahjong financial match remains open'; end if;
  if exists(select 1 from mahjong_clash.room_operations) or exists(select 1 from mahjong_clash.room_resolutions) then raise exception 'Pending Mahjong recovery'; end if;
  if exists(select 1 from mahjong_clash.ai_accounts where locked_balance<>0) or exists(select 1 from mahjong_clash.ai_reservations where released_at is null) then raise exception 'AI funds remain reserved'; end if;
  if exists(select 1 from mahjong_clash.match_states where lease_expires_at>clock_timestamp()) then raise exception 'Mahjong lease remains active'; end if;
end $$;
alter table mahjong_clash.accounting_requests disable trigger immutable_accounting_requests;
alter table mahjong_clash.accounting_commits disable trigger immutable_accounting_commits;
alter table mahjong_clash.economy_operations disable trigger immutable_economy_operations;
alter table mahjong_clash.economy_entries disable trigger immutable_economy_entries;
alter table mahjong_clash.economy_transfers disable trigger immutable_economy_transfers;
alter table mahjong_clash.processed_actions disable trigger immutable_actions;
alter table mahjong_clash.hand_economy disable trigger immutable_hand_economy;
alter table mahjong_clash.match_openings disable trigger immutable_match_openings;
alter table mahjong_clash.runtime_operations disable trigger immutable_runtime_operations;
alter table mahjong_clash.room_resolution_log disable trigger immutable_room_resolution_log;
alter table mahjong_clash.match_players disable trigger seat_binding;
alter table mahjong_clash.hands disable trigger immutable_posted_hand;
delete from mahjong_clash.runtime_records;
delete from mahjong_clash.runtime_operations;
delete from mahjong_clash.runtime_players;
delete from mahjong_clash.room_resolution_log;
delete from mahjong_clash.room_resolutions;
delete from mahjong_clash.room_operations;
delete from mahjong_clash.processed_actions;
delete from mahjong_clash.accounting_commits;
delete from mahjong_clash.accounting_requests;
delete from mahjong_clash.economy_transfers;
delete from mahjong_clash.economy_entries;
delete from mahjong_clash.economy_operations;
delete from mahjong_clash.hand_economy;
delete from mahjong_clash.ai_reservations;
delete from mahjong_clash.match_states;
delete from mahjong_clash.match_players;
delete from mahjong_clash.match_openings;
delete from mahjong_clash.hands;
delete from mahjong_clash.platform_matches;
delete from mahjong_clash.matches;
delete from mahjong_clash.player_profiles;
delete from mahjong_clash.ai_accounts;
update mahjong_clash.economy_state set water=0,strength='normal',risk='normal';
alter table mahjong_clash.accounting_requests enable trigger immutable_accounting_requests;
alter table mahjong_clash.accounting_commits enable trigger immutable_accounting_commits;
alter table mahjong_clash.economy_operations enable trigger immutable_economy_operations;
alter table mahjong_clash.economy_entries enable trigger immutable_economy_entries;
alter table mahjong_clash.economy_transfers enable trigger immutable_economy_transfers;
alter table mahjong_clash.processed_actions enable trigger immutable_actions;
alter table mahjong_clash.hand_economy enable trigger immutable_hand_economy;
alter table mahjong_clash.match_openings enable trigger immutable_match_openings;
alter table mahjong_clash.runtime_operations enable trigger immutable_runtime_operations;
alter table mahjong_clash.room_resolution_log enable trigger immutable_room_resolution_log;
alter table mahjong_clash.match_players enable trigger seat_binding;
alter table mahjong_clash.hands enable trigger immutable_posted_hand;
do $$
declare item record; remaining bigint; actual_fingerprint text;
begin
  for item in select * from mahjong_cleanup_review loop
    execute format('select count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by md5(to_jsonb(t)::text)),'''')) from mahjong_clash.%I t',item.table_name) into remaining,actual_fingerprint;
    if item.table_name in ('economy_versions','lifecycle_config') then
      if actual_fingerprint<>item.fingerprint then raise exception 'Configuration changed: %',item.table_name; end if;
    elsif item.table_name<>'economy_state' and remaining<>0 then raise exception 'Cleanup incomplete: %',item.table_name;
    end if;
  end loop;
  if exists(select 1 from pg_trigger where tgrelid in(select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='mahjong_clash') and not tgisinternal and tgenabled<>'O') then raise exception 'Mahjong trigger was not restored'; end if;
end $$;
commit;
