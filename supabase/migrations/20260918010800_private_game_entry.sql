begin;

create table public.looty_private_entries (
  game_id uuid primary key references public.games(id) on delete restrict,
  entry_origin text not null check(entry_origin ~ '^https://[a-z0-9.-]+(:[0-9]+)?$' or entry_origin='http://localhost:5173'),
  launch_url text not null check(launch_url ~ '^https://' or launch_url='http://localhost:4391/'),
  enabled boolean not null default false,
  check(launch_url<>'http://localhost:4391/' or entry_origin='http://localhost:5173')
);
create table public.looty_private_players (
  game_id uuid not null references public.looty_private_entries(game_id) on delete restrict,
  player_account_id uuid not null references public.player_accounts(id) on delete restrict,
  expires_at timestamptz not null,
  primary key(game_id,player_account_id)
);
alter table public.looty_private_entries enable row level security;
alter table public.looty_private_players enable row level security;
revoke all on public.looty_private_entries,public.looty_private_players from public,anon,authenticated,service_role;

create function public.looty_issue_game_session(
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
  select g.id into v_game from public.games g where g.slug=btrim(p_game_slug);
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

create or replace function public.create_game_session(
  p_game_slug text,p_currency text default 'POINT',p_expires_in_seconds integer default 3600,
  p_display_name text default null,p_auth_user_id uuid default null
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
  return query select * from public.looty_issue_game_session(p_game_slug,p_currency,p_expires_in_seconds,p_display_name,p_auth_user_id);
end;
$$;

create function public.looty_create_private_session(p_game_slug text,p_auth_user_id uuid,p_origin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member record; v_entry record; v_session record;
begin
  select * into v_member from public.looty_resolve_member(p_auth_user_id,false);
  if not found then raise exception 'player membership is required' using errcode='42501'; end if;
  select g.id,g.name,e.launch_url into v_entry from public.games g
    join public.looty_private_entries e on e.game_id=g.id
    join public.looty_private_players p on p.game_id=g.id
    where g.slug=btrim(p_game_slug) and not g.published and e.enabled
      and e.entry_origin=p_origin and p.player_account_id=v_member.player_account_id
      and p.expires_at>now() for share of g,e,p;
  if not found then raise exception 'LOOTY_PRIVATE_ENTRY_DENIED' using errcode='42501'; end if;
  select * into v_session from public.looty_issue_game_session(p_game_slug,'POINT',3600,null,p_auth_user_id);
  return (to_jsonb(v_session)-'player_account_id'-'wallet_account_id') ||
    jsonb_build_object('player_account_ref',v_member.player_account_id,'game_name',v_entry.name,'launch_url',v_entry.launch_url);
end;
$$;

revoke all on function public.looty_issue_game_session(text,text,integer,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_game_session(text,text,integer,text,uuid),public.looty_create_private_session(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.create_game_session(text,text,integer,text,uuid),public.looty_create_private_session(text,uuid,text) to service_role;

commit;
