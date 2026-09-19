const siteKey = "0x4AAAAAAE83bygZg6FXRvCp"
const SCRIPT_TIMEOUT_MS = 15000
const CHALLENGE_TIMEOUT_MS = 45000

let scriptPromise

const captchaError = (code) => Object.assign(new Error("Captcha unavailable"), { code })

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    const finish = (error) => {
      clearTimeout(timer)
      script.removeEventListener("load", onLoad)
      script.removeEventListener("error", onError)
      if (error) {
        script.remove()
        reject(error)
      } else resolve(window.turnstile)
    }
    const onLoad = () => finish(window.turnstile ? null : captchaError("captcha_unavailable"))
    const onError = () => finish(captchaError("captcha_unavailable"))
    const timer = setTimeout(() => finish(captchaError("captcha_timeout")), SCRIPT_TIMEOUT_MS)
    script.addEventListener("load", onLoad, { once: true })
    script.addEventListener("error", onError, { once: true })
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    script.async = true
    script.defer = true
    script.dataset.joy8Turnstile = ""
    document.head.append(script)
  }).catch((error) => {
    scriptPromise = undefined
    throw error
  })
  return scriptPromise
}

export function createMemberCaptcha(root) {
  const container = root.querySelector("#member-captcha")
  let active
  let disposed = false

  function finish(attempt, error, token) {
    if (active !== attempt) return
    active = undefined
    clearTimeout(attempt.timer)
    if (attempt.widgetId !== undefined) {
      try { attempt.api.remove(attempt.widgetId) } catch {}
    }
    if (error) attempt.reject(error)
    else attempt.resolve(token)
  }

  function reset() {
    if (active) finish(active, captchaError("captcha_unavailable"))
  }

  return {
    token() {
      if (disposed) return Promise.reject(captchaError("captcha_unavailable"))
      if (active) return active.promise
      const attempt = {}
      attempt.promise = new Promise((resolve, reject) => {
        attempt.resolve = resolve
        attempt.reject = reject
      })
      active = attempt
      attempt.timer = setTimeout(() => finish(attempt, captchaError("captcha_timeout")), CHALLENGE_TIMEOUT_MS)
      loadTurnstile().then((api) => {
        if (active !== attempt) return
        attempt.api = api
        attempt.widgetId = api.render(container, {
          sitekey: siteKey,
          theme: "dark",
          size: "flexible",
          appearance: "execute",
          execution: "execute",
          retry: "never",
          callback: (token) => finish(attempt, token ? null : captchaError("captcha_failed"), token),
          "expired-callback": () => finish(attempt, captchaError("captcha_failed")),
          "timeout-callback": () => finish(attempt, captchaError("captcha_timeout")),
          "error-callback": () => finish(attempt, captchaError("captcha_failed")),
        })
        if (active !== attempt) {
          api.remove(attempt.widgetId)
          return
        }
        api.execute(attempt.widgetId)
      }).catch((error) => finish(attempt, captchaError(error?.code === "captcha_timeout" ? "captcha_timeout" : "captcha_unavailable")))
      return attempt.promise
    },
    reset,
    dispose() {
      disposed = true
      reset()
    },
  }
}
