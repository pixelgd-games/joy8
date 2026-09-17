import { supabase, supabaseFunctionsUrl } from "/src/lib/supabaseClient.js"
import { appendQueryParams, normalizeLaunchUrl } from "/src/lib/urls.js"
import { ERROR_CODES, showErrorModal } from "/src/ui/error-modal.js"
import { mountGameFrame } from "./iframe.js"
import { memberSupabase } from "/src/lib/memberClient.js"
import { lobbyGamePath, createMemberService } from "/src/member/service.js"

const params = new URLSearchParams(location.search)
const slug = params.get("slug")
const GAME_LOAD_TIMEOUT_MS = 30000

function primeParentScroll() {
  if (window.scrollY > 0) return
  if (document.documentElement.scrollHeight <= window.innerHeight) return

  window.requestAnimationFrame(() => {
    window.scrollTo(0, 1)
  })
}

function showError({ code, title, message, error }) {
  document.body.replaceChildren()

  const errorBox = document.createElement("div")
  errorBox.className = "error"

  const heading = document.createElement("strong")
  heading.textContent = title

  const copy = document.createElement("div")
  copy.textContent = message

  const codeText = document.createElement("div")
  codeText.style.marginTop = "8px"
  codeText.style.opacity = ".72"
  codeText.textContent = `錯誤代碼：${code}`

  errorBox.append(heading, copy, codeText)
  document.body.append(errorBox)

  showErrorModal({
    code,
    title,
    message,
    error,
  })
}

async function main() {
  if (!slug) {
    showError({
      code: ERROR_CODES.GAME_MISSING_SLUG,
      title: "缺少遊戲代碼",
      message: "目前無法判斷要載入哪一款遊戲，請從遊戲列表重新進入。",
    })
    return
  }

  const memberService = createMemberService(memberSupabase, { origin: location.origin })
  if (!(await memberService.membership())) {
    location.replace(lobbyGamePath(location.pathname + location.search, location.origin))
    return
  }

  const { data, error } = await supabase
    .from("public_games_v1")
    .select("id, slug, name, launch_url")
    .eq("slug", slug)
    .maybeSingle()

  if (error) {
    showError({
      code: ERROR_CODES.GAME_READ_FAILED,
      title: "遊戲資料讀取失敗",
      message: "目前無法取得遊戲資料，請稍後再試。",
      error,
    })
    return
  }

  if (!data) {
    showError({
      code: ERROR_CODES.GAME_NOT_FOUND,
      title: "找不到遊戲",
      message: "找不到指定的公開遊戲，請回到遊戲列表重新選擇。",
    })
    return
  }

  const rawGameUrl = data.launch_url?.trim()
  if (!rawGameUrl) {
    showError({
      code: ERROR_CODES.GAME_URL_MISSING,
      title: "遊戲啟動網址未設定",
      message: "這款遊戲目前缺少啟動網址，請聯絡管理員。",
    })
    return
  }

  const gameUrl = normalizeLaunchUrl(rawGameUrl)
  if (!gameUrl) {
    showError({
      code: ERROR_CODES.GAME_URL_INVALID,
      title: "遊戲啟動網址格式不支援",
      message: "這款遊戲的啟動網址格式目前無法使用，請聯絡管理員。",
    })
    return
  }

  const launchSession = await createLaunchSession(data.slug)
  const gatewayUrl = supabaseFunctionsUrl ? `${supabaseFunctionsUrl}/looty-gateway` : ""
  const sessionGameUrl = appendQueryParams(gameUrl, {
    looty_session_id: launchSession.session_id,
    looty_launch_code: launchSession.launch_code,
    looty_game_id: launchSession.game_id,
    looty_currency: launchSession.currency,
    looty_wallet_mode: launchSession.wallet_mode,
    looty_gateway_url: gatewayUrl,
    looty_exchange_url: gatewayUrl ? `${gatewayUrl}/exchange` : "",
  })

  if (!sessionGameUrl) {
    showError({
      code: ERROR_CODES.GAME_URL_INVALID,
      title: "Game URL is invalid",
      message: "Looty could not prepare the game launch URL.",
    })
    return
  }

  mountGameIframe(sessionGameUrl, data.name)
  primeParentScroll()
}

async function createLaunchSession(gameSlug) {
  const { data, error } = await memberSupabase.functions.invoke("looty-gateway/create-session", {
    body: {
      slug: gameSlug,
      currency: "POINT",
      expires_in_seconds: 3600,
    },
  })

  if (error) {
    throw error
  }

  if (!data?.session_id || !data?.launch_code) {
    throw new Error("Looty gateway returned an empty session.")
  }

  return data
}

function mountGameIframe(gameUrl, gameName) {
  const gameRoot = document.getElementById("game")
  if (!gameRoot) return

  mountGameFrame({
    gameRoot,
    gameUrl,
    gameName,
    timeoutMs: GAME_LOAD_TIMEOUT_MS,
    onLoad: hideLoading,
    onTimeout: () => {
      showError({
        code: ERROR_CODES.GAME_LOAD_TIMEOUT,
        title: "遊戲載入逾時",
        message: "遊戲在預定時間內沒有完成載入，請稍後再試。",
      })
    },
  })
}

function hideLoading() {
  const loadingEl = document.getElementById("loading")
  if (!loadingEl) return

  loadingEl.classList.add("is-hidden")
  window.setTimeout(() => {
    loadingEl.remove()
  }, 320)
}

main().catch((error) => {
  showError({
    code: ERROR_CODES.GAME_READ_FAILED,
    title: "遊戲載入失敗",
    message: "目前無法載入遊戲，請稍後再試。",
    error,
  })
})
