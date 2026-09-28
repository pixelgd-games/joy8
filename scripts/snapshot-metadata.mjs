const quote = value => `"${String(value).replaceAll('"', '""')}"`

export async function snapshotMetadata(source, schemas) {
  const owners = (await source.query("select n.nspname schema,c.relname name,r.rolname owner,c.relkind kind from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles r on r.oid=c.relowner where n.nspname=any($1) and c.relkind in ('r','p','v','m','S')", [schemas])).rows
  const functions = (await source.query("select n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,r.rolname owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname=any($1) and p.prokind='f'", [schemas])).rows
  const schemaOwners = (await source.query("select nspname name,pg_get_userbyid(nspowner) owner from pg_namespace where nspname=any($1)", [schemas])).rows
  const extensionSchema = (await source.query("select pg_get_userbyid(n.nspowner) owner,jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)) grants from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname='extensions' group by n.nspowner")).rows[0]
  const roles = (await source.query("select rolname,rolbypassrls from pg_roles where rolname !~ '^pg_' order by rolname")).rows
  const events = (await source.query("select evtname,evtevent,evtfoid::regproc::text function,evttags from pg_event_trigger where evtname like 'joy8_%'")).rows
  const tables = (await source.query("select schemaname,tablename from pg_tables where schemaname=any($1) order by schemaname,tablename", [schemas])).rows
  const counts = {}
  for (const table of tables) counts[`${table.schemaname}.${table.tablename}`] = (await source.query(`select count(*)::text n from ${quote(table.schemaname)}.${quote(table.tablename)}`)).rows[0].n
  return { schemas, counts, owners, functions, roles, events, schemaOwners, extensionSchema }
}
