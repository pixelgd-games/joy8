begin read only;
select jsonb_build_object(
  'auth_users',(select count(*) from auth.users),
  'auth_identity_hash',(select md5(coalesce(string_agg(id::text,',' order by id),'')) from auth.users),
  'players',(select count(*) from public.player_accounts),
  'player_hash',(select md5(coalesce(string_agg(row_to_json(p)::text,',' order by p.id),'')) from public.player_accounts p),
  'games',(select count(*) from public.games),
  'catalog_hash',(select md5(coalesce(string_agg(row_to_json(g)::text,',' order by g.id),'')) from public.games g),
  'admins',(select count(*) from public.admin_users),
  'admin_hash',(select md5(coalesce(string_agg(row_to_json(a)::text,',' order by row_to_json(a)::text),'')) from public.admin_users a)
) as identity_snapshot;
commit;
