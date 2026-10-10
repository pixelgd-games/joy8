begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
grant baccarat_owner to current_user with set true;
set local role baccarat_owner;

select 1 from baccarat.tables for update;

do $$
begin
  if (select count(*) from baccarat.bets) <> 26
    or (select count(*) from baccarat.bet_raises) <> 3
    or (select count(*) from baccarat.gateway_operations) <> 56
    or exists (select 1 from baccarat.bets where status not in ('settled', 'rejected', 'voided'))
    or exists (select 1 from baccarat.gateway_operations where state = 'pending') then
    raise exception 'BACCARAT_RESET_STALE';
  end if;
  delete from baccarat.gateway_operations;
  delete from baccarat.bet_raises;
  delete from baccarat.bets;
  delete from baccarat.rounds r
    where r.serial < (select max(x.serial) from baccarat.rounds x where x.table_id = r.table_id);
  delete from baccarat.shoes s
    where s.retired_at is not null
      and not exists (select 1 from baccarat.rounds r where r.table_id = s.table_id and r.shoe_id = s.shoe_id);
end;
$$;

reset role;
grant baccarat_owner to current_user with set false;
select public.joy8_validate_product_adapters();
commit;
