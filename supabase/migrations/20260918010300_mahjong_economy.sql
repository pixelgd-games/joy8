begin;

create table mahjong_clash.economy_versions (
  version text primary key,
  initial_points bigint not null check(initial_points between 1 and 9007199254740991),
  cooldown_seconds integer not null check(cooldown_seconds>0),
  fee_basis_points integer not null check(fee_basis_points between 0 and 10000),
  strength_entry bigint not null check(strength_entry>0),
  strength_exit bigint not null check(strength_exit between 0 and strength_entry-1),
  warning_loss bigint not null check(warning_loss>=strength_entry),
  review_loss bigint not null check(review_loss>warning_loss)
);
insert into mahjong_clash.economy_versions values('economy-1',10000,1800,1000,10000,5000,20000,30000);
create trigger immutable_economy_versions before update or delete on mahjong_clash.economy_versions
  for each row execute function mahjong_clash.immutable_record();

create table mahjong_clash.economy_state (
  singleton boolean primary key check(singleton),
  environment text not null check(environment in ('local-test','operational')),
  version text not null references mahjong_clash.economy_versions(version),
  water bigint not null default 0,
  strength text not null default 'normal' check(strength in ('weak','normal','strong')),
  risk text not null default 'normal' check(risk in ('normal','warning','review'))
);

create table mahjong_clash.economy_operations (
  id text primary key check(length(id) between 1 and 120),
  kind text not null check(kind in ('initial-funding','top-up','hand')),
  environment text not null check(environment in ('local-test','operational')),
  version text not null references mahjong_clash.economy_versions(version),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null check(jsonb_typeof(response)='object'),
  match_id uuid,
  hand_serial integer,
  ai_account_id uuid references mahjong_clash.ai_accounts(id),
  created_at timestamptz not null default clock_timestamp(),
  created_transaction xid8 not null default pg_current_xact_id(),
  foreign key(match_id,hand_serial) references mahjong_clash.hands(match_id,hand_serial),
  unique(match_id,hand_serial),
  check((kind='hand' and match_id is not null and hand_serial is not null and ai_account_id is null)
    or (kind<>'hand' and match_id is null and hand_serial is null and ai_account_id is not null))
);
create unique index one_initial_ai_funding on mahjong_clash.economy_operations(ai_account_id) where kind='initial-funding';

create table mahjong_clash.economy_entries (
  operation_id text not null references mahjong_clash.economy_operations(id),
  entry_no integer not null check(entry_no>0),
  entry_kind text not null check(entry_kind in ('gross-transfer','winner-fee','initial-funding','top-up')),
  account_kind text not null check(account_kind in ('human','ai','funding-source','point-fee','test-fee','ai-internal-fee')),
  ai_account_id uuid references mahjong_clash.ai_accounts(id),
  match_id uuid,
  seat_index smallint,
  amount bigint not null check(amount<>0),
  primary key(operation_id,entry_no),
  foreign key(match_id,seat_index) references mahjong_clash.match_players(match_id,seat_index),
  check((account_kind='human' and ai_account_id is null and match_id is not null and seat_index is not null)
    or (account_kind='ai' and ai_account_id is not null and ((match_id is null and seat_index is null) or (match_id is not null and seat_index is not null)))
    or (account_kind not in ('human','ai') and ai_account_id is null and match_id is null and seat_index is null))
);

create table mahjong_clash.economy_transfers (
  operation_id text not null references mahjong_clash.economy_operations(id),
  transfer_no integer not null check(transfer_no>0),
  match_id uuid not null,
  payer_seat smallint not null,
  winner_seat smallint not null,
  required_amount bigint not null check(required_amount>=0),
  amount bigint not null check(amount between 0 and required_amount),
  primary key(operation_id,transfer_no),
  foreign key(match_id,payer_seat) references mahjong_clash.match_players(match_id,seat_index),
  foreign key(match_id,winner_seat) references mahjong_clash.match_players(match_id,seat_index),
  check(payer_seat<>winner_seat)
);

create table mahjong_clash.ai_reservations (
  match_id uuid not null,
  seat_index smallint not null,
  ai_account_id uuid not null references mahjong_clash.ai_accounts(id),
  opening_balance bigint not null check(opening_balance>=0),
  released_at timestamptz,
  primary key(match_id,seat_index),
  foreign key(match_id,seat_index) references mahjong_clash.match_players(match_id,seat_index)
);
create unique index reserved_ai on mahjong_clash.ai_reservations(ai_account_id) where released_at is null;

