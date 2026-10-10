begin;
set local lock_timeout='5s';
select public.joy8_operator_reset_ledger('{"game_id":null,"game_sessions":312,"joy8_mail_messages":9,"joy8_mail_recipients":9,"joy8_match_participants":1937,"joy8_match_recoveries":0,"joy8_matches":1937,"joy8_reserve_operations":3,"joy8_settlement_entries":3916,"joy8_settlements":1965,"wallet_transactions":1900}'::jsonb, null);
commit;
