begin;

do $$
begin
  if exists(select 1 from mahjong_clash.matches) or exists(select 1 from mahjong_clash.ai_accounts)
    or exists(select 1 from mahjong_clash.processed_actions) or exists(select 1 from mahjong_clash.integration_pending)
    or exists(select 1 from mahjong_clash.local_runtime where coalesce(metadata->'sessions','{}'::jsonb)<>'{}'::jsonb
      or coalesce(metadata->'activeRooms','[]'::jsonb)<>'[]'::jsonb or coalesce(metadata->'rematchGroups','{}'::jsonb)<>'{}'::jsonb
      or coalesce(metadata->'economy'->'accounts','{}'::jsonb)<>'{}'::jsonb or coalesce(metadata->'economy'->'events','[]'::jsonb)<>'[]'::jsonb) then
    raise exception 'MAHJONG_PER_TABLE_STORAGE_REQUIRES_EMPTY_RUNTIME';
  end if;
end;
$$;

create or replace function mahjong_clash.save_event(p_match uuid,p_owner uuid,p_fence bigint,p_revision bigint,p_event jsonb,p_snapshot jsonb,p_envelope jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  s mahjong_clash.match_states%rowtype; m mahjong_clash.matches%rowtype;
  a mahjong_clash.processed_actions%rowtype; h text; result jsonb;
  hand_no integer; window_id text; next_window bigint; key text;
begin
  if p_owner is null or p_fence is null or p_revision is null then raise exception 'MAHJONG_STALE_OWNER'; end if;
  select * into strict s from mahjong_clash.match_states where match_id=p_match for update;
  if s.lease_owner is distinct from p_owner or s.lease_fence<>p_fence or s.lease_expires_at<=clock_timestamp() then
    raise exception 'MAHJONG_STALE_OWNER';
  end if;
  if jsonb_typeof(p_event) is distinct from 'object' or jsonb_typeof(p_event->'request') is distinct from 'object'
    or jsonb_typeof(p_event->'response') is distinct from 'object'
    or jsonb_typeof(p_event->'id') is distinct from 'string'
    or coalesce(p_event->>'kind','') not in ('player','system')
    or coalesce(length(p_event->>'id'),0) not between 1 and 120
    or (p_event-array['id','kind','seat','request','response'])<>'{}'::jsonb then raise exception 'MAHJONG_INVALID_EVENT'; end if;
  if (p_event->'seat' is not null and p_event->'seat'<>'null'::jsonb and
      (jsonb_typeof(p_event->'seat')<>'number' or p_event->>'seat' !~ '^[0-3]$'))
    or (p_event->>'kind'='player' and coalesce(p_event->>'seat','') !~ '^[0-3]$') then raise exception 'MAHJONG_INVALID_ACTOR'; end if;
  if mahjong_clash.has_credentials(p_event) or mahjong_clash.has_credentials(p_snapshot) or mahjong_clash.has_credentials(p_envelope) then
    raise exception 'MAHJONG_CREDENTIAL_IN_STATE';
  end if;
  h:=mahjong_clash.hash_json(p_event-array['response']);
  select * into a from mahjong_clash.processed_actions where match_id=p_match and action_id=p_event->>'id';
  if found then
    if a.request_hash<>h then raise exception 'MAHJONG_ACTION_CONFLICT'; end if;
    return jsonb_build_object('duplicate',true,'response',a.response,'committed_revision',a.committed_revision,'current_revision',s.revision);
  end if;
  if p_revision>=100000 then raise exception 'MAHJONG_ACTION_HISTORY_LIMIT'; end if;
  if s.revision<>p_revision then raise exception 'MAHJONG_STALE_REVISION'; end if;
  select * into strict m from mahjong_clash.matches where id=p_match;
  if m.status not in ('active','rematch-decision','rematch-backfill') and not (m.status in ('finished','voided') and p_snapshot->>'phase' in ('hand-finished','match-finished') and exists(select 1 from mahjong_clash.hands where match_id=p_match and hand_serial=(p_snapshot->>'hand_serial')::integer and status in ('settled','voided') and hands.result=p_snapshot->'result')) then raise exception 'MAHJONG_MATCH_NOT_ACTIVE'; end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object' or jsonb_typeof(p_envelope) is distinct from 'object'
    or p_snapshot->'version' is distinct from to_jsonb(m.snapshot_version)
    or p_snapshot->>'match_format' is distinct from m.match_format or p_snapshot->>'stake_id' is distinct from m.stake_id
    or coalesce(p_snapshot->>'phase','') not in ('await-discard','await-reactions','await-kong-reactions','hand-finished','match-finished')
    or jsonb_typeof(p_snapshot->'players') is distinct from 'array' or jsonb_array_length(p_snapshot->'players')<>4
    or jsonb_typeof(p_snapshot->'hand_serial') is distinct from 'number'
    or coalesce(p_snapshot->>'hand_serial','') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(p_envelope->'revision') is distinct from 'number'
    or p_envelope->>'roomId' is distinct from p_match::text
    or jsonb_typeof(p_envelope->'nextActionWindowId') is distinct from 'number'
    or coalesce(p_envelope->>'nextActionWindowId','') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(p_envelope->'actionWindowId') is distinct from 'string' then raise exception 'MAHJONG_INVALID_STATE'; end if;
  hand_no:=(p_snapshot->>'hand_serial')::integer;
  next_window:=(p_envelope->>'nextActionWindowId')::bigint;
  window_id:=nullif(p_envelope->>'actionWindowId','');
  if next_window<s.next_action_window_id then raise exception 'MAHJONG_INVALID_WINDOW'; end if;
  if window_id is not null and (window_id !~ ('^h'||hand_no||'-w[1-9][0-9]{0,8}$')
    or split_part(window_id,'-w',2)::bigint>=next_window
    or p_snapshot->>'phase' not in ('await-discard','await-reactions','await-kong-reactions')) then raise exception 'MAHJONG_INVALID_WINDOW'; end if;
  for key in select unnest(array['actionAvailableAt','actionDeadlineAt','continuationDeadlineAt','rematchDecisionDeadlineAt','nextSystemActionAt','systemCountdownDeadlineAt','openingDeadlineAt']) loop
    if not p_envelope ? key then raise exception 'MAHJONG_DEADLINE_REQUIRED'; end if;
    if p_envelope->key<>'null'::jsonb and (jsonb_typeof(p_envelope->key)<>'string'
      or p_envelope->>key !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$') then raise exception 'MAHJONG_INVALID_DEADLINE'; end if;
    if p_envelope->key<>'null'::jsonb then perform (p_envelope->>key)::timestamptz; end if;
  end loop;
  if not exists(select 1 from mahjong_clash.hands where match_id=p_match and hand_serial=hand_no) then raise exception 'MAHJONG_HAND_NOT_FOUND'; end if;
  if (s.hand_serial is null and hand_no<>1) or (s.hand_serial is not null and (hand_no<s.hand_serial or hand_no>s.hand_serial+1)) then raise exception 'MAHJONG_HAND_SEQUENCE'; end if;
  if hand_no>s.hand_serial and not exists(select 1 from mahjong_clash.hands where match_id=p_match and hand_serial=s.hand_serial and status='settled') then
    raise exception 'MAHJONG_PREVIOUS_HAND_UNSETTLED';
  end if;
  result:=jsonb_build_object('duplicate',false,'response',p_event->'response','committed_revision',p_revision+1,'current_revision',p_revision+1);
  insert into mahjong_clash.processed_actions(match_id,action_id,actor_seat,event_kind,request_hash,request,previous_revision,committed_revision,response)
    values(p_match,p_event->>'id',(p_event->>'seat')::smallint,p_event->>'kind',h,p_event->'request',p_revision,p_revision+1,p_event->'response');
  update mahjong_clash.match_states set revision=p_revision+1,hand_serial=hand_no,action_window_id=window_id,next_action_window_id=next_window,
    snapshot=p_snapshot,envelope=p_envelope,state_hash=mahjong_clash.hash_json(jsonb_build_object('snapshot',p_snapshot,'envelope',p_envelope)),updated_at=clock_timestamp()
    where match_id=p_match;
  return result;
end;
$$;

grant mahjong_clash_lifecycle_owner to current_user with set true;
grant mahjong_clash_lifecycle_owner to current_user with inherit true;
grant create on schema mahjong_clash to mahjong_clash_lifecycle_owner;

create or replace function mahjong_clash.prepare_result(p_match uuid,p_owner uuid,p_fence bigint,p_revision bigint,p_hand integer,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h mahjong_clash.hands%rowtype; request jsonb;
begin
  perform mahjong_clash.lock_lifecycle(p_match,p_owner,p_fence,p_revision);
  if jsonb_typeof(p_result) is distinct from 'object' or mahjong_clash.has_credentials(p_result)
    or coalesce(p_result->>'type','') not in ('win','draw','void') then raise exception 'MAHJONG_INVALID_RESULT'; end if;
  select * into strict h from mahjong_clash.hands where match_id=p_match and hand_serial=p_hand;
  if h.result is not null then
    if h.result<>p_result then raise exception 'MAHJONG_RESULT_CONFLICT'; end if;
  else
    if h.status<>'active' or not exists(select 1 from mahjong_clash.platform_matches
      where match_id=p_match and status='open' and settlement_count+1=p_hand) then raise exception 'MAHJONG_HAND_NOT_ACTIVE'; end if;
    update mahjong_clash.hands set result=p_result where match_id=p_match and hand_serial=p_hand;
  end if;
  if p_result->>'type'='void' then
    if p_result->>'endReason' is distinct from 'unrecoverable-hand'
      or (p_result->'settlement')-array['netGain','feeVersion'] is distinct from '{"gain":0,"fee":0,"deltas":[0,0,0,0],"payments":[]}'::jsonb
      or coalesce(p_result->'settlement'->'netGain','0'::jsonb)<>'0'::jsonb then raise exception 'MAHJONG_INVALID_VOID'; end if;
    request:=jsonb_build_object('version',1,'match_ref',p_match);
  else
    request:=mahjong_clash.prepare_hand_posting(p_match,p_hand);
  end if;
  return jsonb_build_object('action',case when p_result->>'type'='void' then 'cancel' else 'settle' end,'request',request);
end;
$$;

create function mahjong_clash.void_unposted_hand(p_match uuid,p_owner uuid,p_fence bigint,p_revision bigint,p_hand integer,p_result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare h mahjong_clash.hands%rowtype;
begin
  perform mahjong_clash.lock_lifecycle(p_match,p_owner,p_fence,p_revision);
  if jsonb_typeof(p_result) is distinct from 'object' or mahjong_clash.has_credentials(p_result)
    or p_result->>'type' is distinct from 'void' or p_result->>'endReason' is distinct from 'unrecoverable-hand'
    or (p_result->'settlement')-array['netGain','feeVersion'] is distinct from '{"gain":0,"fee":0,"deltas":[0,0,0,0],"payments":[]}'::jsonb
    or coalesce(p_result->'settlement'->'netGain','0'::jsonb)<>'0'::jsonb then raise exception 'MAHJONG_INVALID_VOID'; end if;
  select * into strict h from mahjong_clash.hands where match_id=p_match and hand_serial=p_hand for update;
  if h.status<>'active' or exists(select 1 from mahjong_clash.accounting_commits where match_id=p_match and hand_serial=p_hand)
    or not exists(select 1 from mahjong_clash.platform_matches where match_id=p_match and status='open' and settlement_count+1=p_hand) then raise exception 'MAHJONG_HAND_NOT_VOIDABLE'; end if;
  update mahjong_clash.hands set result=p_result where match_id=p_match and hand_serial=p_hand;
end;
$$;
alter function mahjong_clash.void_unposted_hand(uuid,uuid,bigint,bigint,integer,jsonb) owner to mahjong_clash_lifecycle_owner;
revoke execute on function mahjong_clash.void_unposted_hand(uuid,uuid,bigint,bigint,integer,jsonb) from public,anon,authenticated,service_role,mahjong_clash_server;
grant execute on function mahjong_clash.void_unposted_hand(uuid,uuid,bigint,bigint,integer,jsonb) to mahjong_clash_server;

revoke create on schema mahjong_clash from mahjong_clash_lifecycle_owner;
grant mahjong_clash_lifecycle_owner to current_user with inherit false;
grant mahjong_clash_lifecycle_owner to current_user with set false;

drop function mahjong_clash.lock_runtime_economy();
drop table mahjong_clash.integration_pending,mahjong_clash.integration_players,mahjong_clash.local_runtime;

create table mahjong_clash.runtime_players (
  player_id uuid primary key,
  session_id uuid not null,
  wallet_id uuid not null unique
);
create table mahjong_clash.runtime_records (
  kind text not null check(kind in ('lobby','session','group')),
  id text not null check(length(id) between 1 and 120),
  revision bigint not null check(revision>0),
  record jsonb not null check(jsonb_typeof(record)='object' and not mahjong_clash.has_credentials(record)),
  record_hash text not null,
  primary key(kind,id),
  check(record_hash=mahjong_clash.hash_json(record)),
  check(kind<>'lobby' or id='lobby')
);
create table mahjong_clash.runtime_operations (
  operation_id uuid primary key,
  scope text not null check(scope='lobby' or scope ~ '^room:[0-9a-f-]{36}$'),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null check(jsonb_typeof(response)='object'),
  committed_at timestamptz not null default clock_timestamp()
);
create trigger immutable_runtime_operations before update or delete on mahjong_clash.runtime_operations
  for each row execute function mahjong_clash.immutable_record();
create table mahjong_clash.room_operations (
  room_id uuid primary key,
  operation_id uuid not null unique,
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  request jsonb not null check(jsonb_typeof(request)='object' and not mahjong_clash.has_credentials(request)),
  created_at timestamptz not null default clock_timestamp(),
  check(request->>'roomId'=room_id::text and request->>'operationId'=operation_id::text)
);
create table mahjong_clash.room_resolutions (
  room_id uuid primary key,
  reason text not null check(reason ~ '^[a-z-]{1,40}$'),
  platform_status jsonb check(platform_status is null or jsonb_typeof(platform_status)='object'),
  queued_at timestamptz not null default clock_timestamp(),
  checked_at timestamptz not null default clock_timestamp(),
  approved_by text check(approved_by is null or length(approved_by) between 1 and 80),
  approved_at timestamptz,
  check((approved_by is null)=(approved_at is null))
);
create table mahjong_clash.room_resolution_log (
  id bigint generated always as identity primary key,
  room_id uuid not null,
  actor text not null check(length(actor) between 1 and 80),
  action text not null check(action in ('queued','approved','voided','failed')),
  platform_status jsonb check(platform_status is null or jsonb_typeof(platform_status)='object'),
  detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object' and not mahjong_clash.has_credentials(detail)),
  acted_at timestamptz not null default clock_timestamp()
);
create trigger immutable_room_resolution_log before update or delete on mahjong_clash.room_resolution_log
  for each row execute function mahjong_clash.immutable_record();

do $$begin
  if not exists(select 1 from pg_roles where rolname='mahjong_clash_operator') then
    create role mahjong_clash_operator nologin noinherit nosuperuser nobypassrls;
  end if;
end$$;
grant usage on schema mahjong_clash to mahjong_clash_operator;

create function mahjong_clash.operator_resolutions() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('room_id',q.room_id,'reason',q.reason,'platform_status',q.platform_status,
      'queued_at',q.queued_at,'checked_at',q.checked_at,'approved_by',q.approved_by,'approved_at',q.approved_at,
      'match',(select jsonb_build_object('format',m.match_format,'stake',m.stake_id,'status',m.status) from mahjong_clash.matches m where m.id=q.room_id),
      'platform',(select jsonb_build_object('status',p.status,'settlement_count',p.settlement_count) from mahjong_clash.platform_matches p where p.match_id=q.room_id),
      'hands',coalesce((select jsonb_agg(jsonb_build_object('hand',h.hand_serial,'status',h.status,'result',h.result->>'type') order by h.hand_serial)
        from mahjong_clash.hands h where h.match_id=q.room_id),'[]'::jsonb),
      'seats',coalesce((select jsonb_agg(jsonb_build_object('seat',s.seat_index,'kind',s.participant_kind,'account',coalesce(s.player_account_id,s.ai_account_id),'points',s.starting_points,'occupied',s.occupied) order by s.seat_index)
        from mahjong_clash.match_players s where s.match_id=q.room_id),'[]'::jsonb),
      'log',coalesce((select jsonb_agg(jsonb_build_object('actor',l.actor,'action',l.action,'at',l.acted_at,'detail',l.detail) order by l.id)
        from mahjong_clash.room_resolution_log l where l.room_id=q.room_id),'[]'::jsonb)) order by q.queued_at),'[]'::jsonb)
  from mahjong_clash.room_resolutions q;
$$;

create function mahjong_clash.approve_room_resolution(p_room uuid,p_operator text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q mahjong_clash.room_resolutions%rowtype;
begin
  if p_room is null or p_operator is null or length(trim(p_operator)) not between 1 and 80 then raise exception 'MAHJONG_INVALID_OPERATOR'; end if;
  select * into q from mahjong_clash.room_resolutions where room_id=p_room for update;
  if not found then raise exception 'MAHJONG_RESOLUTION_NOT_QUEUED'; end if;
  if q.approved_by is not null then raise exception 'MAHJONG_RESOLUTION_ALREADY_APPROVED'; end if;
  update mahjong_clash.room_resolutions set approved_by=trim(p_operator),approved_at=clock_timestamp() where room_id=p_room;
  insert into mahjong_clash.room_resolution_log(room_id,actor,action,platform_status,detail)
    values(p_room,trim(p_operator),'approved',q.platform_status,jsonb_build_object('reason',q.reason));
  return jsonb_build_object('room_id',p_room,'approved_by',trim(p_operator));
end;
$$;

create or replace function mahjong_clash.bind_runtime_identity(p_session uuid,p_player uuid) returns void
language plpgsql security definer set search_path='' as $$
declare binding jsonb;
begin
  binding:=mahjong_clash.resolve_joy8_session(p_session,p_player);
  insert into mahjong_clash.runtime_players values(p_player,p_session,(binding->>'wallet_id')::uuid)
    on conflict(player_id) do update set session_id=excluded.session_id,wallet_id=excluded.wallet_id;
end;
$$;

create or replace function mahjong_clash.runtime_balance(p_player uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('balance',(w.balance-w.locked_balance)::text,
      'total_balance',w.balance::text,'locked_balance',w.locked_balance::text,
      'match_id',case when r.match_id is not null then seat.match_id end,
      'reserved_balance',coalesce(r.reserved_amount,0)::text)
    from mahjong_clash.runtime_players b
    join public.wallet_accounts w on w.id=b.wallet_id and w.player_account_id=b.player_id
    join mahjong_clash.lifecycle_config c on c.singleton
    join public.joy8_game_policies g on g.game_id=c.game_id and g.wallet_policy_id=w.wallet_policy_id and g.enabled
    join public.joy8_wallet_policies p on p.id=w.wallet_policy_id and p.enabled
    left join mahjong_clash.match_players seat on seat.player_account_id=b.player_id
      and seat.wallet_account_id=w.id and seat.occupied
    left join mahjong_clash.platform_matches m on m.match_id=seat.match_id and m.status='open'
    left join public.joy8_match_participants r on r.match_id=m.platform_match_id
      and r.player_account_id=b.player_id and r.wallet_account_id=w.id and r.released_at is null
    where b.player_id=p_player and w.currency='POINT' and w.status='active';
$$;

create or replace function mahjong_clash.runtime_readiness() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',3,'game_id',c.game_id,'environment',e.environment,
    'continuous',exists(select 1 from information_schema.columns where table_schema='public' and table_name='joy8_matches' and column_name='settlement_count'),
    'wallet_enabled',w.enabled,'game_enabled',p.enabled,'adapter',p.product_adapter::text,
    'pending',exists(select 1 from mahjong_clash.room_operations))
  from mahjong_clash.lifecycle_config c cross join mahjong_clash.economy_state e
    join public.joy8_game_policies p on true
    join public.joy8_wallet_policies w on w.id=p.wallet_policy_id
  where c.singleton and e.singleton and p.game_id=c.game_id;
$$;

revoke all on mahjong_clash.runtime_players,mahjong_clash.runtime_records,mahjong_clash.runtime_operations,mahjong_clash.room_operations,
  mahjong_clash.room_resolutions,mahjong_clash.room_resolution_log
  from public,anon,authenticated,service_role,mahjong_clash_server,mahjong_clash_operator;
grant select on mahjong_clash.runtime_players to mahjong_clash_server;
grant select,insert,update,delete on mahjong_clash.runtime_records to mahjong_clash_server;
grant select,insert on mahjong_clash.runtime_operations to mahjong_clash_server;
grant select,insert,update,delete on mahjong_clash.room_operations to mahjong_clash_server;
grant select,insert,update,delete on mahjong_clash.room_resolutions to mahjong_clash_server;
grant select,insert on mahjong_clash.room_resolution_log to mahjong_clash_server;
create policy runtime_read on mahjong_clash.match_openings for select to mahjong_clash_server using(true);
revoke all on function mahjong_clash.operator_resolutions(),mahjong_clash.approve_room_resolution(uuid,text)
  from public,anon,authenticated,service_role,mahjong_clash_server;
grant execute on function mahjong_clash.operator_resolutions(),mahjong_clash.approve_room_resolution(uuid,text) to mahjong_clash_operator;
revoke all on function mahjong_clash.bind_runtime_identity(uuid,uuid),mahjong_clash.runtime_balance(uuid),mahjong_clash.runtime_readiness()
  from public,anon,authenticated,service_role,mahjong_clash_server;
grant execute on function mahjong_clash.bind_runtime_identity(uuid,uuid),mahjong_clash.runtime_balance(uuid),mahjong_clash.runtime_readiness() to mahjong_clash_server;

select public.joy8_validate_product_adapters();

commit;