create table mahjong_clash.hand_economy (
  match_id uuid not null,
  hand_serial integer not null,
  version text not null references mahjong_clash.economy_versions(version),
  opening_balances jsonb not null check(jsonb_typeof(opening_balances)='array' and jsonb_array_length(opening_balances)=4),
  strategy_by_seat jsonb not null check(jsonb_typeof(strategy_by_seat)='array' and jsonb_array_length(strategy_by_seat)=4),
  primary key(match_id,hand_serial),
  foreign key(match_id,hand_serial) references mahjong_clash.hands(match_id,hand_serial)
);

create trigger immutable_economy_operations before update or delete on mahjong_clash.economy_operations
  for each row execute function mahjong_clash.immutable_record();
create trigger immutable_economy_entries before update or delete on mahjong_clash.economy_entries
  for each row execute function mahjong_clash.immutable_record();
create trigger immutable_economy_transfers before update or delete on mahjong_clash.economy_transfers
  for each row execute function mahjong_clash.immutable_record();
create trigger immutable_hand_economy before update or delete on mahjong_clash.hand_economy
  for each row execute function mahjong_clash.immutable_record();

create function mahjong_clash.guard_economy_append() returns trigger
language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from mahjong_clash.economy_operations where id=new.operation_id and created_transaction=pg_current_xact_id()) then raise exception 'MAHJONG_RECORD_IMMUTABLE'; end if;
  return new;
end;
$$;
create trigger current_operation_entries before insert on mahjong_clash.economy_entries
  for each row execute function mahjong_clash.guard_economy_append();
create trigger current_operation_transfers before insert on mahjong_clash.economy_transfers
  for each row execute function mahjong_clash.guard_economy_append();

create function mahjong_clash.guard_economy_environment() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' or new.environment is distinct from old.environment then raise exception 'MAHJONG_ENVIRONMENT_FIXED'; end if;
  return new;
end;
$$;
create trigger fixed_economy_environment before update or delete on mahjong_clash.economy_state
  for each row execute function mahjong_clash.guard_economy_environment();

create function mahjong_clash.entry_minimum(p_stake text) returns bigint
language sql immutable set search_path='' as $$
  select case p_stake when 'low' then 300 when 'medium' then 800 when 'high' then 3000 end::bigint;
$$;

create function mahjong_clash.next_ai_strength(p_water bigint,p_previous text,p_version text) returns text
language plpgsql stable set search_path='' as $$
declare v mahjong_clash.economy_versions%rowtype;
begin
  select * into strict v from mahjong_clash.economy_versions where version=p_version;
  if p_water is null or p_previous is null or p_previous not in ('normal','strong','weak') then raise exception 'MAHJONG_INVALID_STRENGTH'; end if;
  if p_water<=-v.strength_entry then return 'strong'; end if;
  if p_water>=v.strength_entry then return 'weak'; end if;
  if p_previous='strong' and p_water < -v.strength_exit then return 'strong'; end if;
  if p_previous='weak' and p_water > v.strength_exit then return 'weak'; end if;
  return 'normal';
end;
$$;

create function mahjong_clash.fund_ai(p_ai uuid,p_operation text) returns jsonb
language plpgsql set search_path='' as $$
declare s mahjong_clash.economy_state%rowtype; v mahjong_clash.economy_versions%rowtype;
  a mahjong_clash.ai_accounts%rowtype; prior mahjong_clash.economy_operations%rowtype;
  h text; k text; amount bigint; answer jsonb;
begin
  select * into strict s from mahjong_clash.economy_state where singleton for update;
  h:=mahjong_clash.hash_json(jsonb_build_object('fund',p_ai));
  select * into prior from mahjong_clash.economy_operations where id=p_operation;
  if found then
    if prior.request_hash<>h then raise exception 'MAHJONG_ECONOMY_CONFLICT'; end if;
    return prior.response;
  end if;
  select * into strict v from mahjong_clash.economy_versions where version=s.version;
  select * into strict a from mahjong_clash.ai_accounts where id=p_ai for update;
  if a.locked_balance<>0 or exists(select 1 from mahjong_clash.match_players where ai_account_id=p_ai and occupied)
    or exists(select 1 from mahjong_clash.ai_reservations where ai_account_id=p_ai and released_at is null) then raise exception 'MAHJONG_AI_OCCUPIED'; end if;
  if not exists(select 1 from mahjong_clash.economy_operations where ai_account_id=p_ai and kind='initial-funding') then
    if a.balance<>0 or a.cooldown_until is not null then raise exception 'MAHJONG_AI_NOT_NEW'; end if;
    k:='initial-funding';
  else
    if a.cooldown_until is null or a.cooldown_until>clock_timestamp() then raise exception 'MAHJONG_COOLDOWN_NOT_COMPLETE'; end if;
    k:='top-up';
  end if;
  amount:=greatest(0,v.initial_points-a.balance);
  answer:=jsonb_build_object('aiId',p_ai,'kind',k,'amount',amount,'balance',a.balance+amount);
  insert into mahjong_clash.economy_operations(id,kind,environment,version,request_hash,response,ai_account_id)
    values(p_operation,k,s.environment,s.version,h,answer,p_ai);
  if amount>0 then
    insert into mahjong_clash.economy_entries values
      (p_operation,1,k,'funding-source',null,null,null,-amount),(p_operation,2,k,'ai',p_ai,null,null,amount);
  end if;
  update mahjong_clash.ai_accounts set balance=a.balance+amount,cooldown_until=null where id=p_ai;
  return answer;
