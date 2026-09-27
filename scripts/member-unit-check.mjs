import assert from "node:assert/strict"
import test from "node:test"
import { accountPath, createMemberService, lobbyGamePath, memberErrorMessage, safeReturnPath } from "../src/member/service.js"
import { createGameEntry } from "../src/member/game-entry.js"
import { enterBrandedMember } from "../src/member/branded-entry.js"
import { gameFailure } from "../src/pages/game/errors.js"

const origin = "https://joy8.example"
const registeredUser = { id: "member-1", is_anonymous: false, email_confirmed_at: "2026-09-16" }

test("branded registered entry enrolls explicitly without linking or guest conversion", async () => {
  const f = fixture(registeredUser)
  const launched = []
  const options = { service: f.service, onGoogle: () => assert.fail("Unexpected linking"), onLaunch: () => launched.push(true) }
  await enterBrandedMember({ ...options, method: "google" })
  assert.deepEqual(launched, [true])
  assert.deepEqual(f.calls, [["rpc", "joy8-gateway/enroll-member", { body: {} }]])
  await enterBrandedMember({ ...options, method: "guest" })
  assert.equal(f.calls.length, 1)
})


test("Loader distinguishes inactive accounts, throttling, unavailable games and outages without exposing diagnostics", async () => {
  for (const [status, error, expected] of [[403,"JOY8_PLAYER_INACTIVE","007"],[429,"Too many requests","008"],[403,"JOY8_GAME_NOT_READY","009"],[401,"unknown","010"],[503,"internal secret","011"]]) {
    const result = await gameFailure({ context: new Response(JSON.stringify({ error }), { status, headers: { "Retry-After": "30" } }) })
    assert.equal(result.code, `JOY8-GAME-${expected}`)
    assert.equal(JSON.stringify(result).includes("internal secret"), false)
    if (status === 429) assert.match(result.message, /30/)
  }
})

test("Loader uses explicit whitelist and guest-disabled errors", async () => {
  for (const code of ["JOY8_EMAIL_NOT_ALLOWED", "JOY8_GUEST_DISABLED"]) {
    const result = await gameFailure({ context: Response.json({ error: code }, { status: 403 }) })
    assert.equal(result.code, code)
    assert.equal(result.title, "尚未開放")
    assert.equal(result.reload, false)
    assert.notEqual(memberErrorMessage({ code }), memberErrorMessage({ code: "unknown" }))
  }
})

function fixture(initialUser = null) {
  let user = initialUser
  const calls = []
  const ok = (data = {}) => ({ data, error: null })
  const client = {
    auth: {
      getSession: async () => ok({ session: user ? { user } : null }),
      signInWithOAuth: async (args) => { calls.push(["oauth", args]); return ok({ url: "https://provider.example" }) },
      exchangeCodeForSession: async (code) => { calls.push(["exchange", code]); user = registeredUser; return ok({ user }) },
      signOut: async (args) => { calls.push(["signout", args]); user = null; return ok() },
    },
    functions: {
      invoke: async (...args) => {
        calls.push(["rpc", ...args])
        return ok({ member: { player_account_ref: "player-1", account_type: "registered" } })
      },
    },
  }
  const options = {
    origin,
    next: "/game/?slug=mahjong-clash&token=discard",
  }
  return { client, calls, service: createMemberService(client, options), options }
}

test("return paths reject external destinations and remove unrelated parameters", () => {
  for (const value of ["https://evil.example", "//evil.example/game/?slug=test", "/admin/", "javascript:alert(1)", "/game/?slug=x#secret", "/game/?slug=<script>"]) {
    assert.equal(safeReturnPath(value, origin), "/")
  }
  assert.equal(safeReturnPath("/game/?slug=mahjong-clash&access_token=secret", origin), "/game/?slug=mahjong-clash")
  assert.equal(safeReturnPath("/play-test/?slug=mahjong-clash&launch_url=https://evil.example&token=secret", origin), "/play-test/?slug=mahjong-clash")
  assert.equal(safeReturnPath("/entry/?slug=mahjong-clash&code=secret&flow=signin", origin), "/entry/?slug=mahjong-clash")
  assert.equal(safeReturnPath("https://evil.example/play-test/?slug=mahjong-clash", origin), "/")
  assert.equal(accountPath("/play-test/?slug=mahjong-clash", origin), "/account/?next=%2Fplay-test%2F%3Fslug%3Dmahjong-clash")
  assert.equal(accountPath("/game/?slug=test", origin), "/account/?next=%2Fgame%2F%3Fslug%3Dtest")
  assert.equal(accountPath("/entry/?slug=mahjong-clash", origin), "/account/?next=%2Fentry%2F%3Fslug%3Dmahjong-clash")
  assert.equal(lobbyGamePath("/game/?slug=test&token=discard", origin), "/?play=test")
  assert.equal(lobbyGamePath("https://evil.example/game/?slug=test", origin), "/")
})

test("game selection opens membership on the Lobby with the selected game's safe return path", async () => {
  const opened = []
  const navigated = []
  const enter = createGameEntry({ origin, membership: async () => null, openMember: (...args) => opened.push(args), navigate: (path) => navigated.push(path) })
  await enter({ next: "/game/?slug=game-a&token=discard", gameName: "Game A" })
  await enter({ next: "/game/?slug=game-b", gameName: "Game B" })
  assert.deepEqual(opened.map(([, options]) => options), [{ next: "/game/?slug=game-a", gameName: "Game A" }, { next: "/game/?slug=game-b", gameName: "Game B" }])
  assert.deepEqual(navigated, [])
})

