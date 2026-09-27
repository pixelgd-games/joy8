import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import pg from "pg"
import { restoreSnapshot } from "./restore-snapshot.mjs"

const ref = "lsazydefvnuqglultqii"
const quote = value => `"${String(value).replaceAll('"', '""')}"`
const clean = sql => sql.replace(/^\\(?:un)?restrict.*\r?\n/gm, "").replace(/^CREATE SCHEMA public;\r?\n/gm, "")
const run = promisify(execFile)
assert.equal(process.env.SUPABASE_PROJECT_ID, ref, "Use scripts/supabase-joy8.cmd recovery-snapshot")
assert.ok(process.env.SUPABASE_DB_PASSWORD)
assert.ok(path.isAbsolute(process.env.JOY8_PG_CLIENT_BIN || ""), "Set JOY8_PG_CLIENT_BIN to native PostgreSQL 17 client tools")
const endpoint = new URL((await readFile("supabase/.temp/pooler-url", "utf8")).trim())
assert.ok(decodeURIComponent(endpoint.username).endsWith(`.${ref}`))
const ca = await readFile("supabase/.temp/pgdelta/pgdelta-target-ca.crt", "utf8")
const source = new pg.Client({ host: endpoint.hostname, port: Number(endpoint.port) || 5432,
  user: decodeURIComponent(endpoint.username), password: process.env.SUPABASE_DB_PASSWORD,
  database: endpoint.pathname.slice(1), ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 10000 })
try {
  await source.connect()
  await source.query("begin isolation level repeatable read read only")
  const snapshot = (await source.query("select pg_export_snapshot() id")).rows[0].id
  const schemas = ["auth", "public", ...(await source.query("select schema_name from public.joy8_product_schemas order by schema_name")).rows.map(row => row.schema_name)]
  const owners = (await source.query("select n.nspname schema,c.relname name,r.rolname owner,c.relkind kind from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles r on r.oid=c.relowner where n.nspname=any($1) and n.nspname not in ('auth','public') and c.relkind in ('r','p','v','m','S')", [schemas])).rows
  const functions = (await source.query("select n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,r.rolname owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname=any($1) and n.nspname not in ('auth','public') and p.prokind='f'", [schemas])).rows
  const schemaOwners = (await source.query("select nspname name,pg_get_userbyid(nspowner) owner from pg_namespace where nspname=any($1) and nspname not in ('auth','public')", [schemas])).rows
  const roles = (await source.query("select rolname,rolbypassrls from pg_roles where rolname !~ '^pg_' order by rolname")).rows
  const events = (await source.query("select evtname,evtevent,evtfoid::regproc::text function,evttags from pg_event_trigger where evtname like 'joy8_%'")).rows
  const tables = (await source.query("select schemaname,tablename from pg_tables where schemaname=any($1) order by schemaname,tablename", [schemas])).rows
  const counts = {}
  for (const table of tables) counts[`${table.schemaname}.${table.tablename}`] = (await source.query(`select count(*)::text n from ${quote(table.schemaname)}.${quote(table.tablename)}`)).rows[0].n
  const directory = path.resolve(".recovery.local", new Date().toISOString().replaceAll(/[:.]/g, "-"))
  await mkdir(directory, { recursive: true })
  const files = {}
  for (const section of ["pre-data", "data", "post-data"]) {
    const result = await run(path.join(process.env.JOY8_PG_CLIENT_BIN, process.platform === "win32" ? "pg_dump.exe" : "pg_dump"),
      ["--no-owner", "--no-comments", "--no-password", "--inserts", `--snapshot=${snapshot}`, `--section=${section}`, ...schemas.map(schema => `--schema=${schema}`)], {
        windowsHide: true, timeout: 120000, maxBuffer: 128 * 1024 * 1024,
        env: { ...process.env, PGHOST: endpoint.hostname, PGPORT: endpoint.port || "5432", PGDATABASE: endpoint.pathname.slice(1),
          PGUSER: decodeURIComponent(endpoint.username), PGPASSWORD: process.env.SUPABASE_DB_PASSWORD, PGSSLMODE: "verify-full",
          PGSSLROOTCERT: path.resolve("supabase/.temp/pgdelta/pgdelta-target-ca.crt") },
      })
    files[section] = clean(result.stdout)
    await writeFile(path.join(directory, `${section}.sql`), files[section], { mode: 0o600 })
  }
  await source.query("commit")
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ ref, schemas, counts, owners, functions, roles, events, schemaOwners,
    sha256: Object.fromEntries(Object.entries(files).map(([key, value]) => [key, createHash("sha256").update(value).digest("hex")])) }, null, 2), { mode: 0o600 })
  console.log("Consistent hosted snapshot saved locally; restoring into an isolated PostgreSQL 17 process.")
  await restoreSnapshot(directory)
} catch (error) {
  console.error(`Recovery verification failed: ${String(error.message).replaceAll(process.env.SUPABASE_DB_PASSWORD, "[redacted]")}`)
  process.exitCode = 1
} finally { await source.end() }
