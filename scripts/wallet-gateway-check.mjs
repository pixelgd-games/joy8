import assert from "node:assert/strict"

const originalFetch = globalThis.fetch
let handler
globalThis.Deno = {
  env: { get: name => ({ SUPABASE_URL: "https://fixture.example", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" })[name] },
  serve: value => { handler = value },
}
try {
  await import("../supabase/functions/joy8-gateway/index.ts")
  const calls = []
  let auth = true, admission = true, failure = null
  let response = { wallet: { currency: "POINT", status: "active", balance: "1200.00", available_balance: "1100.00" } }
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/auth/v1/user")) return Response.json(auth ? { id: "verified-user" } : {}, { status: auth ? 200 : 401 })
    const name = url.split("/").at(-1)
    calls.push({ name, args: JSON.parse(options.body), headers: options.headers })
    if (name === "joy8_consume_gateway_rate_limit") return Response.json(JSON.parse(options.body).p_key.startsWith("wallet:") ? admission : true)
    if (name === "joy8_member_wallet_v1") return Response.json(failure || response, { status: failure ? 400 : 200 })
    throw new Error(`Unexpected RPC ${name}`)
  }
  const request = (body = {}, token = "member-token", origin = "https://joy8.cc") => handler(new Request("https://gateway.example/wallet", {
    method: "POST", headers: { "Content-Type": "application/json", apikey: "anon-key", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  }))
  assert.equal((await request({}, "")).status, 401)
  auth = false
  assert.equal((await request()).status, 401)
  auth = true
  for (const origin of ["", "https://game.example", "https://joy8.cc.evil.example"]) assert.equal((await request({}, undefined, origin)).status, 403)
  assert.equal((await request({ p_auth_user_id: "victim" })).status, 400)
  assert.ok(calls.every(call => call.name === "joy8_consume_gateway_rate_limit"))
  let result = await request()
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), response)
  assert.deepEqual(calls.at(-1).args, { p_auth_user_id: "verified-user" })
  assert.equal(calls.at(-1).headers.Authorization, "Bearer service-key")
  response = { wallet: null }
  assert.deepEqual(await (await request()).json(), { wallet: null })
  admission = false
  result = await request()
  assert.equal(result.status, 429)
  assert.equal(result.headers.get("Retry-After"), "60")
  assert.equal(calls.at(-1).name, "joy8_consume_gateway_rate_limit")
  admission = {}
  assert.equal((await request()).status, 503)
  admission = true
  failure = { code: "XX000", message: "private SQL detail" }
  result = await request()
  assert.equal(result.status, 502)
  assert.doesNotMatch(JSON.stringify(await result.json()), /private SQL detail/)
  failure = null
  for (const invalid of [{}, [], { wallet: [] }, { wallet: "1200" }]) {
    response = invalid
    assert.equal((await request()).status, 502)
  }
  console.log("OK Wallet Gateway validates session/origin/body, uses verified identity, limits traffic and returns only the member wallet")
} finally {
  globalThis.fetch = originalFetch
  delete globalThis.Deno
}
