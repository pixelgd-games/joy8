select jsonb_build_object(
  'catalog',(select coalesce(jsonb_agg(t),'[]') from (select g.slug,g.published,
  coalesce(p.enabled,false) as game_policy_enabled,
  coalesce(w.enabled and w.currency='POINT',false) as wallet_policy_enabled,
  exists(select 1 from public.joy8_backend_keys k where k.game_id=g.id and k.revoked_at is null
    and k.scopes @> array['exchange','renew','open','settle','status','cancel']::text[]) as backend_ready,
  coalesce(e.enabled,false) as independent_entry_enabled
from public.games g
left join public.joy8_game_policies p on p.game_id=g.id
left join public.joy8_wallet_policies w on w.id=p.wallet_policy_id
left join public.joy8_private_entries e on e.game_id=g.id
order by g.slug) t),
  'nonempty_definer_paths',(select coalesce(jsonb_agg(t),'[]') from (select p.proname,p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'],false)
order by p.proname) t),
  'catalog_policies',(select coalesce(jsonb_agg(t),'[]') from (select policyname,with_check from pg_policies where schemaname='public' and tablename='games') t),
  'function_defaults',(select coalesce(jsonb_agg(t),'[]') from (select pg_get_userbyid(defaclrole) as owner,defaclnamespace::regnamespace as schema,defaclobjtype,defaclacl
from pg_default_acl where defaclobjtype='f') t)
) as review_status;
