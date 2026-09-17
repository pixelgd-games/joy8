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

export function appendQueryParams(rawValue, params) {
  const value = normalizeLaunchUrl(rawValue)
  if (!value) return ""

  try {
    const isRootRelative = ROOT_RELATIVE_PATH.test(value)
    const url = new URL(value, isRootRelative ? getBaseOrigin() : undefined)
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("looty_")) url.searchParams.delete(key)
    }

    for (const [key, paramValue] of Object.entries(params || {})) {
      if (paramValue === undefined || paramValue === null || paramValue === "") {
        url.searchParams.delete(key)
        continue
      }
      url.searchParams.set(key, String(paramValue))
    }

    if (isRootRelative) {
      return `${url.pathname}${url.search}${url.hash}`
    }

    return url.href
  } catch {
    return ""
  }
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
