begin;

lock table public.player_accounts,public.games,public.joy8_private_entries in access exclusive mode;
do $$
begin
  if exists(select 1 from public.player_accounts where display_name is not null) then
    raise exception 'JOY8_DISPLAY_NAMES_NOT_EMPTY';
  end if;
  if exists(select 1 from public.games where published) or exists(select 1 from public.joy8_private_entries where enabled) then
    raise exception 'JOY8_SESSION_CUTOVER_REQUIRES_PAUSED_ENTRIES';
  end if;
end;
$$;

create function public.joy8_issue_game_session(
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
    v_member.account_type,'POINT',now()+interval '1 hour',
    array['balance']::text[]
  ) returning * into v_session;
  return query select v_session.id,v_session.player_account_id,v_session.wallet_account_id,
    v_session.game_id,v_code,v_session.launch_code_expires_at,v_session.account_type,
    v_session.currency,v_session.expires_at,'server-v1'::text;
end;
$$;

create or replace function public.create_game_session(
  p_game_slug text,p_auth_user_id uuid
)
returns table (
  session_id uuid,player_account_id uuid,wallet_account_id uuid,game_id uuid,
  launch_code text,launch_code_expires_at timestamptz,account_type text,
  currency text,expires_at timestamptz,protocol text
)
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.games g where g.slug=btrim(p_game_slug)
    and g.published and nullif(btrim(g.launch_url),'') is not null for share;
  if not found then raise exception 'game is not available' using errcode='P0002'; end if;
  return query select * from public.joy8_issue_game_session(p_game_slug,p_auth_user_id);
end;
$$;

create or replace function public.joy8_create_private_session(p_game_slug text,p_auth_user_id uuid,p_origin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member record; v_entry record; v_session record;
begin
  select * into v_member from public.joy8_resolve_member(p_auth_user_id,false);
  if not found then raise exception 'player membership is required' using errcode='42501'; end if;
  select g.id,g.name,e.launch_url into v_entry from public.games g
    join public.joy8_private_entries e on e.game_id=g.id
    where g.slug=btrim(p_game_slug) and not g.published and e.enabled
      and e.entry_origin=p_origin for share of g,e;
  if not found then raise exception 'JOY8_PRIVATE_ENTRY_DENIED' using errcode='42501'; end if;
  select * into v_session from public.joy8_issue_game_session(p_game_slug,p_auth_user_id);
  return (to_jsonb(v_session)-'player_account_id'-'wallet_account_id') ||
    jsonb_build_object('player_account_ref',v_member.player_account_id,'game_name',v_entry.name,'launch_url',v_entry.launch_url);
end;
$$;

revoke all on function public.joy8_create_private_session(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.joy8_create_private_session(text,uuid,text) to service_role;


create or replace function public.joy8_platform_health_v1()
returns boolean language sql stable security definer set search_path = '' as $$
  select to_regprocedure('public.joy8_resolve_member(uuid,boolean)') is not null
    and to_regprocedure('public.create_game_session(text,uuid)') is not null
    and to_regprocedure('public.joy8_settle_match_v1(text,jsonb)') is not null
    and (select count(*)>=0 from (select id from public.games limit 1) g);
$$;
revoke all on function public.joy8_platform_health_v1() from public,anon,authenticated;
grant execute on function public.joy8_platform_health_v1() to service_role;


drop function public.create_game_session(text,text,integer,text,uuid);
drop function public.joy8_issue_game_session(text,text,integer,text,uuid);
alter table public.player_accounts drop column display_name;
revoke all on function public.joy8_issue_game_session(text,uuid),public.create_game_session(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_game_session(text,uuid) to service_role;
select public.joy8_validate_product_adapters();
notify pgrst,'reload schema';
commit;
