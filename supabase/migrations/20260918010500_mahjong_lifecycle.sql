begin;

do $$begin
  if not exists(select 1 from pg_roles where rolname='mahjong_clash_lifecycle_owner') then
    create role mahjong_clash_lifecycle_owner nologin noinherit nosuperuser nobypassrls;
  end if;
end$$;
grant usage on schema mahjong_clash to mahjong_clash_lifecycle_owner;
grant mahjong_clash_lifecycle_owner to current_user with set true;
grant mahjong_clash_lifecycle_owner to current_user with inherit true;
grant create on schema mahjong_clash to mahjong_clash_lifecycle_owner;

create table mahjong_clash.lifecycle_config (
  singleton boolean primary key check(singleton),
  game_id uuid not null references public.games(id),
  rule_version text not null check(length(rule_version) between 1 and 80)
);
create table mahjong_clash.match_openings (
  match_id uuid primary key references mahjong_clash.matches(id),
  request jsonb not null check(jsonb_typeof(request)='object')
);
create trigger immutable_match_openings before update or delete on mahjong_clash.match_openings
  for each row execute function mahjong_clash.immutable_record();
alter table mahjong_clash.lifecycle_config enable row level security;
alter table mahjong_clash.match_openings enable row level security;

create function mahjong_clash.prepare_match(p_match uuid,p_owner uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c mahjong_clash.lifecycle_config%rowtype; prior jsonb; seat jsonb; i integer; lease jsonb;
begin
  if p_match is null or p_owner is null or jsonb_typeof(p_request) is distinct from 'object'
    or (p_request-array['format','stake','parent_match_id','seats'])<>'{}'::jsonb
    or coalesce(p_request->>'format','') not in ('hand','round','full')
    or coalesce(p_request->>'stake','') not in ('low','medium','high')
    or jsonb_typeof(p_request->'seats') is distinct from 'array' then raise exception 'MAHJONG_INVALID_OPENING'; end if;
  if jsonb_array_length(p_request->'seats')<>4 or mahjong_clash.has_credentials(p_request) then raise exception 'MAHJONG_INVALID_OPENING'; end if;
  select * into c from mahjong_clash.lifecycle_config where singleton;
  if not found then raise exception 'MAHJONG_LIFECYCLE_NOT_CONFIGURED'; end if;
  perform 1 from mahjong_clash.economy_state where singleton for update;
  if not found then raise exception 'MAHJONG_ECONOMY_NOT_CONFIGURED'; end if;
  select request into prior from mahjong_clash.match_openings where match_id=p_match;
  if found then
    if prior<>p_request then raise exception 'MAHJONG_OPENING_CONFLICT'; end if;
  else
    if p_request->>'parent_match_id' is not null and not exists(select 1 from mahjong_clash.matches parent
      where parent.id=(p_request->>'parent_match_id')::uuid and parent.game_id=c.game_id and parent.status in ('finished','voided','rematch-decision','rematch-backfill')
        and not exists(select 1 from mahjong_clash.match_players where match_id=parent.id and occupied)) then raise exception 'MAHJONG_PARENT_NOT_FINISHED'; end if;
    insert into mahjong_clash.matches(id,game_id,parent_match_id,match_format,stake_id,rule_version,protocol_version,snapshot_version)
      values(p_match,c.game_id,(p_request->>'parent_match_id')::uuid,p_request->>'format',p_request->>'stake',c.rule_version,4,7);
    for i in 0..3 loop
      seat:=p_request->'seats'->i;
      if jsonb_typeof(seat) is distinct from 'object' or jsonb_typeof(seat->'points') is distinct from 'number'
        or coalesce(seat->>'points','') !~ '^[0-9]+$' then raise exception 'MAHJONG_INVALID_SEAT'; end if;
      if (seat->>'points')::numeric not between mahjong_clash.entry_minimum(p_request->>'stake') and 9007199254740991 then raise exception 'MAHJONG_INVALID_POINTS'; end if;
      if seat->>'kind'='human' then
        if (seat-array['kind','player','session','wallet','points'])<>'{}'::jsonb then raise exception 'MAHJONG_INVALID_SEAT'; end if;
        insert into mahjong_clash.match_players(match_id,seat_index,participant_kind,player_account_id,game_session_id,wallet_account_id,control_mode,starting_points)
          values(p_match,i,'human',(seat->>'player')::uuid,(seat->>'session')::uuid,(seat->>'wallet')::uuid,'server',(seat->>'points')::bigint);
      elsif seat->>'kind'='ai' then
        if (seat-array['kind','ai','points'])<>'{}'::jsonb then raise exception 'MAHJONG_INVALID_SEAT'; end if;
        if not exists(select 1 from mahjong_clash.ai_accounts a where a.id=(seat->>'ai')::uuid and a.balance=(seat->>'points')::bigint
          and a.locked_balance=0 and a.cooldown_until is null
          and exists(select 1 from mahjong_clash.economy_operations where ai_account_id=a.id and kind='initial-funding')) then raise exception 'MAHJONG_AI_NOT_ELIGIBLE'; end if;
        insert into mahjong_clash.match_players(match_id,seat_index,participant_kind,ai_account_id,control_mode,starting_points)
          values(p_match,i,'ai',(seat->>'ai')::uuid,'ai',(seat->>'points')::bigint);
      else raise exception 'MAHJONG_INVALID_SEAT'; end if;
    end loop;
    if not exists(select 1 from mahjong_clash.match_players where match_id=p_match and participant_kind='human') then raise exception 'MAHJONG_HUMAN_REQUIRED'; end if;
    insert into mahjong_clash.match_states(match_id) values(p_match);
    insert into mahjong_clash.match_openings values(p_match,p_request);
  end if;
  lease:=mahjong_clash.claim_match(p_match,p_owner,30);
  return jsonb_build_object('lease',lease,'request',mahjong_clash.opening_request(p_match),
    'status',(select status from mahjong_clash.matches where id=p_match));
end;
$$;

create function mahjong_clash.lock_lifecycle(p_match uuid,p_owner uuid,p_fence bigint,p_revision bigint) returns void
language plpgsql set search_path='' as $$
declare s mahjong_clash.match_states%rowtype;
begin
  perform 1 from mahjong_clash.economy_state where singleton for update;
  perform 1 from mahjong_clash.matches where id=p_match for no key update;
  select * into strict s from mahjong_clash.match_states where match_id=p_match for update;
  if p_owner is null or p_fence is null or s.lease_owner is distinct from p_owner
    or s.lease_fence<>p_fence or s.lease_expires_at is null or s.lease_expires_at<=clock_timestamp() then raise exception 'MAHJONG_STALE_OWNER'; end if;
  if p_revision is null or s.revision<>p_revision then raise exception 'MAHJONG_STALE_REVISION'; end if;
end;
$$;

create function mahjong_clash.open_hand(p_match uuid,p_owner uuid,p_fence bigint,p_revision bigint,p_hand integer,p_dealer integer,p_step integer,p_repeats integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h mahjong_clash.hands%rowtype; binding mahjong_clash.platform_matches%rowtype; result jsonb;
begin
  perform mahjong_clash.lock_lifecycle(p_match,p_owner,p_fence,p_revision);
  select * into h from mahjong_clash.hands where match_id=p_match and hand_serial=p_hand;
  if found then
    if (h.dealer_seat,h.dealer_step,h.repeats) is distinct from (p_dealer,p_step,p_repeats) then raise exception 'MAHJONG_HAND_CONFLICT'; end if;
    select to_jsonb(e) into strict result from mahjong_clash.hand_economy e where match_id=p_match and hand_serial=p_hand;
  else
    select * into strict binding from mahjong_clash.platform_matches where match_id=p_match;
    if binding.status<>'open' or (select status from mahjong_clash.matches where id=p_match)<>'active'
      or p_hand is null or p_hand<>binding.settlement_count+1 then raise exception 'MAHJONG_HAND_SEQUENCE'; end if;
    insert into mahjong_clash.hands(match_id,hand_serial,dealer_seat,dealer_step,repeats,fee_version,strategy_by_seat)
      values(p_match,p_hand,p_dealer,p_step,p_repeats,'unbound','[null,null,null,null]');
    result:=mahjong_clash.open_hand_economy(p_match,p_hand);
  end if;
  return result||jsonb_build_object('fee_basis_points',(select fee_basis_points from mahjong_clash.economy_versions where version=result->>'version'));
end;
$$;

create function mahjong_clash.prepare_result(p_match uuid,p_owner uuid,p_fence bigint,p_revision bigint,p_hand integer,p_result jsonb) returns jsonb
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
      or p_result->'settlement' is distinct from '{"gain":0,"fee":0,"deltas":[0,0,0,0],"payments":[]}'::jsonb then raise exception 'MAHJONG_INVALID_VOID'; end if;
    request:=jsonb_build_object('version',1,'match_ref',p_match);
  else
    request:=mahjong_clash.prepare_hand_posting(p_match,p_hand);
  end if;
  return jsonb_build_object('action',case when p_result->>'type'='void' then 'cancel' else 'settle' end,'request',request);
end;
$$;

create function mahjong_clash.abandon_forming_match(p_match uuid,p_owner uuid,p_fence bigint,p_revision bigint) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform mahjong_clash.lock_lifecycle(p_match,p_owner,p_fence,p_revision);
  if exists(select 1 from mahjong_clash.platform_matches where match_id=p_match)
    or exists(select 1 from mahjong_clash.hands where match_id=p_match)
    or (select status from mahjong_clash.matches where id=p_match) not in ('forming','voided') then raise exception 'MAHJONG_OPENING_ALREADY_COMMITTED'; end if;
  update mahjong_clash.matches set status='voided',finished_at=coalesce(finished_at,clock_timestamp()) where id=p_match;
  update mahjong_clash.match_players set occupied=false where match_id=p_match;
end;
$$;

create function mahjong_clash.read_match(p_match uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('match',to_jsonb(m),'state',to_jsonb(s),'platform',to_jsonb(p),
    'seats',(select jsonb_agg(to_jsonb(seat) order by seat_index) from mahjong_clash.match_players seat where match_id=m.id),
    'hands',coalesce((select jsonb_agg(jsonb_build_object('hand',to_jsonb(h),'economy',to_jsonb(e),'request',r.request,'commit',to_jsonb(c)) order by h.hand_serial)
      from mahjong_clash.hands h left join mahjong_clash.hand_economy e using(match_id,hand_serial)
      left join mahjong_clash.accounting_requests r using(match_id,hand_serial)
      left join mahjong_clash.accounting_commits c using(match_id,hand_serial) where h.match_id=m.id),'[]'::jsonb))
  from mahjong_clash.matches m join mahjong_clash.match_states s on s.match_id=m.id
  left join mahjong_clash.platform_matches p on p.match_id=m.id where m.id=p_match;
$$;

create function mahjong_clash.resolve_looty_session(p_session uuid,p_player uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare binding record; seat record;
begin
  select s.id session_id,s.game_id,s.player_account_id,s.wallet_account_id into binding
    from public.game_sessions s join mahjong_clash.lifecycle_config c on c.singleton and c.game_id=s.game_id
    join public.wallet_accounts w on w.id=s.wallet_account_id and w.player_account_id=s.player_account_id
    join public.looty_wallet_policies p on p.id=w.wallet_policy_id and p.game_id=c.game_id
    where s.id=p_session and s.player_account_id=p_player and s.currency='POINT' and w.currency='POINT'
      and s.status='active' and s.expires_at>clock_timestamp() and s.launch_code_used_at is not null
      and s.gateway_token_hash is not null and s.gateway_token_scopes=array['balance']::text[] and w.status='active';
  if not found then raise exception 'MAHJONG_SESSION_BINDING_INVALID'; end if;
  perform public.looty_assert_player(p_player);
  select match_id,seat_index,wallet_account_id into seat from mahjong_clash.match_players
    where player_account_id=p_player and occupied;
  if found and seat.wallet_account_id<>binding.wallet_account_id then raise exception 'MAHJONG_SESSION_BINDING_INVALID'; end if;
  return jsonb_build_object('session_id',binding.session_id,'player_id',binding.player_account_id,
    'game_id',binding.game_id,'wallet_id',binding.wallet_account_id,
    'active_seat',case when seat.match_id is null then null else jsonb_build_object('match_id',seat.match_id,'seat_index',seat.seat_index) end);
end;
$$;

alter function mahjong_clash.guard_seat() security definer;
grant select,update on mahjong_clash.economy_state to mahjong_clash_lifecycle_owner;
grant select,insert,update on mahjong_clash.match_states,mahjong_clash.matches,mahjong_clash.match_players to mahjong_clash_lifecycle_owner;
grant select on mahjong_clash.lifecycle_config to mahjong_clash_lifecycle_owner;
grant select,insert on mahjong_clash.match_openings to mahjong_clash_lifecycle_owner;
grant select,insert,update on mahjong_clash.hands to mahjong_clash_lifecycle_owner;
grant select,insert on mahjong_clash.hand_economy,mahjong_clash.accounting_requests to mahjong_clash_lifecycle_owner;
grant select on mahjong_clash.platform_matches,mahjong_clash.accounting_commits,mahjong_clash.economy_operations,
  mahjong_clash.ai_accounts,mahjong_clash.ai_reservations,mahjong_clash.economy_versions to mahjong_clash_lifecycle_owner;
do $$declare t text; begin
  foreach t in array array['matches','match_players','match_states','hands','ai_accounts','lifecycle_config','match_openings'] loop
    execute format('create policy lifecycle_owner on mahjong_clash.%I to mahjong_clash_lifecycle_owner using(true) with check(true)',t);
  end loop;
end$$;
grant execute on function mahjong_clash.lock_lifecycle(uuid,uuid,bigint,bigint),mahjong_clash.open_hand_economy(uuid,integer),
  mahjong_clash.prepare_hand_posting(uuid,integer),mahjong_clash.hash_json(jsonb),mahjong_clash.has_credentials(jsonb),
  mahjong_clash.calculate_hand_economy(jsonb,jsonb,jsonb,text),mahjong_clash.entry_minimum(text),
  mahjong_clash.opening_request(uuid),mahjong_clash.claim_match(uuid,uuid,integer) to mahjong_clash_lifecycle_owner;
alter function mahjong_clash.prepare_match(uuid,uuid,jsonb) owner to mahjong_clash_lifecycle_owner;
alter function mahjong_clash.open_hand(uuid,uuid,bigint,bigint,integer,integer,integer,integer) owner to mahjong_clash_lifecycle_owner;
alter function mahjong_clash.prepare_result(uuid,uuid,bigint,bigint,integer,jsonb) owner to mahjong_clash_lifecycle_owner;
alter function mahjong_clash.abandon_forming_match(uuid,uuid,bigint,bigint) owner to mahjong_clash_lifecycle_owner;
alter function mahjong_clash.read_match(uuid) owner to mahjong_clash_lifecycle_owner;
revoke all on mahjong_clash.lifecycle_config,mahjong_clash.match_openings from public,anon,authenticated,service_role,mahjong_clash_server;
revoke execute on function mahjong_clash.prepare_match(uuid,uuid,jsonb),mahjong_clash.lock_lifecycle(uuid,uuid,bigint,bigint),
  mahjong_clash.open_hand(uuid,uuid,bigint,bigint,integer,integer,integer,integer),mahjong_clash.prepare_result(uuid,uuid,bigint,bigint,integer,jsonb),
  mahjong_clash.abandon_forming_match(uuid,uuid,bigint,bigint),mahjong_clash.read_match(uuid),mahjong_clash.resolve_looty_session(uuid,uuid)
  from public,anon,authenticated,service_role,mahjong_clash_server;
grant execute on function mahjong_clash.prepare_match(uuid,uuid,jsonb),
  mahjong_clash.open_hand(uuid,uuid,bigint,bigint,integer,integer,integer,integer),mahjong_clash.prepare_result(uuid,uuid,bigint,bigint,integer,jsonb),
  mahjong_clash.abandon_forming_match(uuid,uuid,bigint,bigint),mahjong_clash.read_match(uuid),mahjong_clash.resolve_looty_session(uuid,uuid) to mahjong_clash_server;

revoke create on schema mahjong_clash from mahjong_clash_lifecycle_owner;
grant mahjong_clash_lifecycle_owner to current_user with inherit false;
grant mahjong_clash_lifecycle_owner to current_user with set false;

commit;
