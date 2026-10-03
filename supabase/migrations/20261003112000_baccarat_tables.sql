begin;
grant baccarat_owner to current_user with set true;
set local role baccarat_owner;
insert into baccarat.tables(table_id,game_id,name,rule_version,min_bet_minor,max_bet_minor,max_payout_minor,enabled)
select case when n=1 then 'baccarat' else 'baccarat-' || n end,
  '6dc12d01-5760-4123-832f-6d0bd305404a'::uuid,
  '電子百家樂 ' || n,'baccarat-commission-v1',1000,1000000,21000000,true
from generate_series(1,4) n;
reset role;
grant baccarat_owner to current_user with set false;
select public.joy8_validate_product_adapters();
commit;