end;
$$;

create function mahjong_clash.reserve_match_ai(p_match uuid) returns void
language plpgsql set search_path='' as $$
declare m mahjong_clash.matches%rowtype; p record; a mahjong_clash.ai_accounts%rowtype; r mahjong_clash.ai_reservations%rowtype;
begin
  perform 1 from mahjong_clash.economy_state where singleton for update;
  if not found then raise exception 'MAHJONG_ECONOMY_NOT_CONFIGURED'; end if;
  select * into strict m from mahjong_clash.matches where id=p_match for update;
  if m.status<>'forming' or (select count(*) from mahjong_clash.match_players where match_id=p_match and occupied)<>4 then raise exception 'MAHJONG_RESERVATION_PHASE'; end if;
  for p in select * from mahjong_clash.match_players where match_id=p_match and participant_kind='ai' order by ai_account_id loop
    select * into strict a from mahjong_clash.ai_accounts where id=p.ai_account_id for update;
    select * into r from mahjong_clash.ai_reservations where match_id=p_match and seat_index=p.seat_index;
    if found then
      if r.released_at is not null or r.ai_account_id<>p.ai_account_id then raise exception 'MAHJONG_AI_RESERVATION_CLOSED'; end if;
      continue;
    end if;
    if a.cooldown_until is not null or a.locked_balance<>0 or a.balance<>p.starting_points
      or a.balance<mahjong_clash.entry_minimum(m.stake_id)
      or not exists(select 1 from mahjong_clash.economy_operations where ai_account_id=a.id and kind='initial-funding') then raise exception 'MAHJONG_AI_NOT_ELIGIBLE'; end if;
    insert into mahjong_clash.ai_reservations values(p_match,p.seat_index,a.id,a.balance,null);
    update mahjong_clash.ai_accounts set locked_balance=balance where id=a.id;
  end loop;
end;
$$;

create function mahjong_clash.open_hand_economy(p_match uuid,p_hand integer) returns jsonb
language plpgsql set search_path='' as $$
declare s mahjong_clash.economy_state%rowtype; m mahjong_clash.matches%rowtype; p record; h mahjong_clash.hands%rowtype;
  old mahjong_clash.hand_economy%rowtype; prior jsonb; balances jsonb:='[]'; strategies jsonb:='[]'; b bigint;
begin
  select * into strict s from mahjong_clash.economy_state where singleton for update;
  select * into strict m from mahjong_clash.matches where id=p_match for update;
  select * into old from mahjong_clash.hand_economy where match_id=p_match and hand_serial=p_hand;
  if found then return to_jsonb(old); end if;
  select * into strict h from mahjong_clash.hands where match_id=p_match and hand_serial=p_hand;
  if m.status<>'active' or h.status<>'active' then raise exception 'MAHJONG_HAND_NOT_ACTIVE'; end if;
  if p_hand>1 then
    select response into prior from mahjong_clash.economy_operations where match_id=p_match and hand_serial=p_hand-1;
    if not found or prior->>'type'='void' or coalesce(prior->>'endReason','')<>'' then raise exception 'MAHJONG_PREVIOUS_HAND_REQUIRED'; end if;
  end if;
  for p in select * from mahjong_clash.match_players where match_id=p_match order by seat_index loop
    b:=case when p_hand=1 then p.starting_points else (prior->'balances'->>p.seat_index)::bigint end;
    if b<0 or b>9007199254740991 or (p_hand=1 and b<mahjong_clash.entry_minimum(m.stake_id)) then raise exception 'MAHJONG_INVALID_POINTS'; end if;
    if p.participant_kind='ai' and not exists(select 1 from mahjong_clash.ai_reservations r join mahjong_clash.ai_accounts a on a.id=r.ai_account_id
      where r.match_id=p_match and r.seat_index=p.seat_index and r.released_at is null and a.balance=b and a.locked_balance=b) then raise exception 'MAHJONG_AI_RESERVATION_REQUIRED'; end if;
    balances:=balances||to_jsonb(b);
    strategies:=strategies||jsonb_build_array(case when p.participant_kind='ai' then s.strength else null end);
  end loop;
  if jsonb_array_length(balances)<>4 then raise exception 'MAHJONG_FOUR_SEATS_REQUIRED'; end if;
  insert into mahjong_clash.hand_economy values(p_match,p_hand,s.version,balances,strategies) returning * into old;
  update mahjong_clash.hands set fee_version=s.version,strategy_by_seat=strategies where match_id=p_match and hand_serial=p_hand;
  return to_jsonb(old);
