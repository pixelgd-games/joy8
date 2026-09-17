export function safeReturnPath(value, origin) {
  try {
    const url = new URL(value || "/", origin)
    if (url.origin !== origin || url.username || url.password || url.hash) return "/"
    if (url.pathname === "/" && !url.search) return "/"
    if (url.pathname !== "/game/") return "/"
    const slug = url.searchParams.get("slug")
    if (!/^[a-z0-9-]{1,80}$/.test(slug || "")) return "/"
    return `/game/?slug=${encodeURIComponent(slug)}`
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
    invalid_credentials: "Email 或密碼不正確，請再試一次。",
    email_not_confirmed: "請先到信箱完成驗證，再回來登入。",
    weak_password: "密碼強度不足，請使用至少 10 個字元。",
    identity_already_exists: "這個登入方式已綁定其他帳號。原本的訪客資料會保留，請勿重複註冊。",
    email_exists: "這個 Email 已有帳號，請改用原帳號登入或找回密碼。",
    over_request_rate_limit: "操作太頻繁，請稍後再試。",
    over_email_send_rate_limit: "驗證信寄送太頻繁，請稍後再試。",
    guest_lock_unavailable: "這個瀏覽器暫時無法使用訪客登入，請改用 Google 或 Email。",
    identity_conflict: "登入身分與原訪客不同，已停止升級，沒有合併帳號或點數。",
    member_inactive: "這個玩家帳號目前無法使用，請聯絡平台。",
    verification_required: "請先完成信箱驗證。",
  }
  return messages[code] || "目前無法完成操作，請稍後再試。"
}

export function createMemberService(client, { origin, next = "/", guestLock } = {}) {
  const returnPath = safeReturnPath(next, origin)
  const callbackUrl = (flow) => `${origin}${accountPath(returnPath, origin)}&flow=${flow}`

  async function session() {
    return checked(await client.auth.getSession()).session
  }

  async function membership(enroll = false) {
    if (!(await session())) return null
    const result = await client.functions.invoke(`looty-gateway/${enroll ? "enroll-member" : "member"}`, { body: {} })
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
    return member
  }

  async function signIn(email, password) {
    if ((await session())?.user?.is_anonymous) {
      throw Object.assign(new Error("Upgrade the guest or sign out explicitly"), { code: "identity_conflict" })
    }
    checked(await client.auth.signInWithPassword({ email: email.trim(), password }))
    return membership(true)
  }

  async function guest() {
    if (!guestLock) throw Object.assign(new Error("Web Locks unavailable"), { code: "guest_lock_unavailable" })
    return guestLock(async () => {
      if (!(await session())) checked(await client.auth.signInAnonymously())
      return membership(true)
    })
  }

  async function google() {
    const current = await session()
    const options = { redirectTo: callbackUrl(current ? "link" : "signin"), skipBrowserRedirect: true }
    const data = checked(current
      ? await client.auth.linkIdentity({ provider: "google", options })
      : await client.auth.signInWithOAuth({ provider: "google", options }))
    if (!data?.url) throw new Error("Missing provider redirect")
    return { url: data.url, expectedUserId: current?.user?.id ?? null }
  }

  async function register(email, password) {
    const current = await session()
    if (current?.user?.is_anonymous) {
      checked(await client.auth.updateUser({ email: email.trim() }, { emailRedirectTo: callbackUrl("upgrade") }))
      return { verificationSent: true, expectedUserId: current.user.id }
    }
    if (current) throw new Error("Already signed in")
    checked(await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: callbackUrl("signup") } }))
    return { verificationSent: true, expectedUserId: null }
  }

  async function completeCallback(code, expectedUserId, flow) {
    if (!["signin", "signup", "link", "upgrade", "recovery"].includes(flow)) {
      throw new Error("Unknown authentication callback")
    }
    const linking = ["link", "upgrade"].includes(flow)
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

  async function resetPassword(email) {
    checked(await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: callbackUrl("recovery") }))
  }

  async function setPassword(password) {
    if (password.length < 10 || password.length > 128) {
      throw Object.assign(new Error("Invalid password length"), { code: "weak_password" })
    }
    const user = checked(await client.auth.getUser()).user
    if (!user?.email_confirmed_at || user.is_anonymous) {
      throw Object.assign(new Error("Email verification required"), { code: "verification_required" })
    }
    checked(await client.auth.updateUser({ password }))
    return membership(true)
  }

  async function signOut() {
    checked(await client.auth.signOut({ scope: "local" }))
  }

  return { session, membership, signIn, guest, google, register, completeCallback, resetPassword, setPassword, signOut, returnPath }
}
