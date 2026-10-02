import { GAME_SLUG_PATTERN } from "../../packages/joy8-game-sdk/contract.js"

const STORAGE_KEY = "joy8-game-visit-v1"
const RETURN_TIMEOUT = 120000

function readVisit(browser) {
  try { return JSON.parse(browser.sessionStorage.getItem(STORAGE_KEY)) }
  catch { return null }
}

function remember(browser, slug, at) {
  try { browser.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ slug, at })) }
  catch {}
}

export function prepareGameEntry(path, browser = globalThis.window) {
  try {
    const url = new URL(path, browser.location.origin)
    const slug = url.searchParams.get("slug")
    if (url.origin === browser.location.origin && url.pathname === "/game/" && GAME_SLUG_PATTERN.test(slug || "")) {
      remember(browser, slug, browser.Date.now())
    }
  } catch {}
}

export function trackGameVisit(slug, browser = window) {
  const doc = browser.document
  const visit = readVisit(browser)
  const fresh = at => Number.isFinite(at) && at > 0 && browser.Date.now() >= at && browser.Date.now() - at < RETURN_TIMEOUT
  if (visit?.slug !== slug || !fresh(visit.at)) return null

  let activeAt = visit.at
  let visible = !doc.hidden
  let departed = false
  let timer
  const record = () => {
    activeAt = browser.Date.now()
    remember(browser, slug, activeAt)
  }
  const pulse = () => { if (!departed && !doc.hidden) record() }
  const visibilityChanged = () => {
    if (departed) return
    if (visible || !doc.hidden) record()
    visible = !doc.hidden
  }
  const pageHidden = () => {
    if (visible) record()
    departed = true
    browser.clearInterval(timer)
  }
  const pageShown = event => {
    if (!event.persisted) return
    if (readVisit(browser)?.slug !== slug || !fresh(activeAt)) {
      dispose()
      browser.location.replace("/")
      return
    }
    departed = false
    visible = !doc.hidden
    pulse()
    timer = browser.setInterval(pulse, 15000)
  }
  function dispose() {
    browser.clearInterval(timer)
    doc.removeEventListener("visibilitychange", visibilityChanged)
    browser.removeEventListener("pagehide", pageHidden)
    browser.removeEventListener("pageshow", pageShown)
  }
  pulse()
  timer = browser.setInterval(pulse, 15000)
  doc.addEventListener("visibilitychange", visibilityChanged)
  browser.addEventListener("pagehide", pageHidden)
  browser.addEventListener("pageshow", pageShown)
  return dispose
}
