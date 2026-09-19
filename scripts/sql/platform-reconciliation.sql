begin read only;
select jsonb_build_object(
  'wallet_ledger_mismatches',(select count(*) from public.wallet_accounts w where w.balance<>(select coalesce(sum(t.balance_after-t.balance_before),0)
      from public.wallet_transactions t where t.wallet_account_id=w.id)),
  'reservation_mismatches',(select count(*) from public.wallet_accounts w where w.locked_balance<>(select coalesce(sum(p.reserved_amount),0) from public.joy8_match_participants p
      where p.wallet_account_id=w.id and p.released_at is null)),
  'fee_mismatches',(select count(*) from public.joy8_fee_accounts f where f.balance<>
    (select coalesce(sum(e.amount),0) from public.joy8_settlement_entries e join public.joy8_settlements s on s.id=e.settlement_id
      where s.game_id=f.game_id and e.kind='fee')),
  'unbalanced_settlements',(select count(*) from (select settlement_id from public.joy8_settlement_entries
    group by settlement_id having sum(amount)<>0) invalid),
  'finalized_with_reservations',(select count(*) from public.joy8_matches m where m.state<>'open'
    and exists(select 1 from public.joy8_match_participants p where p.match_id=m.id and p.released_at is null)),
  'open_matches',(select count(*) from public.joy8_matches where state='open'),
  'open_over_24_hours',(select count(*) from public.joy8_matches where state='open' and opened_at<now()-interval '24 hours')
) as reconciliation;
commit;
