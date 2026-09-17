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
      launch_code: "one-use-code", account_type: "guest", currency: "POINT", wallet_mode: "demo",
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

  console.log("Gateway unit check passed, including member authorization boundaries.")
} finally {
  globalThis.fetch = originalFetch
  delete globalThis.Deno
}
