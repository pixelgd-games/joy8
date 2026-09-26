import { INGRESS_LIMIT } from "./config.ts"
import { callRpc, SERVER_ERROR_STATUSES } from "./rpc.ts"
import { getClientAddress, jsonResponse, readJsonBody } from "./http.ts"
import type { JsonValue } from "./http.ts"

export async function serverOperation(route: string, request: Request, headers: HeadersInit): Promise<Response> {
  const match = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)
  const body = match ? await readJsonBody(request) : null
  const result = await callRpc("joy8_server_request_v1", {
    p_route: route,
    p_ingress_key: `ingress:${getClientAddress(request)}`,
    p_ingress_limit: INGRESS_LIMIT.limit,
    p_ingress_window: INGRESS_LIMIT.windowSeconds,
    p_secret: match?.[1] ?? null,
    p_request: body?.ok ? body.value : null,
  })
  if (!result.ok) {
    const error = result.body as { message?: string; code?: string } | null
    const code = error?.message ?? ""
    if (SERVER_ERROR_STATUSES[code]) return jsonResponse({ error: code }, SERVER_ERROR_STATUSES[code], headers)
    if (error?.code === "22P02") return jsonResponse({ error: "JOY8_INVALID_REQUEST" }, 400, headers)
    return jsonResponse({ error: "Gateway rate limit is unavailable" }, 503, headers)
  }
  const packet = result.body as Record<string, unknown> | null
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return jsonResponse({ error: "Gateway rate limit is unavailable" }, 503, headers)
  }
  if (packet.limited === true) {
    if (!Number.isInteger(packet.retry_after) || Number(packet.retry_after) <= 0 || Number(packet.retry_after) > 86400) {
      return jsonResponse({ error: "Gateway rate limit is unavailable" }, 503, headers)
    }
    return jsonResponse({ error: "Too many requests" }, 429, { ...headers, "Retry-After": String(packet.retry_after) })
  }
  if (!match) return jsonResponse({ error: "JOY8_BACKEND_UNAUTHORIZED" }, 401, headers)
  if (!body?.ok) return jsonResponse({ error: "JOY8_INVALID_REQUEST" }, 400, headers)
  if (typeof packet.admission_error === "string") {
    return Object.hasOwn(SERVER_ERROR_STATUSES, packet.admission_error)
      ? jsonResponse({ error: packet.admission_error }, SERVER_ERROR_STATUSES[packet.admission_error], headers)
      : jsonResponse({ error: "Gateway rate limit is unavailable" }, 503, headers)
  }
  if (Object.hasOwn(packet, "error")) {
    if (!packet.error || typeof packet.error !== "object" || Array.isArray(packet.error)) {
      return jsonResponse({ error: "Gateway rate limit is unavailable" }, 503, headers)
    }
    const error = packet.error as { message?: string; code?: string } | null
    const code = error?.message ?? ""
    if (SERVER_ERROR_STATUSES[code]) return jsonResponse({ error: code }, SERVER_ERROR_STATUSES[code], headers)
    if (error?.code === "22P02") return jsonResponse({ error: "JOY8_INVALID_REQUEST" }, 400, headers)
    return jsonResponse({ error: "JOY8_UPSTREAM_UNAVAILABLE" }, 503, headers)
  }
  if (!Object.hasOwn(packet, "result")) {
    return jsonResponse({ error: "Gateway rate limit is unavailable" }, 503, headers)
  }
  if (!packet.result || typeof packet.result !== "object" || Array.isArray(packet.result)) {
    return jsonResponse({ error: "JOY8_UPSTREAM_UNAVAILABLE" }, 502, headers)
  }
  return jsonResponse(packet.result as JsonValue, 200, headers)
}
