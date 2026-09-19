import assert from "node:assert/strict"
import test from "node:test"
import { accountPath, createMemberService, lobbyGamePath, memberErrorMessage, safeReturnPath } from "../src/member/service.js"
import { createGameEntry } from "../src/member/game-entry.js"

const origin = "https://joy8.example"
const guestUser = { id: "guest-1", is_anonymous: true }
const registeredUser = { id: "guest-1", is_anonymous: false, email_confirmed_at: "2026-09-16" }

function fixture(initialUser = null) {
  let user = initialUser
  let lock = Promise.resolve()
  const calls = []
  const ok = (data = {}) => ({ data, error: null })
  const client = {
    auth: {
      getSession: async () => ok({ session: user ? { user } : null }),
      getUser: async () => ok({ user }),
      signInAnonymously: async () => {
        calls.push(["anonymous"])
        await new Promise((resolve) => setTimeout(resolve, 5))
        user = guestUser
        return ok({ user })
      },
      signInWithPassword: async (args) => {
        calls.push(["password", args])
        user = registeredUser
        return ok({ user })
      },
      signUp: async (args) => { calls.push(["signup", args]); return ok() },
      signInWithOAuth: async (args) => { calls.push(["oauth", args]); return ok({ url: "https://provider.example" }) },
      linkIdentity: async (args) => { calls.push(["link", args]); return ok({ url: "https://provider.example" }) },
      updateUser: async (...args) => { calls.push(["update", ...args]); return ok({ user }) },
      exchangeCodeForSession: async (code) => { calls.push(["exchange", code]); user = registeredUser; return ok({ user }) },
      resetPasswordForEmail: async (...args) => { calls.push(["reset", ...args]); return ok() },
      signOut: async (args) => { calls.push(["signout", args]); user = null; return ok() },
    },
    functions: {
      invoke: async (...args) => {
        calls.push(["rpc", ...args])
        return ok({ member: { player_account_ref: "player-1", account_type: user?.is_anonymous ? "guest" : "registered" } })
      },
    },
  }
  const options = {
    origin,
    next: "/game/?slug=mahjong-clash&token=discard",
    guestLock: (action) => {
      const result = lock.then(action)
      lock = result.catch(() => {})
      return result
    },
  }
  return { client, calls, service: createMemberService(client, options), options }
}

