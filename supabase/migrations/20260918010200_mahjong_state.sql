begin;

create schema mahjong_clash;
do $$
begin
  if not exists(select 1 from pg_roles where rolname='mahjong_clash_server') then
    create role mahjong_clash_server nologin noinherit;
  end if;
end;
$$;
revoke all on schema mahjong_clash from public,anon,authenticated,service_role;
grant usage on schema mahjong_clash to mahjong_clash_server;
alter default privileges in schema mahjong_clash revoke execute on functions from public;

create table mahjong_clash.ai_accounts (
  id uuid primary key,
  display_name text not null check(length(display_name) between 1 and 80),
  balance bigint not null default 0 check(balance>=0),
  locked_balance bigint not null default 0 check(locked_balance between 0 and balance),
  cooldown_until timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

create table mahjong_clash.matches (
  id uuid primary key,
  game_id uuid not null references public.games(id),
  parent_match_id uuid references mahjong_clash.matches(id),
  match_format text not null check(match_format in ('hand','round','full')),
  stake_id text not null check(stake_id in ('low','medium','high')),
  rule_version text not null check(length(rule_version) between 1 and 80),
  protocol_version integer not null check(protocol_version=4),
  snapshot_version integer not null check(snapshot_version=7),
  status text not null default 'forming' check(status in ('forming','active','rematch-decision','rematch-backfill','finished','voided')),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  check(parent_match_id is distinct from id)
);

create table mahjong_clash.match_players (
  match_id uuid not null references mahjong_clash.matches(id),
  seat_index smallint not null check(seat_index between 0 and 3),
  participant_kind text not null check(participant_kind in ('human','ai')),
  player_account_id uuid references public.player_accounts(id),
  game_session_id uuid references public.game_sessions(id),
  wallet_account_id uuid references public.wallet_accounts(id),
  ai_account_id uuid references mahjong_clash.ai_accounts(id),
  presence text not null default 'disconnected' check(presence in ('connected','away','disconnected','left')),
  control_mode text not null check(control_mode in ('human','server','ai')),
  occupied boolean not null default true,
  starting_points bigint not null check(starting_points>=0),
  reconnect_hash text unique check(reconnect_hash ~ '^[0-9a-f]{64}$'),
  reconnect_revoked_at timestamptz,
  reconnect_rotated_at timestamptz,
  primary key(match_id,seat_index),
  unique(match_id,player_account_id),
  unique(match_id,ai_account_id),
  check((participant_kind='human' and player_account_id is not null and game_session_id is not null and wallet_account_id is not null and ai_account_id is null and control_mode in ('human','server'))
    or (participant_kind='ai' and player_account_id is null and game_session_id is null and wallet_account_id is null and ai_account_id is not null and control_mode='ai')),
  check((reconnect_hash is null and reconnect_rotated_at is null)
    or (participant_kind='human' and reconnect_hash is not null and reconnect_revoked_at is null and reconnect_rotated_at is not null)),
  check(reconnect_revoked_at is null or participant_kind='human')
);
create unique index occupied_human on mahjong_clash.match_players(player_account_id) where occupied and participant_kind='human';
create unique index occupied_ai on mahjong_clash.match_players(ai_account_id) where occupied and participant_kind='ai';

create table mahjong_clash.hands (
  match_id uuid not null references mahjong_clash.matches(id),
  hand_serial integer not null check(hand_serial>0),
  dealer_seat smallint not null check(dealer_seat between 0 and 3),
  dealer_step integer not null check(dealer_step between 0 and 15),
  repeats integer not null check(repeats between 0 and 9),
  status text not null default 'active' check(status in ('active','settling','settled','voided')),
  result jsonb check(jsonb_typeof(result)='object'),
  fee_version text not null,
  strategy_by_seat jsonb not null check(jsonb_typeof(strategy_by_seat)='array' and jsonb_array_length(strategy_by_seat)=4),
  created_at timestamptz not null default clock_timestamp(),
  primary key(match_id,hand_serial)
);

create table mahjong_clash.match_states (
  match_id uuid primary key references mahjong_clash.matches(id),
  revision bigint not null default 0 check(revision>=0),
  hand_serial integer,
  action_window_id text,
  next_action_window_id bigint not null default 1 check(next_action_window_id>0),
  snapshot jsonb,
  envelope jsonb,
  state_hash text check(state_hash ~ '^[0-9a-f]{64}$'),
  lease_owner uuid,
  lease_fence bigint not null default 0 check(lease_fence>=0),
  lease_expires_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key(match_id,hand_serial) references mahjong_clash.hands(match_id,hand_serial),
  check(action_window_id is null or action_window_id ~ '^h[1-9][0-9]*-w[1-9][0-9]*$'),
  check((snapshot is null and envelope is null and state_hash is null and hand_serial is null and revision=0)
    or (jsonb_typeof(snapshot)='object' and jsonb_typeof(envelope)='object' and state_hash is not null and hand_serial is not null)),
  check((lease_owner is null)=(lease_expires_at is null))
);

create table mahjong_clash.processed_actions (
  match_id uuid not null references mahjong_clash.matches(id),
  action_id text not null check(length(action_id) between 1 and 120),
  actor_seat smallint check(actor_seat between 0 and 3),
  event_kind text not null check(event_kind in ('player','system')),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  request jsonb not null check(jsonb_typeof(request)='object'),
  previous_revision bigint not null check(previous_revision>=0),
  committed_revision bigint not null check(committed_revision=previous_revision+1),
  response jsonb not null check(jsonb_typeof(response)='object'),
  committed_at timestamptz not null default clock_timestamp(),
  primary key(match_id,action_id),
  unique(match_id,committed_revision),
  foreign key(match_id,actor_seat) references mahjong_clash.match_players(match_id,seat_index),
  check(event_kind='system' or actor_seat is not null)
);

create function mahjong_clash.hash_json(value jsonb) returns text
language sql immutable strict set search_path='' as $$
  select encode(sha256(convert_to(value::text,'UTF8')),'hex');
$$;

create function mahjong_clash.has_credentials(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item record;
begin
  if jsonb_typeof(value)='object' then
    for item in select * from jsonb_each(value) loop
      if lower(item.key) ~ '(token|secret|password|authorization|launch.?code|service.?role)'
        or mahjong_clash.has_credentials(item.value) then return true; end if;
    end loop;
  elsif jsonb_typeof(value)='array' then
    for item in select v from jsonb_array_elements(value) v loop
      if mahjong_clash.has_credentials(item.v) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;

create function mahjong_clash.guard_seat() returns trigger
language plpgsql set search_path='' as $$
declare m mahjong_clash.matches%rowtype;
begin
  select * into strict m from mahjong_clash.matches where id=coalesce(new.match_id,old.match_id) for update;
  if tg_op='DELETE' or (tg_op='UPDATE' and
    (new.match_id,new.seat_index,new.participant_kind,new.player_account_id,new.wallet_account_id,new.ai_account_id,new.starting_points)
    is distinct from (old.match_id,old.seat_index,old.participant_kind,old.player_account_id,old.wallet_account_id,old.ai_account_id,old.starting_points))
    or (tg_op='INSERT' and m.status<>'forming') then
    raise exception 'MAHJONG_SEAT_FIXED';
  end if;
  if new.participant_kind='human' and (tg_op='INSERT' or
    (new.player_account_id,new.game_session_id,new.wallet_account_id) is distinct from
    (old.player_account_id,old.game_session_id,old.wallet_account_id)) then
    if not exists(
      select 1 from public.game_sessions s join public.wallet_accounts w on w.id=s.wallet_account_id
      where s.id=new.game_session_id and s.game_id=m.game_id and s.player_account_id=new.player_account_id
        and s.wallet_account_id=new.wallet_account_id and w.player_account_id=new.player_account_id
    ) then raise exception 'MAHJONG_IDENTITY_MISMATCH'; end if;
  end if;
  if not new.occupied and m.status not in ('finished','voided','rematch-decision','rematch-backfill') then
    raise exception 'MAHJONG_OCCUPANCY_REQUIRED';
  end if;
  return new;
end;
$$;
create trigger seat_binding before insert or update or delete on mahjong_clash.match_players
  for each row execute function mahjong_clash.guard_seat();

create function mahjong_clash.guard_start() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.status='active' and (select count(*) from mahjong_clash.match_players where match_id=new.id and occupied)<>4 then
    raise exception 'MAHJONG_FOUR_SEATS_REQUIRED';
  end if;
  if tg_op='UPDATE' and old.status<>'forming' and
    (new.game_id,new.parent_match_id,new.match_format,new.stake_id,new.rule_version,new.protocol_version,new.snapshot_version)
    is distinct from (old.game_id,old.parent_match_id,old.match_format,old.stake_id,old.rule_version,old.protocol_version,old.snapshot_version) then
    raise exception 'MAHJONG_MATCH_FIXED';
  end if;
  return new;
end;
$$;
create trigger match_start before insert or update on mahjong_clash.matches
  for each row execute function mahjong_clash.guard_start();

create function mahjong_clash.immutable_record() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'MAHJONG_RECORD_IMMUTABLE';
end;
$$;
create trigger immutable_actions before update or delete on mahjong_clash.processed_actions
  for each row execute function mahjong_clash.immutable_record();

create function mahjong_clash.claim_match(p_match uuid,p_owner uuid,p_seconds integer default 30) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s mahjong_clash.match_states%rowtype; t timestamptz;
begin
  if p_owner is null or p_seconds is null or p_seconds not between 5 and 60 then raise exception 'MAHJONG_INVALID_LEASE'; end if;
  select * into strict s from mahjong_clash.match_states where match_id=p_match for update;
  t:=clock_timestamp();
  if s.lease_expires_at>t and s.lease_owner<>p_owner then raise exception 'MAHJONG_OWNER_BUSY'; end if;
  if s.lease_owner is distinct from p_owner or s.lease_expires_at<=t then s.lease_fence:=s.lease_fence+1; end if;
  update mahjong_clash.match_states set lease_owner=p_owner,lease_fence=s.lease_fence,lease_expires_at=t+make_interval(secs=>p_seconds)
    where match_id=p_match;
  return jsonb_build_object('fence',s.lease_fence,'revision',s.revision,'snapshot',s.snapshot,'envelope',s.envelope,'state_hash',s.state_hash);
end;
$$;

create function mahjong_clash.save_event(p_match uuid,p_owner uuid,p_fence bigint,p_revision bigint,p_event jsonb,p_snapshot jsonb,p_envelope jsonb) returns jsonb
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
    or p_envelope->'revision' is distinct from to_jsonb(p_revision+1)
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

revoke all on all tables in schema mahjong_clash from public,anon,authenticated,service_role,mahjong_clash_server;
revoke all on all functions in schema mahjong_clash from public,anon,authenticated,service_role,mahjong_clash_server;
grant execute on function mahjong_clash.claim_match(uuid,uuid,integer),mahjong_clash.save_event(uuid,uuid,bigint,bigint,jsonb,jsonb,jsonb) to mahjong_clash_server;
alter table mahjong_clash.ai_accounts enable row level security;
alter table mahjong_clash.matches enable row level security;
alter table mahjong_clash.match_players enable row level security;
alter table mahjong_clash.hands enable row level security;
alter table mahjong_clash.match_states enable row level security;
alter table mahjong_clash.processed_actions enable row level security;

commit;
