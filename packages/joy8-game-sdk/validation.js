import { Joy8SdkError } from "./errors.js"

export const PROTOCOL = "server-v1"
export const CURRENCY = "POINT"
export const BACKEND_KEY_PATTERN = /^[a-f0-9]{64}$/
export const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
export const AMOUNT_PATTERN = /^-?(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$/

export function fail(code, message) {
  throw new Joy8SdkError(code, message)
}

export function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export function requireRecord(value, name) {
  if (!isRecord(value)) fail("JOY8_SDK_INVALID_ARGUMENT", `${name} must be an object`)
  return value
}

export function requireExactKeys(value, keys, name) {
  requireRecord(value, name)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("JOY8_SDK_INVALID_ARGUMENT", `${name} has invalid fields`)
  }
}

export function requireAllowedKeys(value, allowed, required, name) {
  requireRecord(value, name)
  const keys = Object.keys(value)
  if (keys.some(key => !allowed.includes(key)) || required.some(key => !keys.includes(key))) {
    fail("JOY8_SDK_INVALID_ARGUMENT", `${name} has invalid fields`)
  }
}

export function requireText(value, name, min = 1, max = 180) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    fail("JOY8_SDK_INVALID_ARGUMENT", `${name} is invalid`)
  }
  return value
}

export function requireUuid(value, name) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    fail("JOY8_SDK_INVALID_ARGUMENT", `${name} must be a canonical UUID`)
  }
  return value
}

export function requireAmount(value, name, { positive = false, nonzero = false } = {}) {
  if (typeof value !== "string" || !AMOUNT_PATTERN.test(value)) {
    fail("JOY8_SDK_INVALID_ARGUMENT", `${name} must be a decimal string with at most two decimal places`)
  }
  const amount = Number(value)
  if (!Number.isFinite(amount) || (positive && amount <= 0) || (nonzero && amount === 0)) {
    fail("JOY8_SDK_INVALID_ARGUMENT", `${name} is outside the allowed range`)
  }
  return value
}

export function normalizeGatewayUrl(value) {
  requireText(value, "gatewayUrl", 1, 2048)
  let url
  try {
    url = new URL(value)
  } catch {
    fail("JOY8_SDK_INVALID_CONFIGURATION", "gatewayUrl is invalid")
  }
  const loopback = ["localhost", "127.0.0.1"].includes(url.hostname)
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    || url.username || url.password || url.search || url.hash
    || !url.pathname.replace(/\/+$/, "").endsWith("/joy8-gateway")) {
    fail("JOY8_SDK_INVALID_CONFIGURATION", "gatewayUrl must be an HTTPS Joy8 Gateway URL")
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

export function normalizeParentOrigins(values) {
  if (!Array.isArray(values) || values.length < 1) {
    fail("JOY8_SDK_INVALID_CONFIGURATION", "parentOrigins must contain at least one exact origin")
  }
  const origins = values.map(value => {
    requireText(value, "parent origin", 1, 2048)
    let url
    try {
      url = new URL(value)
    } catch {
      fail("JOY8_SDK_INVALID_CONFIGURATION", "parent origin is invalid")
    }
    const loopback = ["localhost", "127.0.0.1"].includes(url.hostname)
    if (url.origin !== value || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
      fail("JOY8_SDK_INVALID_CONFIGURATION", "parentOrigins must use exact HTTPS origins")
    }
    return value
  })
  return [...new Set(origins)]
}

export function rejectUrlCredentials(href) {
  let url
  try {
    url = new URL(href)
  } catch {
    fail("JOY8_SDK_INVALID_CONFIGURATION", "locationHref is invalid")
  }
  if ([...url.searchParams.keys()].some(key => key.toLowerCase().startsWith("joy8_"))) {
    fail("JOY8_URL_CREDENTIALS_REJECTED", "Joy8 credentials and launch metadata are not accepted in the URL")
  }
}
