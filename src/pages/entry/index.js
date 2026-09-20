import { memberSupabase } from "../../lib/memberClient.js"
import { createGameIframe } from "../game/iframe.js"
import { normalizeLaunchUrl } from "../../lib/urls.js"
import { createMemberCaptcha } from "../../member/captcha.js"
import { createMemberService, memberErrorMessage } from "../../member/service.js"

const params = new URLSearchParams(location.search)
const slug = params.get("slug")
const root = document.getElementById("entry")
const status = document.getElementById("entry-status")
const next = `/entry/?slug=${encodeURIComponent(slug || "")}`
const service = createMemberService(memberSupabase, {
  origin: location.origin,
  next,
  guestLock: navigator.locks ? (action) => navigator.locks.request("joy8-guest-entry", action) : null,
})
const captcha = createMemberCaptcha(document)
const pendingKey = "joy8-member-link-user"
const HANDSHAKE_TIMEOUT_MS = 30000
let frame
let frameOrigin
let targetOrigin
let ready = false
let busy = false
let launch = null
let handshakeTimeout = 0

function tellGame(payload) {
  if (frame?.contentWindow) frame.contentWindow.postMessage(payload, targetOrigin)
}

function showStatus(message, error = false) {
  status.textContent = message
  status.dataset.error = String(error)
  tellGame({ type: "joy8-entry-result-v1", ok: !error, message })
}

function cleanCallback() {
  history.replaceState(null, "", next)
}

function launchPayload(session) {
  const gatewayUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/joy8-gateway`
  return {
    joy8_session_id: session.session_id,
    joy8_launch_code: session.launch_code,
    joy8_game_id: session.game_id,
    joy8_currency: session.currency,
    joy8_gateway_url: gatewayUrl,
    joy8_protocol: "server-v1",
  }
}

async function issueSession() {
  if (launch) return launch
  const { data, error } = await memberSupabase.functions.invoke("joy8-gateway/branded-session", { body: { slug } })
  if (error || !data?.session_id || !data.launch_code || data.protocol !== "server-v1") throw error || new Error("Invalid branded session")
  launch = launchPayload(data)
  return launch
}

async function deliverSession() {
  const payload = await issueSession()
  if (!ready) return
  tellGame({ type: "joy8-launch-v1", launch: payload })
  launch = null
}

async function enrollAndLaunch() {
  await service.membership(true)
  await deliverSession()
}

async function completeCallback() {
  const code = params.get("code")
  const flow = params.get("flow")
  const callbackError = params.get("error_code") || (params.has("error") ? "auth_callback_failed" : "")
  if (callbackError) {
    sessionStorage.removeItem(pendingKey)
    cleanCallback()
    throw Object.assign(new Error("Authentication callback failed"), { code: callbackError })
  }
  if (!code) return false
  await service.completeCallback(code, sessionStorage.getItem(pendingKey), flow)
  sessionStorage.removeItem(pendingKey)
  cleanCallback()
  await enrollAndLaunch()
  return true
}

async function beginGoogle() {
  const current = await service.session()
  if (current?.user?.is_anonymous) sessionStorage.setItem(pendingKey, current.user.id)
  else sessionStorage.removeItem(pendingKey)
  const result = await service.oauth("google")
  if (result.expectedUserId) sessionStorage.setItem(pendingKey, result.expectedUserId)
  location.assign(result.url)
}

async function beginGuest() {
  try {
    await service.guest(await captcha.token())
    await deliverSession()
  } finally {
    captcha.reset()
  }
}

async function handleRequest(method) {
  if (busy || !["google", "guest"].includes(method)) return
  busy = true
  showStatus(method === "google" ? "正在前往 Google 登入…" : "正在建立訪客身分…")
  try {
    if (method === "google") await beginGoogle()
    else await beginGuest()
  } catch (error) {
    showStatus(memberErrorMessage(error, "google"), true)
  } finally {
    busy = false
  }
}

function onMessage(event) {
  if (event.source !== frame?.contentWindow || event.origin !== frameOrigin) return
  if (event.data?.type === "joy8-launch-ready-v1" && event.data.protocol === "server-v1") {
    ready = true
    clearTimeout(handshakeTimeout)
    root.setAttribute("aria-busy", "false")
    status.remove()
    if (launch) deliverSession().catch(fail)
    return
  }
  if (event.data?.type === "joy8-entry-request-v1") handleRequest(event.data.method)
}

async function existingMemberLaunch() {
  const session = await service.session()
  if (!session) return
  const member = await service.membership()
  if (member) await deliverSession()
}

function fail(error) {
  showStatus(memberErrorMessage(error), true)
}

async function main() {
  if (!/^[a-z0-9-]{1,80}$/.test(slug || "")) throw new Error("Invalid game slug")
  const { data, error } = await memberSupabase.functions.invoke("joy8-gateway/branded-entry", { body: { slug } })
  if (error || !data?.launch_url || data.protocol !== "server-v1") throw error || new Error("Invalid branded entry")
  const gameUrl = normalizeLaunchUrl(data.launch_url)
  if (!gameUrl) throw new Error("Invalid game URL")
  const gameOrigin = new URL(gameUrl, location.origin).origin
  frameOrigin = gameOrigin === location.origin ? "null" : gameOrigin
  targetOrigin = gameOrigin === location.origin ? "*" : gameOrigin
  frame = createGameIframe({ gameUrl, gameName: data.game_name })
  window.addEventListener("message", onMessage)
  root.append(frame)
  handshakeTimeout = window.setTimeout(() => {
    if (ready) return
    frame.remove()
    fail(new Error("Game entry handshake timed out"))
  }, HANDSHAKE_TIMEOUT_MS)
  await completeCallback() || await existingMemberLaunch()
}

main().catch(fail)
