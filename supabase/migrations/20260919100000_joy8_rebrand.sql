begin;

do $$
declare
  item record;
  target_name text;
begin
  for item in
    select *
    from (values
      ('public', 'looty_wallet_policies'),
      ('public', 'looty_game_policies'),
      ('public', 'looty_backend_keys'),
      ('public', 'looty_matches'),
      ('public', 'looty_match_participants'),
      ('public', 'looty_settlements'),
      ('public', 'looty_fee_accounts'),
      ('public', 'looty_settlement_entries'),
      ('public', 'looty_private_entries')
    ) as names(schema_name, object_name)
  loop
    target_name := replace(item.object_name, 'looty', 'joy8');
    if to_regclass(format('%I.%I', item.schema_name, target_name)) is not null then
      raise exception 'JOY8_REBRAND_TARGET_EXISTS';
    end if;
    if to_regclass(format('%I.%I', item.schema_name, item.object_name)) is not null then
      execute format(
        'alter table %I.%I rename to %I',
        item.schema_name,
        item.object_name,
        target_name
      );
    end if;
  end loop;

  for item in
    select
      n.nspname as schema_name,
      p.proname as object_name,
      pg_get_function_identity_arguments(p.oid) as identity_arguments,
      oidvectortypes(p.proargtypes) as argument_types
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'mahjong_clash')
      and p.prokind = 'f'
      and p.proname ilike '%looty%'
    order by p.oid
  loop
    target_name := replace(item.object_name, 'looty', 'joy8');
    if to_regprocedure(format(
      '%I.%I(%s)',
      item.schema_name,
      target_name,
      item.argument_types
    )) is not null then
      raise exception 'JOY8_REBRAND_TARGET_EXISTS';
    end if;
    execute format(
      'alter function %I.%I(%s) rename to %I',
      item.schema_name,
      item.object_name,
      item.identity_arguments,
      target_name
    );
  end loop;

  for item in
    select pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'mahjong_clash')
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%looty%'
    order by p.oid
  loop
    execute replace(
      replace(
        replace(item.definition, 'LOOTY', 'JOY8'),
        'Looty', 'Joy8'
      ),
      'looty', 'joy8'
    );
  end loop;

  for item in
    select n.nspname as schema_name, c.relname as table_name, con.conname as object_name
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'mahjong_clash')
      and con.conname ilike '%looty%'
    order by con.oid
  loop
    execute format(
      'alter table %I.%I rename constraint %I to %I',
      item.schema_name,
      item.table_name,
      item.object_name,
      replace(item.object_name, 'looty', 'joy8')
    );
  end loop;

  for item in
    select n.nspname as schema_name, c.relname as object_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'mahjong_clash')
      and c.relkind in ('i', 'I')
      and c.relname ilike '%looty%'
    order by c.oid
  loop
    execute format(
      'alter index %I.%I rename to %I',
      item.schema_name,
      item.object_name,
      replace(item.object_name, 'looty', 'joy8')
    );
  end loop;

  for item in
    select n.nspname as schema_name, c.relname as table_name, t.tgname as object_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'mahjong_clash')
      and not t.tgisinternal
      and t.tgname ilike '%looty%'
    order by t.oid
  loop
    execute format(
      'alter trigger %I on %I.%I rename to %I',
      item.object_name,
      item.schema_name,
      item.table_name,
      replace(item.object_name, 'looty', 'joy8')
    );
  end loop;

  for item in
    select schemaname as schema_name, tablename as table_name, policyname as object_name
    from pg_policies
    where schemaname in ('public', 'mahjong_clash')
      and policyname ilike '%looty%'
    order by schemaname, tablename, policyname
  loop
    execute format(
      'alter policy %I on %I.%I rename to %I',
      item.object_name,
      item.schema_name,
      item.table_name,
      replace(item.object_name, 'looty', 'joy8')
    );
  end loop;

  if exists(
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'mahjong_clash')
      and c.relname ilike '%looty%'
  ) or exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'mahjong_clash')
      and p.prokind = 'f'
      and (
        p.proname ilike '%looty%'
        or pg_get_functiondef(p.oid) ilike '%looty%'
      )
  ) then
    raise exception 'JOY8_REBRAND_INCOMPLETE';
  end if;
end;
$$;

commit;
