create table mahjong_clash.processed_actions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references mahjong_clash.matches(id) on delete restrict,
  hand_id uuid,
  match_player_id uuid,
  action_id text not null check (length(action_id) between 1 and 120),
  actor_kind text not null check (actor_kind in ('human', 'ai', 'system')),
  action_window_id bigint not null check (action_window_id >= 0),
  request_revision bigint not null check (request_revision >= 0),
  committed_revision bigint not null check (committed_revision >= 0),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  decision text not null check (decision in ('accepted', 'rejected')),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  processed_at timestamptz not null default now(),
  unique (match_id, action_id),
  foreign key (match_id, hand_id) references mahjong_clash.hands(match_id, id) on delete restrict,
  foreign key (match_id, match_player_id) references mahjong_clash.match_players(match_id, id) on delete restrict,
  check (decision = 'rejected' or committed_revision >= request_revision),
  check (
    (actor_kind = 'system' and match_player_id is null)
    or (actor_kind in ('human', 'ai') and match_player_id is not null)
  )
);

create index mahjong_clash_processed_actions_hand_idx
  on mahjong_clash.processed_actions (match_id, hand_id, processed_at);

create index mahjong_clash_processed_actions_actor_idx
  on mahjong_clash.processed_actions (match_player_id, processed_at)
  where match_player_id is not null;

alter table mahjong_clash.processed_actions enable row level security;

create policy mahjong_clash_server_processed_actions
  on mahjong_clash.processed_actions for all to mahjong_clash_server
  using (true) with check (true);

revoke all on mahjong_clash.processed_actions from public, anon, authenticated, service_role;
grant select, insert on mahjong_clash.processed_actions to mahjong_clash_server;
