import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { createLocalPostgres } from "./fixtures/local-postgres.mjs"

const quote = value => `"${String(value).replaceAll('"', '""')}"`
export async function restoreSnapshot(directory) {
  directory = path.resolve(directory)
  const root = path.resolve(".recovery.local") + path.sep
  assert.ok(directory.startsWith(root), "Snapshot must be in the ignored recovery directory")
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"))
  assert.equal(manifest.ref, "lsazydefvnuqglultqii")
  const files = {}
  for (const section of ["pre-data", "data", "post-data"]) {
    files[section] = await readFile(path.join(directory, `${section}.sql`), "utf8")
    assert.equal(createHash("sha256").update(files[section]).digest("hex"), manifest.sha256[section])
  }
  const local = await createLocalPostgres()
  try {
    for (const role of manifest.roles) if (role.rolname !== "joy8_test") await local.exec(`CREATE ROLE ${quote(role.rolname)} NOLOGIN ${role.rolbypassrls ? "BYPASSRLS" : "NOBYPASSRLS"}`)
    await local.exec("create schema extensions; create extension pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions;")
    await local.exec(files["pre-data"])
    for (const owner of manifest.owners) {
      if (owner.kind === "S" && (await local.query("select exists(select 1 from pg_depend where classid='pg_class'::regclass and objid=$1::regclass and refclassid='pg_class'::regclass and deptype in ('a','i')) owned", [`${quote(owner.schema)}.${quote(owner.name)}`])).rows[0].owned) continue
      const kind = ({ r: "TABLE", p: "TABLE", v: "VIEW", m: "MATERIALIZED VIEW", S: "SEQUENCE" })[owner.kind]
      await local.exec(`ALTER ${kind} ${quote(owner.schema)}.${quote(owner.name)} OWNER TO ${quote(owner.owner)}`)
    }
    for (const fn of manifest.functions) await local.exec(`ALTER FUNCTION ${quote(fn.schema)}.${quote(fn.name)}(${fn.args}) OWNER TO ${quote(fn.owner)}`)
    for (const schema of manifest.schemaOwners || []) await local.exec(`ALTER SCHEMA ${quote(schema.name)} OWNER TO ${quote(schema.owner)}`)
    await local.exec(files.data)
    await local.exec(files["post-data"])
    for (const [table, count] of Object.entries(manifest.counts)) {
      const [schema, name] = table.split(".")
      assert.equal((await local.query(`select count(*)::text n from ${quote(schema)}.${quote(name)}`)).rows[0].n, count)
    }
    await local.query("select public.joy8_validate_product_adapters()")
    for (const event of manifest.events) {
      if ((await local.query("select 1 from pg_event_trigger where evtname=$1", [event.evtname])).rows.length) continue
      assert.match(event.function, /^(public\.)?joy8_[a-z_]+$/)
      assert.ok(["ddl_command_end", "sql_drop"].includes(event.evtevent))
      const tags = event.evttags?.length ? ` WHEN TAG IN (${event.evttags.map(tag => `'${tag.replaceAll("'", "''")}'`).join(",")})` : ""
      await local.exec(`CREATE EVENT TRIGGER ${quote(event.evtname)} ON ${event.evtevent}${tags} EXECUTE FUNCTION public.${event.function.replace(/^public\./, "")}()`)
    }
    const report = await local.exec(await readFile("scripts/sql/platform-reconciliation.sql", "utf8"))
    const reconciliation = report.flatMap(result => result.rows || []).find(row => row.reconciliation)?.reconciliation
    assert.ok(reconciliation)
    for (const key of ["wallet_ledger_mismatches", "reservation_mismatches", "fee_mismatches", "unbalanced_settlements", "finalized_with_reservations"]) assert.equal(reconciliation[key], 0, key)
    await writeFile(path.join(directory, "restore-result.json"), JSON.stringify({ restored: true, countsMatched: true, productAdaptersValid: true, eventGuardsInstalled: true, reconciliation }, null, 2), { mode: 0o600 })
    console.log("Hosted snapshot restored locally: table counts, accounting, adapter permissions and DDL guards passed.")
  } finally { await local.close() }
}

if (process.argv[1]?.endsWith("restore-snapshot.mjs")) await restoreSnapshot(process.argv[2])
