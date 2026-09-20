begin;

create index game_sessions_game_launch_code_idx on public.game_sessions(game_id,launch_code_hash)
  where launch_code_hash is not null;

create function public.joy8_admit_gateway_request(
  p_route text, p_request jsonb default '{}'::jsonb,
  p_secret text default null, p_auth_user_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_game uuid;
  v_subject uuid;
  v_action text;
  v_key text;
  v_limit integer:=120;
  v_window integer:=60;
  v_session public.game_sessions%rowtype;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    return jsonb_build_object('error','JOY8_INVALID_REQUEST');
  end if;
  if p_route in ('member','enroll-member','create-session','private-session') then
    if p_auth_user_id is null or not exists(select 1 from auth.users u where u.id=p_auth_user_id
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then
      return jsonb_build_object('error','JOY8_PLAYER_INACTIVE');
    end if;
    v_key:='player:'||p_auth_user_id::text||':'||p_route;
    if p_route<>'member' then v_limit:=30; v_window:=300; end if;
  elsif p_route='balance' then
    select s.player_account_id into v_subject from public.joy8_active_session(p_request->>'gateway_token','balance') s;
    if not found then return jsonb_build_object('error','JOY8_SESSION_INVALID'); end if;
    select p.auth_user_id into v_subject from public.player_accounts p where p.id=v_subject;
    if v_subject is null then return jsonb_build_object('error','JOY8_PLAYER_INACTIVE'); end if;
    v_key:='player:'||v_subject::text||':balance';
  elsif p_route in ('server-exchange-v1','server-renew-v1','server-open-v1','server-settle-v1','server-status-v1','server-cancel-v1') then
    v_action:=substring(p_route from 8 for length(p_route)-10);
    begin
      v_game:=public.joy8_backend_game(p_secret,v_action);
    exception when invalid_authorization_specification then
      return jsonb_build_object('error','JOY8_BACKEND_UNAUTHORIZED');
    end;
    if not public.joy8_consume_gateway_rate_limit('backend:'||v_game::text,6000,60) then
      return jsonb_build_object('allowed',false,'retry_after',60);
    end if;
    if p_request->>'version' is distinct from '1' then
      return jsonb_build_object('error','JOY8_INVALID_REQUEST');
    end if;
    if v_action in ('exchange','renew') then
      if v_action='exchange' then
        if coalesce(p_request->>'launch_code','') !~ '^[a-f0-9]{64}$' then
          return jsonb_build_object('error','JOY8_INVALID_REQUEST');
        end if;
        select s.* into v_session from public.game_sessions s
          where s.launch_code_hash=public.joy8_hash_secret(p_request->>'launch_code') and s.game_id=v_game;
      else
        if coalesce(p_request->>'session_id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
          return jsonb_build_object('error','JOY8_INVALID_REQUEST');
        end if;
        select s.* into v_session from public.game_sessions s
          where s.id=(p_request->>'session_id')::uuid and s.game_id=v_game and s.launch_code_used_at is not null;
      end if;
      if v_session.id is null or v_session.status<>'active' or v_session.expires_at<=now() then
        return jsonb_build_object('error','JOY8_SESSION_INVALID');
      end if;
      v_key:='session:'||v_session.id::text||':login';
      v_limit:=30;
    elsif v_action='open' then
      v_key:='backend:'||v_game::text||':open';
      v_limit:=120;
    else
      if coalesce(length(p_request->>'match_ref'),0) not between 1 and 120 then
        return jsonb_build_object('error','JOY8_INVALID_REQUEST');
      end if;
      select m.id into v_subject from public.joy8_matches m
        where m.game_id=v_game and m.match_ref=p_request->>'match_ref';
      if not found then return jsonb_build_object('error','JOY8_MATCH_NOT_FOUND'); end if;
      v_key:='match:'||v_subject::text||':'||v_action;
      if v_action in ('settle','cancel') then v_limit:=30; end if;
    end if;
  else
    return jsonb_build_object('error','JOY8_INVALID_REQUEST');
  end if;
  return jsonb_build_object('allowed',public.joy8_consume_gateway_rate_limit(v_key,v_limit,v_window),'retry_after',v_window);
end;
$$;

revoke all on function public.joy8_admit_gateway_request(text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.joy8_admit_gateway_request(text,jsonb,text,uuid) to service_role;

commit;
