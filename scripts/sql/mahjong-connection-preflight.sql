select g.id game_id,g.published,g.launch_url,w.enabled wallet_enabled,w.initial_credit,
  r.rolcanlogin,r.rolsuper,r.rolbypassrls,
  exists(select 1 from public.joy8_game_policies p where p.game_id=g.id) game_policy_present,
  exists(select 1 from public.joy8_backend_keys k where k.game_id=g.id and k.revoked_at is null and k.expires_at>now()) backend_key_present,
  to_regclass('public.joy8_private_entries') is not null private_entry_installed
from public.games g join public.joy8_wallet_policies w on w.game_id=g.id
  cross join pg_roles r where g.slug='mahjong-clash' and r.rolname='mahjong_clash_runtime';
