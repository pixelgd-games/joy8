import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import pg from "pg"

assert.equal(process.env.SUPABASE_PROJECT_ID, "lsazydefvnuqglultqii")
assert.ok(process.env.SUPABASE_DB_PASSWORD)
assert.ok(process.env.JOY8_DB_CA_CERT)
assert.ok(process.argv[2])

const connectionString = (await readFile(new URL("../supabase/.temp/pooler-url", import.meta.url), "utf8")).trim()
const address = new URL(connectionString)
const ca = await readFile(process.env.JOY8_DB_CA_CERT, "utf8")
const sql = await readFile(process.argv[2], "utf8")
const client = new pg.Client({
  host: address.hostname,
  port: Number(address.port),
  database: address.pathname.slice(1),
  user: decodeURIComponent(address.username),
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: { ca, rejectUnauthorized: true },
})

await client.connect()
try {
  const results = await client.query(sql)
  for (const result of Array.isArray(results) ? results : [results]) {
    for (const row of result.rows || []) process.stdout.write(`${JSON.stringify(row)}\n`)
  }
} finally {
  await client.end()
}
