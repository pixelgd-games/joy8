const BASE_SANDBOX_TOKENS = [
  "allow-forms",
  "allow-orientation-lock",
  "allow-pointer-lock",
  "allow-scripts",
]
const IFRAME_PERMISSIONS = "autoplay; fullscreen; gamepad"
const JOY8_LAUNCH_READY_TYPE = "joy8-launch-ready-v1"
const JOY8_LAUNCH_MESSAGE_TYPE = "joy8-launch-v1"

export function createGameIframe({ gameUrl, gameName, onLoad }) {
  const iframe = document.createElement("iframe")
  iframe.title = gameName || "Joy8 Game"
  iframe.loading = "eager"
  iframe.referrerPolicy = "no-referrer"
  iframe.setAttribute("sandbox", getSandboxTokens(gameUrl).join(" "))
  iframe.setAttribute("allow", IFRAME_PERMISSIONS)
  iframe.setAttribute("allowfullscreen", "")

  if (onLoad) {
    iframe.addEventListener("load", onLoad, { once: true })
  }

  iframe.src = gameUrl
  return iframe
}

export function mountGameFrame({ gameRoot, gameUrl, gameName, launch = null, deferredLaunch = false, timeoutMs = 30000, onLoad, onTimeout, onMessage }) {
  let loaded = false
  let ready = false
  let completed = false
  let stopped = false
  let delivered = false
  let launchPayload = launch
  let timeoutId
  const iframe = createGameIframe({ gameUrl, gameName, onLoad: () => { loaded = true; complete() } })
  const gameOrigin = new URL(gameUrl, location.origin).origin
  const expectedOrigin = gameOrigin === location.origin ? "null" : gameOrigin
  const targetOrigin = gameOrigin === location.origin ? "*" : gameOrigin
  function dispose() {
    stopped = true
    launchPayload = null
    window.clearTimeout(timeoutId)
    window.removeEventListener("message", receive)
  }
  function fail(reason) {
    if (stopped) return
    dispose()
    iframe.remove()
    onTimeout?.(reason)
  }
  function complete() {
    if (stopped || completed || !loaded || !ready || (!deferredLaunch && !delivered)) return
    completed = true
    window.clearTimeout(timeoutId)
    onLoad?.()
  }
  function sendMessage(payload) {
    if (stopped || !iframe.contentWindow) return false
    iframe.contentWindow.postMessage(payload, targetOrigin)
    return true
  }
  function sendLaunch(payload) {
    if (stopped || delivered || launchPayload && payload !== launchPayload) return false
    launchPayload = payload
    if (!ready) return true
    try {
      if (!sendMessage({ type: JOY8_LAUNCH_MESSAGE_TYPE, launch: launchPayload })) throw new Error("Game frame unavailable")
      delivered = true
      launchPayload = null
      window.removeEventListener("message", receive)
      complete()
      return true
    } catch {
      fail("handshake")
      return false
    }
  }
  function receive(event) {
    if (stopped || event.source !== iframe.contentWindow || event.origin !== expectedOrigin) return
    if (event.data?.type === JOY8_LAUNCH_READY_TYPE && event.data.protocol === "server-v1") {
      ready = true
      if (launchPayload) sendLaunch(launchPayload)
      complete()
    } else if (deferredLaunch && !delivered) onMessage?.(event.data)
  }
  window.addEventListener("message", receive)
  timeoutId = window.setTimeout(() => fail(loaded ? "handshake" : "load"), timeoutMs)
  gameRoot.append(iframe)
  return { iframe, sendLaunch, sendMessage, dispose }
}

function getSandboxTokens(gameUrl) {
  const tokens = [...BASE_SANDBOX_TOKENS]

  if (new URL(gameUrl, location.origin).origin !== location.origin) {
    tokens.push("allow-same-origin")
  }

  return tokens
}
