begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
grant baccarat_owner to current_user with set true;
set local role baccarat_owner;

alter table baccarat.bets add column raised_through integer not null default 0 check (raised_through between 0 and 10);

create table baccarat.bet_raises (
  bet_id uuid not null references baccarat.bets(bet_id) on delete cascade,
  raise_no integer not null check (raise_no between 1 and 10),
  request_key text not null check (length(request_key) between 1 and 180),
  operation_key text not null unique check (length(operation_key) between 1 and 180),
  player_minor bigint not null default 0 check (player_minor between 0 and 1000000),
  banker_minor bigint not null default 0 check (banker_minor between 0 and 1000000),
  tie_minor bigint not null default 0 check (tie_minor between 0 and 1000000),
  player_pair_minor bigint not null default 0 check (player_pair_minor between 0 and 1000000),
  banker_pair_minor bigint not null default 0 check (banker_pair_minor between 0 and 1000000),
  lucky6_minor bigint not null default 0 check (lucky6_minor between 0 and 1000000),
  raise_minor bigint generated always as
    (player_minor + banker_minor + tie_minor + player_pair_minor + banker_pair_minor + lucky6_minor) stored,
  status text not null default 'pending' check (status in ('pending','applied','rejected','cancelling','cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (bet_id, raise_no),
  unique (bet_id, request_key),
  check (raise_minor between 100 and 1000000)
);
create unique index baccarat_one_unresolved_raise on baccarat.bet_raises(bet_id) where status in ('pending','cancelling');
create index baccarat_unresolved_raises on baccarat.bet_raises(created_at, bet_id, raise_no) where status in ('pending','cancelling');

alter table baccarat.gateway_operations drop constraint gateway_operations_bet_id_kind_key;
alter table baccarat.gateway_operations drop constraint gateway_operations_kind_check;
alter table baccarat.gateway_operations add column raise_no integer;
alter table baccarat.gateway_operations add constraint gateway_operations_kind_check
  check (kind in ('open','settle','cancel','reserve','reserve-cancel'));
alter table baccarat.gateway_operations add constraint gateway_operations_raise_check
  check ((kind in ('reserve','reserve-cancel')) = (raise_no is not null));
alter table baccarat.gateway_operations add constraint gateway_operations_raise_fkey
  foreign key (bet_id, raise_no) references baccarat.bet_raises(bet_id, raise_no) on delete cascade;
create unique index baccarat_one_bet_operation on baccarat.gateway_operations(bet_id, kind) where raise_no is null;
create unique index baccarat_one_raise_operation on baccarat.gateway_operations(bet_id, raise_no, kind) where raise_no is not null;
drop index baccarat.baccarat_one_final_operation;
create unique index baccarat_one_final_operation on baccarat.gateway_operations(bet_id) where kind in ('settle','cancel');

create function baccarat.guard_raise_insert() returns trigger
language plpgsql set search_path = '' as $$
declare bet_row baccarat.bets; round_row baccarat.rounds; table_row baccarat.tables;
begin
  select * into strict bet_row from baccarat.bets where bet_id = new.bet_id for update;
  select * into strict round_row from baccarat.rounds where round_id = bet_row.round_id;
  select * into strict table_row from baccarat.tables where table_id = round_row.table_id for share;
  select * into strict round_row from baccarat.rounds where round_id = bet_row.round_id for update;
  if not table_row.enabled or round_row.phase <> 'betting'
    or clock_timestamp() < round_row.opened_at or clock_timestamp() >= round_row.betting_closes_at then
    raise exception 'BACCARAT_BETTING_CLOSED';
  end if;
  if bet_row.status <> 'accepted' or new.status <> 'pending'
    or new.raise_no <> coalesce((select max(raise_no) from baccarat.bet_raises where bet_id = new.bet_id), 0) + 1
    or new.operation_key <> bet_row.match_ref || ':raise:' || new.raise_no then
    raise exception 'BACCARAT_INVALID_RAISE';
  end if;
  if bet_row.stake_minor + new.player_minor + new.banker_minor + new.tie_minor
    + new.player_pair_minor + new.banker_pair_minor + new.lucky6_minor > table_row.max_bet_minor then
    raise exception 'BACCARAT_BET_LIMIT';
  end if;
  return new;
end;
$$;

create or replace function baccarat.guard_update() returns trigger
language plpgsql set search_path = '' as $$
declare mutable text[]; amounts text[] := array['player_minor','banker_minor','tie_minor','player_pair_minor','banker_pair_minor','lucky6_minor'];
  raise_row baccarat.bet_raises; round_row baccarat.rounds; table_row baccarat.tables;
begin
  if tg_table_name = 'tables' then
    mutable := array['name','rule_version','min_bet_minor','max_bet_minor','max_payout_minor','revision','enabled'];
  elsif tg_table_name = 'rounds' then
    mutable := array['phase','result','finished_at'];
    if old.phase in ('result','void') and new is distinct from old then
      raise exception 'BACCARAT_FINAL_ROUND';
    end if;
    if old.phase = 'closing' and new.phase in ('dealing','void') and (exists (
      select 1 from baccarat.bets where round_id = old.round_id and status = 'opening'
    ) or exists (
      select 1 from baccarat.bet_raises r join baccarat.bets b using (bet_id)
      where b.round_id = old.round_id and r.status in ('pending','cancelling')
    )) then raise exception 'BACCARAT_RESERVATIONS_PENDING'; end if;
    if (old.result is not null and new.result is distinct from old.result)
      or (old.phase <> new.phase and not (
        (old.phase = 'betting' and new.phase = 'closing')
        or (old.phase = 'closing' and new.phase in ('dealing','void'))
        or (old.phase = 'dealing' and new.phase = 'result'))) then
      raise exception 'BACCARAT_ROUND_TRANSITION';
    end if;
  elsif tg_table_name = 'bets' then
    mutable := array['status','payout_minor','stake_minor'];
    if old.status in ('settled','rejected','voided') and new is distinct from old then
      raise exception 'BACCARAT_FINAL_BET';
    end if;
    if old.status <> new.status and not (
      (old.status = 'opening' and new.status in ('accepted','rejected','voiding'))
      or (old.status = 'accepted' and new.status in ('settling','voiding'))
      or (old.status = 'settling' and new.status = 'settled')
      or (old.status = 'voiding' and new.status = 'voided')) then
      raise exception 'BACCARAT_BET_TRANSITION';
    end if;
    if new.raised_through <> old.raised_through then
      mutable := mutable || amounts || array['raised_through'];
      select * into raise_row from baccarat.bet_raises where bet_id = new.bet_id and raise_no = new.raised_through;
      if old.status <> 'accepted' or new.status <> 'accepted' or new.raised_through <= old.raised_through
        or raise_row.status is distinct from 'applied'
        or new.player_minor <> old.player_minor + raise_row.player_minor
        or new.banker_minor <> old.banker_minor + raise_row.banker_minor
        or new.tie_minor <> old.tie_minor + raise_row.tie_minor
        or new.player_pair_minor <> old.player_pair_minor + raise_row.player_pair_minor
        or new.banker_pair_minor <> old.banker_pair_minor + raise_row.banker_pair_minor
        or new.lucky6_minor <> old.lucky6_minor + raise_row.lucky6_minor then
        raise exception 'BACCARAT_INVALID_RAISE';
      end if;
      select * into strict round_row from baccarat.rounds where round_id = new.round_id;
      select * into strict table_row from baccarat.tables where table_id = round_row.table_id for share;
      select * into strict round_row from baccarat.rounds where round_id = new.round_id for share;
      if round_row.phase <> 'betting' or clock_timestamp() >= round_row.betting_closes_at then
        raise exception 'BACCARAT_BETTING_CLOSED';
      end if;
      if new.stake_minor > table_row.max_bet_minor then raise exception 'BACCARAT_BET_LIMIT'; end if;
    end if;
  elsif tg_table_name = 'bet_raises' then
    mutable := array['status','raise_minor'];
    if old.status in ('applied','rejected','cancelled') and new is distinct from old then
      raise exception 'BACCARAT_FINAL_RAISE';
    end if;
    if old.status <> new.status and not (
      (old.status = 'pending' and new.status in ('applied','rejected','cancelling'))
      or (old.status = 'cancelling' and new.status = 'cancelled')) then
      raise exception 'BACCARAT_RAISE_TRANSITION';
    end if;
  else
    mutable := array['state','attempts','next_attempt_at','response','completed_at','last_error'];
    if old.state <> 'pending' and new is distinct from old then
      raise exception 'BACCARAT_FINAL_OPERATION';
    end if;
    if new.attempts < old.attempts then raise exception 'BACCARAT_ATTEMPT_REGRESSION'; end if;
  end if;
  if to_jsonb(new) - mutable is distinct from to_jsonb(old) - mutable then
    raise exception 'BACCARAT_IMMUTABLE_RECORD';
  end if;
  return new;
end;
$$;

create trigger baccarat_raise_admission before insert on baccarat.bet_raises for each row execute function baccarat.guard_raise_insert();
create trigger baccarat_raise_guard before update on baccarat.bet_raises for each row execute function baccarat.guard_update();

revoke execute on all functions in schema baccarat from public, anon, authenticated, service_role;

alter table baccarat.bet_raises enable row level security;
create policy baccarat_backend_access on baccarat.bet_raises to baccarat_backend using (true) with check (true);
grant select, insert, update on baccarat.bet_raises to baccarat_backend;

reset role;
grant baccarat_owner to current_user with set false;
select public.joy8_validate_product_adapters();
commit;
