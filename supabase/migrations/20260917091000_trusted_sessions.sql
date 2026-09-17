begin;

create function public.create_game_session(
  p_game_slug text,p_currency text default 'POINT',p_expires_in_seconds integer default 3600,
  p_display_name text default null,p_auth_user_id uuid default null
)
returns table (
  session_id uuid,player_account_id uuid,wallet_account_id uuid,game_id uuid,
  launch_code text,launch_code_expires_at timestamptz,account_type text,
  currency text,expires_at timestamptz,protocol text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_game uuid;
  v_member record;
  v_wallet uuid;
  v_session public.game_sessions%rowtype;
  v_code text;
begin
  select g.id into v_game from public.games g where g.slug=btrim(p_game_slug)
    and g.published and nullif(btrim(g.launch_url),'') is not null;
  if v_game is null then raise exception 'game is not available' using errcode='P0002'; end if;
  if upper(btrim(coalesce(p_currency,'POINT'))) <> 'POINT'
    or coalesce(p_expires_in_seconds,3600) not between 60 and 86400
    or length(coalesce(p_display_name,''))>120 then
    raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023';
  end if;
  select * into v_member from public.looty_resolve_member(p_auth_user_id,false);
  if not found then raise exception 'player membership is required' using errcode='42501'; end if;
  v_wallet := public.looty_provision_wallet(v_member.player_account_id,v_game);
  if nullif(btrim(p_display_name),'') is not null then
    update public.player_accounts set display_name=btrim(p_display_name)
      where id=v_member.player_account_id and display_name is null;
  end if;
  v_code := encode(extensions.gen_random_bytes(32),'hex');
  insert into public.game_sessions (
    player_account_id,wallet_account_id,game_id,launch_code_hash,launch_code_expires_at,
    account_type,currency,expires_at,gateway_token_scopes
  ) values (
    v_member.player_account_id,v_wallet,v_game,public.looty_hash_secret(v_code),
    now()+least(coalesce(p_expires_in_seconds,3600),120)*interval '1 second',
    v_member.account_type,'POINT',now()+coalesce(p_expires_in_seconds,3600)*interval '1 second',
    array['balance']::text[]
  ) returning * into v_session;
  return query select v_session.id,v_session.player_account_id,v_session.wallet_account_id,
    v_session.game_id,v_code,v_session.launch_code_expires_at,v_session.account_type,
    v_session.currency,v_session.expires_at,'server-v1'::text;
end;
$$;

create function public.looty_active_session(p_gateway_token text,p_required_scope text default null)
returns table (
  session_id uuid,player_account_id uuid,wallet_account_id uuid,game_id uuid,
  account_type text,currency text,gateway_token_scopes text[]
)
language sql stable security definer set search_path = '' as $$
  select s.id,s.player_account_id,s.wallet_account_id,s.game_id,
    s.account_type,s.currency,s.gateway_token_scopes
  from public.game_sessions s
  join public.player_accounts p on p.id=s.player_account_id
  join public.wallet_accounts w on w.id=s.wallet_account_id
  where s.gateway_token_hash=public.looty_hash_secret(p_gateway_token)
    and s.gateway_token_expires_at>now() and s.expires_at>now() and s.status='active'
    and p.status='active' and w.status='active'
    and p_required_scope='balance'
    and (p_required_scope is null or p_required_scope=any(s.gateway_token_scopes));
$$;

create function public.looty_assert_player(p_player uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_auth uuid;
begin
  select p.auth_user_id into v_auth from public.player_accounts p where p.id=p_player;
  perform 1 from auth.users u where u.id=v_auth and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now())
    and (u.is_anonymous or u.email_confirmed_at is not null) for share;
  if not found then raise exception 'LOOTY_PLAYER_INACTIVE' using errcode='42501'; end if;
  perform 1 from public.player_accounts p where p.id=p_player and p.status='active'
    and p.member_enrolled_at is not null for share;
  if not found then raise exception 'LOOTY_PLAYER_INACTIVE' using errcode='42501'; end if;
end;
$$;

create or replace function public.wallet_get_balance(p_gateway_token text)
returns table (session_id uuid,player_account_id uuid,wallet_account_id uuid,
  currency text,balance numeric,locked_balance numeric)
language plpgsql security definer set search_path = '' as $$
declare v_session record;
begin
  select * into v_session from public.looty_active_session(p_gateway_token,'balance');
  if not found then raise exception 'game session is not active' using errcode='P0002'; end if;
  return query select v_session.session_id,v_session.player_account_id,w.id,w.currency,
    w.balance-w.locked_balance,w.locked_balance
    from public.wallet_accounts w where w.id=v_session.wallet_account_id and w.status='active';
end;
$$;

create function public.looty_server_session_v1(p_secret text,p_action text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_game uuid;
  v_session public.game_sessions%rowtype;
  v_token text;
  v_expiry timestamptz;
begin
  if p_action not in ('exchange','renew') or jsonb_typeof(p_request) is distinct from 'object'
    or p_request->>'version' is distinct from '1'
    or (p_request - array['version','launch_code','session_id']) <> '{}'::jsonb then
    raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023';
  end if;
  v_game := public.looty_backend_game(p_secret,p_action);
  if p_action='exchange' then
    if p_request ? 'session_id' or coalesce(p_request->>'launch_code','') !~ '^[a-f0-9]{64}$' then
      raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023';
    end if;
    select s.* into v_session from public.game_sessions s
    where s.launch_code_hash=public.looty_hash_secret(p_request->>'launch_code') and s.game_id=v_game
     ;
  else
    if p_request ? 'launch_code' then raise exception 'LOOTY_INVALID_REQUEST' using errcode='22023'; end if;
    select s.* into v_session from public.game_sessions s where s.id=(p_request->>'session_id')::uuid
      and s.game_id=v_game and s.launch_code_used_at is not null;
  end if;
  if not found then raise exception 'LOOTY_SESSION_INVALID' using errcode='42501'; end if;
  perform public.looty_assert_player(v_session.player_account_id);
  perform 1 from public.wallet_accounts w where w.id=v_session.wallet_account_id and w.status='active' for share;
  if not found then raise exception 'LOOTY_WALLET_INACTIVE' using errcode='42501'; end if;
  select s.* into v_session from public.game_sessions s where s.id=v_session.id for update;
  if v_session.status<>'active' or v_session.expires_at<=now()
    or (p_action='exchange' and (v_session.launch_code_used_at is not null or v_session.launch_code_expires_at<=now())) then
    raise exception 'LOOTY_SESSION_INVALID' using errcode='42501';
  end if;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  v_expiry := least(v_session.expires_at,now()+interval '15 minutes');
  update public.game_sessions set launch_code_used_at=coalesce(launch_code_used_at,now()),
    gateway_token_hash=public.looty_hash_secret(v_token),gateway_token_expires_at=v_expiry,
    gateway_token_scopes=array['balance']::text[] where id=v_session.id;
  return (select jsonb_build_object('version',1,'session_id',v_session.id,'game_id',v_game,
    'player_account_ref',v_session.player_account_id,'account_type',v_session.account_type,
    'wallet_scope',case when p.game_id is null then 'platform' else 'game' end,
    'currency',v_session.currency,'gateway_token',v_token,
    'gateway_token_expires_at',v_expiry,'expires_at',v_session.expires_at,'scopes',jsonb_build_array('balance'))
    from public.wallet_accounts w join public.looty_wallet_policies p on p.id=w.wallet_policy_id
    where w.id=v_session.wallet_account_id);
end;
$$;

revoke all on function public.create_game_session(text,text,integer,text,uuid),
  public.looty_active_session(text,text),
  public.looty_assert_player(uuid),public.looty_server_session_v1(text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.create_game_session(text,text,integer,text,uuid),
  public.looty_server_session_v1(text,text,jsonb) to service_role;

commit;
