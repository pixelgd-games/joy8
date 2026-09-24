begin;

create or replace function public.joy8_backend_game(p_secret text,p_scope text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_game uuid;
begin
  if p_secret is null or p_secret !~ '^[a-f0-9]{64}$' then
    raise exception 'JOY8_BACKEND_UNAUTHORIZED' using errcode='28000';
  end if;
  select k.game_id into v_game from public.joy8_backend_keys k
  where k.key_hash=public.joy8_hash_secret(p_secret) and k.revoked_at is null
    and p_scope=any(k.scopes) for share;
  if not found then raise exception 'JOY8_BACKEND_UNAUTHORIZED' using errcode='28000'; end if;
  return v_game;
end;
$$;

alter table public.joy8_backend_keys drop column expires_at;

do $$
begin
  if exists(select 1 from pg_roles where rolname='mahjong_clash_runtime') then
    alter role mahjong_clash_runtime valid until 'infinity';
  end if;
end;
$$;

select public.joy8_validate_product_adapters();

commit;