end;
$$;

create function mahjong_clash.calculate_hand_economy(p_balances jsonb,p_kinds jsonb,p_result jsonb,p_version text) returns jsonb
language plpgsql stable set search_path='' as $$
declare v mahjong_clash.economy_versions%rowtype; balances bigint[]:='{}'; deltas bigint[]:=array[0,0,0,0];
  i integer; winner integer; payer integer; pay jsonb; payments jsonb:='[]'; required bigint; amount bigint;
  gross bigint:=0; fee bigint:=0; water bigint:=0; kinds text[]:='{}';
begin
  select * into strict v from mahjong_clash.economy_versions where version=p_version;
  if jsonb_typeof(p_balances) is distinct from 'array' or jsonb_array_length(p_balances)<>4
    or jsonb_typeof(p_kinds) is distinct from 'array' or jsonb_array_length(p_kinds)<>4
    or jsonb_typeof(p_result) is distinct from 'object' or coalesce(p_result->>'type','') not in ('win','draw','void')
    or jsonb_typeof(p_result->'payments') is distinct from 'array' then raise exception 'MAHJONG_INVALID_ECONOMY_RESULT'; end if;
  for i in 0..3 loop
    if jsonb_typeof(p_balances->i) is distinct from 'number' or p_balances->>i !~ '^[0-9]+$' or (p_balances->>i)::numeric>9007199254740991
      or coalesce(p_kinds->>i,'') not in ('human','ai') then raise exception 'MAHJONG_INVALID_POINTS'; end if;
    balances:=array_append(balances,(p_balances->>i)::bigint);
    kinds:=array_append(kinds,p_kinds->>i);
  end loop;
  if p_result->>'type'='win' then
    if jsonb_typeof(p_result->'winnerIndex') is distinct from 'number' or p_result->>'winnerIndex' !~ '^[0-3]$' then raise exception 'MAHJONG_INVALID_WINNER'; end if;
    winner:=(p_result->>'winnerIndex')::integer+1;
    if jsonb_array_length(p_result->'payments')=0 then raise exception 'MAHJONG_PAYMENT_REQUIRED'; end if;
    for pay in select value from jsonb_array_elements(p_result->'payments') loop
      if jsonb_typeof(pay) is distinct from 'object' or (pay-array['payerIndex','requiredAmount'])<>'{}'::jsonb
        or jsonb_typeof(pay->'payerIndex') is distinct from 'number' or coalesce(pay->>'payerIndex','') !~ '^[0-3]$'
        or jsonb_typeof(pay->'requiredAmount') is distinct from 'number' or coalesce(pay->>'requiredAmount','') !~ '^[0-9]+$'
        or (pay->>'requiredAmount')::numeric>9007199254740991 then raise exception 'MAHJONG_INVALID_PAYMENT'; end if;
      payer:=(pay->>'payerIndex')::integer+1;
      if payer=winner then raise exception 'MAHJONG_INVALID_PAYER'; end if;
      required:=(pay->>'requiredAmount')::bigint;
      amount:=least(required,balances[payer]);
      balances[payer]:=balances[payer]-amount;
      balances[winner]:=balances[winner]+amount;
      deltas[payer]:=deltas[payer]-amount;
      deltas[winner]:=deltas[winner]+amount;
      gross:=gross+amount;
      if kinds[payer]='human' and kinds[winner]='ai' then water:=water+amount; end if;
      if kinds[payer]='ai' and kinds[winner]='human' then water:=water-amount; end if;
      payments:=payments||jsonb_build_array(jsonb_build_object('payerIndex',payer-1,'requiredAmount',required,'amount',amount,'capped',amount<required));
    end loop;
    fee:=floor(gross::numeric*v.fee_basis_points/10000)::bigint;
    balances[winner]:=balances[winner]-fee;
    deltas[winner]:=deltas[winner]-fee;
  elsif jsonb_array_length(p_result->'payments')<>0 or p_result ? 'winnerIndex' then raise exception 'MAHJONG_NONWIN_TRANSFER'; end if;
  if gross>9007199254740991 or abs(water)>9007199254740991 or exists(select 1 from unnest(balances) b where b>9007199254740991) then raise exception 'MAHJONG_INVALID_POINTS'; end if;
  return jsonb_build_object('type',p_result->>'type','winnerIndex',winner-1,'balances',to_jsonb(balances),'deltas',to_jsonb(deltas),
    'payments',payments,'grossWin',gross,'winnerFee',fee,'netWin',gross-fee,'waterDelta',water,'feeVersion',p_version,'hasHuman','human'=any(kinds));
