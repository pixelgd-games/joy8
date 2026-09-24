begin;

lock table public.player_accounts, public.wallet_accounts, public.wallet_transactions,
  public.joy8_wallet_policies in share row exclusive mode;

do $$
begin
  if (select count(*) from public.joy8_wallet_policies) <> 1
    or exists(select 1 from public.joy8_wallet_policies where currency <> 'POINT') then
    raise exception 'JOY8_POINT_POLICY_REVIEW_REQUIRED' using errcode = '55000';
  end if;
  if exists(select 1 from public.wallet_transactions where source_type in ('initial_grant','registration_grant')) then
    raise exception 'JOY8_POINT_GRANTS_ALREADY_ISSUED' using errcode = '55000';
  end if;
end;
$$;

alter table public.joy8_wallet_policies
  add column guest_initial_credit numeric(18,2) not null default 0,
  add constraint joy8_wallet_policies_guest_initial_credit_check
    check (guest_initial_credit >= 0 and guest_initial_credit <= initial_credit);

update public.joy8_wallet_policies set initial_credit = 1000, guest_initial_credit = 100;

alter table public.wallet_transactions
  alter column game_id drop not null,
  add constraint wallet_transactions_game_source_check
    check (game_id is not null or source_type in ('initial_grant','registration_grant'));

create function public.joy8_apply_point_grant(
  p_wallet public.wallet_accounts, p_amount numeric, p_source text, p_policy uuid
)
returns public.wallet_accounts language plpgsql security definer set search_path = '' as $$
declare
  v_wallet public.wallet_accounts%rowtype;
begin
  update public.wallet_accounts set balance = balance + p_amount, updated_at = now()
    where id = p_wallet.id returning * into v_wallet;
  insert into public.wallet_transactions(
    wallet_account_id, type, amount, balance_before, balance_after, game_id,
    idempotency_key, source_type, source_ref
  ) values (
    v_wallet.id, 'deposit', p_amount, p_wallet.balance, v_wallet.balance, null,
    replace(p_source, '_', '-') || ':' || v_wallet.id::text, p_source, p_policy::text
  );
  return v_wallet;
end;
$$;

