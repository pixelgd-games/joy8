begin;

create table public.joy8_product_ddl_checks (
  transaction_id xid8 primary key
);
alter table public.joy8_product_ddl_checks enable row level security;
revoke all on public.joy8_product_ddl_checks from public,anon,authenticated,service_role;

create function public.joy8_queue_product_ddl_check()
returns event_trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(75080003);
  insert into public.joy8_product_ddl_checks values(pg_catalog.pg_current_xact_id())
  on conflict do nothing;
end;
$$;

create function public.joy8_check_product_ddl()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform public.joy8_validate_product_adapters();
  delete from public.joy8_product_ddl_checks where transaction_id=new.transaction_id;
  return null;
exception when sqlstate '42501' then
  raise exception 'JOY8_PRODUCT_DDL_REJECTED' using errcode='42501',
    hint='Revoke unintended product privileges in this transaction before commit. Product adapters were not executed.';
end;
$$;

create constraint trigger joy8_product_ddl_check
after insert on public.joy8_product_ddl_checks
deferrable initially deferred
for each row execute function public.joy8_check_product_ddl();

revoke all on function public.joy8_queue_product_ddl_check(),public.joy8_check_product_ddl()
  from public,anon,authenticated,service_role;

select public.joy8_validate_product_adapters();

create event trigger joy8_product_ddl_guard on ddl_command_end
execute function public.joy8_queue_product_ddl_check();

commit;
