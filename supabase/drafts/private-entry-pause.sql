begin;

do $$
begin
  if exists(select 1 from public.joy8_matches where state='open') then
    raise exception 'JOY8_ENTRY_PAUSE_REQUIRES_MATCH_REVIEW';
  end if;
  if exists(select 1 from public.joy8_backend_keys where revoked_at is null and expires_at>now()
    and scopes && array['open','settle','cancel']::text[]) then
    raise exception 'JOY8_ENTRY_PAUSE_REQUIRES_KEY_REVIEW';
  end if;
end;
$$;

update public.joy8_private_entries e set enabled=false
from public.games g where g.id=e.game_id and g.slug in ('mahjong-clash','monster-lab') and not g.published;

commit;
