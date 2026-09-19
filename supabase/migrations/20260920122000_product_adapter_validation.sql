begin;

create or replace function public.joy8_validate_product_adapter(p_adapter regprocedure)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner oid; v_schema oid;
begin
  select candidate.proowner,candidate_namespace.oid into v_owner,v_schema
  from pg_catalog.pg_proc candidate
  join pg_catalog.pg_namespace candidate_namespace on candidate_namespace.oid=candidate.pronamespace
  join public.joy8_product_schemas registered on registered.schema_name=candidate_namespace.nspname
  where candidate.oid=p_adapter::oid and candidate.proargtypes='25 2950 3802'::oidvector
    and candidate.prokind='f' and candidate.prorettype='jsonb'::regtype
    and not candidate.proretset and candidate.prosecdef
    and candidate.proconfig @> array['search_path=""']::text[]
    and not exists(select 1 from pg_catalog.pg_roles r where r.oid=candidate.proowner and (r.rolsuper or r.rolbypassrls))
    and not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
      where ns.nspname in ('public','auth') and c.relkind in ('r','p')
        and (has_table_privilege(candidate.proowner,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
          or (c.relname<>'games' and has_table_privilege(candidate.proowner,c.oid,'SELECT'))));
  if not found then raise exception 'JOY8_ADAPTER_UNAVAILABLE' using errcode='42501'; end if;
  if not exists(
    select 1 from public.joy8_product_schemas s
    join pg_catalog.pg_namespace n on n.nspname=s.schema_name where n.oid<>v_schema
  ) then return; end if;
  if exists(
      select 1 from public.joy8_product_schemas s
      join pg_catalog.pg_namespace n on n.nspname=s.schema_name
      where n.oid<>v_schema
        and has_schema_privilege(v_owner,n.oid,'CREATE')
    )
    or exists(
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      join public.joy8_product_schemas s on s.schema_name=n.nspname
      where n.oid<>v_schema and (
        (c.relkind in ('r','p','v','m')
          and has_table_privilege(v_owner,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'))
        or (c.relkind='S' and has_sequence_privilege(v_owner,c.oid,'USAGE,SELECT,UPDATE'))
      )
    )
    or exists(
      select 1 from pg_catalog.pg_proc f
      join pg_catalog.pg_namespace n on n.oid=f.pronamespace
      join public.joy8_product_schemas s on s.schema_name=n.nspname
      where n.oid<>v_schema
        and has_function_privilege(v_owner,f.oid,'EXECUTE')
    ) then raise exception 'JOY8_ADAPTER_UNAVAILABLE' using errcode='42501'; end if;
end;
$$;

revoke all on function public.joy8_validate_product_adapter(regprocedure)
  from public,anon,authenticated,service_role;

select public.joy8_validate_product_adapters();

commit;
