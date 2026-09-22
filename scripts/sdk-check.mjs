import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { afterEach, describe, test } from "node:test"
import { getJoy8Balance, receiveJoy8Launch } from "../packages/joy8-game-sdk/browser.js"
import { Joy8ApiError, Joy8SdkError } from "../packages/joy8-game-sdk/errors.js"
import { Joy8ServerClient } from "../packages/joy8-game-sdk/server.js"

const gameId = "11111111-1111-4111-8111-111111111111"
const sessionId = "22222222-2222-4222-8222-222222222222"
const playerId = "33333333-3333-4333-8333-333333333333"
const matchId = "44444444-4444-4444-8444-444444444444"
const settlementId = "55555555-5555-4555-8555-555555555555"
const backendKey = "b".repeat(64)
const launchCode = "a".repeat(64)
const gatewayUrl = "https://gateway.example/functions/v1/joy8-gateway"
const parentOrigin = "https://joy8.cc"
const clocks = new Set()

afterEach(() => {
  for (const clock of clocks) clearTimeout(clock)
  clocks.clear()
})

function fakeWindow(href = "https://game.example/client/") {
  const listeners = new Set()
  const messages = []
  const parent = { postMessage: (data, origin) => messages.push({ data, origin }) }
  return {
    parent,
    location: { href },
    messages,
    listeners,
    addEventListener: (name, listener) => { if (name === "message") listeners.add(listener) },
    removeEventListener: (name, listener) => { if (name === "message") listeners.delete(listener) },
    setTimeout: (callback, delay) => {
      const clock = setTimeout(callback, delay)
      clocks.add(clock)
      return clock
    },
    clearTimeout: clock => {
      clearTimeout(clock)
      clocks.delete(clock)
    },
    dispatch: event => { for (const listener of [...listeners]) listener(event) },
  }
}

function launch(overrides = {}) {
  return {
    joy8_session_id: sessionId,
    joy8_launch_code: launchCode,
    joy8_game_id: gameId,
    joy8_currency: "POINT",
    joy8_protocol: "server-v1",
    joy8_gateway_url: gatewayUrl,
    ...overrides,
  }
}

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })
}

describe("Joy8 browser SDK", () => {
  test("installs first, announces only to exact origins and accepts one trusted in-memory launch", async () => {
    const windowObject = fakeWindow()
    const pending = receiveJoy8Launch({ parentOrigins: [parentOrigin, "https://www.joy8.cc"], expectedGameId: gameId, gatewayUrl, windowObject })
    assert.deepEqual(windowObject.messages, [
      { data: { type: "joy8-launch-ready-v1", protocol: "server-v1" }, origin: parentOrigin },
      { data: { type: "joy8-launch-ready-v1", protocol: "server-v1" }, origin: "https://www.joy8.cc" },
    ])
    windowObject.dispatch({ source: {}, origin: parentOrigin, data: { type: "joy8-launch-v1", launch: launch() } })
    windowObject.dispatch({ source: windowObject.parent, origin: "https://evil.example", data: { type: "joy8-launch-v1", launch: launch() } })
    assert.equal(windowObject.listeners.size, 1)
    windowObject.dispatch({ source: windowObject.parent, origin: parentOrigin, data: { type: "joy8-launch-v1", launch: launch() } })
    assert.deepEqual(await pending, launch())
    assert.equal(windowObject.listeners.size, 0)
  })

  test("fails closed for URL credentials, wildcard origins, mismatched configuration and abort", async () => {
    assert.throws(() => receiveJoy8Launch({ parentOrigins: [parentOrigin], expectedGameId: gameId, gatewayUrl, windowObject: fakeWindow(`https://game.example/?joy8_launch_code=${launchCode}`) }), error => error.code === "JOY8_URL_CREDENTIALS_REJECTED")
    assert.throws(() => receiveJoy8Launch({ parentOrigins: ["*"], expectedGameId: gameId, gatewayUrl, windowObject: fakeWindow() }), error => error.code === "JOY8_SDK_INVALID_CONFIGURATION")
    const mismatchWindow = fakeWindow()
    const mismatch = receiveJoy8Launch({ parentOrigins: [parentOrigin], expectedGameId: gameId, gatewayUrl, windowObject: mismatchWindow })
    mismatchWindow.dispatch({ source: mismatchWindow.parent, origin: parentOrigin, data: { type: "joy8-launch-v1", launch: launch({ joy8_game_id: "99999999-9999-4999-8999-999999999999" }) } })
    await assert.rejects(mismatch, error => error.code === "JOY8_INVALID_LAUNCH")
    const controller = new AbortController(), abortWindow = fakeWindow()
    const aborted = receiveJoy8Launch({ parentOrigins: [parentOrigin], expectedGameId: gameId, gatewayUrl, windowObject: abortWindow, signal: controller.signal })
    controller.abort()
    await assert.rejects(aborted, error => error.code === "JOY8_LAUNCH_ABORTED")
    assert.equal(abortWindow.listeners.size, 0)
  })

  test("balance uses only the short-lived token and returns normalized strings", async () => {
    let request
    const fetch = async (url, options) => {
      request = { url, options }
      return response({ session_id: sessionId, player_account_ref: playerId, currency: "POINT", balance: 120, locked_balance: "20.00" })
    }
    const balance = await getJoy8Balance({ gatewayUrl, gatewayToken: "gateway-token", fetch })
    assert.equal(request.url, `${gatewayUrl}/balance`)
    assert.equal(request.options.headers.Authorization, undefined)
    assert.deepEqual(JSON.parse(request.options.body), { gateway_token: "gateway-token" })
    assert.deepEqual(balance, { sessionId, playerAccountRef: playerId, currency: "POINT", balance: "120", lockedBalance: "20.00" })
  })
})

