import assert from "node:assert/strict"

const gateway = new URL(process.env.GATEWAY_URL || "https://lsazydefvnuqglultqii.supabase.co/functions/v1/joy8-gateway")
const production = gateway.hostname === "lsazydefvnuqglultqii.supabase.co"
if (production && process.env.ALLOW_PRODUCTION_GATEWAY_SMOKE !== "1") {
  throw new Error("Set ALLOW_PRODUCTION_GATEWAY_SMOKE=1 after approving the hosted check; runtime rate counters may change.")
}
if (gateway.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(gateway.hostname)) {
  throw new Error("Gateway must use HTTPS outside loopback")
}
const base = gateway.href.replace(/\/+$/, "")
const origin = process.env.GATEWAY_JOY8_ORIGIN || "https://joy8.cc"
async function post(route, body = {}, browserOrigin = null) {
  return fetch(base + "/" + route, {
    method: "POST", headers: { "Content-Type": "application/json", ...(browserOrigin ? { Origin: browserOrigin } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
  })
}
assert.equal((await post("create-session", {}, "https://not-joy8.example")).status, 403)
assert.equal((await post("create-session")).status, 403)
assert.equal((await post("create-session", {}, origin)).status, 401)
assert.equal((await post("private-session", { slug: "mahjong-clash" }, "https://not-joy8.example")).status, 403)
assert.equal((await post("private-session", { slug: "mahjong-clash" })).status, 403)
assert.equal((await post("private-session", { slug: "mahjong-clash" }, "http://localhost:5173")).status, 401)
assert.equal((await post("branded-entry", { slug: "mahjong-clash" }, "https://not-joy8.example")).status, 403)
assert.equal((await post("branded-entry", { slug: "mahjong-clash" })).status, 403)
const brandedEntry = await post("branded-entry", { slug: "mahjong-clash" }, "http://localhost:5173")
assert.equal(brandedEntry.status, 200)
const brandedConfig = await brandedEntry.json()
assert.deepEqual(Object.keys(brandedConfig).sort(), ["game_id", "game_name", "launch_url", "protocol"])
assert.match(brandedConfig.game_id, /^[0-9a-f-]{36}$/)
assert.ok(brandedConfig.game_name)
assert.equal(brandedConfig.launch_url, "http://localhost:4391/")
assert.equal(brandedConfig.protocol, "server-v1")
assert.equal((await post("branded-session", { slug: "mahjong-clash" }, "http://localhost:5173")).status, 401)
for (const route of ["exchange", "bet", "payout", "refund", "close-round"]) {
  assert.equal((await post(route)).status, 404, route + " must be removed")
}
for (const action of ["exchange", "renew", "open", "settle", "status", "cancel"]) {
  assert.equal((await post("server-" + action + "-v1", { version: 1 })).status, 401)
  assert.equal((await post("server-" + action + "-v1", { version: 1 }, origin)).status, 403)
}
const health = await post("health")
assert.equal(health.status, 200)
assert.deepEqual(await health.json(), { status: "ok" })
console.log("Gateway health and rejection checks passed; no identity, wallet, session or settlement was created.")
