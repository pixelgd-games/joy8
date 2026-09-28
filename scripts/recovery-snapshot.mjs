import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import pg from "pg"
import { restoreSnapshot } from "./restore-snapshot.mjs"
import { snapshotMetadata } from "./snapshot-metadata.mjs"

const ref = "lsazydefvnuqglultqii"
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
  await source.query("set local search_path=''")
  const snapshot = (await source.query("select pg_export_snapshot() id")).rows[0].id
  const schemas = ["auth", "public", ...(await source.query("select schema_name from public.joy8_product_schemas order by schema_name")).rows.map(row => row.schema_name)]
  const metadata = await snapshotMetadata(source, schemas)
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
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ ref, ...metadata,
    sha256: Object.fromEntries(Object.entries(files).map(([key, value]) => [key, createHash("sha256").update(value).digest("hex")])) }, null, 2), { mode: 0o600 })
  console.log("Consistent hosted snapshot saved locally; restoring into an isolated PostgreSQL 17 process.")
  await restoreSnapshot(directory)
} catch (error) {
  console.error(`Recovery verification failed: ${String(error.message).replaceAll(process.env.SUPABASE_DB_PASSWORD, "[redacted]")}`)
  process.exitCode = 1
} finally { await source.end() }
