begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

grant baccarat_owner to current_user with set true;
set local role baccarat_owner;
lock table baccarat.tables in share row exclusive mode;

do $$
begin
  if (select count(*) from baccarat.tables) <> 4 or
    (select count(*) from baccarat.tables
      where table_id in ('baccarat','baccarat-2','baccarat-3','baccarat-4')
        and game_id = '6dc12d01-5760-4123-832f-6d0bd305404a'::uuid
        and rule_version = 'baccarat-commission-v1'
        and min_bet_minor = 1000 and max_bet_minor = 1000000
        and max_payout_minor = 21000000 and enabled) <> 4 then
    raise exception 'BACCARAT_FOUR_TABLE_CONFIGURATION_CHANGED';
  end if;
end;
$$;

insert into baccarat.tables(table_id,game_id,name,rule_version,min_bet_minor,max_bet_minor,max_payout_minor,enabled)
select 'baccarat-' || n,game_id,'電子百家樂 ' || n,rule_version,
  min_bet_minor,max_bet_minor,max_payout_minor,true
from baccarat.tables cross join generate_series(5,6) n
where table_id = 'baccarat';

reset role;
grant baccarat_owner to current_user with set false;
select public.joy8_validate_product_adapters();
commit;
