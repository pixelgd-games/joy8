begin;

lock table public.player_accounts,public.wallet_accounts,public.game_sessions,
  public.game_rounds,public.wallet_transactions in access exclusive mode;
do $$ begin
  if exists(select 1 from public.game_sessions where wallet_mode<>'demo') then
    raise exception 'LOOTY_RESET_REQUIRES_TEST_ONLY_DATA';
  end if;
  if exists(select 1 from public.wallet_accounts where locked_balance<>0) then
    raise exception 'LOOTY_RESET_HAS_OUTSTANDING_RESERVATIONS';
  end if;
  if exists(select 1 from pg_catalog.pg_constraint where contype='f'
    and confrelid in ('public.wallet_accounts'::regclass,'public.wallet_transactions'::regclass,
      'public.game_sessions'::regclass,'public.game_rounds'::regclass)
    and conrelid not in ('public.wallet_accounts'::regclass,'public.wallet_transactions'::regclass,
      'public.game_sessions'::regclass,'public.game_rounds'::regclass)) then
    raise exception 'LOOTY_RESET_HAS_EXTERNAL_DEPENDENCIES';
  end if;
end $$;

drop function public.wallet_bet(text,text,numeric,text,jsonb);
drop function public.wallet_payout(text,text,numeric,text,jsonb);
drop function public.wallet_refund(text,text,numeric,text,jsonb);
drop function public.close_game_round(text,text);
drop function public.looty_apply_wallet_transaction(text,text,text,numeric,text,jsonb);
drop function public.exchange_game_launch_code(text,integer);
drop function public.create_game_session(text,text,integer,text,uuid);
drop function public.looty_active_session(text,text);
drop trigger wallet_accounts_demo_initial_credit on public.wallet_accounts;
drop function public.record_demo_wallet_initial_credit();

delete from public.wallet_transactions;
delete from public.game_rounds;
delete from public.game_sessions;
delete from public.wallet_accounts;
drop table public.game_rounds;
alter table public.game_sessions drop column wallet_mode;
alter table public.wallet_accounts alter column balance set default 0;

create table public.looty_wallet_policies (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references public.games(id) on delete restrict,
  currency text not null default 'POINT' check (currency = 'POINT'),
  initial_credit numeric(18,2) not null default 0 check (initial_credit >= 0),
  enabled boolean not null default false,
  unique nulls not distinct (game_id, currency)
);

create table public.looty_game_policies (
  game_id uuid primary key references public.games(id) on delete restrict,
  wallet_policy_id uuid not null references public.looty_wallet_policies(id) on delete restrict,
  enabled boolean not null default false,
  max_entry_amount numeric(18,2) not null check (max_entry_amount > 0),
  max_participants integer not null default 16 check (max_participants between 1 and 64),
  product_adapter regprocedure,
  created_at timestamptz not null default now()
);

alter table public.wallet_accounts
  add column wallet_policy_id uuid not null references public.looty_wallet_policies(id) on delete restrict;

drop index public.wallet_accounts_active_currency_key;
create unique index wallet_accounts_identity_key on public.wallet_accounts
  (player_account_id,currency,wallet_policy_id);

alter table public.wallet_transactions
  add column source_type text,
  add column source_ref text;

