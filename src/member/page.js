import { createMemberAuthFlow } from "./auth-flow.js"
import "./account.css"
import { memberSupabase } from "../lib/memberClient.js"
import { createMemberService, memberErrorMessage } from "./service.js"
import { prepareGameEntry } from "./game-visit.js"

export function initMemberPanel(root, options = {}) {
  const $ = (id) => root.querySelector(`#${id}`)
  const params = options.params ?? new URLSearchParams()
  const authCode = params.get("code")
  const callbackError = params.has("error") || params.has("error_code")
  const service = createMemberService(memberSupabase, {
    origin: location.origin,
    next: params.get("next"),
  })
  const memberFlow = createMemberAuthFlow(service, { isActive: () => !disposed })
  const entryDescription = $("account-description").textContent
  let user = null
  let busy = false
  let disposed = false

  if (authCode || callbackError) {
    const label = "Google"
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
    $("account-title").textContent = user ? "我的帳號" : "登入開始遊戲"
    $("account-description").textContent = user ? "" : entryDescription
    $("account-description").hidden = !$("account-description").textContent
    $("identity-summary").hidden = !user
    $("signin-options").hidden = Boolean(user)
    $("continue-link").hidden = true
    $("enroll-button").hidden = true
    $("identity-label").textContent = user?.email || "已登入 Joy8"
    if (!user) return
    const member = await service.membership()
    if (disposed) return
    $("continue-link").href = service.returnPath
    $("continue-link").hidden = !member
    $("enroll-button").hidden = Boolean(member)
  }

  function startProvider(provider) {
    return run(() => memberFlow.begin(provider))
  }

  $("google-button").addEventListener("click", () => startProvider("google"))

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
    await memberFlow.signOut()
    await refresh()
    status("已登出，請選擇登入方式。")
  }))

  const ready = run(async () => {
    if (callbackError || authCode) {
      if (await memberFlow.complete(params)) continuePlaying()
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
    prepareGameEntry(service.returnPath)
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
    },
  }
}
