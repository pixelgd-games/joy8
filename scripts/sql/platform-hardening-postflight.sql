begin read only;
with definitions as (
  select
    pg_get_functiondef('public.joy8_resolve_member(uuid,boolean)'::regprocedure) as member_definition,
    pg_get_functiondef('public.joy8_validate_product_adapter(regprocedure)'::regprocedure) as adapter_definition
)
select jsonb_build_object(
  'member_read_branch',strpos(member_definition,'if p_enroll is not true then')>0,
  'member_read_without_player_lock',strpos(member_definition,'where p.auth_user_id = p_auth_user_id;')>0,
  'member_enrollment_lock_retained',strpos(member_definition,'where p.auth_user_id = p_auth_user_id for update;')>0,
  'member_service_role_execute',has_function_privilege('service_role','public.joy8_resolve_member(uuid,boolean)','EXECUTE'),
  'member_anon_execute',has_function_privilege('anon','public.joy8_resolve_member(uuid,boolean)','EXECUTE'),
  'member_authenticated_execute',has_function_privilege('authenticated','public.joy8_resolve_member(uuid,boolean)','EXECUTE'),
  'adapter_schema_create_guard',strpos(adapter_definition,'has_schema_privilege(candidate.proowner,other_namespace.oid,''CREATE'')')>0,
  'adapter_table_guard',strpos(adapter_definition,'has_table_privilege(candidate.proowner,other_relation.oid')>0,
  'adapter_sequence_guard',strpos(adapter_definition,'has_sequence_privilege(candidate.proowner,other_relation.oid')>0,
  'adapter_function_guard',strpos(adapter_definition,'has_function_privilege(candidate.proowner,other_function.oid')>0,
  'adapter_service_role_execute',has_function_privilege('service_role','public.joy8_product_adapter(regprocedure,text,uuid,jsonb)','EXECUTE'),
  'adapter_anon_execute',has_function_privilege('anon','public.joy8_product_adapter(regprocedure,text,uuid,jsonb)','EXECUTE'),
  'adapter_authenticated_execute',has_function_privilege('authenticated','public.joy8_product_adapter(regprocedure,text,uuid,jsonb)','EXECUTE')
) as platform_hardening
from definitions;
commit;