end;
$$;

create function mahjong_clash.post_hand_economy(p_match uuid,p_hand integer,p_operation text,p_result jsonb,p_end_reason text) returns jsonb
language plpgsql set search_path='' as $$
declare s mahjong_clash.economy_state%rowtype; v mahjong_clash.economy_versions%rowtype; m mahjong_clash.matches%rowtype;
  h mahjong_clash.hand_economy%rowtype; prior mahjong_clash.economy_operations%rowtype; p record; pay jsonb; answer jsonb; kinds jsonb;
  hash text; winner integer; n integer:=0; transfer integer:=0; fee_kind text; new_water bigint; result_kind text;
begin
  select * into strict s from mahjong_clash.economy_state where singleton for update;
  hash:=mahjong_clash.hash_json(jsonb_build_object('match',p_match,'hand',p_hand,'result',p_result,'endReason',p_end_reason));
  select * into prior from mahjong_clash.economy_operations where id=p_operation;
  if found then
    if prior.request_hash<>hash then raise exception 'MAHJONG_ECONOMY_CONFLICT'; end if;
    return prior.response;
  end if;
  select * into strict m from mahjong_clash.matches where id=p_match for update;
  if m.status<>'active' then raise exception 'MAHJONG_HAND_NOT_ACTIVE'; end if;
  if p_end_reason is null or p_end_reason not in ('','format-complete','insufficient-balance','unrecoverable-hand') then raise exception 'MAHJONG_INVALID_END_REASON'; end if;
  select * into strict h from mahjong_clash.hand_economy where match_id=p_match and hand_serial=p_hand;
  if exists(select 1 from mahjong_clash.economy_operations where match_id=p_match and hand_serial=p_hand) then raise exception 'MAHJONG_HAND_ALREADY_POSTED'; end if;
  if not exists(select 1 from mahjong_clash.hands where match_id=p_match and hand_serial=p_hand and status in ('active','settling')) then raise exception 'MAHJONG_HAND_NOT_ACTIVE'; end if;
  select jsonb_agg(participant_kind order by seat_index) into kinds from mahjong_clash.match_players where match_id=p_match;
  answer:=mahjong_clash.calculate_hand_economy(h.opening_balances,kinds,p_result,h.version);
  result_kind:=answer->>'type';
  if (result_kind='void')<>(p_end_reason='unrecoverable-hand') or (m.match_format='hand' and p_end_reason='') then raise exception 'MAHJONG_INVALID_END_REASON'; end if;
  if p_end_reason='' and exists(select 1 from jsonb_array_elements_text(answer->'balances') b
    where b::bigint < case m.stake_id when 'low' then 150 when 'medium' then 600 when 'high' then 2000 end) then raise exception 'MAHJONG_CONTINUATION_BALANCE'; end if;
  select * into strict v from mahjong_clash.economy_versions where version=s.version;
  new_water:=s.water+(answer->>'waterDelta')::bigint;
  answer:=answer||jsonb_build_object('endReason',p_end_reason,'waterAfter',new_water,'strengthAfter',
    case when result_kind='void' then s.strength else mahjong_clash.next_ai_strength(new_water,s.strength,s.version) end,
    'riskAfter',case when new_water<=-v.review_loss then 'review' when new_water<=-v.warning_loss then 'warning' else 'normal' end);
  insert into mahjong_clash.economy_operations(id,kind,environment,version,request_hash,response,match_id,hand_serial)
    values(p_operation,'hand',s.environment,h.version,hash,answer,p_match,p_hand);
  winner:=(answer->>'winnerIndex')::integer;
  for pay in select value from jsonb_array_elements(answer->'payments') loop
    transfer:=transfer+1;
    insert into mahjong_clash.economy_transfers values(p_operation,transfer,p_match,(pay->>'payerIndex')::smallint,winner::smallint,(pay->>'requiredAmount')::bigint,(pay->>'amount')::bigint);
    if (pay->>'amount')::bigint=0 then continue; end if;
    for p in select * from mahjong_clash.match_players where match_id=p_match and seat_index in (winner,(pay->>'payerIndex')::integer) order by seat_index loop
      n:=n+1;
      insert into mahjong_clash.economy_entries values(p_operation,n,'gross-transfer',p.participant_kind,p.ai_account_id,p_match,p.seat_index,
        (pay->>'amount')::bigint*case when p.seat_index=winner then 1 else -1 end);
    end loop;
  end loop;
  if (answer->>'winnerFee')::bigint>0 then
    select * into strict p from mahjong_clash.match_players where match_id=p_match and seat_index=winner;
    fee_kind:=case when not (answer->>'hasHuman')::boolean then 'ai-internal-fee' when s.environment='operational' then 'point-fee' else 'test-fee' end;
    insert into mahjong_clash.economy_entries values
      (p_operation,n+1,'winner-fee',p.participant_kind,p.ai_account_id,p_match,p.seat_index,-(answer->>'winnerFee')::bigint),
      (p_operation,n+2,'winner-fee',fee_kind,null,null,null,(answer->>'winnerFee')::bigint);
  end if;
  for p in select mp.*,a.balance,a.locked_balance from mahjong_clash.match_players mp join mahjong_clash.ai_accounts a on a.id=mp.ai_account_id
    where mp.match_id=p_match order by a.id for update of a loop
    if p.balance<>(h.opening_balances->>p.seat_index)::bigint or p.locked_balance<>p.balance
      or not exists(select 1 from mahjong_clash.ai_reservations where match_id=p_match and seat_index=p.seat_index and released_at is null) then raise exception 'MAHJONG_AI_BALANCE_CONFLICT'; end if;
    update mahjong_clash.ai_accounts set balance=(answer->'balances'->>p.seat_index)::bigint,locked_balance=(answer->'balances'->>p.seat_index)::bigint where id=p.ai_account_id;
  end loop;
  update mahjong_clash.economy_state set water=new_water,strength=answer->>'strengthAfter',risk=answer->>'riskAfter' where singleton;
  return answer;
