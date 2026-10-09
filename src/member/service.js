import { GAME_SLUG_PATTERN } from "../../packages/joy8-game-sdk/contract.js"

export function safeReturnPath(value, origin) {
  try {
    const url = new URL(value || "/", origin)
    if (url.origin !== origin || url.username || url.password || url.hash) return "/"
    if (url.pathname === "/" && !url.search) return "/"
    if (!["/game/", "/play-test/", "/entry/"].includes(url.pathname)) return "/"
    const slug = url.searchParams.get("slug")
    if (!GAME_SLUG_PATTERN.test(slug || "")) return "/"
    return `${url.pathname}?slug=${encodeURIComponent(slug)}`
  } catch {
    return "/"
  }
}

export function accountPath(next, origin) {
  return `/account/?next=${encodeURIComponent(safeReturnPath(next, origin))}`
}

export function lobbyGamePath(next, origin) {
  const path = safeReturnPath(next, origin)
  if (path === "/") return "/"
  return `/?play=${encodeURIComponent(new URL(path, origin).searchParams.get("slug"))}`
}

function checked(result) {
  if (result.error) throw result.error
  return result.data
}

export function memberErrorMessage(error) {
  const code = error?.code
  const messages = {
    JOY8_EMAIL_NOT_ALLOWED: "尚未開放，目前僅限白名單 Google 帳號遊玩。",
    JOY8_GUEST_DISABLED: "訪客入口暫停開放，請使用白名單 Google 帳號登入。",
    over_request_rate_limit: "操作太頻繁，請稍後再試。",
    verification_required: "目前的登入身分無法通過驗證，請重新登入。",
    member_inactive: "這個玩家帳號目前無法使用，請聯絡平台。",
    flow_state_not_found: "這個驗證連結已使用或已失效，請重新操作。",
    flow_state_expired: "這個驗證連結已失效，請重新操作。",
    auth_callback_failed: "驗證連結無法完成，請重新操作。",
  }
  return messages[code] || "目前無法完成操作，請稍後再試。"
}

export function createMemberService(client, { origin, next = "/" } = {}) {
  const returnPath = safeReturnPath(next, origin)
  const callbackUrl = `${origin}${accountPath(returnPath, origin)}&flow=signin&provider=google`
  let pendingMember = null

  async function session() {
    return checked(await client.auth.getSession()).session
  }

  async function membership(enroll = false) {
    const current = await session()
    if (!current) return null
    if (enroll) return requestMembership(true, current.user.id)
    if (pendingMember && pendingMember.userId === current.user.id) return pendingMember.request
    const request = requestMembership(false)
    pendingMember = { userId: current.user.id, request }
    try { return await request }
    finally { if (pendingMember?.request === request) pendingMember = null }
  }

  async function memberFailure(error) {
    if (error.context?.status === 429) return Object.assign(new Error("Member request rate limited"), { code: "over_request_rate_limit", context: error.context })
    let code = "member_unavailable"
    try {
      const body = await error.context?.json()
      if (["JOY8_EMAIL_NOT_ALLOWED", "JOY8_GUEST_DISABLED"].includes(body?.error)) code = body.error
      if (body?.error === "player account is not active") code = "member_inactive"
      if (body?.error === "verified member identity is required") code = "verification_required"
    } catch {}
    return Object.assign(new Error("Member request failed"), { code })
  }

  async function requestMembership(enroll, authUserId = null) {
    const result = await client.functions.invoke(`joy8-gateway/${enroll ? "enroll-member" : "member"}`, { body: {} })
    if (result.error) throw await memberFailure(result.error)
    const member = result.data?.member ?? null
    if (enroll && !member) throw new Error("Enrollment returned no member")
    if (enroll && (await session())?.user.id !== authUserId) throw new Error("Member identity changed")
    if (enroll && member && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("joy8:membership", { detail: { ...member, auth_user_id: authUserId } }))
    }
    return member
  }

  async function lobby() {
    if (!(await session())) return null
    const result = await client.functions.invoke("joy8-gateway/lobby", { body: {} })
    if (result.error) throw await memberFailure(result.error)
    const member = result.data?.member ?? null
    return { member, wallet: member ? result.data?.wallet ?? null : null, mail: member ? result.data?.mail ?? null : null }
  }

  async function wallet() {
    if (!(await session())) return null
    const result = await client.functions.invoke("joy8-gateway/wallet", { body: {} })
    if (result.error) throw Object.assign(new Error("Wallet request failed"), { code: result.error.context?.status === 429 ? "over_request_rate_limit" : "wallet_unavailable" })
    return result.data?.wallet ?? null
  }

  async function oauth(provider = "google") {
    if (provider !== "google") throw new Error("Unsupported authentication provider")
    const options = { redirectTo: callbackUrl, skipBrowserRedirect: true }
    const data = checked(await client.auth.signInWithOAuth({ provider: "google", options }))
    if (!data?.url) throw new Error("Missing provider redirect")
    return { url: data.url }
  }

  async function completeCallback(code, flow) {
    if (flow !== "signin") throw new Error("Unknown authentication callback")
    const data = checked(await client.auth.exchangeCodeForSession(code))
    if (!data.user || data.user.is_anonymous === true) {
      await client.auth.signOut({ scope: "local" })
      throw Object.assign(new Error("Verified identity required"), { code: "verification_required" })
    }
    return data
  }

  async function signOut() {
    checked(await client.auth.signOut({ scope: "local" }))
  }

  return { session, membership, lobby, wallet, oauth, completeCallback, signOut, returnPath }
}
