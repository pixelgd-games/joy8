import { supabase } from "../lib/supabaseClient.js"
import { ERROR_CODES, showErrorModal } from "../ui/error-modal.js"
import { signInWithGoogle, signOut, requireAdmin } from "./auth.js"

const $ = (selector) => document.querySelector(selector)

async function initLoginPage() {
  const statusEl = $("#status")
  const btnLogin = $("#btnLogin")
  const btnLogout = $("#btnLogout")

  btnLogin?.addEventListener("click", signInWithGoogle)
  btnLogout?.addEventListener("click", signOut)

  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) {
    if (statusEl) statusEl.textContent = "登入狀態讀取失敗"
    showErrorModal({
      code: ERROR_CODES.ADMIN_AUTH_READ_FAILED,
      title: "後台登入狀態讀取失敗",
      message: "目前無法確認後台登入狀態，請稍後再試。",
      error,
    })
    return
  }

  const isSignedIn = Boolean(session?.user)
  if (btnLogout) btnLogout.hidden = !isSignedIn
  if (btnLogin) btnLogin.textContent = isSignedIn ? "切換 Google 帳號" : "用 Google 登入"

  if (!isSignedIn) {
    if (statusEl) statusEl.textContent = "尚未登入"
    return
  }

  if (statusEl) statusEl.textContent = "已登入，檢查管理員白名單中..."
  const admin = await requireAdmin({
    redirectIfMissing: false,
    showDeniedModal: false,
  })

  if (admin) {
    location.href = "/admin/games/"
    return
  }

  if (statusEl) {
    statusEl.textContent = "目前登入的帳號不是管理員，請登出或切換 Google 帳號。"
  }
}

initLoginPage()
