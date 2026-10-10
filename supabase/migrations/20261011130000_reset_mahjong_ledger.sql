begin;
set local lock_timeout='5s';
select public.joy8_operator_reset_ledger('{"game_id":"faaa45eb-7d7d-40b5-9081-3dd73482adfa","game_sessions":51,"joy8_mail_messages":0,"joy8_mail_recipients":0,"joy8_match_participants":0,"joy8_match_recoveries":0,"joy8_matches":0,"joy8_reserve_operations":0,"joy8_settlement_entries":0,"joy8_settlements":0,"wallet_transactions":0}'::jsonb, 'faaa45eb-7d7d-40b5-9081-3dd73482adfa'::uuid);
commit;
