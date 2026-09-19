const BASE_SANDBOX_TOKENS = [
  "allow-forms",
  "allow-orientation-lock",
  "allow-pointer-lock",
  "allow-scripts",
]
const IFRAME_PERMISSIONS = "autoplay; fullscreen; gamepad"
export const JOY8_LAUNCH_READY_TYPE = "joy8-launch-ready-v1"
export const JOY8_LAUNCH_MESSAGE_TYPE = "joy8-launch-v1"

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

export function mountGameFrame({
  gameRoot,
  gameUrl,
  gameName,
  launch,
  timeoutMs,
  onLoad,
  onTimeout,
}) {
  let settled = false
  let timeoutId = 0
  let deliveryTimeoutId = 0
  let launchPayload = launch ? { ...launch } : null
  const iframe = createGameIframe({
    gameUrl,
    gameName,
    onLoad: () => {
      if (settled) return

      settled = true
      window.clearTimeout(timeoutId)
      onLoad?.()
    },
  })
  const gameOrigin = new URL(gameUrl, location.origin).origin
  const expectedMessageOrigin = gameOrigin === location.origin ? "null" : gameOrigin
  const targetOrigin = gameOrigin === location.origin ? "*" : gameOrigin
  const clearLaunch = () => {
    launchPayload = null
    window.clearTimeout(deliveryTimeoutId)
    window.removeEventListener("message", deliverLaunch)
  }
  const deliverLaunch = (event) => {
    if (!launchPayload
      || event.source !== iframe.contentWindow
      || event.origin !== expectedMessageOrigin
      || event.data?.type !== JOY8_LAUNCH_READY_TYPE
      || event.data?.protocol !== "server-v1") return

    iframe.contentWindow?.postMessage({
      type: JOY8_LAUNCH_MESSAGE_TYPE,
      launch: launchPayload,
    }, targetOrigin)
    clearLaunch()
  }

  if (launchPayload) {
    window.addEventListener("message", deliverLaunch)
    deliveryTimeoutId = window.setTimeout(clearLaunch, Math.min(timeoutMs, 10000))
  }
  timeoutId = window.setTimeout(() => {
    if (settled) return

    settled = true
    clearLaunch()
    iframe.remove()
    onTimeout?.()
  }, timeoutMs)

  gameRoot.append(iframe)
  return iframe
}

function getSandboxTokens(gameUrl) {
  const tokens = [...BASE_SANDBOX_TOKENS]

  if (new URL(gameUrl, location.origin).origin !== location.origin) {
    tokens.push("allow-same-origin")
  }

  return tokens
}
