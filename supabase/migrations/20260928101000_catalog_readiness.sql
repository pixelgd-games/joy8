begin;
set local lock_timeout='5s';

create function public.joy8_game_readiness(p_game_id uuid,p_slug text,p_launch_url text,p_thumbnail text)
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
revoke all on function public.joy8_game_readiness(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.joy8_game_readiness(uuid,text,text,text) to authenticated;

alter policy games_admin_insert on public.games
with check(public.is_joy8_admin() and (not published or cardinality(public.joy8_game_readiness(id,slug,launch_url,thumbnail))=0));
alter policy games_admin_update on public.games
with check(public.is_joy8_admin() and (not published or cardinality(public.joy8_game_readiness(id,slug,launch_url,thumbnail))=0));

select public.joy8_validate_product_adapters();
commit;
