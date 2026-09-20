import "./account.css"
import { memberSupabase } from "../lib/memberClient.js"
import { createMemberCaptcha } from "./captcha.js"
import { createMemberService, memberErrorMessage, providerLabel } from "./service.js"

export function initMemberPanel(root, options = {}) {
  const $ = (id) => root.querySelector(`#${id}`)
  const params = options.params ?? new URLSearchParams()
  const facebookEnabled = options.facebookEnabled ?? import.meta.env.VITE_FACEBOOK_AUTH_ENABLED === "true"
  const flow = params.get("flow")
  const providerParam = params.get("provider")
  const callbackProvider = providerParam === "google" || (facebookEnabled && providerParam === "facebook") ? providerParam : null
  const authCode = params.get("code")
  const callbackError = params.has("error") || params.has("error_code")
  const callbackErrorCode = params.get("error_code") || "auth_callback_failed"
  const service = createMemberService(memberSupabase, {
    origin: location.origin,
    next: params.get("next"),
    guestLock: navigator.locks ? (fn) => navigator.locks.request("joy8-guest-entry", fn) : null,
  })
  const captcha = options.captcha ?? createMemberCaptcha(root)
  const pendingKey = "joy8-member-link-user"
  const entryDescription = $("account-description").textContent
  let user = null
  let busy = false
  let disposed = false

  $("facebook-button").hidden = !facebookEnabled
  $("guest-notice-text").textContent = facebookEnabled
    ? "訪客登入憑證只保留在目前瀏覽器；換裝置前，記得綁定 Google 或 Facebook。"
    : "訪客登入憑證只保留在目前瀏覽器；換裝置前，記得綁定 Google。"

  if (authCode || callbackError) {
    const label = providerLabel(callbackProvider)
    $("account-title").textContent = callbackError ? "登入沒有完成" : "正在完成登入"
    $("account-description").textContent = callbackError ? "你可以重新選擇登入方式。" : "請稍候，馬上帶你回到 Joy8。"
    $("account-description").hidden = false
    status(authCode ? `正在安全地完成 ${label} 登入…` : `正在處理 ${label} 回傳結果…`)
  }

  function status(message = "", error = false) {
    $("account-status").textContent = message
    $("account-status").dataset.error = String(error)
  }

  async function run(action) {
    if (busy || disposed) return
    busy = true
    root.querySelector(".account-card").setAttribute("aria-busy", "true")
    for (const button of root.querySelectorAll("button")) button.disabled = true
    try {
      await action()
    } catch (error) {
      if (!disposed) {
        status(memberErrorMessage(error, callbackProvider), true)
        $("account-status").focus()
      }
    } finally {
      busy = false
      if (disposed) return
      root.querySelector(".account-card").setAttribute("aria-busy", "false")
      for (const button of root.querySelectorAll("button")) button.disabled = false
      $("account-actions").hidden = false
    }
  }

  async function refresh() {
    user = (await service.session())?.user ?? null
    if (disposed) return
    const guest = user?.is_anonymous === true
    $("account-title").textContent = guest ? "訪客帳號" : user ? "我的帳號" : "登入 Joy8"
    $("account-description").textContent = guest
      ? `綁定 ${facebookEnabled ? "Google 或 Facebook" : "Google"} 後，可在其他裝置找回進度。`
      : user ? "" : entryDescription
    $("account-description").hidden = !$("account-description").textContent
    $("identity-summary").hidden = !user
    $("signin-options").hidden = Boolean(user && !guest)
    $("continue-link").hidden = true
    $("enroll-button").hidden = true
    $("google-label").textContent = guest ? "綁定 Google，保留進度" : "使用 Google 登入"
    $("facebook-label").textContent = guest ? "綁定 Facebook，保留進度" : "使用 Facebook 登入"
    $("guest-button").hidden = Boolean(user)
    $("guest-notice").hidden = Boolean(user)
    $("identity-label").textContent = guest ? "目前以訪客身分登入" : user?.email || "已登入 Joy8"
    if (!user) return
    const member = await service.membership()
    if (disposed) return
    $("continue-link").href = service.returnPath
    $("continue-link").hidden = !member
    $("enroll-button").hidden = Boolean(member)
  }

  async function beginProvider(provider) {
    if (user?.is_anonymous) sessionStorage.setItem(pendingKey, user.id)
    else sessionStorage.removeItem(pendingKey)
    let result
    try {
      result = await service.oauth(provider)
    } catch (error) {
      if (error?.code !== "identity_already_exists") sessionStorage.removeItem(pendingKey)
      throw error
    }
    if (disposed) return
    if (result.expectedUserId) sessionStorage.setItem(pendingKey, result.expectedUserId)
    else sessionStorage.removeItem(pendingKey)
    location.assign(result.url)
  }

  async function switchToExistingProvider(provider) {
    const current = (await service.session())?.user
    const expected = sessionStorage.getItem(pendingKey)
    if (!current?.is_anonymous || !expected || current.id !== expected) {
      throw Object.assign(new Error("Original guest identity unavailable"), { code: "identity_conflict" })
    }
    const label = providerLabel(provider)
    const confirmed = window.confirm(`這個 ${label} 已經綁定其他 Joy8 玩家。\n\n繼續後會離開目前訪客帳號，登入既有帳號；訪客進度、POINT 與錢包不會合併或轉移。`)
    sessionStorage.removeItem(pendingKey)
    if (!confirmed) {
      status("已保留目前的訪客帳號，沒有合併或轉移任何資料。")
      await refresh()
      return
    }
    await service.signOut()
    await beginProvider(provider)
  }

  function startProvider(provider) {
    return run(async () => {
      try {
        await beginProvider(provider)
      } catch (error) {
        if (error?.code === "identity_already_exists" && user?.is_anonymous) {
          await switchToExistingProvider(provider)
          return
        }
        throw error
      }
    })
  }

  $("google-button").addEventListener("click", () => startProvider("google"))
  if (facebookEnabled) $("facebook-button").addEventListener("click", () => startProvider("facebook"))

  $("guest-button").addEventListener("click", () => run(async () => {
    try {
      await service.guest(await captcha.token())
      continuePlaying()
    } finally {
      captcha.reset()
    }
  }))

  $("enroll-button").addEventListener("click", () => run(async () => {
    await service.membership(true)
    if (service.returnPath !== "/") {
      continuePlaying()
      return
    }
    await refresh()
    status("玩家身分已啟用。")
  }))

  $("signout-button").addEventListener("click", () => run(async () => {
    if (user?.is_anonymous && !window.confirm("登出後可能無法找回這個訪客進度。建議先綁定 Google，確定仍要登出？")) return
    await service.signOut()
    sessionStorage.removeItem(pendingKey)
    await refresh()
    status("已登出，請選擇登入方式。")
  }))

  const ready = run(async () => {
    if (callbackError) {
      if (callbackErrorCode === "identity_already_exists" && flow === "link" && callbackProvider) {
        await switchToExistingProvider(callbackProvider)
        return
      }
      sessionStorage.removeItem(pendingKey)
      throw Object.assign(new Error("Authentication callback failed"), { code: callbackErrorCode })
    }
    if (authCode) {
      await service.completeCallback(authCode, sessionStorage.getItem(pendingKey), flow)
      sessionStorage.removeItem(pendingKey)
      await service.membership(true)
      continuePlaying()
      return
    }
    await refresh()
    status()
  })

  const onFocus = () => {
    if (!busy && root.getClientRects().length) run(refresh)
  }
  window.addEventListener("focus", onFocus)

  function continuePlaying() {
    if (disposed) return
    if (options.onContinue) options.onContinue(service.returnPath)
    else location.assign(service.returnPath)
  }

  $("continue-link").addEventListener("click", (event) => {
    event.preventDefault()
    continuePlaying()
  })

  return {
    ready,
    dispose() {
      disposed = true
      captcha.dispose()
      window.removeEventListener("focus", onFocus)
    },
  }
}
