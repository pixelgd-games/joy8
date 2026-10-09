begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.joy8_member_lobby_v1(p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admission jsonb;
  v_member record;
  v_wallet jsonb;
  v_mail jsonb;
begin
  v_admission:=public.joy8_admit_gateway_request('member','{}'::jsonb,null,p_auth_user_id);
  if v_admission ? 'error' then
    return jsonb_build_object('admission_error',v_admission->>'error');
  end if;
  if (v_admission->>'allowed')::boolean is distinct from true then
    return jsonb_build_object('limited',true,'retry_after',v_admission->'retry_after');
  end if;
  begin
    select m.player_account_id,m.account_type,m.public_id into v_member
      from public.joy8_resolve_member_profile(p_auth_user_id,false) m;
    if not found then
      return jsonb_build_object('result',jsonb_build_object('member',null));
    end if;
    v_wallet:=public.joy8_member_wallet_v1(p_auth_user_id)->'wallet';
  exception when others then
    return jsonb_build_object('error',jsonb_build_object('message',SQLERRM,'code',SQLSTATE));
  end;
  begin
    v_mail:=public.joy8_member_mail(p_auth_user_id,'list','{}'::jsonb);
  exception when others then
    v_mail:=null;
  end;
  return jsonb_build_object('result',jsonb_build_object(
    'member',jsonb_build_object('player_account_ref',v_member.player_account_id,
      'public_id',v_member.public_id,'account_type',v_member.account_type),
    'wallet',v_wallet,'mail',v_mail));
end;
$$;

revoke all on function public.joy8_member_lobby_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.joy8_member_lobby_v1(uuid) to service_role;

commit;