test("enrolled registered players enter directly without opening a login dialog", async () => {
  for (const type of ["registered"]) {
    const paths = []
    const enter = createGameEntry({ origin, membership: async () => ({ account_type: type, player_account_ref: "player-1" }), openMember: () => assert.fail("Unexpected login dialog"), navigate: (path) => paths.push(path) })
    await enter({ next: "/game/?slug=game-a" })
    assert.deepEqual(paths, ["/game/?slug=game-a"])
  }
})

test("membership failures stop game entry and never create a replacement guest", async () => {
  const enter = createGameEntry({ origin, membership: async () => { throw new Error("Unavailable") }, openMember: () => assert.fail("Unexpected login fallback"), navigate: () => assert.fail("Unauthorized navigation") })
  await assert.rejects(enter({ next: "/game/?slug=test" }), /Unavailable/)
})

test("repeated game clicks are serialized and invalid destinations do not check membership", async () => {
  let resolveMember
  let reads = 0
  const paths = []
  const enter = createGameEntry({ origin, membership: () => { reads++; return new Promise((resolve) => { resolveMember = resolve }) }, openMember: (_, options) => paths.push(options.next), navigate: () => assert.fail("Unexpected navigation") })
  await enter({ next: "https://evil.example/game/?slug=test" })
  assert.equal(reads, 0)
  const first = enter({ next: "/game/?slug=first" })
  await enter({ next: "/game/?slug=second" })
  assert.equal(reads, 1)
  resolveMember(null)
  await first
  assert.deepEqual(paths, ["/game/?slug=first"])
})

test("account and game entry share one guard, including lazy dialog loading and failure cleanup", async () => {
  let rejectDialog
  let busy = false
  const trigger = { setAttribute: () => { busy = true }, removeAttribute: () => { busy = false } }
  let reads = 0
  const paths = []
  const enter = createGameEntry({
    origin,
    membership: async () => { reads++; return { player_account_ref: "player-1" } },
    openMember: () => new Promise((_, reject) => { rejectDialog = reject }),
    navigate: (path) => paths.push(path),
  })
  const account = enter({ trigger })
  assert.equal(busy, true)
  await enter({ trigger, next: "/game/?slug=test" })
  assert.equal(reads, 0)
  rejectDialog(new Error("Dialog load failed"))
  await assert.rejects(account, /Dialog load failed/)
  assert.equal(busy, false)
  await enter({ trigger, next: "/game/?slug=test" })
  assert.deepEqual(paths, ["/game/?slug=test"])
  assert.equal(busy, false)
})

test("reading membership never creates a guest or enrolls an existing Auth user", async () => {
  const f = fixture()
  assert.equal(await f.service.membership(), null)
  assert.deepEqual(f.calls, [])
  const signedIn = fixture(registeredUser)
  await signedIn.service.membership()
  assert.deepEqual(signedIn.calls, [["rpc", "joy8-gateway/member", { body: {} }]])
})




test("invalid or replayed callbacks cannot enroll or fall back to a new guest", async () => {
  const f = fixture()
  await assert.rejects(f.service.completeCallback("code", "unknown"))
  f.client.auth.exchangeCodeForSession = async () => ({ error: { code: "flow_state_not_found" } })
  await assert.rejects(f.service.completeCallback("used-code", "signin"), { code: "flow_state_not_found" })
  assert.deepEqual(f.calls, [])
})


test("sign-out does not auto-create guests", async () => {
  const f = fixture(registeredUser)
  await f.service.signOut()
  assert.equal(await f.service.membership(), null)
  assert.deepEqual(f.calls.at(-1), ["signout", { scope: "local" }])
})

test("inactive membership and upstream failures fail closed without exposing raw errors", async () => {
  const f = fixture(registeredUser)
  f.client.functions.invoke = async () => ({ error: { context: { json: async () => ({ error: "player account is not active" }) } } })
  await assert.rejects(f.service.membership(), { code: "member_inactive" })
  f.client.functions.invoke = async () => ({ error: { context: { json: async () => ({ error: "verified member identity is required" }) } } })
  await assert.rejects(f.service.membership(), (error) => {
    assert.equal(error.code, "verification_required")
    assert.equal(memberErrorMessage(error), "目前的登入身分無法通過驗證，請重新登入。")
    return true
  })
  f.client.functions.invoke = async () => ({ error: new Error("secret diagnostic") })
  await assert.rejects(f.service.membership(), { code: "member_unavailable" })
  assert.equal(memberErrorMessage(new Error("secret diagnostic")).includes("secret"), false)
})

test("Google is the sole sign-in method and never links identities", async () => {
  for (const user of [null, registeredUser]) {
    const f = fixture(user)
    await f.service.oauth()
    assert.equal(f.calls[0][0], "oauth")
    assert.equal(f.calls[0][1].provider, "google")
    assert.equal(new URL(f.calls[0][1].options.redirectTo).searchParams.get("flow"), "signin")
    for (const provider of ["facebook", "guest", "unknown"]) await assert.rejects(f.service.oauth(provider), /Unsupported/)
    assert.equal(f.service.guest, undefined)
  }
})
