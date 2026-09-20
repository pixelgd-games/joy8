export function safeReturnPath(value, origin) {
  try {
    const url = new URL(value || "/", origin)
    if (url.origin !== origin || url.username || url.password || url.hash) return "/"
    if (url.pathname === "/" && !url.search) return "/"
    if (!["/game/", "/play-test/"].includes(url.pathname)) return "/"
    const slug = url.searchParams.get("slug")
    if (!/^[a-z0-9-]{1,80}$/.test(slug || "")) return "/"
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

const oauthProviders = new Set(["google", "facebook"])

export function providerLabel(provider) {
  return provider === "facebook" ? "Facebook" : provider === "google" ? "Google" : "第三方帳號"
}

function checkedProvider(provider) {
  if (!oauthProviders.has(provider)) throw new Error("Unsupported authentication provider")
  return provider
}

export function memberErrorMessage(error, provider) {
  const code = error?.code
  const label = providerLabel(provider)
  const messages = {
    identity_already_exists: `這個 ${label} 已綁定其他玩家，不能合併目前的訪客資料。`,
    over_request_rate_limit: "操作太頻繁，請稍後再試。",
    captcha_failed: "安全驗證失敗，請重新驗證後再試。",
    captcha_timeout: "安全驗證逾時，請檢查網路後再試一次。",
    captcha_unavailable: "安全驗證暫時無法載入，請稍後再試。",
    verification_required: "目前的登入身分無法通過驗證，請重新登入。",
    guest_lock_unavailable: "這個瀏覽器暫時無法使用訪客登入，請改用 Google 或 Facebook。",
    identity_conflict: "登入身分與原訪客不同，已停止升級，沒有合併帳號或點數。",
    member_inactive: "這個玩家帳號目前無法使用，請聯絡平台。",
    flow_state_not_found: "這個驗證連結已使用或已失效，請重新操作。",
    flow_state_expired: "這個驗證連結已失效，請重新操作。",
    auth_callback_failed: "驗證連結無法完成，請重新操作。",
  }
  return messages[code] || "目前無法完成操作，請稍後再試。"
}

export function createMemberService(client, { origin, next = "/", guestLock } = {}) {
  const returnPath = safeReturnPath(next, origin)
  const callbackUrl = (flow, provider) => `${origin}${accountPath(returnPath, origin)}&flow=${flow}&provider=${provider}`

  async function session() {
    return checked(await client.auth.getSession()).session
  }

  async function membership(enroll = false) {
    if (!(await session())) return null
    const result = await client.functions.invoke(`joy8-gateway/${enroll ? "enroll-member" : "member"}`, { body: {} })
    if (result.error) {
      let code = "member_unavailable"
      try {
        const body = await result.error.context?.json()
        if (body?.error === "player account is not active") code = "member_inactive"
        if (body?.error === "verified member identity is required") code = "verification_required"
      } catch {}
      throw Object.assign(new Error("Member request failed"), { code })
    }
    const member = result.data?.member ?? null
    if (enroll && !member) throw new Error("Enrollment returned no member")
    if (enroll && member && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("joy8:membership", { detail: member }))
    }
    return member
  }

  async function guest(captchaToken) {
    if (!guestLock) throw Object.assign(new Error("Web Locks unavailable"), { code: "guest_lock_unavailable" })
    return guestLock(async () => {
      if (!(await session())) checked(await client.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined))
      return membership(true)
    })
  }

  async function oauth(provider) {
    checkedProvider(provider)
    const current = await session()
    const options = { redirectTo: callbackUrl(current ? "link" : "signin", provider), skipBrowserRedirect: true }
    const data = checked(current
      ? await client.auth.linkIdentity({ provider, options })
      : await client.auth.signInWithOAuth({ provider, options }))
    if (!data?.url) throw new Error("Missing provider redirect")
    return { url: data.url, expectedUserId: current?.user?.id ?? null, provider }
  }

  async function completeCallback(code, expectedUserId, flow) {
    if (!["signin", "link"].includes(flow)) {
      throw new Error("Unknown authentication callback")
    }
    const linking = flow === "link"
    const expected = linking ? expectedUserId || (await session())?.user?.id : null
    if (linking && !expected) {
      throw Object.assign(new Error("Original identity unavailable"), { code: "identity_conflict" })
    }
    const data = checked(await client.auth.exchangeCodeForSession(code))
    if (expected && data.user?.id !== expected) {
      await client.auth.signOut({ scope: "local" })
      throw Object.assign(new Error("Identity changed during linking"), { code: "identity_conflict" })
    }
    return data
  }

  async function signOut() {
    checked(await client.auth.signOut({ scope: "local" }))
  }

  return { session, membership, guest, oauth, completeCallback, signOut, returnPath }
}
