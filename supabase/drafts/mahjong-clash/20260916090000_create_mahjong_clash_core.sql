create schema if not exists mahjong_clash;

do $$
begin
  if not exists (
    select 1
    from pg_roles
    where rolname = 'mahjong_clash_server'
  ) then
    create role mahjong_clash_server nologin noinherit;
  end if;
end
$$;

revoke all on schema mahjong_clash from public, anon, authenticated, service_role;
grant usage on schema mahjong_clash to mahjong_clash_server;

create table mahjong_clash.player_profiles (
  player_account_id uuid primary key references public.player_accounts(id) on delete restrict,
  profile_version integer not null default 1 check (profile_version > 0),
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object'),
  matches_played bigint not null default 0 check (matches_played >= 0),
  hands_played bigint not null default 0 check (hands_played >= 0),
  wins bigint not null default 0 check (wins >= 0),
  self_draw_wins bigint not null default 0 check (self_draw_wins >= 0),
  discard_wins bigint not null default 0 check (discard_wins >= 0),
  deal_ins bigint not null default 0 check (deal_ins >= 0),
  draws bigint not null default 0 check (draws >= 0),
  net_points bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_played_at timestamptz,
  check (self_draw_wins + discard_wins <= wins)
);

create table mahjong_clash.matches (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete restrict,
  parent_match_id uuid references mahjong_clash.matches(id) on delete restrict,
  match_format text not null check (match_format in ('hand', 'round', 'full')),
  stake_id text not null check (stake_id in ('low', 'medium', 'high')),
  currency text not null default 'POINT' check (currency ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  base_score bigint not null check (base_score > 0),
  tai_score bigint not null check (tai_score > 0),
  minimum_entry bigint not null check (minimum_entry >= 0),
  continue_threshold bigint not null check (continue_threshold >= 0),
  initial_total bigint not null check (initial_total >= 0),
  rule_version text not null check (length(rule_version) between 1 and 80),
  protocol_version integer not null check (protocol_version > 0),
  snapshot_version integer not null check (snapshot_version > 0),
  status text not null default 'active' check (
    status in ('active', 'rematch-decision', 'rematch-backfill', 'finished', 'abandoned', 'voided')
  ),
  end_reason text check (end_reason is null or length(end_reason) between 1 and 80),
  final_result jsonb check (final_result is null or jsonb_typeof(final_result) = 'object'),
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index mahjong_clash_matches_status_updated_idx
  on mahjong_clash.matches (status, updated_at);

create index mahjong_clash_matches_parent_idx
  on mahjong_clash.matches (parent_match_id)
  where parent_match_id is not null;

create table mahjong_clash.match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references mahjong_clash.matches(id) on delete restrict,
  seat_index smallint not null check (seat_index between 0 and 3),
  participant_kind text not null check (participant_kind in ('human', 'ai')),
  control_mode text not null check (control_mode in ('human', 'server', 'ai')),
  player_account_id uuid references public.player_accounts(id) on delete restrict,
  game_session_id uuid references public.game_sessions(id) on delete restrict,
  display_name text not null check (length(display_name) between 1 and 80),
  starting_points bigint not null check (starting_points >= 0),
  ending_points bigint check (ending_points is null or ending_points >= 0),
  net_points bigint,
  presence_status text not null default 'seated' check (
    presence_status in ('seated', 'away', 'disconnected', 'left', 'completed')
  ),
  reconnect_token_hash text unique check (
    reconnect_token_hash is null or reconnect_token_hash ~ '^[0-9a-f]{64}$'
  ),
  reconnect_token_expires_at timestamptz,
  reconnect_token_rotated_at timestamptz,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (match_id, id),
  unique (match_id, seat_index),
  check (
    (participant_kind = 'human' and player_account_id is not null and game_session_id is not null and control_mode in ('human', 'server'))
    or
    (participant_kind = 'ai' and player_account_id is null and game_session_id is null and control_mode = 'ai')
  ),
  check (
    (reconnect_token_hash is null and reconnect_token_expires_at is null)
    or
    (participant_kind = 'human' and reconnect_token_hash is not null and reconnect_token_expires_at is not null)
  )
);

create unique index mahjong_clash_match_players_account_idx
  on mahjong_clash.match_players (match_id, player_account_id)
  where player_account_id is not null;

create unique index mahjong_clash_match_players_session_idx
  on mahjong_clash.match_players (match_id, game_session_id)
  where game_session_id is not null;

create unique index mahjong_clash_match_players_active_account_idx
  on mahjong_clash.match_players (player_account_id)
  where player_account_id is not null and presence_status in ('seated', 'away', 'disconnected');

create unique index mahjong_clash_match_players_active_session_idx
  on mahjong_clash.match_players (game_session_id)
  where game_session_id is not null and presence_status in ('seated', 'away', 'disconnected');

create table mahjong_clash.hands (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references mahjong_clash.matches(id) on delete restrict,
  hand_serial integer not null check (hand_serial > 0),
  dealer_seat_index smallint not null check (dealer_seat_index between 0 and 3),
  dealer_step integer not null check (dealer_step >= 0),
  repeats integer not null check (repeats >= 0),
  status text not null default 'active' check (
    status in ('active', 'finished', 'settling', 'settled', 'reconciliation-required', 'voided')
  ),
  result_type text check (result_type is null or result_type in ('win', 'draw', 'void')),
  winner_seat_index smallint check (winner_seat_index is null or winner_seat_index between 0 and 3),
  source_seat_index smallint check (source_seat_index is null or source_seat_index between 0 and 3),
  self_draw boolean,
  winning_tile text check (winning_tile is null or length(winning_tile) between 1 and 32),
  winning_source text check (winning_source is null or length(winning_source) between 1 and 80),
  authoritative_result jsonb check (
    authoritative_result is null or jsonb_typeof(authoritative_result) = 'object'
  ),
  scoring_output jsonb check (scoring_output is null or jsonb_typeof(scoring_output) = 'object'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  settled_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (match_id, id),
  unique (match_id, hand_serial),
  check (
    result_type <> 'win'
    or (winner_seat_index is not null and self_draw is not null)
  )
);

create index mahjong_clash_hands_match_status_idx
  on mahjong_clash.hands (match_id, status, hand_serial);

create table mahjong_clash.match_states (
  match_id uuid primary key references mahjong_clash.matches(id) on delete restrict,
  hand_id uuid,
  revision bigint not null check (revision >= 0),
  snapshot_version integer not null check (snapshot_version > 0),
  protocol_version integer not null check (protocol_version > 0),
  phase text not null check (
    phase in ('idle', 'await-discard', 'await-reactions', 'await-kong-reactions', 'hand-finished', 'match-finished')
  ),
  hand_serial integer not null check (hand_serial >= 0),
  action_window_id bigint not null check (action_window_id >= 0),
  next_action_window_id bigint not null check (next_action_window_id > action_window_id),
  state_hash text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  authoritative_snapshot jsonb not null check (jsonb_typeof(authoritative_snapshot) = 'object'),
  room_envelope jsonb not null check (jsonb_typeof(room_envelope) = 'object'),
  action_available_at timestamptz,
  action_deadline_at timestamptz,
  continuation_deadline_at timestamptz,
  rematch_decision_deadline_at timestamptz,
  next_system_action_at timestamptz,
  system_countdown_deadline_at timestamptz,
  opening_deadline_at timestamptz,
  lease_owner text check (lease_owner is null or length(lease_owner) between 1 and 160),
  lease_fence bigint not null default 0 check (lease_fence >= 0),
  lease_expires_at timestamptz,
  last_persisted_action_id text check (
    last_persisted_action_id is null or length(last_persisted_action_id) between 1 and 120
  ),
  updated_at timestamptz not null default now(),
  foreign key (match_id, hand_id) references mahjong_clash.hands(match_id, id) on delete restrict,
  check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  )
);

create index mahjong_clash_match_states_lease_idx
  on mahjong_clash.match_states (lease_expires_at)
  where lease_expires_at is not null;

alter table mahjong_clash.player_profiles enable row level security;
alter table mahjong_clash.matches enable row level security;
alter table mahjong_clash.match_players enable row level security;
alter table mahjong_clash.hands enable row level security;
alter table mahjong_clash.match_states enable row level security;

create policy mahjong_clash_server_player_profiles
  on mahjong_clash.player_profiles for all to mahjong_clash_server
  using (true) with check (true);

create policy mahjong_clash_server_matches
  on mahjong_clash.matches for all to mahjong_clash_server
  using (true) with check (true);

create policy mahjong_clash_server_match_players
  on mahjong_clash.match_players for all to mahjong_clash_server
  using (true) with check (true);

create policy mahjong_clash_server_hands
  on mahjong_clash.hands for all to mahjong_clash_server
  using (true) with check (true);

create policy mahjong_clash_server_match_states
  on mahjong_clash.match_states for all to mahjong_clash_server
  using (true) with check (true);

revoke all on all tables in schema mahjong_clash from public, anon, authenticated, service_role;
grant select, insert, update on mahjong_clash.player_profiles to mahjong_clash_server;
grant select, insert, update on mahjong_clash.matches to mahjong_clash_server;
grant select, insert, update on mahjong_clash.match_players to mahjong_clash_server;
grant select, insert, update on mahjong_clash.hands to mahjong_clash_server;
grant select, insert, update on mahjong_clash.match_states to mahjong_clash_server;
