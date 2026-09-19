-- Review-only Mahjong settlement records. Joy8's current Demo POINT wallet is
-- shared by player/currency; do not use these records for Mahjong wallet
-- settlement until Joy8 implements and validates game-scoped wallet resolution.
create table mahjong_clash.settlements (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references mahjong_clash.matches(id) on delete restrict,
  hand_id uuid not null unique,
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 160),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  rule_version text not null check (length(rule_version) between 1 and 80),
  status text not null default 'pending' check (
    status in ('pending', 'committed', 'failed', 'reconciliation-required', 'voided')
  ),
  total_debit numeric(18, 2) not null default 0 check (total_debit >= 0),
  total_credit numeric(18, 2) not null default 0 check (total_credit >= 0),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  response_payload jsonb check (response_payload is null or jsonb_typeof(response_payload) = 'object'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text check (last_error_code is null or length(last_error_code) between 1 and 80),
  last_error_detail jsonb check (last_error_detail is null or jsonb_typeof(last_error_detail) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (match_id, id),
  foreign key (match_id, hand_id) references mahjong_clash.hands(match_id, id) on delete restrict,
  check (total_debit = total_credit),
  check (
    (status = 'committed' and committed_at is not null)
    or status <> 'committed'
  )
);

create index mahjong_clash_settlements_status_idx
  on mahjong_clash.settlements (status, updated_at);

create table mahjong_clash.settlement_entries (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references mahjong_clash.matches(id) on delete restrict,
  settlement_id uuid not null,
  match_player_id uuid not null,
  player_account_id uuid not null references public.player_accounts(id) on delete restrict,
  game_session_id uuid not null references public.game_sessions(id) on delete restrict,
  wallet_account_id uuid not null references public.wallet_accounts(id) on delete restrict,
  seat_index smallint not null check (seat_index between 0 and 3),
  delta_amount numeric(18, 2) not null check (delta_amount <> 0 and delta_amount = trunc(delta_amount)),
  debit_amount numeric(18, 2) not null default 0 check (debit_amount >= 0),
  credit_amount numeric(18, 2) not null default 0 check (credit_amount >= 0),
  balance_before numeric(18, 2),
  balance_after numeric(18, 2),
  wallet_transaction_id uuid unique references public.wallet_transactions(id) on delete restrict,
  status text not null default 'pending' check (
    status in ('pending', 'committed', 'failed', 'reconciliation-required', 'voided')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (settlement_id, match_player_id),
  unique (settlement_id, seat_index),
  foreign key (match_id, settlement_id) references mahjong_clash.settlements(match_id, id) on delete restrict,
  foreign key (match_id, match_player_id) references mahjong_clash.match_players(match_id, id) on delete restrict,
  check (credit_amount - debit_amount = delta_amount),
  check (
    (delta_amount > 0 and credit_amount > 0 and debit_amount = 0)
    or (delta_amount < 0 and debit_amount > 0 and credit_amount = 0)
  ),
  check (
    (status = 'committed' and wallet_transaction_id is not null and balance_before is not null and balance_after is not null)
    or status <> 'committed'
  )
);

create index mahjong_clash_settlement_entries_wallet_idx
  on mahjong_clash.settlement_entries (wallet_account_id, created_at);

create index mahjong_clash_settlement_entries_session_idx
  on mahjong_clash.settlement_entries (game_session_id, created_at);

alter table mahjong_clash.settlements enable row level security;
alter table mahjong_clash.settlement_entries enable row level security;

create policy mahjong_clash_server_settlements
  on mahjong_clash.settlements for all to mahjong_clash_server
  using (true) with check (true);

create policy mahjong_clash_server_settlement_entries
  on mahjong_clash.settlement_entries for all to mahjong_clash_server
  using (true) with check (true);

revoke all on mahjong_clash.settlements from public, anon, authenticated, service_role;
revoke all on mahjong_clash.settlement_entries from public, anon, authenticated, service_role;
grant select, insert, update on mahjong_clash.settlements to mahjong_clash_server;
grant select, insert, update on mahjong_clash.settlement_entries to mahjong_clash_server;
