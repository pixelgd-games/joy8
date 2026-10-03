begin;

create role baccarat_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create role baccarat_backend nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
grant baccarat_owner to current_user with set true;
grant baccarat_owner to current_user with inherit true;
create schema baccarat authorization baccarat_owner;
revoke all on schema baccarat from public, anon, authenticated, service_role;

set local role baccarat_owner;
alter default privileges in schema baccarat revoke execute on functions from public;

create table baccarat.tables (
  table_id text primary key check (table_id ~ '^baccarat(-[1-9][0-9]*)?$'),
  game_id uuid not null,
  name text not null check (length(name) between 1 and 80),
  rule_version text not null check (length(rule_version) between 1 and 80),
  min_bet_minor bigint not null check (min_bet_minor > 0 and min_bet_minor % 100 = 0),
  max_bet_minor bigint not null check (max_bet_minor between min_bet_minor and 1000000 and max_bet_minor % 100 = 0),
  max_payout_minor bigint not null check (max_payout_minor between max_bet_minor and 21000000),
  revision bigint not null default 0 check (revision >= 0),
  enabled boolean not null default false
);

create table baccarat.shoes (
  shoe_id text primary key check (length(shoe_id) between 1 and 120),
  table_id text not null references baccarat.tables(table_id),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  unique (table_id, shoe_id),
  check (retired_at is null or retired_at >= created_at)
);
create unique index baccarat_one_current_shoe on baccarat.shoes(table_id) where retired_at is null;

create table baccarat.rounds (
  round_id text primary key check (length(round_id) between 1 and 120),
  table_id text not null references baccarat.tables(table_id),
  serial bigint not null check (serial > 0),
  shoe_id text not null,
  rule_version text not null check (length(rule_version) between 1 and 80),
  phase text not null default 'betting' check (phase in ('betting','closing','dealing','result','void')),
  opened_at timestamptz not null,
  betting_closes_at timestamptz not null check (betting_closes_at > opened_at),
  result jsonb check (jsonb_typeof(result) = 'object'),
  finished_at timestamptz,
  unique (table_id, serial),
  foreign key (table_id, shoe_id) references baccarat.shoes(table_id, shoe_id),
  check ((phase in ('betting','closing') and result is null and finished_at is null)
    or (phase = 'dealing' and result is not null and finished_at is null)
    or (phase in ('result','void') and result is not null and finished_at is not null and finished_at >= betting_closes_at))
);
create unique index baccarat_one_active_round on baccarat.rounds(table_id) where finished_at is null;

create table baccarat.bets (
  bet_id uuid primary key,
  round_id text not null references baccarat.rounds(round_id),
  player_ref uuid not null,
  session_ref uuid not null,
  request_key text not null check (length(request_key) between 1 and 180),
  match_ref text not null unique check (length(match_ref) between 1 and 120),
  rule_version text not null check (length(rule_version) between 1 and 80),
  player_minor bigint not null default 0 check (player_minor between 0 and 1000000),
  banker_minor bigint not null default 0 check (banker_minor between 0 and 1000000),
  tie_minor bigint not null default 0 check (tie_minor between 0 and 1000000),
  player_pair_minor bigint not null default 0 check (player_pair_minor between 0 and 1000000),
  banker_pair_minor bigint not null default 0 check (banker_pair_minor between 0 and 1000000),
  lucky6_minor bigint not null default 0 check (lucky6_minor between 0 and 1000000),
  stake_minor bigint generated always as
    (player_minor + banker_minor + tie_minor + player_pair_minor + banker_pair_minor + lucky6_minor) stored,
  status text not null default 'opening' check (status in ('opening','accepted','settling','settled','rejected','voiding','voided')),
  payout_minor bigint check (payout_minor between 0 and 21000000),
  created_at timestamptz not null default clock_timestamp(),
  unique (player_ref, request_key),
  unique (player_ref, round_id),
  check (stake_minor between 1 and 1000000),
  check ((status = 'settled' and payout_minor is not null) or (status <> 'settled' and payout_minor is null))
);
create unique index baccarat_one_player_obligation on baccarat.bets(player_ref)
  where status in ('opening','accepted','settling','voiding');
create index baccarat_unfinished_bets on baccarat.bets(created_at, bet_id)
  where status in ('opening','accepted','settling','voiding');

