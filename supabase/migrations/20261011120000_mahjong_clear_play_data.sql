begin isolation level read committed;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local time zone interval '00:00' hour to minute;
do $$
begin
  if not pg_try_advisory_xact_lock(1296123978,1) then raise exception 'MAHJONG_CLEAR_AUTHORITY_RUNNING'; end if;
  if (select game_id from mahjong_clash.lifecycle_config where singleton) is distinct from 'faaa45eb-7d7d-40b5-9081-3dd73482adfa'::uuid then raise exception 'MAHJONG_CLEAR_GAME_CHANGED'; end if;
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
create temporary table mahjong_clear_review(table_name text primary key,expected_rows bigint,fingerprint text) on commit drop;
insert into mahjong_clear_review values
('accounting_commits',83,'e7829fffd4efff8d2dce9be3a657a8a6'),
('accounting_requests',83,'7f7fa0ca48776abfe43338e357d60d0e'),
('ai_accounts',6,'6eb210d13160e42fce22cf3a91b5a77a'),
('ai_reservations',165,'8d612b8f34feadce40472b6b31bef636'),
('economy_entries',348,'455c798bfdbaa9b06f2c5e465b6d40e6'),
('economy_operations',89,'be5d923401ee59e8dde39e4bbc55b04f'),
('economy_state',1,'3ed9f15792d771551ca5e0dd0c116ea9'),
('economy_transfers',104,'da053df90d6ee0d8ccd139bc5d79c34b'),
('economy_versions',1,'9e37b510f2e6c8c100cbd2260cf46dd3'),
('hand_economy',83,'806bc41010a924e32c17c9bc009e4d28'),
('hands',83,'a6cebcce7e6e35756fe71784fc80caeb'),
('lifecycle_config',1,'6f8b22869389293e429d072b097d33ef'),
('match_openings',55,'814d787a00879e0ab394163c1b9301a4'),
('match_players',220,'ae552c0b4f3e837b6e5b02ad27a4d865'),
('match_states',55,'2be5541793bf4f176cb88af26673792f'),
('matches',55,'19b7f4e09b6eb922f992ad3e616fac3f'),
('platform_matches',55,'dff7b963ea68d7c927d4e347f8131768'),
('player_profiles',7,'650a7c65b99bf753c6bce927d940bfab'),
('processed_actions',8229,'070db4c8f8b449449675c1cedcc02785'),
('room_operations',0,'d41d8cd98f00b204e9800998ecf8427e'),
('room_resolution_log',0,'d41d8cd98f00b204e9800998ecf8427e'),
('room_resolutions',0,'d41d8cd98f00b204e9800998ecf8427e'),
('runtime_operations',8556,'b0e83c4ef2f98770a5ff44113162e092'),
('runtime_players',7,'0b6a4e8b980d0432f904169b4d110402'),
('runtime_records',9,'738313947a022fa0164f5d6f775d63a6');
do $$
declare item record; actual_rows bigint; actual_fingerprint text;
begin
  for item in select * from mahjong_clear_review loop
    execute format('select count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by md5(to_jsonb(t)::text)),'''')) from mahjong_clash.%I t',item.table_name) into actual_rows,actual_fingerprint;
    if actual_rows<>item.expected_rows or actual_fingerprint<>item.fingerprint then raise exception 'MAHJONG_CLEAR_COUNTS_CHANGED' using detail=item.table_name; end if;
  end loop;
  if exists(select 1 from mahjong_clash.platform_matches where status='open')
    or exists(select 1 from mahjong_clash.matches where status not in ('finished','voided')) then raise exception 'MAHJONG_CLEAR_OPEN_MATCH'; end if;
  if exists(select 1 from mahjong_clash.room_operations) or exists(select 1 from mahjong_clash.room_resolutions) then raise exception 'MAHJONG_CLEAR_PENDING_RECOVERY'; end if;
  if exists(select 1 from mahjong_clash.ai_accounts where locked_balance<>0) or exists(select 1 from mahjong_clash.ai_reservations where released_at is null) then raise exception 'MAHJONG_CLEAR_AI_RESERVED'; end if;
  if exists(select 1 from mahjong_clash.match_states where lease_expires_at>clock_timestamp()) then raise exception 'MAHJONG_CLEAR_LEASE_ACTIVE'; end if;
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
  for item in select * from mahjong_clear_review loop
    execute format('select count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by md5(to_jsonb(t)::text)),'''')) from mahjong_clash.%I t',item.table_name) into remaining,actual_fingerprint;
    if item.table_name in ('economy_versions','lifecycle_config') then
      if actual_fingerprint<>item.fingerprint then raise exception 'MAHJONG_CLEAR_CONFIG_CHANGED' using detail=item.table_name; end if;
    elsif item.table_name<>'economy_state' and remaining<>0 then raise exception 'MAHJONG_CLEAR_INCOMPLETE' using detail=item.table_name;
    end if;
  end loop;
  if exists(select 1 from mahjong_clash.economy_state where singleton and (water<>0 or strength<>'normal' or risk<>'normal')) then raise exception 'MAHJONG_CLEAR_INCOMPLETE' using detail='economy_state'; end if;
  if exists(select 1 from pg_trigger where tgrelid in (select oid from pg_class where relnamespace='mahjong_clash'::regnamespace) and not tgisinternal and tgenabled<>'O') then raise exception 'MAHJONG_CLEAR_TRIGGER_NOT_RESTORED'; end if;
end $$;
select public.joy8_validate_product_adapters();
commit;
