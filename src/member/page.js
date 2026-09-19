import "./account.css"
import { memberSupabase } from "../lib/memberClient.js"
import { createMemberCaptcha } from "./captcha.js"
import { createMemberService, memberErrorMessage } from "./service.js"

export function initMemberPanel(root, options = {}) {
  const $ = (id) => root.querySelector(`#${id}`)
  const params = options.params ?? new URLSearchParams()
  const flow = params.get("flow")
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

  if (options.standalone) history.replaceState(null, "", `/account/?next=${encodeURIComponent(service.returnPath)}`)

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
        status(memberErrorMessage(error), true)
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
    $("account-title").textContent = guest ? "訪客帳號" : user ? "我的帳號" : "登入"
    $("account-description").textContent = guest ? "綁定 Google 後，可在其他裝置找回進度。" : user ? "" : entryDescription
    $("account-description").hidden = !$("account-description").textContent
    $("identity-summary").hidden = !user
    $("signin-options").hidden = Boolean(user && !guest)
    $("continue-link").hidden = true
    $("enroll-button").hidden = true
    $("google-button").textContent = guest ? "綁定 Google，保留進度" : "使用 Google 登入"
    $("guest-button").hidden = Boolean(user)
    $("guest-notice").hidden = Boolean(user)
    $("identity-label").textContent = guest ? "目前以訪客身分登入" : user?.email || "已使用 Google 登入"
    if (!user) return
    const member = await service.membership()
    if (disposed) return
    $("continue-link").href = service.returnPath
    $("continue-link").hidden = !member
    $("enroll-button").hidden = Boolean(member)
  }

  $("google-button").addEventListener("click", () => run(async () => {
    const result = await service.google()
    if (disposed) return
    if (result.expectedUserId) sessionStorage.setItem(pendingKey, result.expectedUserId)
    else sessionStorage.removeItem(pendingKey)
    location.assign(result.url)
  }))

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
    await captcha.ready
    if (callbackError) throw Object.assign(new Error("Authentication callback failed"), { code: callbackErrorCode })
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