describe("Joy8 server SDK", () => {
  test("maps every server-v1 operation and keeps the Backend Key in the authorization header", async () => {
    const calls = []
    const fetch = async (url, options) => {
      const route = url.split("/").at(-1)
      const body = JSON.parse(options.body)
      calls.push({ route, body, headers: options.headers })
      if (route === "server-exchange-v1" || route === "server-renew-v1") return response({
        version: 1, session_id: sessionId, game_id: gameId, player_account_ref: playerId,
        account_type: "guest", wallet_scope: "platform", currency: "POINT",
        gateway_token: "gateway-token", gateway_token_expires_at: "2026-09-21T01:15:00Z",
        expires_at: "2026-09-21T02:00:00Z", scopes: ["balance"],
      })
      if (route === "server-open-v1") return response({ version: 1, match_id: matchId, state: "open" })
      if (route === "server-settle-v1") return response({ version: 1, settlement_id: settlementId, match_id: matchId, state: "settled", settlement_no: 1, final: true, request_hash: "c".repeat(64), settled_at: "2026-09-21T01:05:00Z" })
      return response({ version: 1, match_id: matchId, state: route === "server-cancel-v1" ? "cancelled" : "open", result: null, settlement_count: 0 })
    }
    const client = new Joy8ServerClient({ gatewayUrl, backendKey, gameId, fetch })
    assert.equal(client.backendKey, undefined)
    assert.ok(!JSON.stringify(client).includes(backendKey))
    const session = await client.exchangeLaunchCode({ launchCode })
    await client.renewSession({ sessionId })
    await client.openMatch({ matchRef: "spin-1", ruleVersion: "rules-v1", participants: [{ sessionId, reserve: "100.00" }] })
    await client.settleMatch({ matchRef: "spin-1", ruleVersion: "rules-v1", operationKey: "spin-1:settle:1", settlementNo: 1, final: true, entries: [{ kind: "player", accountRef: playerId, amount: "-100.00", source: "gameplay" }] })
    await client.getMatchStatus({ matchRef: "spin-1" })
    await client.cancelMatch({ matchRef: "spin-2" })
    assert.equal(session.playerAccountRef, playerId)
    assert.deepEqual(calls.map(call => call.route), ["server-exchange-v1", "server-renew-v1", "server-open-v1", "server-settle-v1", "server-status-v1", "server-cancel-v1"])
    for (const call of calls) {
      assert.equal(call.headers.Authorization, `Bearer ${backendKey}`)
      assert.equal(call.headers.Origin, undefined)
      assert.equal(call.body.version, 1)
    }
    assert.deepEqual(calls[2].body.participants, [{ session_id: sessionId, reserve: "100.00" }])
    assert.equal(calls[3].body.entries[0].account_ref, playerId)
  })

  test("rejects invalid local input, another Game ID and safe API errors without leaking the key", async () => {
    assert.throws(() => new Joy8ServerClient({ gatewayUrl, backendKey: "bad", gameId }), error => error.code === "JOY8_SDK_INVALID_CONFIGURATION")
    const wrongGame = new Joy8ServerClient({ gatewayUrl, backendKey, gameId, fetch: async () => response({
      version: 1, session_id: sessionId, game_id: "99999999-9999-4999-8999-999999999999", player_account_ref: playerId,
      account_type: "guest", wallet_scope: "platform", currency: "POINT", gateway_token: "token",
      gateway_token_expires_at: "later", expires_at: "later", scopes: ["balance"],
    }) })
    await assert.rejects(wrongGame.exchangeLaunchCode({ launchCode }), error => error.code === "JOY8_INVALID_RESPONSE")
    const limited = new Joy8ServerClient({ gatewayUrl, backendKey, gameId, fetch: async () => response({ error: "Too many requests" }, 429, { "Retry-After": "60", "X-Joy8-Request-Id": "request-1" }) })
    await assert.rejects(limited.getMatchStatus({ matchRef: "spin-1" }), error => {
      assert.ok(error instanceof Joy8ApiError)
      assert.equal(error.status, 429)
      assert.equal(error.retryAfterSeconds, 60)
      assert.equal(error.requestId, "request-1")
      assert.ok(!error.message.includes(backendKey))
      return true
    })
    await assert.rejects(new Joy8ServerClient({ gatewayUrl, backendKey, gameId, fetch: async () => response({}) }).settleMatch({
      matchRef: "spin-1", ruleVersion: "rules-v1", operationKey: "bad", settlementNo: 1, final: true,
      entries: [{ kind: "platform", accountRef: gameId, amount: "1.00", source: "gameplay" }],
    }), error => error instanceof Joy8SdkError && error.code === "JOY8_SDK_INVALID_ARGUMENT")
  })
})

