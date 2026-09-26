import { INGRESS_LIMIT } from "./config.ts"
import { callRpc, SERVER_ERROR_STATUSES } from "./rpc.ts"
import { getClientAddress, jsonResponse } from "./http.ts"
import type { JsonValue } from "./http.ts"

export async function enforceRateLimit(
  route: string,
  request: Request,
  headers: HeadersInit,
): Promise<Response | null> {
  const config = route === "health" ? { limit: 30, windowSeconds: 60 } : INGRESS_LIMIT

  const clientAddress = getClientAddress(request)
  const rpcResult = await callRpc("joy8_consume_gateway_rate_limit", {
    p_key: `${route === "health" ? "health" : "ingress"}:${clientAddress}`,
    p_limit: config.limit,
    p_window_seconds: config.windowSeconds,
  })

  if (!rpcResult.ok) {
    return jsonResponse({ error: "Gateway rate limit is unavailable" }, 503, headers)
  }

  if (rpcResult.body !== true) {
    return jsonResponse({ error: "Too many requests" }, 429, {
      ...headers,
      "Retry-After": String(config.windowSeconds),
    })
  }

  return null
}

export async function enforceSubjectRateLimit(
  route: string, request: Record<string, JsonValue>, headers: HeadersInit,
  secret: string | null = null, authUserId: string | null = null,
): Promise<Response | null> {
  const result = await callRpc("joy8_admit_gateway_request", {
    p_route: route, p_request: request, p_secret: secret, p_auth_user_id: authUserId,
  })
  const body = result.body as { allowed?: boolean; error?: string; retry_after?: number } | null
  if (!result.ok || !body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Gateway rate limit is unavailable" }, 503, headers)
  }
  if (body.error) {
    return Object.hasOwn(SERVER_ERROR_STATUSES, body.error)
      ? jsonResponse({ error: body.error }, SERVER_ERROR_STATUSES[body.error], headers)
      : jsonResponse({ error: "Gateway rate limit is unavailable" }, 503, headers)
  }
  if (body.allowed === true) return null
  if (body.allowed === false && Number.isInteger(body.retry_after) && body.retry_after! > 0 && body.retry_after! <= 86400) {
    return jsonResponse({ error: "Too many requests" }, 429, { ...headers, "Retry-After": String(body.retry_after) })
  }
  return jsonResponse({ error: "Gateway rate limit is unavailable" }, 503, headers)
}