test("return paths reject external destinations and remove unrelated parameters", () => {
  for (const value of ["https://evil.example", "//evil.example/game/?slug=test", "/admin/", "javascript:alert(1)", "/game/?slug=x#secret", "/game/?slug=<script>"]) {
    assert.equal(safeReturnPath(value, origin), "/")
  }
  assert.equal(safeReturnPath("/game/?slug=mahjong-clash&access_token=secret", origin), "/game/?slug=mahjong-clash")
  assert.equal(safeReturnPath("/play-test/?slug=mahjong-clash&launch_url=https://evil.example&token=secret", origin), "/play-test/?slug=mahjong-clash")
  assert.equal(safeReturnPath("https://evil.example/play-test/?slug=mahjong-clash", origin), "/")
  assert.equal(accountPath("/play-test/?slug=mahjong-clash", origin), "/account/?next=%2Fplay-test%2F%3Fslug%3Dmahjong-clash")
  assert.equal(accountPath("/game/?slug=test", origin), "/account/?next=%2Fgame%2F%3Fslug%3Dtest")
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

test("both enrolled guests and registered players enter directly without opening a login dialog", async () => {
  for (const type of ["guest", "registered"]) {
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

test("concurrent guest entry creates one Auth guest and preserves its player", async () => {
  const f = fixture()
  const otherTab = createMemberService(f.client, f.options)
  const members = await Promise.all([f.service.guest(), otherTab.guest(), f.service.guest()])
  assert.equal(f.calls.filter(([name]) => name === "anonymous").length, 1)
  assert.deepEqual(members.map((member) => member.player_account_ref), ["player-1", "player-1", "player-1"])
})

test("unsupported guest locking and Auth failure stop enrollment", async () => {
  const f = fixture()
  const service = createMemberService(f.client, { origin })
  await assert.rejects(service.guest(), { code: "guest_lock_unavailable" })
  f.client.auth.signInAnonymously = async () => ({ error: { code: "over_request_rate_limit" } })
  await assert.rejects(f.service.guest(), { code: "over_request_rate_limit" })
  assert.deepEqual(f.calls, [])
})

test("guest email upgrade changes the same identity without assigning an unverified password", async () => {
  const f = fixture(guestUser)
  const result = await f.service.register(" player@example.com ", "not-used")
  assert.equal(result.expectedUserId, guestUser.id)
  assert.deepEqual(f.calls[0][1], { email: "player@example.com" })
  assert.equal(new URL(f.calls[0][2].emailRedirectTo).searchParams.get("flow"), "upgrade")
  await assert.rejects(f.service.signIn("other@example.com", "password"), { code: "identity_conflict" })
  assert.equal(f.calls.length, 1)
})

test("Google upgrades link to the guest and provider conflicts preserve the current session", async () => {
  const f = fixture(guestUser)
  assert.equal((await f.service.google()).expectedUserId, guestUser.id)
  assert.equal(f.calls[0][0], "link")
  f.client.auth.linkIdentity = async () => ({ error: { code: "identity_already_exists" } })
  await assert.rejects(f.service.google(), { code: "identity_already_exists" })
  assert.equal((await f.service.session()).user.id, guestUser.id)
  assert.equal(f.calls.some(([name]) => name === "signout"), false)
  const signedOut = fixture()
  await signedOut.service.google()
  assert.equal(signedOut.calls[0][0], "oauth")
})

test("upgrade callbacks require the original identity, including a new email tab", async () => {
  const f = fixture(guestUser)
  assert.equal((await f.service.completeCallback("one-use-code", null, "upgrade")).user.id, guestUser.id)
  await assert.rejects(f.service.completeCallback("another-code", "wrong-user", "link"), { code: "identity_conflict" })
  assert.equal(await f.service.session(), null)
  const lostGuest = fixture()
  await assert.rejects(lostGuest.service.completeCallback("code", null, "upgrade"), { code: "identity_conflict" })
  assert.deepEqual(lostGuest.calls, [])
})

test("invalid or replayed callbacks cannot enroll or fall back to a new guest", async () => {
  const f = fixture()
  await assert.rejects(f.service.completeCallback("code", null, "unknown"))
  f.client.auth.exchangeCodeForSession = async () => ({ error: { code: "flow_state_not_found" } })
  await assert.rejects(f.service.completeCallback("used-code", null, "signin"), { code: "flow_state_not_found" })
  assert.deepEqual(f.calls, [])
})

test("email password sign-in enrolls only after successful authentication", async () => {
  const f = fixture()
  assert.equal((await f.service.signIn(" player@example.com ", "password" )).player_account_ref, "player-1")
  assert.deepEqual(f.calls.map(([name]) => name), ["password", "rpc"])
  assert.equal(f.calls[1][1], "joy8-gateway/enroll-member")
  const rejected = fixture()
  rejected.client.auth.signInWithPassword = async () => ({ error: { code: "email_not_confirmed" } })
  await assert.rejects(rejected.service.signIn("player@example.com", "password"), { code: "email_not_confirmed" })
  assert.deepEqual(rejected.calls, [])
})

test("password setup requires verified nonanonymous identity and minimum strength", async () => {
  const f = fixture(guestUser)
  await assert.rejects(f.service.setPassword("long-password"), { code: "verification_required" })
  const verified = fixture(registeredUser)
  await assert.rejects(verified.service.setPassword("short"), { code: "weak_password" })
  await verified.service.setPassword("long-password")
  assert.deepEqual(verified.calls.map(([name]) => name), ["update", "rpc"])
})

test("recovery disregards a stale link expectation and sign-out does not auto-create guests", async () => {
  const f = fixture()
  await f.service.resetPassword(" player@example.com ")
  assert.equal(new URL(f.calls[0][2].redirectTo).searchParams.get("flow"), "recovery")
  await f.service.completeCallback("recovery-code", "stale-user", "recovery")
  await f.service.signOut()
  assert.equal(await f.service.membership(), null)
  assert.deepEqual(f.calls.at(-1), ["signout", { scope: "local" }])
})

test("inactive membership and upstream failures fail closed without exposing raw errors", async () => {
  const f = fixture(registeredUser)
  f.client.functions.invoke = async () => ({ error: { context: { json: async () => ({ error: "player account is not active" }) } } })
  await assert.rejects(f.service.membership(), { code: "member_inactive" })
  f.client.functions.invoke = async () => ({ error: new Error("secret diagnostic") })
  await assert.rejects(f.service.membership(), { code: "member_unavailable" })
  assert.equal(memberErrorMessage(new Error("secret diagnostic")).includes("secret"), false)
})
