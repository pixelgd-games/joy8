const siteKey = "0x4AAAAAAE83bygZg6FXRvCp"

let scriptPromise

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-joy8-turnstile]')
    const script = existing || document.createElement("script")
    script.addEventListener("load", () => resolve(window.turnstile), { once: true })
    script.addEventListener("error", () => reject(Object.assign(new Error("Turnstile unavailable"), { code: "captcha_unavailable" })), { once: true })
    if (!existing) {
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      script.async = true
      script.defer = true
      script.dataset.joy8Turnstile = ""
      document.head.append(script)
    }
  })
  return scriptPromise
}

export function createMemberCaptcha(root) {
  const container = root.querySelector("#member-captcha")
  let turnstile
  let widgetId
  let currentToken = ""
  let pendingToken
  let resolveToken
  let rejectToken
  let disposed = false
  let readyPromise

  function clearPending() {
    pendingToken = undefined
    resolveToken = undefined
    rejectToken = undefined
  }

  function ensureReady() {
    if (readyPromise) return readyPromise
    readyPromise = loadTurnstile().then((api) => {
      if (disposed || !api) return
      turnstile = api
      widgetId = api.render(container, {
        sitekey: siteKey,
        theme: "dark",
        size: "flexible",
        appearance: "execute",
        execution: "execute",
        callback: (token) => {
          currentToken = token
          resolveToken?.(token)
          clearPending()
        },
        "expired-callback": () => { currentToken = "" },
        "error-callback": () => {
          currentToken = ""
          rejectToken?.(Object.assign(new Error("Captcha failed"), { code: "captcha_failed" }))
          clearPending()
        },
      })
    })
    return readyPromise
  }

  return {
    ready: Promise.resolve(),
    async token() {
      await ensureReady()
      if (currentToken) return currentToken
      if (widgetId === undefined) throw Object.assign(new Error("Captcha unavailable"), { code: "captcha_unavailable" })
      if (!pendingToken) {
        pendingToken = new Promise((resolve, reject) => {
          resolveToken = resolve
          rejectToken = reject
        })
        turnstile.execute(widgetId)
      }
      return pendingToken
    },
    reset() {
      currentToken = ""
      if (turnstile && widgetId !== undefined) turnstile.reset(widgetId)
    },
    dispose() {
      disposed = true
      currentToken = ""
      rejectToken?.(Object.assign(new Error("Captcha unavailable"), { code: "captcha_unavailable" }))
      clearPending()
      if (turnstile && widgetId !== undefined) turnstile.remove(widgetId)
    },
  }
}
