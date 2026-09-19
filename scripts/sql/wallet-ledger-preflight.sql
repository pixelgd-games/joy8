begin read only;

select jsonb_build_object(
  'ledger_rows',(select count(*) from public.wallet_transactions),
  'nonempty_metadata',(select count(*) from public.wallet_transactions where metadata<>'{}'::jsonb),
  'open_matches',(select count(*) from public.joy8_matches where state='open'),
  'settlement_matches_reviewed_body',(select md5(replace(prosrc,E'\r',''))='7ac9e44264788ccbe292a57ff019a859' from pg_proc
    where oid='public.joy8_settle_match_v1(text,jsonb)'::regprocedure),
  'continuous_already_installed',exists(select 1 from pg_attribute
    where attrelid='public.joy8_matches'::regclass and attname='settlement_count' and not attisdropped),
  'routines_with_legacy_ledger_references',coalesce((select jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema') and p.prosrc like '%wallet_transactions%'
      and (p.prosrc ~ '\mround_id\M' or p.prosrc ~ '\mmetadata\M')),'[]'::jsonb),
  'column_dependencies',coalesce((select jsonb_agg(distinct pg_describe_object(d.classid,d.objid,d.objsubid))
    from pg_depend d join pg_attribute a on a.attrelid=d.refobjid and a.attnum=d.refobjsubid
    where d.refobjid='public.wallet_transactions'::regclass and a.attname in ('round_id','metadata')),'[]'::jsonb)
) as ledger_cleanup_preflight;

commit;
