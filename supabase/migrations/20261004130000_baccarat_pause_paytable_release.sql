begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
grant baccarat_owner to current_user with set true;
set local role baccarat_owner;
lock table baccarat.tables in share row exclusive mode;
do $$
begin
  if (select count(*) from baccarat.tables) <> 6 or
    (select count(*) from baccarat.tables where
      table_id in ('baccarat','baccarat-2','baccarat-3','baccarat-4','baccarat-5','baccarat-6')
      and game_id='6dc12d01-5760-4123-832f-6d0bd305404a'::uuid
      and rule_version='baccarat-commission-v1' and enabled) <> 6 then
    raise exception 'BACCARAT_RELEASE_CONFIGURATION_CHANGED';
  end if;
end;
$$;
update baccarat.tables set enabled=false,revision=revision+1;
reset role;
grant baccarat_owner to current_user with set false;
select public.joy8_validate_product_adapters();
commit;
