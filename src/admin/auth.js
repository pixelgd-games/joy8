import { supabase } from "../lib/supabaseClient.js"
import { ERROR_CODES, showErrorModal } from "../ui/error-modal.js"

const ADMIN_LOGIN_PATH = "/admin/login/"

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: location.origin + ADMIN_LOGIN_PATH,
      queryParams: { prompt: "select_account" },
    },
  })

  if (error) {
    showErrorModal({
      code: ERROR_CODES.ADMIN_OAUTH_FAILED,
      title: "後台登入失敗",
      message: "目前無法啟動 Google 登入，請稍後再試。",
      error,
      reload: false,
    })
  }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut({ scope: "local" })
  if (error) {
    showErrorModal({
      code: ERROR_CODES.ADMIN_SIGN_OUT_FAILED,
      title: "後台登出失敗",
      message: "目前無法完成登出，請稍後再試。",
      error,
      reload: false,
    })
    return
  }

  location.href = ADMIN_LOGIN_PATH
}

export async function requireAdmin(options = {}) {
  const {
    redirectIfMissing = true,
    showDeniedModal = true,
  } = options

  const { data: { session }, error: sessionError } = await supabase.auth.getSession()

  if (sessionError) {
    showErrorModal({
      code: ERROR_CODES.ADMIN_AUTH_READ_FAILED,
      title: "後台登入狀態讀取失敗",
      message: "目前無法確認後台登入狀態，請稍後再試。",
      error: sessionError,
    })
    return null
  }

  if (!session?.user) {
    if (redirectIfMissing) {
      location.href = ADMIN_LOGIN_PATH
    }
    return null
  }

  const { data, error } = await supabase
    .rpc("is_joy8_admin")

  if (error) {
    showErrorModal({
      code: ERROR_CODES.ADMIN_AUTH_READ_FAILED,
      title: "後台白名單檢查失敗",
      message: "目前無法確認管理員權限，請稍後再試。",
      error,
    })
    return null
  }

  if (data !== true) {
    if (showDeniedModal) {
      showErrorModal({
        code: ERROR_CODES.ADMIN_NOT_ALLOWED,
        title: "沒有後台權限",
        message: "目前登入的帳號不是管理員，請使用管理員 Google 帳號登入。",
        reload: false,
        primaryAction: {
          label: "前往後台登入",
          onClick: () => {
            location.href = ADMIN_LOGIN_PATH
          },
        },
      })
    }
    return null
  }

  return { session, user: session.user }
}
