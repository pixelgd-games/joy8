begin;

create or replace function public.joy8_issue_game_session(
  p_game_slug text,p_auth_user_id uuid
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
  if p_game_slug is null or p_game_slug !~ '^[a-z0-9-]{1,80}$' then raise exception 'JOY8_INVALID_REQUEST' using errcode='22023'; end if;
  select g.id into v_game from public.games g where g.slug=btrim(p_game_slug);
  if v_game is null then raise exception 'game is not available' using errcode='P0002'; end if;
  select * into v_member from public.joy8_resolve_member(p_auth_user_id,false);
  if not found then raise exception 'player membership is required' using errcode='42501'; end if;
  v_wallet := public.joy8_provision_wallet(v_member.player_account_id,v_game);
  v_code := encode(extensions.gen_random_bytes(32),'hex');
  insert into public.game_sessions (
    player_account_id,wallet_account_id,game_id,launch_code_hash,launch_code_expires_at,
    account_type,currency,expires_at,gateway_token_scopes
  ) values (
    v_member.player_account_id,v_wallet,v_game,public.joy8_hash_secret(v_code),
    now()+interval '120 seconds',
    v_member.account_type,'POINT',now()+interval '12 hours',
    array['balance']::text[]
  ) returning * into v_session;
  return query select v_session.id,v_session.player_account_id,v_session.wallet_account_id,
    v_session.game_id,v_code,v_session.launch_code_expires_at,v_session.account_type,
    v_session.currency,v_session.expires_at,'server-v1'::text;
end;
$$;


commit;
