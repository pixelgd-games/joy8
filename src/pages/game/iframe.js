const BASE_SANDBOX_TOKENS = [
  "allow-forms",
  "allow-orientation-lock",
  "allow-pointer-lock",
  "allow-scripts",
]
const IFRAME_PERMISSIONS = "autoplay; fullscreen; gamepad"

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
  timeoutMs,
  onLoad,
  onTimeout,
}) {
  let settled = false
  let timeoutId = 0
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
  timeoutId = window.setTimeout(() => {
    if (settled) return

    settled = true
    iframe.remove()
    onTimeout?.()
  }, timeoutMs)

  gameRoot.append(iframe)
}

function getSandboxTokens(gameUrl) {
  const tokens = [...BASE_SANDBOX_TOKENS]

  if (new URL(gameUrl, location.origin).origin !== location.origin) {
    tokens.push("allow-same-origin")
  }

  return tokens
}
