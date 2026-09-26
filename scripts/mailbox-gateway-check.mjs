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
  let auth = true, admission = true, failure = null, response = { items: [], unread: 0 }
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/auth/v1/user")) return Response.json(auth ? { id: "verified-user" } : {}, { status: auth ? 200 : 401 })
    const name = url.split("/").at(-1)
    calls.push({ name, args: JSON.parse(options.body), headers: options.headers })
    if (name === "joy8_consume_gateway_rate_limit") return Response.json(JSON.parse(options.body).p_key.startsWith("mail:") ? admission : true)
    if (name === "joy8_member_mail" || name === "joy8_admin_mail") return Response.json(failure || response, { status: failure ? 400 : 200 })
    throw new Error(`Unexpected RPC ${name}`)
  }
  const request = (route, body = { action: "list", request: {} }, token = "member-token", origin = "https://joy8.cc") => handler(new Request(`https://gateway.example/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: "anon-key", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  }))
  assert.equal((await request("mailbox", undefined, "")).status, 401)
  auth = false
  assert.equal((await request("mailbox")).status, 401)
  assert.ok(calls.every(call => call.name === "joy8_consume_gateway_rate_limit"))
  auth = true
  for (const origin of ["", "https://game.example", "https://joy8.cc.evil.example"]) assert.equal((await request("mailbox", undefined, undefined, origin)).status, 403)
  for (const body of [{ action: "send", request: {} }, { action: "claim", request: {}, p_auth_user_id: "victim" }, { action: "claim", request: [] }]) {
    assert.equal((await request("mailbox", body)).status, 400)
  }
  assert.ok(calls.every(call => call.name === "joy8_consume_gateway_rate_limit"))
  assert.equal((await request("mailbox", { action: "claim", request: { id: "mail-id" } })).status, 200)
  assert.deepEqual(calls.at(-1).args, { p_action: "claim", p_request: { id: "mail-id" }, p_auth_user_id: "verified-user" })
  assert.equal(calls.at(-1).headers.Authorization, "Bearer service-key")
  assert.equal((await request("admin-mailbox", { action: "send", request: { id: "mail-id" } }, "admin-token")).status, 200)
  assert.equal(calls.at(-1).headers.Authorization, "Bearer admin-token")
  assert.equal(calls.at(-1).headers.apikey, "anon-key")
  assert.equal(calls.at(-1).args.p_auth_user_id, undefined)
  admission = false
  let result = await request("mailbox")
  assert.equal(result.status, 429)
  assert.equal(result.headers.get("Retry-After"), "60")
  assert.equal(calls.at(-1).name, "joy8_consume_gateway_rate_limit")
  admission = {}
  assert.equal((await request("mailbox")).status, 503)
  admission = true
  for (const [code, message, status, publicError] of [
    ["42501", "JOY8_MAIL_FORBIDDEN", 403, "JOY8_MAIL_FORBIDDEN"],
    ["22P02", "secret invalid UUID value", 400, "JOY8_INVALID_REQUEST"],
    ["XX000", "private SQL detail", 503, "JOY8_UPSTREAM_UNAVAILABLE"],
  ]) {
    failure = { code, message }
    result = await request("admin-mailbox")
    assert.equal(result.status, status)
    assert.deepEqual(await result.json(), { error: publicError })
  }
  failure = null
  response = []
  assert.equal((await request("mailbox")).status, 502)
  console.log("OK Mailbox Gateway validates session/origin/action, uses verified identity, preserves admin JWT, limits traffic and masks SQL details")
} finally {
  globalThis.fetch = originalFetch
  delete globalThis.Deno
}
