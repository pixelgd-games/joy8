import "./account.css"
import { memberSupabase } from "../lib/memberClient.js"
import { createMemberService, memberErrorMessage } from "./service.js"

export function initMemberPanel(root, options = {}) {
  const $ = (id) => root.querySelector(`#${id}`)
  const params = options.params ?? new URLSearchParams()
  let flow = params.get("flow")
  const authCode = params.get("code")
  const callbackError = params.has("error") || params.has("error_code")
  const service = createMemberService(memberSupabase, {
    origin: location.origin,
    next: params.get("next"),
    guestLock: navigator.locks ? (fn) => navigator.locks.request("joy8-guest-entry", fn) : null,
  })
  const pendingKey = "joy8-member-link-user"
  const entryDescription = $("account-description").textContent
  let user = null
  let formMode = "signin"
  let busy = false
  let disposed = false

  if (options.standalone) history.replaceState(null, "", `/account/?next=${encodeURIComponent(service.returnPath)}${["recovery", "upgrade"].includes(flow) ? `&flow=${flow}` : ""}`)

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
      $("password").value = ""
      $("register-confirm-password").value = ""
      $("new-password").value = ""
      $("confirm-password").value = ""
      $("account-actions").hidden = false
    }
  }

  function mode(value) {
    formMode = value
    const guest = user?.is_anonymous === true
    const creating = value === "register"
    const emailOnly = value === "reset" || (creating && guest)
    $("account-title").textContent = guest ? "訪客帳號" : user ? ["recovery", "upgrade"].includes(flow) ? "設定密碼" : "我的帳號" : value === "register" ? "建立帳號" : value === "reset" ? "找回密碼" : "登入"
    $("account-description").textContent = guest ? "綁定帳號後，可在其他裝置找回進度。" : user || value !== "signin" ? "" : entryDescription
    $("account-description").hidden = !$("account-description").textContent
    $("provider-options").hidden = !guest && value !== "signin"
    $("password-field").hidden = emailOnly
    $("password").required = !emailOnly
    $("password").minLength = creating ? 10 : 1
    $("password").autocomplete = creating ? "new-password" : "current-password"
    $("password-label").textContent = creating ? "設定密碼" : "密碼"
    $("confirm-password-field").hidden = !creating || guest
    $("register-confirm-password").required = creating && !guest
    $("password-hint").hidden = !creating || guest
    $("reset-button").hidden = value !== "signin" || Boolean(user)
    $("email-submit").textContent = value === "reset" ? "寄送重設密碼信" : guest ? "寄送綁定驗證信" : creating ? "寄送帳號驗證信" : "登入"
    $("account-switch").hidden = Boolean(user)
    $("account-switch-prompt").textContent = creating ? "已經有帳號？" : value === "reset" ? "想起密碼了？" : "還沒有帳號？"
    $("register-button").textContent = value === "signin" ? "建立帳號" : "返回登入"
    $("guest-button").hidden = Boolean(user) || value !== "signin"
    $("guest-notice").hidden = Boolean(user) || value !== "signin"
  }

  async function refresh() {
    user = (await service.session())?.user ?? null
    if (disposed) return
    $("identity-summary").hidden = !user
    $("signin-options").hidden = Boolean(user && !user.is_anonymous)
    $("continue-link").hidden = true
    $("enroll-button").hidden = true
    $("new-password-form").hidden = !(user && !user.is_anonymous && ["recovery", "upgrade"].includes(flow))
    $("google-button").textContent = user ? "綁定 Google，保留進度" : "使用 Google 登入"
    $("identity-label").textContent = user?.is_anonymous ? "目前以訪客身分登入" : user?.email || ""
    mode(user?.is_anonymous ? "register" : "signin")
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
    await service.guest()
    continuePlaying()
  }))

  $("email-form").addEventListener("submit", (event) => {
    event.preventDefault()
    if (formMode === "register" && !user?.is_anonymous && $("password").value !== $("register-confirm-password").value) {
      status("兩次密碼不相同，請重新輸入。", true)
      $("register-confirm-password").focus()
      return
    }
    run(async () => {
      const email = $("email").value
      if (formMode === "reset") {
        await service.resetPassword(email)
        sessionStorage.removeItem(pendingKey)
        status("如果此 Email 可以找回帳號，你會收到重設密碼信。請在這個瀏覽器開啟連結。")
      } else if (formMode === "register") {
        const result = await service.register(email, $("password").value)
        if (result.expectedUserId) sessionStorage.setItem(pendingKey, result.expectedUserId)
        else sessionStorage.removeItem(pendingKey)
        status("請到信箱查看驗證信，並在這個瀏覽器開啟連結。若已有帳號，請使用登入或忘記密碼。")
      } else {
        await service.signIn(email, $("password").value)
        continuePlaying()
      }
    })
  })

  $("register-button").addEventListener("click", () => {
    status()
    mode(formMode === "signin" ? "register" : "signin")
  })
  $("reset-button").addEventListener("click", () => {
    status()
    mode("reset")
  })
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
    if (user?.is_anonymous && !window.confirm("登出後可能無法找回這個訪客進度。建議先綁定帳號，確定仍要登出？")) return
    await service.signOut()
    sessionStorage.removeItem(pendingKey)
    await refresh()
    status("已登出，請選擇登入方式。")
  }))
  $("new-password-form").addEventListener("submit", (event) => {
    event.preventDefault()
    if ($("new-password").value !== $("confirm-password").value) {
      status("兩次密碼不相同，請重新輸入。", true)
      return
    }
    run(async () => {
      await service.setPassword($("new-password").value)
      flow = null
      if (options.standalone) history.replaceState(null, "", `/account/?next=${encodeURIComponent(service.returnPath)}`)
      await refresh()
      $("new-password-form").hidden = true
      status("密碼已儲存，可以繼續遊玩。")
    })
  })

  const ready = run(async () => {
    if (callbackError) throw new Error("Authentication callback failed")
    if (authCode) {
      await service.completeCallback(authCode, sessionStorage.getItem(pendingKey), flow)
      sessionStorage.removeItem(pendingKey)
      if (!["recovery", "upgrade"].includes(flow)) {
        await service.membership(true)
        continuePlaying()
        return
      }
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
      window.removeEventListener("focus", onFocus)
      for (const input of root.querySelectorAll('input[type="password"]')) input.value = ""
    },
  }

}
