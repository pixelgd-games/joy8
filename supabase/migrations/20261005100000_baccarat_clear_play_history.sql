begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
grant baccarat_owner to current_user with set true;
set local role baccarat_owner;

create temporary table baccarat_cleared_rounds on commit drop as
  select r.round_id from baccarat.rounds r
  where r.finished_at is not null
    and r.serial < (select max(x.serial) from baccarat.rounds x where x.table_id = r.table_id)
    and not exists (
      select 1 from baccarat.bets b
      where b.round_id = r.round_id and (
        b.status not in ('settled','rejected','voided')
        or exists (select 1 from baccarat.gateway_operations o where o.bet_id = b.bet_id and o.state = 'pending')
      )
    );

delete from baccarat.gateway_operations o using baccarat.bets b
  where o.bet_id = b.bet_id and b.round_id in (select round_id from baccarat_cleared_rounds);
delete from baccarat.bets where round_id in (select round_id from baccarat_cleared_rounds);
delete from baccarat.rounds where round_id in (select round_id from baccarat_cleared_rounds);
delete from baccarat.shoes s where s.retired_at is not null
  and not exists (select 1 from baccarat.rounds r where r.shoe_id = s.shoe_id);

reset role;
grant baccarat_owner to current_user with set false;
select public.joy8_validate_product_adapters();
commit;