end;
$$;

create function mahjong_clash.release_match_ai(p_match uuid) returns void
language plpgsql set search_path='' as $$
declare s mahjong_clash.economy_state%rowtype; v mahjong_clash.economy_versions%rowtype; m mahjong_clash.matches%rowtype; r record; ended timestamptz;
begin
  select * into strict s from mahjong_clash.economy_state where singleton for update;
  select * into strict v from mahjong_clash.economy_versions where version=s.version;
  select * into strict m from mahjong_clash.matches where id=p_match for update;
  if m.status not in ('finished','voided','rematch-decision','rematch-backfill') then raise exception 'MAHJONG_MATCH_NOT_ENDED'; end if;
  select created_at into ended from mahjong_clash.economy_operations where match_id=p_match order by hand_serial desc limit 1;
  if not found or not exists(select 1 from mahjong_clash.economy_operations where match_id=p_match and created_at=ended and response->>'endReason'<>'') then raise exception 'MAHJONG_FINAL_POST_REQUIRED'; end if;
  for r in select ar.*,a.balance from mahjong_clash.ai_reservations ar join mahjong_clash.ai_accounts a on a.id=ar.ai_account_id
    where ar.match_id=p_match and ar.released_at is null order by a.id for update of a loop
    update mahjong_clash.ai_accounts set locked_balance=0,cooldown_until=case when balance<mahjong_clash.entry_minimum(m.stake_id) then ended+make_interval(secs=>v.cooldown_seconds) else null end where id=r.ai_account_id;
    update mahjong_clash.ai_reservations set released_at=ended where match_id=p_match and seat_index=r.seat_index;
    update mahjong_clash.match_players set occupied=false where match_id=p_match and seat_index=r.seat_index;
  end loop;
end;
$$;

create view mahjong_clash.ai_reconciliation as
select a.id,a.balance,coalesce(sum(e.amount),0)::bigint ledger_balance,
  a.balance-coalesce(sum(e.amount),0)::bigint difference,
  coalesce(sum(e.amount) filter(where e.entry_kind in ('initial-funding','top-up')),0)::bigint funding,
  coalesce(sum(e.amount) filter(where e.entry_kind='gross-transfer'),0)::bigint gross_result,
  -coalesce(sum(e.amount) filter(where e.entry_kind='winner-fee'),0)::bigint fees
from mahjong_clash.ai_accounts a left join mahjong_clash.economy_entries e on e.ai_account_id=a.id and e.account_kind='ai' group by a.id;

