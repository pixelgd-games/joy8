begin;

create or replace function public.joy8_product_adapter(
  p_adapter regprocedure,p_action text,p_match uuid,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_schema text; v_name text; v_result jsonb;
begin
  select candidate_namespace.nspname,candidate.proname into v_schema,v_name
  from pg_catalog.pg_proc candidate
  join pg_catalog.pg_namespace candidate_namespace on candidate_namespace.oid=candidate.pronamespace
  where candidate.oid=p_adapter::oid and candidate.proargtypes='25 2950 3802'::oidvector
    and candidate.prorettype='jsonb'::regtype and not candidate.proretset and candidate.prosecdef
    and not exists(select 1 from pg_catalog.pg_roles r where r.oid=candidate.proowner and (r.rolsuper or r.rolbypassrls))
    and not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
      where ns.nspname in ('public','auth') and c.relkind in ('r','p')
        and (has_table_privilege(candidate.proowner,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
          or (c.relname<>'games' and has_table_privilege(candidate.proowner,c.oid,'SELECT'))))
    and not exists(
      select 1
      from public.joy8_game_policies configured
      join pg_catalog.pg_proc configured_adapter on configured_adapter.oid=configured.product_adapter::oid
      join pg_catalog.pg_namespace configured_namespace on configured_namespace.oid=configured_adapter.pronamespace
      where configured.product_adapter is not null
        and configured_namespace.oid<>candidate_namespace.oid
        and (
          has_schema_privilege(candidate.proowner,configured_namespace.oid,'CREATE')
          or exists(
            select 1 from pg_catalog.pg_class other_relation
            where other_relation.relnamespace=configured_namespace.oid
              and (
                (other_relation.relkind in ('r','p','v','m')
                  and has_table_privilege(candidate.proowner,other_relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'))
                or (other_relation.relkind='S'
                  and has_sequence_privilege(candidate.proowner,other_relation.oid,'USAGE,SELECT,UPDATE'))
              )
          )
          or exists(
            select 1 from pg_catalog.pg_proc other_function
            where other_function.pronamespace=configured_namespace.oid
              and has_function_privilege(candidate.proowner,other_function.oid,'EXECUTE')
          )
        )
    )
    and candidate_namespace.nspname not in ('public','auth','extensions','pg_catalog','information_schema');
  if not found then raise exception 'JOY8_ADAPTER_UNAVAILABLE' using errcode='42501'; end if;
  execute format('select %I.%I($1,$2,$3)',v_schema,v_name) into v_result
    using p_action,p_match,p_payload;
  if v_result->>'committed' is distinct from 'true' then
    raise exception 'JOY8_ADAPTER_REJECTED' using errcode='42501';
  end if;
  return v_result;
end;
$$;

revoke all on function public.joy8_product_adapter(regprocedure,text,uuid,jsonb) from public,anon,authenticated,service_role;

commit;
