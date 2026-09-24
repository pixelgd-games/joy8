select jsonb_build_object(
  'policy',(select jsonb_agg(jsonb_build_object('currency',currency,'enabled',enabled,'member_credit',initial_credit,'guest_credit',guest_initial_credit)) from public.joy8_wallet_policies),
  'players',(select count(*) from public.player_accounts where status='active' and member_enrolled_at is not null),
  'players_without_wallet',(select count(*) from public.player_accounts p where p.status='active' and p.member_enrolled_at is not null
    and not exists(select 1 from public.wallet_accounts w where w.player_account_id=p.id)),
  'grants',(select coalesce(jsonb_object_agg(source_type,n),'{}'::jsonb) from (select source_type,count(*) n from public.wallet_transactions
    where source_type in ('initial_grant','registration_grant') group by source_type) g),
  'non_grant_transactions',(select count(*) from public.wallet_transactions where source_type not in ('initial_grant','registration_grant')),
  'balance_equals_grants',(select coalesce(bool_and(w.balance=coalesce(t.total,0)),true) from public.wallet_accounts w
    left join (select wallet_account_id,sum(amount) total from public.wallet_transactions where type='deposit' group by wallet_account_id) t
    on t.wallet_account_id=w.id),
  'min_bet',(select jsonb_object_agg(g.slug,jsonb_build_object('mode',p.reservation_mode,'min',p.min_bet_amount,'max',p.max_bet_amount,'max_payout',p.max_payout_amount))
    from public.joy8_game_policies p join public.games g on g.id=p.game_id),
  'budget_removed',to_regclass('public.joy8_payout_budgets') is null
    and not exists(select 1 from pg_proc where proname in ('joy8_reserve_payout_budget','joy8_consume_payout_budget','joy8_release_payout_budget'))
    and not exists(select 1 from pg_attribute where attrelid='public.joy8_matches'::regclass and attname='platform_paid_amount' and not attisdropped),
  'grant_functions_private',not has_function_privilege('service_role','public.joy8_grant_member_point(uuid)','EXECUTE')
    and not has_function_privilege('authenticated','public.joy8_grant_member_point(uuid)','EXECUTE')
) as point_rules_postflight;
