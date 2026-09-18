begin read only;
select jsonb_build_object(
  'auth',(select jsonb_build_object('count',count(*),'ids',md5(string_agg(id::text,',' order by id))) from auth.users),
  'players',(select jsonb_build_object('count',count(*),'ids',md5(string_agg(id::text,',' order by id))) from public.player_accounts),
  'existing_catalog',(select jsonb_build_object('count',count(*),'records',md5(string_agg(to_jsonb(g)::text,',' order by id))) from public.games g where slug<>'mahjong-clash'),
  'admins',(select count(*) from public.admin_users),
  'wallets',(select count(*) from public.wallet_accounts),
  'transactions',(select count(*) from public.wallet_transactions),
  'sessions',(select count(*) from public.game_sessions),
  'matches',(select count(*) from public.looty_matches),
  'settlements',(select count(*) from public.looty_settlements)
) as installation_snapshot;
commit;
