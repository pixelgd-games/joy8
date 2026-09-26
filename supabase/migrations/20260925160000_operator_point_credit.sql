begin;

do $$
declare
  v_player_id uuid;
  v_game_id uuid;
  v_wallet public.wallet_accounts%rowtype;
  v_new_balance numeric(18,2);
  v_amount constant numeric(18,2) := 10000000.00;
  v_key constant text := 'operator-point-credit:20260925:player-506016';
begin
  select p.id into v_player_id
  from public.player_accounts p
  where p.public_id = '506016'
    and p.auth_user_id = '8cd34776-7803-47a7-b0b8-1754eb9128f0'::uuid
    and p.account_type = 'registered'
    and p.status = 'active'
    and p.member_enrolled_at is not null;
  if v_player_id is null then
    raise exception 'JOY8_OPERATOR_CREDIT_PLAYER_NOT_READY' using errcode = '55000';
  end if;

  select g.id into v_game_id
  from public.games g
  where g.slug = 'monster-lab' and g.published;
  if v_game_id is null then
    raise exception 'JOY8_OPERATOR_CREDIT_GAME_NOT_READY' using errcode = '55000';
  end if;

  select w.* into v_wallet
  from public.wallet_accounts w
  where w.player_account_id = v_player_id and w.currency = 'POINT'
  for update;
  if not found or v_wallet.status <> 'active'
    or v_wallet.balance <> 25.00 or v_wallet.locked_balance <> 0 then
    raise exception 'JOY8_OPERATOR_CREDIT_WALLET_NOT_READY' using errcode = '55000';
  end if;
  if exists (select 1 from public.joy8_matches m
    join public.joy8_match_participants mp on mp.match_id = m.id
    where mp.wallet_account_id = v_wallet.id and m.state = 'open') then
    raise exception 'JOY8_OPERATOR_CREDIT_MATCH_OPEN' using errcode = '55000';
  end if;
  if exists (select 1 from public.wallet_transactions t where t.idempotency_key = v_key) then
    raise exception 'JOY8_OPERATOR_CREDIT_ALREADY_APPLIED' using errcode = '55000';
  end if;
  if v_wallet.balance <> (select coalesce(sum(t.balance_after - t.balance_before), 0)
    from public.wallet_transactions t where t.wallet_account_id = v_wallet.id) then
    raise exception 'JOY8_OPERATOR_CREDIT_LEDGER_MISMATCH' using errcode = '55000';
  end if;

  update public.wallet_accounts
  set balance = balance + v_amount, updated_at = now()
  where id = v_wallet.id
  returning balance into v_new_balance;

  insert into public.wallet_transactions (
    wallet_account_id, type, amount, balance_before, balance_after,
    game_id, idempotency_key, source_type, source_ref
  ) values (
    v_wallet.id, 'adjustment', v_amount, v_wallet.balance, v_new_balance,
    v_game_id, v_key, 'operator_adjustment', 'monster-lab:player-506016:20260925'
  );
end;
$$;

commit;
