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
      game_id='6dc12d01-5760-4123-832f-6d0bd305404a'::uuid
      and rule_version='baccarat-commission-v1' and not enabled) <> 6 then
    raise exception 'BACCARAT_RELEASE_NOT_PAUSED';
  end if;
  if exists(select 1 from baccarat.bets where status not in ('settled','rejected','voided'))
    or exists(select 1 from baccarat.gateway_operations where state='pending') then
    raise exception 'BACCARAT_RELEASE_PENDING_OBLIGATIONS';
  end if;
end;
$$;
reset role;
do $$
begin
  if exists(select 1 from public.joy8_matches
    where game_id='6dc12d01-5760-4123-832f-6d0bd305404a'::uuid and state='open') then
    raise exception 'BACCARAT_RELEASE_OPEN_PLATFORM_MATCH';
  end if;
end;
$$;
set local role baccarat_owner;
update baccarat.tables set rule_version='baccarat-8d-commission-lucky6-12-20-v1',revision=revision+1;
reset role;
grant baccarat_owner to current_user with set false;
select public.joy8_validate_product_adapters();
commit;