test("the npm package contains only the documented distributable SDK files", () => {
  const npmExecutable = process.env.npm_execpath
  const command = npmExecutable ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm"
  const args = npmExecutable
    ? [npmExecutable, "pack", "./packages/joy8-game-sdk", "--dry-run", "--json"]
    : ["pack", "./packages/joy8-game-sdk", "--dry-run", "--json"]
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, shell: process.platform === "win32" && !npmExecutable })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr)
  const pack = JSON.parse(result.stdout)[0]
  assert.equal(pack.name, "@joy8/game-sdk")
  assert.equal(pack.version, "1.0.0")
  const paths = pack.files.map(file => file.path)
  for (const required of ["README.md", "browser.js", "browser.d.ts", "server.js", "server.d.ts", "index.js", "index.d.ts", "errors.js", "errors.d.ts", "http.js", "validation.js", "package.json"]) {
    assert.ok(paths.includes(required), required)
  }
  assert.ok(paths.every(path => !path.includes("test") && !path.includes(".env")))
})

test("the third-party kit is complete and contains no Backend Key value", async () => {
  const root = new URL("../integrations/third-party/", import.meta.url)
  const profile = JSON.parse(await readFile(new URL("integration-profile.example.json", root), "utf8"))
  const delivery = JSON.parse(await readFile(new URL("backend-key-delivery.example.json", root), "utf8"))
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"))
  const sdkPackage = JSON.parse(await readFile(new URL("../packages/joy8-game-sdk/package.json", import.meta.url), "utf8"))
  const env = await readFile(new URL("server.env.example", root), "utf8")
  const readme = await readFile(new URL("README.md", root), "utf8")
  const api = await readFile(new URL("API.md", root), "utf8")
  const aiHandoff = await readFile(new URL("AI_HANDOFF.md", root), "utf8")
  const acceptance = await readFile(new URL("ACCEPTANCE.md", root), "utf8")
  assert.equal(profile.platform.protocol, "server-v1")
  assert.equal(profile.platform.currency, "POINT")
  assert.equal(manifest.protocol, profile.platform.protocol)
  assert.equal(manifest.currency, profile.platform.currency)
  assert.equal(manifest.sdk.package, sdkPackage.name)
  assert.equal(manifest.sdk.version, sdkPackage.version)
  assert.equal(profile.rules.maxBetAmount, "10000.00")
  assert.equal(profile.credential.environmentVariable, "JOY8_BACKEND_KEY")
  assert.equal(profile.credential.purpose, "private-integration")
  assert.equal(delivery.secretName, profile.credential.environmentVariable)
  assert.match(env, /^JOY8_BACKEND_KEY=$/m)
  assert.match(readme, /before implementation begins/)
  assert.match(api, /server-settle-v1|settleMatch/)
  assert.match(aiHandoff, /Do not print, read back/)
  assert.match(acceptance, /Backend Key exists only in the provider backend secret manager/)
  assert.ok(![env, readme, api, aiHandoff, acceptance, JSON.stringify(profile), JSON.stringify(delivery), JSON.stringify(manifest)].some(text => /JOY8_BACKEND_KEY=[a-zA-Z0-9]/.test(text)))
})
