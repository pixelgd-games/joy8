begin read only;
select jsonb_build_object(
'tables',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select n.nspname as schema,c.relname as table_name,
  (xpath('/row/n/text()',query_to_xml(format('select count(*) as n from %I.%I',n.nspname,c.relname),false,true,'')))[1]::text::bigint as rows
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind='r' and n.nspname in ('public','auth','mahjong_clash') order by 1,2) r),
'players',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select p.id,p.auth_user_id,p.public_id,
  exists(select 1 from public.admin_users a join auth.users u on lower(a.email)=lower(u.email) where u.id=p.auth_user_id) as administrator,
  (select count(*) from public.wallet_accounts w where w.player_account_id=p.id) as wallets
from public.player_accounts p order by p.id) r),
'open_matches',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select id,game_id,match_ref,state,settlement_count from public.joy8_matches where state='open') r),
'triggers',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and n.nspname='public' order by c.relname,t.tgname) r),
'foreign_keys',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select conrelid::regclass::text as table_name,confrelid::regclass::text as referenced_table,pg_get_constraintdef(oid) as definition
from pg_constraint where contype='f' and (connamespace='public'::regnamespace or confrelid='auth.users'::regclass) order by 1,2) r)
) as inventory;
commit;
