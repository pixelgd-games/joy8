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
  const member = { player_account_ref: "11111111-1111-4111-8111-111111111111", public_id: "482731", account_type: "registered" }
  const wallet = { currency: "POINT", status: "active", balance: "1200.00", available_balance: "1100.00" }
  const mail = { items: [], unread: 2, offset: 0 }
  let auth = true, ingress = true, failure = null
  let packet = { result: { member, wallet, mail } }
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/auth/v1/user")) return Response.json(auth ? { id: "verified-user" } : {}, { status: auth ? 200 : 401 })
    const name = url.split("/").at(-1)
    calls.push({ name, args: JSON.parse(options.body), headers: options.headers })
    if (name === "joy8_consume_gateway_rate_limit") return Response.json(ingress)
    if (name === "joy8_member_lobby_v1") return Response.json(failure || packet, { status: failure ? 400 : 200 })
    throw new Error(`Unexpected RPC ${name}`)
  }
  const request = (body = {}, token = "member-token", origin = "https://joy8.cc") => handler(new Request("https://gateway.example/lobby", {
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
  assert.deepEqual(await result.json(), { member, wallet, mail })
  assert.deepEqual(calls.slice(-2).map(call => call.name), ["joy8_consume_gateway_rate_limit", "joy8_member_lobby_v1"])
  assert.deepEqual(calls.at(-1).args, { p_auth_user_id: "verified-user" })
  assert.equal(calls.at(-1).headers.Authorization, "Bearer service-key")
  packet = { result: { member: null } }
  assert.deepEqual(await (await request()).json(), { member: null })
  packet = { result: { member, wallet: null, mail: null } }
  assert.deepEqual(await (await request()).json(), { member, wallet: null, mail: null })
  ingress = false
  assert.equal((await request()).status, 429)
  ingress = true
  packet = { limited: true, retry_after: 60 }
  result = await request()
  assert.equal(result.status, 429)
  assert.equal(result.headers.get("Retry-After"), "60")
  packet = { limited: true, retry_after: 0 }
  assert.equal((await request()).status, 503)
  packet = { admission_error: "JOY8_PLAYER_INACTIVE" }
  assert.deepEqual([(result = await request()).status, await result.json()], [403, { error: "JOY8_PLAYER_INACTIVE" }])
  packet = { admission_error: "private detail" }
  assert.equal((await request()).status, 503)
  packet = { error: { message: "JOY8_EMAIL_NOT_ALLOWED", code: "42501" } }
  assert.deepEqual([(result = await request()).status, await result.json()], [403, { error: "JOY8_EMAIL_NOT_ALLOWED" }])
  packet = { error: { message: "private SQL detail", code: "XX000" } }
  result = await request()
  assert.equal(result.status, 502)
  assert.doesNotMatch(JSON.stringify(await result.json()), /private SQL detail/)
  failure = { code: "XX000", message: "private SQL detail" }
  result = await request()
  assert.equal(result.status, 502)
  assert.doesNotMatch(JSON.stringify(await result.json()), /private SQL detail/)
  failure = null
  for (const invalid of [[], {}, { result: [] }, { result: {} }, { result: { member: { ...member, public_id: "12" } } },
    { result: { member, wallet: [] } }, { result: { member, mail: "2" } }]) {
    packet = invalid
    assert.equal((await request()).status, 502)
  }
  console.log("OK Lobby Gateway validates session/origin/body, limits traffic, maps errors and returns member, wallet and mailbox in one call")
} finally {
  globalThis.fetch = originalFetch
  delete globalThis.Deno
}
