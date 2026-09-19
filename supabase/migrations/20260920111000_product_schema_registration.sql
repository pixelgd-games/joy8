begin;

lock table public.joy8_game_policies in share row exclusive mode;

create table public.joy8_product_schemas (
  schema_name name primary key,
  check (schema_name::text !~ '^pg_' and schema_name not in
    ('public','auth','extensions','information_schema','storage','realtime','vault','supabase_functions'))
);
alter table public.joy8_product_schemas enable row level security;
revoke all on public.joy8_product_schemas from public,anon,authenticated,service_role;

insert into public.joy8_product_schemas(schema_name)
select distinct n.nspname
from public.joy8_game_policies p
join pg_catalog.pg_proc f on f.oid=p.product_adapter::oid
join pg_catalog.pg_namespace n on n.oid=f.pronamespace;

create function public.joy8_validate_product_adapter(p_adapter regprocedure)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1
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
          or (c.relname<>'games' and has_table_privilege(candidate.proowner,c.oid,'SELECT'))))
    and not exists(
      select 1
      from public.joy8_product_schemas other_schema
      join pg_catalog.pg_namespace other_namespace on other_namespace.nspname=other_schema.schema_name
      where other_namespace.oid<>candidate_namespace.oid
        and (
          has_schema_privilege(candidate.proowner,other_namespace.oid,'CREATE')
          or exists(
            select 1 from pg_catalog.pg_class other_relation
            where other_relation.relnamespace=other_namespace.oid
              and (
                (other_relation.relkind in ('r','p','v','m')
                  and has_table_privilege(candidate.proowner,other_relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'))
                or (other_relation.relkind='S'
                  and has_sequence_privilege(candidate.proowner,other_relation.oid,'USAGE,SELECT,UPDATE'))
              )
          )
          or exists(
            select 1 from pg_catalog.pg_proc other_function
            where other_function.pronamespace=other_namespace.oid
              and has_function_privilege(candidate.proowner,other_function.oid,'EXECUTE')
          )
        )
    );
  if not found then raise exception 'JOY8_ADAPTER_UNAVAILABLE' using errcode='42501'; end if;
end;
$$;

create function public.joy8_validate_product_adapters()
returns void language plpgsql security definer set search_path='' as $$
declare v_adapter regprocedure;
begin
  if exists(select 1 from public.joy8_product_schemas s
    where pg_catalog.to_regnamespace(s.schema_name::text) is null) then
    raise exception 'JOY8_PRODUCT_SCHEMA_UNAVAILABLE' using errcode='42501';
  end if;
  for v_adapter in select distinct product_adapter from public.joy8_game_policies where product_adapter is not null loop
    perform public.joy8_validate_product_adapter(v_adapter);
  end loop;
end;
$$;

create or replace function public.joy8_product_adapter(
  p_adapter regprocedure,p_action text,p_match uuid,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_schema text; v_name text; v_result jsonb;
begin
  perform public.joy8_validate_product_adapter(p_adapter);
  select n.nspname,p.proname into strict v_schema,v_name
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where p.oid=p_adapter::oid;
  execute format('select %I.%I($1,$2,$3)',v_schema,v_name) into v_result
    using p_action,p_match,p_payload;
  if v_result->>'committed' is distinct from 'true' then
    raise exception 'JOY8_ADAPTER_REJECTED' using errcode='42501';
  end if;
  return v_result;
end;
$$;

create function public.joy8_check_product_registration()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(75080003);
  perform public.joy8_validate_product_adapters();
  return null;
end;
$$;

create trigger joy8_product_schema_registration
after insert or update or delete on public.joy8_product_schemas
for each statement execute function public.joy8_check_product_registration();

create trigger joy8_product_adapter_registration
after insert or update or delete on public.joy8_game_policies
for each statement execute function public.joy8_check_product_registration();

revoke all on function public.joy8_validate_product_adapter(regprocedure),
  public.joy8_validate_product_adapters(),public.joy8_check_product_registration(),
  public.joy8_product_adapter(regprocedure,text,uuid,jsonb) from public,anon,authenticated,service_role;

select public.joy8_validate_product_adapters();

commit;
