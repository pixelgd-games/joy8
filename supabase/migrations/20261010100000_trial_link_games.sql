begin;
set local lock_timeout='5s';

alter table public.games add column launch_mode text not null default 'joy8'
  constraint games_launch_mode_check check (launch_mode in ('joy8','trial'));

drop policy games_admin_insert on public.games;
drop policy games_admin_update on public.games;
drop function public.joy8_game_readiness(uuid,text,text,text);

create function public.joy8_game_readiness(p_game_id uuid,p_slug text,p_launch_url text,p_thumbnail text,p_launch_mode text)
returns text[] language plpgsql stable security definer set search_path='' as $$
declare
  v_missing text[] := array[]::text[];
  v_policy public.joy8_game_policies%rowtype;
begin
  if not public.is_joy8_admin() then raise exception 'JOY8_ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_game_id is null then v_missing:=array_append(v_missing,'save_draft'); end if;
  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,80}$' then v_missing:=array_append(v_missing,'slug'); end if;
  if p_launch_url is null or p_launch_url !~ '^https://[^/@[:space:]]+([/?#]|$)'
    or p_launch_url ~ '[[:space:]]' then v_missing:=array_append(v_missing,'https_url'); end if;
  if p_thumbnail is null or p_thumbnail is distinct from '/games/'||p_slug||'/cover.webp' then
    v_missing:=array_append(v_missing,'cover');
  end if;
  if p_launch_mode is distinct from 'joy8' then
    if p_launch_mode is distinct from 'trial' then v_missing:=array_append(v_missing,'launch_mode'); end if;
    return v_missing;
  end if;
  select * into v_policy from public.joy8_game_policies where game_id=p_game_id;
  if not found or not v_policy.enabled then v_missing:=array_append(v_missing,'game_policy'); end if;
  if not exists(select 1 from public.joy8_wallet_policies where id=v_policy.wallet_policy_id and enabled and currency='POINT') then
    v_missing:=array_append(v_missing,'wallet_policy');
  end if;
  if not exists(select 1 from public.joy8_backend_keys where game_id=p_game_id and revoked_at is null
    and scopes @> array['exchange','renew','open','settle','status','cancel']::text[]) then
    v_missing:=array_append(v_missing,'backend_key');
  end if;
  if v_policy.product_adapter is not null then
    begin
      perform public.joy8_validate_product_adapter(v_policy.product_adapter);
    exception when others then v_missing:=array_append(v_missing,'product_adapter');
    end;
  end if;
  return v_missing;
end;
$$;
revoke all on function public.joy8_game_readiness(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.joy8_game_readiness(uuid,text,text,text,text) to authenticated;

create policy games_admin_insert on public.games for insert to authenticated
  with check (public.is_joy8_admin() and ((not published)
    or cardinality(public.joy8_game_readiness(id,slug,launch_url,thumbnail,launch_mode))=0));
create policy games_admin_update on public.games for update to authenticated
  using (public.is_joy8_admin())
  with check (public.is_joy8_admin() and ((not published)
    or cardinality(public.joy8_game_readiness(id,slug,launch_url,thumbnail,launch_mode))=0));

drop view public.public_games_v1;
drop function public.joy8_public_games_v1();

create function public.joy8_public_games_v1()
returns table(id uuid,slug text,name text,type text,thumbnail text,created_at timestamptz,launch_url text,sort_order integer,launch_mode text)
language sql stable security definer set search_path='' as $$
  select g.id,g.slug,g.name,g.type,g.thumbnail,g.created_at,g.launch_url,g.sort_order,g.launch_mode
  from public.games g
  where g.published = true
    and g.launch_url is not null
    and btrim(g.launch_url) <> ''
  order by g.sort_order, g.created_at desc;
$$;
revoke all on function public.joy8_public_games_v1() from public,anon,authenticated,service_role;
grant execute on function public.joy8_public_games_v1() to anon,authenticated,service_role;

create view public.public_games_v1 with (security_invoker=true, security_barrier=true) as
  select id,slug,name,type,thumbnail,created_at,launch_url,sort_order,launch_mode
  from public.joy8_public_games_v1();
revoke all on public.public_games_v1 from public,anon,authenticated,service_role;
grant select on public.public_games_v1 to anon,authenticated,service_role;

create or replace function public.create_game_session(p_game_slug text, p_auth_user_id uuid)
returns table(session_id uuid, player_account_id uuid, wallet_account_id uuid, game_id uuid, launch_code text, launch_code_expires_at timestamptz, account_type text, currency text, expires_at timestamptz, protocol text)
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.games g where g.slug=btrim(p_game_slug)
    and g.published and g.launch_mode='joy8' and nullif(btrim(g.launch_url),'') is not null for share;
  if not found then raise exception 'game is not available' using errcode='P0002'; end if;
  return query select * from public.joy8_issue_game_session(p_game_slug,p_auth_user_id);
end;
$$;

commit;
