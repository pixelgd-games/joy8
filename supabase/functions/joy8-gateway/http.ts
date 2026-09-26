import { isLoopbackHostname } from "../../../packages/joy8-game-sdk/policy.js"

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

type BodyResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

const MAX_BODY_BYTES = 16 * 1024

const DEFAULT_ALLOWED_ORIGINS = [
  "https://joy8.cc",
  "https://www.joy8.cc",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]

const allowedOrigins = (Deno.env.get("JOY8_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)

if (allowedOrigins.length === 0) {
  allowedOrigins.push(...DEFAULT_ALLOWED_ORIGINS)
}

export function getRoute(url: string): string {
  const pathname = new URL(url).pathname
  const parts = pathname.split("/").filter(Boolean)
  const last = parts[parts.length - 1] ?? ""

  return last
}

export function buildCorsHeaders(
  origin: string | null,
  route: string,
  requestId: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Expose-Headers": "Retry-After, X-Joy8-Request-Id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "7200",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Joy8-Request-Id": requestId,
    Vary: "Origin",
  }

  if (isCorsOriginAllowed(origin, route) && origin) {
    headers["Access-Control-Allow-Origin"] = origin
  }

  return headers
}

export function isCorsOriginAllowed(origin: string | null, route: string): boolean {
  if (route === "mailbox" || route === "admin-mailbox") return Boolean(origin && allowedOrigins.includes(origin))
  if (route.startsWith("server-") && route.endsWith("-v1")) return !origin
  if (["private-session", "branded-entry"].includes(route)) return Boolean(origin && allowedOrigins.includes(origin))
  const memberRoute = ["create-session", "member", "enroll-member"].includes(route)
  if (!origin) {
    return !memberRoute
  }

  if (memberRoute) {
    return allowedOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  }

  try {
    const url = new URL(origin)
    return url.protocol === "https:"
      || (url.protocol === "http:" && isLoopbackHostname(url.hostname))
  } catch {
    return false
  }
}

export function getClientAddress(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()

  return request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || forwardedFor
    || "unknown"
}

export function jsonResponse(payload: JsonValue, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers,
  })
}

export async function readJsonBody(request: Request): Promise<BodyResult> {
  try {
    const contentLength = request.headers.get("content-length")

    if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) {
      return { ok: false, error: "JSON body is too large" }
    }

    const reader = request.body?.getReader()

    if (!reader) {
      return { ok: false, error: "Invalid JSON body" }
    }

    const chunks: Uint8Array[] = []
    let totalBytes = 0

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      totalBytes += value.byteLength

      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, error: "JSON body is too large" }
      }

      chunks.push(value)
    }

    const bytes = new Uint8Array(totalBytes)
    let offset = 0

    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }

    const text = new TextDecoder().decode(bytes)
    const value = JSON.parse(text)

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "JSON body must be an object" }
    }

    return { ok: true, value: value as Record<string, unknown> }
  } catch {
    return { ok: false, error: "Invalid JSON body" }
  }
}

export function normalizeRequiredText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return ""
  }

  const text = value.trim()
  if (!text || text.length > maxLength) {
    return ""
  }

  return text
}
