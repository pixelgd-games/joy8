import { memberSupabase } from "../../lib/memberClient.js"
import { mountGameFrame } from "../game/iframe.js"
import { gameLaunchPayload } from "../game/launch.js"
import { normalizeLaunchUrl } from "../../lib/urls.js"
import { createMemberCaptcha } from "../../member/captcha.js"
import { createMemberService, memberErrorMessage } from "../../member/service.js"
import { createMemberAuthFlow } from "../../member/auth-flow.js"
import { enterBrandedMember } from "../../member/branded-entry.js"
import { GAME_SLUG_PATTERN } from "../../../packages/joy8-game-sdk/policy.js"

const params = new URLSearchParams(location.search)
const slug = params.get("slug")
const root = document.getElementById("entry")
const status = document.getElementById("entry-status")
const next = `/entry/?slug=${encodeURIComponent(slug || "")}`
const service = createMemberService(memberSupabase, {
  origin: location.origin, next,
  guestLock: navigator.locks ? action => navigator.locks.request("joy8-guest-entry", action) : null,
})
const captcha = createMemberCaptcha(document)
const memberFlow = createMemberAuthFlow(service, { isActive: () => !failed && !issued, onRetained: () => showStatus("已保留目前的訪客帳號，沒有合併或轉移任何資料。") })
let frame
let busy = true
let issued = false
let failed = false

function showStatus(message, error = false) {
  status.hidden = false
  status.textContent = message
  status.dataset.error = String(error)
  frame?.sendMessage({ type: "joy8-entry-result-v1", ok: !error, message })
}

async function deliverSession() {
  if (issued || failed) return
  const { data, error } = await memberSupabase.functions.invoke("joy8-gateway/private-session", { body: { slug } })
  if (error) throw error
  if (failed) return
  if (!frame.sendLaunch(gameLaunchPayload(data, import.meta.env.VITE_SUPABASE_URL))) throw new Error("Launch delivery failed")
  issued = true
}

async function handleRequest(method) {
  if (busy || issued || failed || !["google", "guest"].includes(method)) return
  busy = true
  try {
    await enterBrandedMember({ method, service, captcha, onGoogle: () => memberFlow.begin("google"), onLaunch: deliverSession })
  } catch (error) {
    showStatus(memberErrorMessage(error, "google"), true)
  } finally { busy = false }
}

async function main() {
  if (!GAME_SLUG_PATTERN.test(slug || "")) throw new Error("Invalid game slug")
  const callback = params.has("code") || params.has("error") || params.has("error_code")
  if (callback) history.replaceState(null, "", next)
  const { data, error } = await memberSupabase.functions.invoke("joy8-gateway/branded-entry", { body: { slug } })
  if (error || !data?.launch_url || data.protocol !== "server-v1") throw error || new Error("Invalid branded entry")
  const gameUrl = normalizeLaunchUrl(data.launch_url)
  if (!gameUrl) throw new Error("Invalid game URL")
  document.title = `${data.game_name}｜遊戲登入`
  frame = mountGameFrame({
    gameRoot: root, gameUrl, gameName: data.game_name, deferredLaunch: true,
    onLoad: () => { root.setAttribute("aria-busy", "false"); if (status.dataset.error !== "true") status.hidden = true },
    onTimeout: () => { failed = true; showStatus("遊戲連線未完成，請重新整理後再試。", true) },
    onMessage: data => { if (data?.type === "joy8-entry-request-v1") void handleRequest(data.method) },
  })
  if (callback) {
    if (await memberFlow.complete(params)) await deliverSession()
  } else if (await service.membership()) await deliverSession()
}

main().catch(error => showStatus(memberErrorMessage(error), true)).finally(() => { busy = false })
