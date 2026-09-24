begin;

lock table public.joy8_matches, public.joy8_settlement_entries, public.joy8_payout_budgets in access exclusive mode;

drop trigger joy8_reserve_payout_budget on public.joy8_matches;
drop trigger joy8_consume_payout_budget on public.joy8_settlement_entries;
drop trigger joy8_release_payout_budget on public.joy8_matches;
drop function public.joy8_reserve_payout_budget();
drop function public.joy8_consume_payout_budget();
drop function public.joy8_release_payout_budget();
drop table public.joy8_payout_budgets;
alter table public.joy8_matches drop column platform_paid_amount;

select public.joy8_validate_product_adapters();

commit;