create function public.joy8_grant_member_point(p_player_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_policy public.joy8_wallet_policies%rowtype;
  v_player public.player_accounts%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_initial numeric;
  v_topup numeric;
begin
  select p.* into v_policy from public.joy8_wallet_policies p
    where p.currency = 'POINT' and p.enabled for share;
  if not found then return null; end if;
  select p.* into v_player from public.player_accounts p where p.id = p_player_id for update;
  if not found or v_player.status <> 'active' or v_player.member_enrolled_at is null then
    raise exception 'JOY8_PLAYER_INACTIVE' using errcode = '42501';
  end if;
  select w.* into v_wallet from public.wallet_accounts w
    where w.player_account_id = p_player_id and w.currency = 'POINT' for update;
  if not found then
    insert into public.wallet_accounts(player_account_id, currency, balance, wallet_policy_id)
      values (p_player_id, 'POINT', 0, v_policy.id) returning * into v_wallet;
  elsif v_wallet.status <> 'active' or v_wallet.wallet_policy_id <> v_policy.id then
    raise exception 'JOY8_WALLET_INACTIVE' using errcode = '42501';
  end if;

  select t.amount into v_initial from public.wallet_transactions t
    where t.idempotency_key = 'initial-grant:' || v_wallet.id::text;
  if not found then
    v_initial := case v_player.account_type when 'guest' then v_policy.guest_initial_credit
      else v_policy.initial_credit end;
    if v_initial > 0 then
      v_wallet := public.joy8_apply_point_grant(v_wallet, v_initial, 'initial_grant', v_policy.id);
    end if;
  end if;

  if v_player.account_type = 'registered' and not exists(
    select 1 from public.wallet_transactions t
    where t.idempotency_key = 'registration-grant:' || v_wallet.id::text) then
    v_topup := v_policy.initial_credit - v_initial;
    if v_topup > 0 then
      v_wallet := public.joy8_apply_point_grant(v_wallet, v_topup, 'registration_grant', v_policy.id);
    end if;
  end if;
  return v_wallet.id;
end;
$$;

create or replace function public.joy8_provision_wallet(p_player_id uuid, p_game_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_policy uuid;
  v_wallet uuid;
begin
  select p.id into v_policy
  from public.joy8_game_policies g
  join public.joy8_wallet_policies p on p.id = g.wallet_policy_id
  where g.game_id = p_game_id and g.enabled and p.enabled
  for share of g, p;
  if not found then raise exception 'JOY8_GAME_NOT_READY' using errcode = '42501'; end if;
  v_wallet := public.joy8_grant_member_point(p_player_id);
  if v_wallet is null or not exists(select 1 from public.wallet_accounts w
    where w.id = v_wallet and w.wallet_policy_id = v_policy) then
    raise exception 'JOY8_WALLET_INACTIVE' using errcode = '42501';
  end if;
  return v_wallet;
end;
$$;

create or replace function public.joy8_resolve_member(
  p_auth_user_id uuid,
  p_enroll boolean default false
)
returns table (player_account_id uuid, account_type text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth auth.users%rowtype;
  v_player public.player_accounts%rowtype;
  v_type text;
begin
  if p_auth_user_id is null then
    raise exception 'verified member identity is required' using errcode = '42501';
  end if;

  if p_enroll is true then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_auth_user_id::text, 0));
    select u.* into v_auth from auth.users u where u.id = p_auth_user_id for share;
  else
    select u.* into v_auth from auth.users u where u.id = p_auth_user_id;
  end if;

  if not found or v_auth.deleted_at is not null or v_auth.banned_until > now() then
    raise exception 'verified member identity is required' using errcode = '42501';
  end if;
  if v_auth.is_anonymous is true then
    v_type := 'guest';
  elsif v_auth.is_anonymous is false and v_auth.email_confirmed_at is not null then
    v_type := 'registered';
  else
    raise exception 'verified member identity is required' using errcode = '42501';
  end if;

  if p_enroll is not true then
    select p.* into v_player from public.player_accounts p
    where p.auth_user_id = p_auth_user_id;
    if not found or v_player.member_enrolled_at is null then
      return;
    end if;
    if v_player.status <> 'active' then
      raise exception 'player account is not active' using errcode = '42501';
    end if;
    if v_player.account_type = 'registered' and v_type = 'guest' then
      raise exception 'verified member identity is required' using errcode = '42501';
    end if;
    return query select v_player.id, v_type;
    return;
  end if;

  select p.* into v_player from public.player_accounts p
  where p.auth_user_id = p_auth_user_id for update;
  if found then
    if v_player.status <> 'active' then
      raise exception 'player account is not active' using errcode = '42501';
    end if;
    if v_player.account_type = 'registered' and v_type = 'guest' then
      raise exception 'verified member identity is required' using errcode = '42501';
    end if;
    if v_player.account_type is distinct from v_type
      or v_player.member_enrolled_at is null
      or (v_player.account_type = 'guest' and v_type = 'registered' and v_player.upgraded_at is null) then
      update public.player_accounts p
      set account_type = v_type,
          member_enrolled_at = coalesce(p.member_enrolled_at, now()),
          upgraded_at = case when p.account_type = 'guest' and v_type = 'registered'
            then coalesce(p.upgraded_at, now()) else p.upgraded_at end
      where p.id = v_player.id;
    end if;
  else
    insert into public.player_accounts (auth_user_id, account_type, member_enrolled_at)
    values (p_auth_user_id, v_type, now()) returning * into v_player;
  end if;

  perform public.joy8_grant_member_point(v_player.id);
  return query select v_player.id, v_type;
end;
$$;

select public.joy8_grant_member_point(p.id) from public.player_accounts p
  where p.status = 'active' and p.member_enrolled_at is not null order by p.id;

revoke all on function public.joy8_apply_point_grant(public.wallet_accounts, numeric, text, uuid),
  public.joy8_grant_member_point(uuid) from public, anon, authenticated, service_role;
revoke all on function public.joy8_resolve_member(uuid, boolean) from public, anon, authenticated;
grant execute on function public.joy8_resolve_member(uuid, boolean) to service_role;
revoke all on function public.joy8_provision_wallet(uuid, uuid) from public, anon, authenticated, service_role;

commit;