create view mahjong_clash.economy_report as
select o.environment,m.stake_id,
  coalesce(sum(case when p.participant_kind='human' and w.participant_kind='ai' then t.amount
    when p.participant_kind='ai' and w.participant_kind='human' then -t.amount else 0 end),0)::bigint water,
  coalesce(sum(t.amount) filter(where p.participant_kind='ai' and w.participant_kind='ai'),0)::bigint ai_internal_volume,
  coalesce(sum(t.amount) filter(where p.participant_kind='human' and w.participant_kind='ai'),0)::bigint ai_receipts_from_humans,
  coalesce(sum(t.amount) filter(where p.participant_kind='ai' and w.participant_kind='human'),0)::bigint ai_payments_to_humans
from mahjong_clash.economy_transfers t join mahjong_clash.economy_operations o on o.id=t.operation_id
join mahjong_clash.matches m on m.id=t.match_id
join mahjong_clash.match_players p on (p.match_id,p.seat_index)=(t.match_id,t.payer_seat)
join mahjong_clash.match_players w on (w.match_id,w.seat_index)=(t.match_id,t.winner_seat)
group by o.environment,m.stake_id;

create view mahjong_clash.eligible_ai_accounts as
select a.id,a.display_name,a.balance,m.stake_id
from mahjong_clash.ai_accounts a cross join (values('low'),('medium'),('high')) m(stake_id)
where a.cooldown_until is null and a.locked_balance=0 and a.balance>=mahjong_clash.entry_minimum(m.stake_id)
  and exists(select 1 from mahjong_clash.economy_operations where ai_account_id=a.id and kind='initial-funding')
  and not exists(select 1 from mahjong_clash.match_players where ai_account_id=a.id and occupied)
  and not exists(select 1 from mahjong_clash.ai_reservations where ai_account_id=a.id and released_at is null);

create view mahjong_clash.fee_report as
select o.environment,m.stake_id,e.account_kind,sum(e.amount)::bigint amount
from mahjong_clash.economy_entries e join mahjong_clash.economy_operations o on o.id=e.operation_id
join mahjong_clash.matches m on m.id=o.match_id
where e.account_kind in ('point-fee','test-fee','ai-internal-fee')
group by o.environment,m.stake_id,e.account_kind;

create view mahjong_clash.ai_hand_results as
select o.environment,o.match_id,o.hand_serial,m.stake_id,p.ai_account_id,p.seat_index,
  h.strategy_by_seat->>p.seat_index strength,h.version,o.response->>'type' result_type,
  (o.response->>'winnerIndex')::integer=p.seat_index won,
  (o.response->'deltas'->>p.seat_index)::bigint net_points,
  (o.response->'balances'->>p.seat_index)::bigint closing_balance,o.created_at
from mahjong_clash.economy_operations o join mahjong_clash.matches m on m.id=o.match_id
join mahjong_clash.match_players p on p.match_id=o.match_id and p.participant_kind='ai'
join mahjong_clash.hand_economy h on (h.match_id,h.hand_serial)=(o.match_id,o.hand_serial)
where o.kind='hand';

