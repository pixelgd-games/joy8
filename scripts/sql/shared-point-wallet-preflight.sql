begin read only;

select jsonb_build_object(
  'players', (select count(*) from public.player_accounts),
  'wallets', jsonb_build_object(
    'rows', (select count(*) from public.wallet_accounts),
    'players', (select count(distinct player_account_id) from public.wallet_accounts),
    'duplicate_player_currency_groups', (
      select count(*) from (
        select player_account_id, currency
        from public.wallet_accounts
        group by player_account_id, currency
        having count(*) > 1
      ) duplicates
    ),
    'non_point_rows', (select count(*) from public.wallet_accounts where currency <> 'POINT'),
    'nonzero_rows', (
      select count(*) from public.wallet_accounts where balance <> 0 or locked_balance <> 0
    ),
    'balance_total', (select coalesce(sum(balance), 0) from public.wallet_accounts),
    'locked_total', (select coalesce(sum(locked_balance), 0) from public.wallet_accounts),
    'by_scope', coalesce((
      select jsonb_agg(row_data order by row_data->>'scope', row_data->>'status')
      from (
        select jsonb_build_object(
          'scope', coalesce(g.slug, 'platform'),
          'status', w.status,
          'wallets', count(*),
          'balance', sum(w.balance),
          'locked', sum(w.locked_balance)
        ) row_data
        from public.wallet_accounts w
        join public.joy8_wallet_policies p on p.id = w.wallet_policy_id
        left join public.games g on g.id = p.game_id
        group by coalesce(g.slug, 'platform'), w.status
      ) grouped
    ), '[]'::jsonb)
  ),
  'policies', coalesce((
    select jsonb_agg(jsonb_build_object(
      'scope', coalesce(g.slug, 'platform'),
      'currency', p.currency,
      'initial_credit', p.initial_credit,
      'enabled', p.enabled,
      'games', (
        select coalesce(jsonb_agg(gp_game.slug order by gp_game.slug), '[]'::jsonb)
        from public.joy8_game_policies gp
        join public.games gp_game on gp_game.id = gp.game_id
        where gp.wallet_policy_id = p.id
      )
    ) order by coalesce(g.slug, 'platform'), p.currency)
    from public.joy8_wallet_policies p
    left join public.games g on g.id = p.game_id
  ), '[]'::jsonb),
  'transactions', jsonb_build_object(
    'rows', (select count(*) from public.wallet_transactions),
    'net_change', (
      select coalesce(sum(balance_after - balance_before), 0) from public.wallet_transactions
    ),
    'by_source_game', coalesce((
      select jsonb_agg(jsonb_build_object(
        'game', coalesce(g.slug, 'platform'),
        'rows', grouped.rows,
        'net_change', grouped.net_change
      ) order by coalesce(g.slug, 'platform'))
      from (
        select game_id, count(*) rows, sum(balance_after - balance_before) net_change
        from public.wallet_transactions
        group by game_id
      ) grouped
      left join public.games g on g.id = grouped.game_id
    ), '[]'::jsonb),
    'by_source_type', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_type', grouped.source_type,
        'rows', grouped.rows,
        'net_change', grouped.net_change
      ) order by grouped.source_type)
      from (
        select coalesce(source_type, 'unset') source_type,
          count(*) rows,
          sum(balance_after - balance_before) net_change
        from public.wallet_transactions
        group by coalesce(source_type, 'unset')
      ) grouped
    ), '[]'::jsonb),
    'wallet_balance_mismatches', (
      select count(*)
      from public.wallet_accounts w
      where w.balance <> coalesce((
        select sum(t.balance_after - t.balance_before)
        from public.wallet_transactions t
        where t.wallet_account_id = w.id
      ), 0)
    ),
    'chain_mismatches', (
      select count(*)
      from (
        select balance_before,
          lag(balance_after) over (partition by wallet_account_id order by created_at, id) prior_balance
        from public.wallet_transactions
      ) chain
      where prior_balance is not null and balance_before <> prior_balance
    )
  ),
  'sessions', jsonb_build_object(
    'rows', (select count(*) from public.game_sessions),
    'active_unexpired', (
      select count(*) from public.game_sessions where status = 'active' and expires_at > now()
    )
  ),
  'platform_matches', jsonb_build_object(
    'accounting_rows', jsonb_build_object(
      'matches', (select count(*) from public.joy8_matches),
      'participants', (select count(*) from public.joy8_match_participants),
      'settlements', (select count(*) from public.joy8_settlements),
      'settlement_entries', (select count(*) from public.joy8_settlement_entries),
      'fee_accounts', (select count(*) from public.joy8_fee_accounts)
    ),
    'open', (select count(*) from public.joy8_matches where state = 'open'),
    'unreleased_participants', (
      select count(*) from public.joy8_match_participants where released_at is null
    ),
    'reserved_total', (
      select coalesce(sum(reserved_amount), 0)
      from public.joy8_match_participants
      where released_at is null
    ),
    'reservation_mismatches', (
      select count(*)
      from public.wallet_accounts w
      where w.locked_balance <> coalesce((
        select sum(p.reserved_amount)
        from public.joy8_match_participants p
        where p.wallet_account_id = w.id and p.released_at is null
      ), 0)
    )
  ),
  'mahjong', jsonb_build_object(
    'matches_by_status', coalesce((
      select jsonb_object_agg(status, rows order by status)
      from (
        select status, count(*) rows
        from mahjong_clash.matches
        group by status
      ) grouped
    ), '{}'::jsonb),
    'unfinished_matches', (
      select count(*)
      from mahjong_clash.matches
      where status not in ('finished', 'voided')
    ),
    'hands_by_status', coalesce((
      select jsonb_object_agg(status, rows order by status)
      from (
        select status, count(*) rows
        from mahjong_clash.hands
        group by status
      ) grouped
    ), '{}'::jsonb),
    'uncommitted_accounting_requests', (
      select count(*)
      from mahjong_clash.accounting_requests r
      left join mahjong_clash.accounting_commits c
        on c.match_id = r.match_id and c.hand_serial = r.hand_serial
      where c.match_id is null
    ),
    'open_platform_matches', (
      select count(*) from mahjong_clash.platform_matches where status = 'open'
    )
  ),
  'schema_contract', jsonb_build_object(
    'policy_game_id_present', exists(
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'joy8_wallet_policies' and column_name = 'game_id'
    ),
    'policy_scope_constraint_present', exists(
      select 1 from pg_constraint
      where conrelid = 'public.joy8_wallet_policies'::regclass
        and conname = 'joy8_wallet_policies_game_id_currency_key'
    ),
    'wallet_identity_index', pg_get_indexdef('public.wallet_accounts_identity_key'::regclass),
    'transaction_game_nullable', (
      select is_nullable = 'YES' from information_schema.columns
      where table_schema = 'public' and table_name = 'wallet_transactions' and column_name = 'game_id'
    ),
    'runtime_balance_return', (
      select p.prorettype::regtype::text from pg_proc p
      where p.oid = 'mahjong_clash.runtime_balance(uuid)'::regprocedure
    ),
    'functions_using_policy_game_id', coalesce((
      select jsonb_agg(format('%I.%I(%s)', n.nspname, p.proname,
        pg_get_function_identity_arguments(p.oid)) order by n.nspname, p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosrc ilike '%joy8_wallet_policies%'
        and p.prosrc ilike '%game_id%'
    ), '[]'::jsonb)
  )
) as shared_point_wallet_preflight;

commit;
