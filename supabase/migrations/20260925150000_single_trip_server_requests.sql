begin;

create function public.joy8_server_request_v1(
  p_route text, p_ingress_key text, p_ingress_limit integer, p_ingress_window integer,
  p_secret text, p_request jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_admission jsonb;
  v_action text;
  v_result jsonb;
begin
  if not public.joy8_consume_gateway_rate_limit(p_ingress_key,p_ingress_limit,p_ingress_window) then
    return jsonb_build_object('limited',true,'retry_after',p_ingress_window);
  end if;
  if p_secret is null or p_request is null then
    return jsonb_build_object('precheck',true);
  end if;
  v_admission:=public.joy8_admit_gateway_request(p_route,p_request,p_secret,null);
  if v_admission ? 'error' then
    return jsonb_build_object('admission_error',v_admission->>'error');
  end if;
  if (v_admission->>'allowed')::boolean is distinct from true then
    return jsonb_build_object('limited',true,'retry_after',v_admission->'retry_after');
  end if;
  v_action:=substring(p_route from 8 for length(p_route)-10);
  begin
    if v_action in ('exchange','renew') then
      v_result:=public.joy8_server_session_v1(p_secret,v_action,p_request);
    elsif v_action='open' then
      v_result:=public.joy8_open_match_v1(p_secret,p_request);
    elsif v_action='settle' then
      v_result:=public.joy8_settle_match_v1(p_secret,p_request);
    elsif v_action in ('status','cancel') then
      v_result:=public.joy8_match_status_v1(p_secret,p_request,v_action='cancel');
    else
      return jsonb_build_object('admission_error','JOY8_INVALID_REQUEST');
    end if;
  exception when others then
    return jsonb_build_object('error',jsonb_build_object('message',SQLERRM,'code',SQLSTATE));
  end;
  return jsonb_build_object('result',v_result);
end;
$$;

revoke all on function public.joy8_server_request_v1(text,text,integer,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.joy8_server_request_v1(text,text,integer,integer,text,jsonb) to service_role;

commit;