create function mahjong_clash.check_economy_ledger() returns trigger
language plpgsql set search_path='' as $$
declare o mahjong_clash.economy_operations%rowtype; p record; delta numeric; expected_fee_kind text;
begin
  select * into strict o from mahjong_clash.economy_operations where id=case when tg_table_name='economy_operations' then to_jsonb(new)->>'id' else to_jsonb(new)->>'operation_id' end;
  if o.environment is distinct from (select environment from mahjong_clash.economy_state where singleton)
    or (select coalesce(sum(amount),0) from mahjong_clash.economy_entries where operation_id=o.id)<>0 then raise exception 'MAHJONG_LEDGER_UNBALANCED'; end if;
  if o.kind='hand' then
    if exists(select 1 from mahjong_clash.economy_entries e left join mahjong_clash.match_players mp on (mp.match_id,mp.seat_index)=(e.match_id,e.seat_index)
      where e.operation_id=o.id and (e.entry_kind not in ('gross-transfer','winner-fee') or (e.account_kind in ('human','ai') and
        (e.match_id is distinct from o.match_id or e.account_kind is distinct from mp.participant_kind or e.ai_account_id is distinct from mp.ai_account_id)))) then raise exception 'MAHJONG_LEDGER_BINDING'; end if;
    for p in select * from mahjong_clash.match_players where match_id=o.match_id loop
      select coalesce(sum(amount),0) into delta from mahjong_clash.economy_entries where operation_id=o.id and match_id=o.match_id and seat_index=p.seat_index;
      if delta is distinct from (o.response->'deltas'->>p.seat_index)::numeric then raise exception 'MAHJONG_LEDGER_DELTA'; end if;
      if (select coalesce(sum(amount),0) from mahjong_clash.economy_entries where operation_id=o.id and seat_index=p.seat_index and entry_kind='gross-transfer')
        is distinct from (select coalesce(sum(case when winner_seat=p.seat_index then amount when payer_seat=p.seat_index then -amount else 0 end),0)
          from mahjong_clash.economy_transfers where operation_id=o.id) then raise exception 'MAHJONG_GROSS_MISMATCH'; end if;
    end loop;
    if (select count(*) from mahjong_clash.economy_transfers where operation_id=o.id)<>jsonb_array_length(o.response->'payments')
      or exists(select 1 from mahjong_clash.economy_transfers t where t.operation_id=o.id and
        (t.match_id<>o.match_id or t.winner_seat<>(o.response->>'winnerIndex')::integer
          or t.payer_seat<>(o.response->'payments'->(t.transfer_no-1)->>'payerIndex')::integer
          or t.required_amount<>(o.response->'payments'->(t.transfer_no-1)->>'requiredAmount')::bigint
          or t.amount<>(o.response->'payments'->(t.transfer_no-1)->>'amount')::bigint)) then raise exception 'MAHJONG_TRANSFER_MISMATCH'; end if;
    if (select coalesce(sum(t.amount*case when payer.participant_kind='human' and w.participant_kind='ai' then 1
      when payer.participant_kind='ai' and w.participant_kind='human' then -1 else 0 end),0)
      from mahjong_clash.economy_transfers t join mahjong_clash.match_players payer on (payer.match_id,payer.seat_index)=(t.match_id,t.payer_seat)
      join mahjong_clash.match_players w on (w.match_id,w.seat_index)=(t.match_id,t.winner_seat) where t.operation_id=o.id)
      is distinct from (o.response->>'waterDelta')::numeric then raise exception 'MAHJONG_WATER_MISMATCH'; end if;
    expected_fee_kind:=case when not (o.response->>'hasHuman')::boolean then 'ai-internal-fee' when o.environment='operational' then 'point-fee' else 'test-fee' end;
    if (select coalesce(sum(amount),0) from mahjong_clash.economy_entries where operation_id=o.id and account_kind=expected_fee_kind)<>(o.response->>'winnerFee')::bigint
      or exists(select 1 from mahjong_clash.economy_entries where operation_id=o.id and account_kind not in ('human','ai',expected_fee_kind)) then raise exception 'MAHJONG_FEE_MISMATCH'; end if;
  else
    if exists(select 1 from mahjong_clash.economy_entries where operation_id=o.id and
      (entry_kind<>o.kind or match_id is not null or account_kind not in ('ai','funding-source') or (account_kind='ai' and ai_account_id<>o.ai_account_id))) then raise exception 'MAHJONG_FUNDING_BINDING'; end if;
    if (select coalesce(sum(amount),0) from mahjong_clash.economy_entries where operation_id=o.id and account_kind='ai')<>(o.response->>'amount')::bigint then raise exception 'MAHJONG_FUNDING_MISMATCH'; end if;
  end if;
  return null;
end;
$$;
create constraint trigger balanced_economy_operation after insert on mahjong_clash.economy_operations
  deferrable initially deferred for each row execute function mahjong_clash.check_economy_ledger();
create constraint trigger balanced_economy_entry after insert on mahjong_clash.economy_entries
  deferrable initially deferred for each row execute function mahjong_clash.check_economy_ledger();
create constraint trigger balanced_economy_transfer after insert on mahjong_clash.economy_transfers
  deferrable initially deferred for each row execute function mahjong_clash.check_economy_ledger();

revoke all on all tables in schema mahjong_clash from public,anon,authenticated,service_role,mahjong_clash_server;
revoke execute on function mahjong_clash.fund_ai(uuid,text),mahjong_clash.reserve_match_ai(uuid),
  mahjong_clash.open_hand_economy(uuid,integer),mahjong_clash.post_hand_economy(uuid,integer,text,jsonb,text),
  mahjong_clash.release_match_ai(uuid),mahjong_clash.calculate_hand_economy(jsonb,jsonb,jsonb,text),
  mahjong_clash.next_ai_strength(bigint,text,text),mahjong_clash.entry_minimum(text),mahjong_clash.guard_economy_environment(),mahjong_clash.check_economy_ledger(),mahjong_clash.guard_economy_append()
  from public,anon,authenticated,service_role,mahjong_clash_server;

commit;
