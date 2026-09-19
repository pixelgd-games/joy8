begin;

create function public.joy8_lock_product_ddl_schemas(p_schemas oid[])
returns void language plpgsql security definer set search_path='' as $$
declare v_schema oid;
begin
  if coalesce(cardinality(p_schemas),0)>0
    and current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'JOY8_PRODUCT_DDL_REQUIRES_READ_COMMITTED' using errcode='40001';
  end if;
  for v_schema in select distinct unnest(p_schemas) order by 1 loop
    perform pg_catalog.pg_advisory_xact_lock(75080005,v_schema::integer);
  end loop;
end;
$$;

create or replace function public.joy8_check_product_registration()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform public.joy8_lock_product_ddl_schemas(array(
    select n.oid from pg_catalog.pg_namespace n
    where n.nspname in ('public','auth')
      or exists(select 1 from public.joy8_product_schemas s where s.schema_name=n.nspname)
  ));
  perform pg_catalog.pg_advisory_xact_lock(75080003);
  perform public.joy8_validate_product_adapters();
  return null;
end;
$$;

create or replace function public.joy8_queue_product_ddl_check()
returns event_trigger language plpgsql security definer set search_path='' as $$
declare
  v_schemas oid[];
  v_relevant boolean:=false;
begin
  if tg_event='sql_drop' then
    select array_agg(distinct coalesce(n.oid,dropped_schema.objid,
      case when d.classid='pg_catalog.pg_namespace'::regclass then d.objid end))
    into v_schemas
    from pg_catalog.pg_event_trigger_dropped_objects() d
    left join pg_catalog.pg_namespace n on n.nspname=d.schema_name
    left join pg_catalog.pg_event_trigger_dropped_objects() dropped_schema
      on dropped_schema.classid='pg_catalog.pg_namespace'::regclass
      and dropped_schema.object_name=d.schema_name
    where d.classid in ('pg_catalog.pg_class'::regclass,'pg_catalog.pg_proc'::regclass,'pg_catalog.pg_namespace'::regclass)
      and d.object_type not in ('index','index column');
  else
    select array_agg(distinct coalesce(c.relnamespace,p.pronamespace,n.oid)) into v_schemas
    from pg_catalog.pg_event_trigger_ddl_commands() d
    left join pg_catalog.pg_class c on d.classid='pg_catalog.pg_class'::regclass and c.oid=d.objid
      and c.relkind in ('r','p','v','m','S','f')
    left join pg_catalog.pg_proc p on d.classid='pg_catalog.pg_proc'::regclass and p.oid=d.objid
    left join pg_catalog.pg_namespace n on d.classid='pg_catalog.pg_namespace'::regclass and n.oid=d.objid;
  end if;
  perform public.joy8_lock_product_ddl_schemas(array_remove(v_schemas,null));

  if tg_tag in ('GRANT','REVOKE') then
    v_relevant:=true;
  elsif exists(select 1 from public.joy8_product_schemas s
    where pg_catalog.to_regnamespace(s.schema_name::text) is null) then
    v_relevant:=true;
  elsif tg_event='sql_drop' then
    select exists(
      select 1 from pg_catalog.pg_event_trigger_dropped_objects() d
      where (d.classid='pg_catalog.pg_namespace'::regclass
        and exists(select 1 from public.joy8_product_schemas s where s.schema_name=d.object_name))
        or (d.classid='pg_catalog.pg_proc'::regclass
          and exists(select 1 from public.joy8_game_policies p where p.product_adapter::oid=d.objid))
        or (d.classid in ('pg_catalog.pg_class'::regclass,'pg_catalog.pg_proc'::regclass)
          and d.object_type not in ('index','index column')
          and exists(select 1 from public.joy8_product_schemas s where s.schema_name=d.schema_name))
    ) into v_relevant;
  else
    select exists(
      select 1 from pg_catalog.pg_event_trigger_ddl_commands() d
      left join pg_catalog.pg_class c on d.classid='pg_catalog.pg_class'::regclass and c.oid=d.objid
      left join pg_catalog.pg_namespace n on d.classid='pg_catalog.pg_namespace'::regclass and n.oid=d.objid
      where (d.classid='pg_catalog.pg_proc'::regclass
        and exists(select 1 from public.joy8_game_policies p where p.product_adapter::oid=d.objid))
        or ((d.classid='pg_catalog.pg_proc'::regclass or c.relkind in ('r','p','v','m','S','f'))
          and exists(select 1 from public.joy8_product_schemas s where s.schema_name=d.schema_name))
        or exists(select 1 from public.joy8_product_schemas s where s.schema_name=n.nspname)
        or (c.relkind in ('r','p') and d.schema_name in ('public','auth') and exists(
          select 1 from public.joy8_game_policies policy
          join pg_catalog.pg_proc adapter on adapter.oid=policy.product_adapter::oid
          where has_table_privilege(adapter.proowner,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
            or (c.relname<>'games' and has_table_privilege(adapter.proowner,c.oid,'SELECT'))
        ))
    ) into v_relevant;
  end if;
  if not v_relevant then return; end if;
  if current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'JOY8_PRODUCT_DDL_REQUIRES_READ_COMMITTED' using errcode='40001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(75080003);
  insert into public.joy8_product_ddl_checks values(pg_catalog.pg_current_xact_id())
  on conflict do nothing;
end;
$$;

revoke all on function public.joy8_lock_product_ddl_schemas(oid[])
  from public,anon,authenticated,service_role;

drop event trigger joy8_product_ddl_guard;
create event trigger joy8_product_ddl_guard on ddl_command_end
when tag in ('GRANT','REVOKE','CREATE SCHEMA','ALTER SCHEMA',
  'CREATE TABLE','CREATE TABLE AS','SELECT INTO','ALTER TABLE',
  'CREATE FOREIGN TABLE','ALTER FOREIGN TABLE','IMPORT FOREIGN SCHEMA',
  'CREATE SEQUENCE','ALTER SEQUENCE','CREATE VIEW','ALTER VIEW',
  'CREATE MATERIALIZED VIEW','ALTER MATERIALIZED VIEW',
  'CREATE FUNCTION','ALTER FUNCTION','CREATE PROCEDURE','ALTER PROCEDURE','ALTER ROUTINE',
  'CREATE AGGREGATE','ALTER AGGREGATE','CREATE EXTENSION','ALTER EXTENSION')
execute function public.joy8_queue_product_ddl_check();

create event trigger joy8_product_drop_guard on sql_drop
execute function public.joy8_queue_product_ddl_check();

select public.joy8_validate_product_adapters();

commit;
