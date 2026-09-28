import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve6 } from "node:dns/promises"
import { promisify } from "node:util"
import path from "node:path"

assert.equal(process.env.ALLOW_PRODUCTION_GATEWAY_SMOKE, "1", "Explicitly enable the bounded hosted test")
assert.equal(process.platform, "win32", "Use the approved Joy8 PowerShell wrapper")
const root = path.resolve(".acceptance.local")
await mkdir(root, { recursive: true })
const sql = path.join(root, "ingress.sql")
await writeFile(sql, "select coalesce(jsonb_agg(jsonb_build_object('key',bucket_key_hash,'window',window_started_at,'count',request_count)),'[]') as buckets from public.gateway_rate_limits where updated_at>now()-interval '5 minutes';")
const run = promisify(execFile)
async function snapshot() {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-File", "scripts/supabase-joy8.ps1", "db", "query", "--linked", "--file", sql], { windowsHide: true, timeout: 60000 })
  const response = JSON.parse(stdout.slice(stdout.indexOf("{")))
  return new Map(response.rows[0].buckets.map(row => [`${row.key}:${row.window}`, row]))
}
const before = await snapshot()
const host = "lsazydefvnuqglultqii.supabase.co"
const fake = ["198.51.100.211", "203.0.113.212", "192.0.2.213", "2001:db8::214", "198.51.100.215, 203.0.113.216"]
const variants = [
  ["baseline", {}],
  ["cf-ipv4", { "cf-connecting-ip": fake[0] }],
  ["real-ipv4", { "x-real-ip": fake[1] }],
  ["forwarded-ipv4", { "x-forwarded-for": fake[2] }],
  ["cf-ipv6-value", { "cf-connecting-ip": fake[3] }],
  ["forwarded-chain", { "x-forwarded-for": fake[4] }],
  ["conflicting", { "cf-connecting-ip": fake[0], "x-real-ip": fake[1], "x-forwarded-for": fake[2] }],
  ["empty", { "cf-connecting-ip": "", "x-real-ip": "", "x-forwarded-for": "" }],
  ["malformed", { "cf-connecting-ip": "not-an-ip", "x-real-ip": "not-an-ip", "x-forwarded-for": "not-an-ip" }],
  ["baseline-repeat", {}],
]
const responses = []
for (const [name, headers] of variants) {
  const response = await fetch(`https://${host}/functions/v1/joy8-gateway/health`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}", signal: AbortSignal.timeout(15000) })
  responses.push({ name, status: response.status, server: response.headers.get("server"), gatewayRequestIdPresent: response.headers.has("x-joy8-request-id") })
  assert.ok([200, 403].includes(response.status), `${name}: ${response.status}`)
  if (response.status === 200) assert.deepEqual(await response.json(), { status: "ok" })
}
const after = await snapshot()
const changed = [...after.entries()].map(([id, row]) => ({ key: row.key, delta: row.count - (before.get(id)?.count || 0) })).filter(row => row.delta > 0)
const candidates = [...fake, ...fake[4].split(", "), "not-an-ip", "unknown"]
const hashes = new Set(candidates.map(ip => createHash("sha256").update(`health:${ip}`).digest("hex")))
const injectedBuckets = changed.filter(row => hashes.has(row.key)).length
const uniqueBuckets = new Set(changed.map(row => row.key)).size
const changedRequests = changed.reduce((sum, row) => sum + row.delta, 0)
let ipv6DnsAvailable = false
try { ipv6DnsAvailable = (await resolve6(host)).length > 0 } catch {}
const report = { testedAt: new Date().toISOString(), responses, injectedBuckets, observedChangedBuckets: uniqueBuckets, observedChangedRequests: changedRequests, ipv6DnsAvailable,
  boundary: "Direct client requests only. Concurrent health traffic can affect counter deltas. IPv6 header text is not native IPv6 transport. Worker subrequests and all managed ingress paths are not certified." }
await writeFile(path.join(root, "ingress-result.json"), JSON.stringify(report, null, 2))
assert.equal(injectedBuckets, 0, "An injected address created a rate bucket")
assert.equal(uniqueBuckets, 1, "Unexpected rate buckets; inspect managed ingress behavior or concurrent traffic")
assert.equal(changedRequests, responses.filter(row => row.status === 200).length, "Counter attribution is inconclusive")
console.log(JSON.stringify(report, null, 2))
