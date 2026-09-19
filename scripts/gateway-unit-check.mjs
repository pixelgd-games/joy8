import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

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
  const { callRpc, resolveAuthUser, SERVER_ERROR_STATUSES } = await import("../supabase/functions/joy8-gateway/index.ts")
  const integrationContract = await readFile(new URL("../docs/platform/GAME_PLATFORM_INTEGRATION.md", import.meta.url), "utf8")
  const stableErrorTable = integrationContract.split("| HTTP | Stable errors |")[1]?.split("\n\n")[0] || ""
  const documentedServerErrors = [...stableErrorTable.matchAll(/`(JOY8_[A-Z_]+)`/g)].map((match) => match[1]).sort()
  assert.deepEqual(Object.keys(SERVER_ERROR_STATUSES).sort(), documentedServerErrors)

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
    code: "JOY8_UPSTREAM_UNAVAILABLE",
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
  let sessionError = null
  const rpcCalls = []
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: "verified-user" })
    const name = url.split("/").at(-1)
    const args = JSON.parse(options.body)
    rpcCalls.push({ name, args })
    if (name === "joy8_consume_gateway_rate_limit") return Response.json(true)
    if (name === "joy8_resolve_member") {
      return memberError ? Response.json(memberError, { status: 403 }) : Response.json(memberRows)
    }
    if (name === "create_game_session") return sessionError ? Response.json(sessionError, { status: 400 }) : Response.json([{
      session_id: "session-1", player_account_id: "player-1", game_id: "game-1",
      launch_code: "one-use-code", account_type: "guest", currency: "POINT", protocol: "server-v1",
    }])
    if (name === "joy8_cleanup_gateway_runtime") return Response.json([])
    if (name === "joy8_create_private_session") return sessionError ? Response.json(sessionError, { status: 403 }) : Response.json({
      session_id: "private-session", game_id: "game-1", launch_code: "private-code", protocol: "server-v1",
      launch_url: "http://localhost:4391/", game_name: "Mahjong Clash", currency: "POINT",
    })
    throw new Error(`Unexpected RPC ${name}`)
  }
  const request = (route, body = {}, token = "member-token", origin = "https://joy8.pages.dev") => handleRequest(new Request(`https://gateway.example/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: "anon-key", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  }))
  for (const route of ["member", "enroll-member", "create-session", "private-session"]) {
    assert.equal((await request(route, {}, "", "https://evil.example")).status, 403)
    assert.equal((await request(route, {}, "", null)).status, 403)
    for (const token of ["", "anon-key"]) assert.equal((await request(route, {}, token)).status, 401)
  }
  assert.equal(rpcCalls.some(({ name }) => name === "joy8_resolve_member" || name === "create_game_session"), false)
  assert.equal((await request("enroll-member", { p_auth_user_id: "victim", account_type: "registered" })).status, 400)
  const memberResponse = await request("member")
  assert.deepEqual(await memberResponse.json(), { member: { player_account_ref: "player-1", account_type: "guest" } })
  assert.deepEqual(rpcCalls.at(-1), { name: "joy8_resolve_member", args: { p_auth_user_id: "verified-user", p_enroll: false } })
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
  assert.equal(launched.headers.get("cache-control"), "no-store")
  assert.equal((await launched.json()).account_type, "guest")
  assert.equal(rpcCalls.find(({ name }) => name === "create_game_session").args.p_auth_user_id, "verified-user")

  for (const [code, message, status] of [
    ["P0002", "game is not available", 404],
    ["22023", "JOY8_INVALID_REQUEST", 400],
    ["42501", "JOY8_WALLET_INACTIVE", 403],
  ]) {
    sessionError = { code, message }
    const response = await request("create-session", { slug: "test" })
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error: message })
  }
  for (const message of [
    "game slug is required",
    "expires_in_seconds must be between 60 and 86400",
    "wallet account is not active",
    "private database diagnostic",
  ]) {
    sessionError = { code: "22023", message }
    const response = await request("create-session", { slug: "test" })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: "Gateway RPC failed" })
  }
  sessionError = null

  assert.equal((await request("private-session", { slug: "mahjong-clash", auth_user_id: "victim" })).status, 400)
  assert.equal((await request("private-session", { slug: "mahjong-clash", origin: "http://localhost:5173" })).status, 400)
  assert.equal((await request("private-session", { slug: "mahjong-clash" }, "member-token", "http://localhost:9000")).status, 403)
  const privateResponse = await request("private-session", { slug: "mahjong-clash" }, "member-token", "http://localhost:5173")
  assert.equal(privateResponse.status, 200)
  assert.equal(privateResponse.headers.get("cache-control"), "no-store")
  assert.deepEqual(rpcCalls.at(-1), { name: "joy8_create_private_session", args: { p_game_slug: "mahjong-clash", p_auth_user_id: "verified-user", p_origin: "http://localhost:5173" } })
  sessionError = { code: "42501", message: "JOY8_PRIVATE_ENTRY_DENIED" }
  const privateDenied = await request("private-session", { slug: "mahjong-clash" })
  assert.equal(privateDenied.status, 403)
  assert.deepEqual(await privateDenied.json(), { error: "JOY8_PRIVATE_ENTRY_DENIED" })
  sessionError = null

  for (const route of ["exchange", "bet", "payout", "refund", "close-round"]) {
    assert.equal((await request(route, {}, "", null)).status, 404)
  }
  const key = "a".repeat(64)
  let serverError = null, health = true
  const serverCalls = []
  globalThis.fetch = async (url, options) => {
    const name = url.split("/").at(-1)
    if (name === "joy8_consume_gateway_rate_limit") return Response.json(true)
    if (name === "joy8_platform_health_v1") return Response.json(health)
    serverCalls.push({ name, args: JSON.parse(options.body) })
    return serverError ? Response.json(serverError, { status: 400 }) : Response.json({ version: 1, state: "open" })
  }
  const expected = {
    exchange: "joy8_server_session_v1", renew: "joy8_server_session_v1",
    open: "joy8_open_match_v1", settle: "joy8_settle_match_v1",
    status: "joy8_match_status_v1", cancel: "joy8_match_status_v1",
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
  for (const [code, status] of Object.entries(SERVER_ERROR_STATUSES)) {
    serverError = { message: code }
    const response = await request("server-settle-v1", {}, key, null)
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error: code })
  }
  serverError = { message: "private database diagnostic", details: key }
  assert.deepEqual(await (await request("server-settle-v1", {}, key, null)).json(), { error: "JOY8_UPSTREAM_UNAVAILABLE" })
  assert.deepEqual(await (await request("health", {}, "", null)).json(), { status: "ok" })
  health = false
  assert.equal((await request("health", {}, "", null)).status, 503)
  console.log("Gateway unit check passed, including member, server authority and health boundaries.")
} finally {
  globalThis.fetch = originalFetch
  delete globalThis.Deno
}
