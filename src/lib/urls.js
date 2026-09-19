const ROOT_RELATIVE_PATH = /^\/(?!\/)/
const HTTP_URL = /^https?:\/\//i

export function normalizeLaunchUrl(rawValue) {
  const value = String(rawValue || "").trim()
  if (!value) return ""

  if (ROOT_RELATIVE_PATH.test(value)) {
    try {
      const url = new URL(value, getBaseOrigin())
      return `${url.pathname}${url.search}${url.hash}`
    } catch {
      return ""
    }
  }

  if (!HTTP_URL.test(value)) {
    return ""
  }

  try {
    const url = new URL(value)
    if (url.protocol === "https:") return url.href
    if (url.protocol === "http:" && isLocalDevelopmentUrl(url)) return url.href
    return ""
  } catch {
    return ""
  }
}

export function normalizeCoverPath(rawValue, slug) {
  const value = String(rawValue || "").trim()
  const normalizedSlug = String(slug || "").trim()
  if (!value || !/^[a-z0-9-]+$/.test(normalizedSlug)) return ""

  const expected = `/games/${normalizedSlug}/cover.webp`
  return value === expected ? expected : ""
}

function getBaseOrigin() {
  return globalThis.location?.origin || "http://localhost"
}

function isLocalDevelopmentUrl(url) {
  try {
    const baseUrl = new URL(getBaseOrigin())
    return baseUrl.protocol === "http:"
      && isLoopbackHostname(baseUrl.hostname)
      && isLoopbackHostname(url.hostname)
  } catch {
    return false
  }
}

function isLoopbackHostname(hostname) {
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "[::1]"
    || hostname === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}