create table baccarat.gateway_operations (
  operation_id bigint generated always as identity primary key,
  bet_id uuid not null references baccarat.bets(bet_id),
  kind text not null check (kind in ('open','settle','cancel')),
  request_text text not null check (octet_length(request_text) between 2 and 16384
    and jsonb_typeof(request_text::jsonb) = 'object'),
  state text not null default 'pending' check (state in ('pending','confirmed','rejected')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  response jsonb check (jsonb_typeof(response) = 'object'),
  last_error text check (last_error ~ '^[A-Z0-9_]{1,100}$'),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (bet_id, kind),
  check ((state = 'pending' and completed_at is null and response is null)
    or (state <> 'pending' and completed_at is not null and completed_at >= created_at and response is not null))
);
create unique index baccarat_one_final_operation on baccarat.gateway_operations(bet_id) where kind <> 'open';
create index baccarat_due_operations on baccarat.gateway_operations(next_attempt_at, operation_id) where state = 'pending';

create function baccarat.guard_bet_insert() returns trigger
language plpgsql set search_path = '' as $$
declare round_row baccarat.rounds; table_row baccarat.tables; stake bigint;
begin
  select * into strict round_row from baccarat.rounds where round_id = new.round_id;
  select * into strict table_row from baccarat.tables where table_id = round_row.table_id for share;
  select * into strict round_row from baccarat.rounds where round_id = new.round_id for update;
  stake := new.player_minor + new.banker_minor + new.tie_minor
    + new.player_pair_minor + new.banker_pair_minor + new.lucky6_minor;
  if not table_row.enabled or round_row.phase <> 'betting'
    or clock_timestamp() < round_row.opened_at or clock_timestamp() >= round_row.betting_closes_at then
    raise exception 'BACCARAT_BETTING_CLOSED';
  end if;
  if new.status <> 'opening' or new.payout_minor is not null
    or new.rule_version <> round_row.rule_version or new.rule_version <> table_row.rule_version then
    raise exception 'BACCARAT_INVALID_SUBMISSION';
  end if;
  if stake < table_row.min_bet_minor or stake > table_row.max_bet_minor then
    raise exception 'BACCARAT_BET_LIMIT';
  end if;
  return new;
end;
$$;

create function baccarat.guard_update() returns trigger
language plpgsql set search_path = '' as $$
declare mutable text[];
begin
  if tg_table_name = 'tables' then
    mutable := array['name','rule_version','min_bet_minor','max_bet_minor','max_payout_minor','revision','enabled'];
  elsif tg_table_name = 'rounds' then
    mutable := array['phase','result','finished_at'];
    if old.phase in ('result','void') and new is distinct from old then
      raise exception 'BACCARAT_FINAL_ROUND';
    end if;
    if old.phase = 'closing' and new.phase in ('dealing','void') and exists (
      select 1 from baccarat.bets where round_id = old.round_id and status = 'opening'
    ) then raise exception 'BACCARAT_RESERVATIONS_PENDING'; end if;
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
      (old.status = 'opening' and new.status in ('accepted','rejected'))
      or (old.status = 'accepted' and new.status in ('settling','voiding'))
      or (old.status = 'settling' and new.status = 'settled')
      or (old.status = 'voiding' and new.status = 'voided')) then
      raise exception 'BACCARAT_BET_TRANSITION';
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

create trigger baccarat_table_guard before update on baccarat.tables for each row execute function baccarat.guard_update();
create trigger baccarat_round_guard before update on baccarat.rounds for each row execute function baccarat.guard_update();
create trigger baccarat_bet_admission before insert on baccarat.bets for each row execute function baccarat.guard_bet_insert();
create trigger baccarat_bet_guard before update on baccarat.bets for each row execute function baccarat.guard_update();
create trigger baccarat_operation_guard before update on baccarat.gateway_operations for each row execute function baccarat.guard_update();

revoke execute on all functions in schema baccarat from public, anon, authenticated, service_role;

alter table baccarat.tables enable row level security;
alter table baccarat.shoes enable row level security;
alter table baccarat.rounds enable row level security;
alter table baccarat.bets enable row level security;
alter table baccarat.gateway_operations enable row level security;
create policy baccarat_backend_access on baccarat.tables to baccarat_backend using (true) with check (true);
create policy baccarat_backend_access on baccarat.shoes to baccarat_backend using (true) with check (true);
create policy baccarat_backend_access on baccarat.rounds to baccarat_backend using (true) with check (true);
create policy baccarat_backend_access on baccarat.bets to baccarat_backend using (true) with check (true);
create policy baccarat_backend_access on baccarat.gateway_operations to baccarat_backend using (true) with check (true);
grant usage on schema baccarat to baccarat_backend;
grant select, insert, update on all tables in schema baccarat to baccarat_backend;
grant usage on all sequences in schema baccarat to baccarat_backend;

reset role;
insert into public.joy8_product_schemas(schema_name) values ('baccarat');
grant baccarat_owner to current_user with inherit false;
grant baccarat_owner to current_user with set false;
select public.joy8_validate_product_adapters();
commit;