create function public.looty_provision_wallet(p_player_id uuid, p_game_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_policy public.looty_wallet_policies%rowtype;
  v_wallet public.wallet_accounts%rowtype;
begin
  select p.* into v_policy from public.looty_wallet_policies p
  join public.looty_game_policies g on g.wallet_policy_id=p.id
  where g.game_id=p_game_id and g.enabled and p.enabled
    and (p.game_id is null or p.game_id=p_game_id) for share of p,g;
  if not found then raise exception 'LOOTY_GAME_NOT_READY' using errcode='42501'; end if;
  perform 1 from public.player_accounts p where p.id=p_player_id
    and p.status='active' and p.member_enrolled_at is not null for update;
  if not found then raise exception 'LOOTY_PLAYER_INACTIVE' using errcode='42501'; end if;
  select w.* into v_wallet from public.wallet_accounts w
  where w.player_account_id=p_player_id
    and w.wallet_policy_id=v_policy.id and w.currency=v_policy.currency for update;
  if found then
    if v_wallet.status <> 'active' then raise exception 'LOOTY_WALLET_INACTIVE' using errcode='42501'; end if;
    return v_wallet.id;
  end if;
  insert into public.wallet_accounts (player_account_id,currency,balance,wallet_policy_id)
  values (p_player_id,v_policy.currency,0,v_policy.id) returning * into v_wallet;
  if v_policy.initial_credit > 0 then
    update public.wallet_accounts set balance=v_policy.initial_credit where id=v_wallet.id;
    insert into public.wallet_transactions (
      wallet_account_id,type,amount,balance_before,balance_after,game_id,
      idempotency_key,source_type,source_ref
    ) values (
      v_wallet.id,'deposit',v_policy.initial_credit,0,v_policy.initial_credit,v_policy.game_id,
      'initial-grant:' || v_wallet.id::text,'initial_grant',v_policy.id::text
    );
  end if;
  return v_wallet.id;
end;
$$;

create table public.looty_backend_keys (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete restrict,
  key_hash text not null unique check (length(key_hash)=64),
  scopes text[] not null check (cardinality(scopes)>0 and scopes <@ array['exchange','renew','open','settle','status','cancel']::text[]),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create function public.looty_backend_game(p_secret text,p_scope text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_game uuid;
begin
  if p_secret is null or p_secret !~ '^[a-f0-9]{64}$' then
    raise exception 'LOOTY_BACKEND_UNAUTHORIZED' using errcode='28000';
  end if;
  select k.game_id into v_game from public.looty_backend_keys k
  where k.key_hash=public.looty_hash_secret(p_secret) and k.revoked_at is null
    and k.expires_at>clock_timestamp() and p_scope=any(k.scopes) for share;
  if not found then raise exception 'LOOTY_BACKEND_UNAUTHORIZED' using errcode='28000'; end if;
  return v_game;
end;
$$;

create table public.looty_matches (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete restrict,
  match_ref text not null check (length(match_ref) between 1 and 120),
  rule_version text not null check (length(rule_version) between 1 and 80),
  open_hash text not null,
  wallet_policy_id uuid not null references public.looty_wallet_policies(id),
  max_entry_amount numeric(18,2) not null,
  product_adapter regprocedure,
  product_participants jsonb not null default '[]'::jsonb,
  state text not null default 'open' check (state in ('open','settled','cancelled')),
  opened_at timestamptz not null default now(),
  finalized_at timestamptz,
  result jsonb,
  unique (game_id,match_ref)
);

create table public.looty_match_participants (
  match_id uuid not null references public.looty_matches(id) on delete restrict,
  player_account_id uuid not null references public.player_accounts(id) on delete restrict,
  wallet_account_id uuid not null references public.wallet_accounts(id) on delete restrict,
  game_session_id uuid not null references public.game_sessions(id) on delete restrict,
  reserved_amount numeric(18,2) not null check (reserved_amount > 0),
  released_at timestamptz,
  primary key(match_id,player_account_id),
  unique(match_id,wallet_account_id)
);
create unique index looty_one_active_match_per_wallet on public.looty_match_participants(wallet_account_id)
  where released_at is null;

create table public.looty_settlements (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.looty_matches(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete restrict,
  operation_key text not null check (length(operation_key) between 1 and 180),
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(game_id,operation_key)
);

create table public.looty_fee_accounts (
  game_id uuid primary key references public.games(id) on delete restrict,
  balance numeric(18,2) not null default 0 check (balance>=0)
);

create table public.looty_settlement_entries (
  settlement_id uuid not null references public.looty_settlements(id) on delete restrict,
  entry_index integer not null,
  kind text not null check (kind in ('player','product','fee')),
  account_ref text not null,
  amount numeric(18,2) not null check (amount<>0),
  source_type text not null check (source_type in ('gameplay','fee')),
  primary key(settlement_id,entry_index)
);

create function public.looty_reject_accounting_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'LOOTY_ACCOUNTING_IMMUTABLE' using errcode='42501';
end;
$$;
create trigger looty_settlements_immutable before update or delete on public.looty_settlements
for each row execute function public.looty_reject_accounting_change();
create trigger looty_settlement_entries_immutable before update or delete on public.looty_settlement_entries
for each row execute function public.looty_reject_accounting_change();

alter table public.looty_wallet_policies enable row level security;
alter table public.looty_game_policies enable row level security;
alter table public.looty_backend_keys enable row level security;
alter table public.looty_matches enable row level security;
alter table public.looty_match_participants enable row level security;
alter table public.looty_settlements enable row level security;
alter table public.looty_fee_accounts enable row level security;
alter table public.looty_settlement_entries enable row level security;
revoke all on public.looty_wallet_policies,public.looty_game_policies,public.looty_backend_keys,
  public.looty_matches,public.looty_match_participants,public.looty_settlements,
  public.looty_fee_accounts,public.looty_settlement_entries from public,anon,authenticated,service_role;
revoke all on function public.looty_provision_wallet(uuid,uuid),public.looty_backend_game(text,text),
  public.looty_reject_accounting_change()
  from public,anon,authenticated,service_role;

commit;
