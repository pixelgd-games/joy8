import assert from "node:assert/strict"

const originalFetch = globalThis.fetch
let handleRequest

globalThis.Deno = {
  env: {
    get(name) {
      return {
        SUPABASE_URL: "https://supabase.example",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        SUPABASE_ANON_KEY: "anon-key",
      }[name]
    },
  },
  serve(handler) { handleRequest = handler },
}

try {
  const { callRpc, resolveAuthUser } = await import("../supabase/functions/looty-gateway/index.ts")

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => {
      throw new DOMException("Timed out", "AbortError")
    },
  })

  const authResult = await resolveAuthUser(new Request("https://gateway.example/create-session", {
    headers: {
      apikey: "anon-key",
      authorization: "Bearer member-token",
    },
  }))
  assert.deepEqual(authResult, {
    ok: false,
    error: "Gateway authentication is unavailable",
    status: 503,
  })

  const rpcResult = await callRpc("test_rpc", {})
  assert.equal(rpcResult.ok, false)
  assert.deepEqual(rpcResult.body, {
    code: "LOOTY_UPSTREAM_UNAVAILABLE",
    message: "Gateway upstream request failed",
  })

  globalThis.fetch = async () => ({
    ok: false,
    json: async () => {
      throw new Error("Auth error body should not be read")
    },
  })

  const invalidAuthResult = await resolveAuthUser(new Request("https://gateway.example/create-session", {
    headers: {
      apikey: "anon-key",
      authorization: "Bearer invalid-token",
    },
  }))
  assert.deepEqual(invalidAuthResult, {
    ok: false,
    error: "User session is not valid",
    status: 401,
  })

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ id: "user-1" }),
  })

  const validAuthResult = await resolveAuthUser(new Request("https://gateway.example/create-session", {
    headers: {
      apikey: "anon-key",
      authorization: "Bearer valid-token",
    },
  }))
  assert.deepEqual(validAuthResult, {
    ok: true,
    userId: "user-1",
  })

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => [{ result: "ok" }],
  })

  const successfulRpcResult = await callRpc("test_rpc", {})
  assert.deepEqual(successfulRpcResult, {
    ok: true,
    body: [{ result: "ok" }],
  })

  let memberRows = [{ player_account_id: "player-1", account_type: "guest" }]
  let memberError = null
  const rpcCalls = []
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: "verified-user" })
    const name = url.split("/").at(-1)
    const args = JSON.parse(options.body)
    rpcCalls.push({ name, args })
    if (name === "looty_consume_gateway_rate_limit") return Response.json(true)
    if (name === "looty_resolve_member") {
      return memberError ? Response.json(memberError, { status: 403 }) : Response.json(memberRows)
    }
    if (name === "create_game_session") return Response.json([{
      session_id: "session-1", player_account_id: "player-1", game_id: "game-1",
      launch_code: "one-use-code", account_type: "guest", currency: "POINT", protocol: "server-v1",
    }])
    if (name === "looty_cleanup_gateway_runtime") return Response.json([])
    throw new Error(`Unexpected RPC ${name}`)
  }
  const request = (route, body = {}, token = "member-token", origin = "https://looty-git.pages.dev") => handleRequest(new Request(`https://gateway.example/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: "anon-key", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  }))
  for (const route of ["member", "enroll-member", "create-session"]) {
    assert.equal((await request(route, {}, "", "https://evil.example")).status, 403)
    assert.equal((await request(route, {}, "", null)).status, 403)
    for (const token of ["", "anon-key"]) assert.equal((await request(route, {}, token)).status, 401)
  }
  assert.equal(rpcCalls.some(({ name }) => name === "looty_resolve_member" || name === "create_game_session"), false)
  assert.equal((await request("enroll-member", { p_auth_user_id: "victim", account_type: "registered" })).status, 400)
  const memberResponse = await request("member")
  assert.deepEqual(await memberResponse.json(), { member: { player_account_ref: "player-1", account_type: "guest" } })
  assert.deepEqual(rpcCalls.at(-1), { name: "looty_resolve_member", args: { p_auth_user_id: "verified-user", p_enroll: false } })
  assert.equal((await request("enroll-member")).status, 200)
  assert.equal(rpcCalls.at(-1).args.p_enroll, true)

  memberRows = []
  assert.deepEqual(await (await request("member")).json(), { member: null })
  assert.equal((await request("enroll-member")).status, 502)
  assert.equal((await request("create-session", { slug: "test" })).status, 403)
  assert.equal(rpcCalls.some(({ name }) => name === "create_game_session"), false)
  memberError = { code: "42501", message: "player account is not active" }
  assert.equal((await request("enroll-member")).status, 403)
  assert.equal((await request("create-session", { slug: "test" })).status, 403)
  assert.equal(rpcCalls.some(({ name }) => name === "create_game_session"), false)
  memberError = { code: "42501", message: "private database diagnostic" }
  assert.deepEqual(await (await request("member")).json(), { error: "Gateway RPC failed" })
  memberError = null
  memberRows = [{ player_account_id: "player-1", account_type: "guest" }]
  const launched = await request("create-session", { slug: "test", auth_user_id: "victim" })
  assert.equal(launched.status, 200)
  assert.equal((await launched.json()).account_type, "guest")
  assert.equal(rpcCalls.find(({ name }) => name === "create_game_session").args.p_auth_user_id, "verified-user")

  for (const route of ["exchange", "bet", "payout", "refund", "close-round"]) {
    assert.equal((await request(route, {}, "", null)).status, 404)
  }
  const key = "a".repeat(64)
  let serverError = null, health = true
  const serverCalls = []
  globalThis.fetch = async (url, options) => {
    const name = url.split("/").at(-1)
    if (name === "looty_consume_gateway_rate_limit") return Response.json(true)
    if (name === "looty_platform_health_v1") return Response.json(health)
    serverCalls.push({ name, args: JSON.parse(options.body) })
    return serverError ? Response.json(serverError, { status: 400 }) : Response.json({ version: 1, state: "open" })
  }
  const expected = {
    exchange: "looty_server_session_v1", renew: "looty_server_session_v1",
    open: "looty_open_match_v1", settle: "looty_settle_match_v1",
    status: "looty_match_status_v1", cancel: "looty_match_status_v1",
  }
  for (const [action, name] of Object.entries(expected)) {
    const route = `server-${action}-v1`
    assert.equal((await request(route, {}, key)).status, 403)
    assert.equal((await request(route, {}, "member-token", null)).status, 401)
    assert.equal((await request(route, {}, "", null)).status, 401)
    const body = { version: 1, match_ref: "fixture" }
    assert.equal((await request(route, body, key, null)).status, 200)
    assert.equal(serverCalls.at(-1).name, name)
    assert.equal(serverCalls.at(-1).args.p_secret, key)
    assert.deepEqual(serverCalls.at(-1).args.p_request, body)
    if (["exchange", "renew"].includes(action)) assert.equal(serverCalls.at(-1).args.p_action, action)
    if (["status", "cancel"].includes(action)) assert.equal(serverCalls.at(-1).args.p_cancel, action === "cancel")
  }
  const count = serverCalls.length
  assert.equal((await request("server-open-v1", [], key, null)).status, 400)
  assert.equal((await request("server-open-v1", { data: "x".repeat(17000) }, key, null)).status, 400)
  assert.equal(serverCalls.length, count)
  for (const [code, status] of [["LOOTY_BACKEND_UNAUTHORIZED", 401], ["LOOTY_IDEMPOTENCY_CONFLICT", 409], ["LOOTY_WALLET_INACTIVE", 403], ["LOOTY_MATCH_NOT_FOUND", 404]]) {
    serverError = { message: code }
    const response = await request("server-settle-v1", {}, key, null)
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error: code })
  }
  serverError = { message: "private database diagnostic", details: key }
  assert.deepEqual(await (await request("server-settle-v1", {}, key, null)).json(), { error: "LOOTY_UPSTREAM_UNAVAILABLE" })
  assert.deepEqual(await (await request("health", {}, "", null)).json(), { status: "ok" })
  health = false
  assert.equal((await request("health", {}, "", null)).status, 503)
  console.log("Gateway unit check passed, including member, server authority and health boundaries.")
} finally {
  globalThis.fetch = originalFetch
  delete globalThis.Deno
}
