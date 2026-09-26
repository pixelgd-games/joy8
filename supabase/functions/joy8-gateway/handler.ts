import { getRoute, buildCorsHeaders, isCorsOriginAllowed, jsonResponse } from "./http.ts"
import { callRpc } from "./rpc.ts"
import { enforceRateLimit } from "./rate-limit.ts"
import { mailboxOperation } from "./mailbox-routes.ts"
import { serverOperation } from "./server-routes.ts"
import { resolveMember, createSession, createPrivateSession, resolveBrandedEntry, getBalance } from "./member-routes.ts"

const ROUTES = new Set([
  "health", "server-exchange-v1", "server-renew-v1", "server-open-v1",
  "server-settle-v1", "server-status-v1", "server-cancel-v1", "member",
  "enroll-member", "create-session", "private-session", "branded-entry",
  "balance", "mailbox", "admin-mailbox",
])

export async function handleRequest(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID()
  const startedAt = Date.now()
  const origin = request.headers.get("origin")
  const route = getRoute(request.url)
  const corsHeaders = buildCorsHeaders(origin, route, requestId)
  let response: Response

  try {
    if (request.method === "OPTIONS") {
      response = new Response(null, {
        status: isCorsOriginAllowed(origin, route) ? 204 : 403,
        headers: corsHeaders,
      })
    } else if (!isCorsOriginAllowed(origin, route)) {
      response = jsonResponse({ error: "Origin is not allowed" }, 403, corsHeaders)
    } else if (request.method !== "POST") {
      response = jsonResponse({ error: "Method not allowed" }, 405, {
        ...corsHeaders,
        Allow: "POST, OPTIONS",
      })
    } else if (!ROUTES.has(route)) {
      response = jsonResponse({ error: "Route not found" }, 404, corsHeaders)
    } else {
      const rateLimitResponse = route.startsWith("server-") ? null : await enforceRateLimit(route, request, corsHeaders)
      response = rateLimitResponse ?? await dispatchRoute(route, request, corsHeaders)
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: "gateway_error",
      request_id: requestId,
      route,
      message: error instanceof Error ? error.message : "Unknown gateway error",
    }))
    response = jsonResponse({ error: "Gateway request failed" }, 500, corsHeaders)
  }

  console.log(JSON.stringify({
    event: "gateway_request",
    request_id: requestId,
    route,
    method: request.method,
    status: response.status,
    duration_ms: Date.now() - startedAt,
    origin: origin || null,
  }))

  return response
}

async function dispatchRoute(
  route: string,
  request: Request,
  headers: HeadersInit,
): Promise<Response> {
  if (route === "mailbox" || route === "admin-mailbox") return mailboxOperation(route, request, headers)
  if (route === "health") {
    const result = await callRpc("joy8_platform_health_v1", {})
    const healthy = result.ok && result.body === true
    return jsonResponse({ status: healthy ? "ok" : "unavailable" }, healthy ? 200 : 503, headers)
  }
  if (route.startsWith("server-") && route.endsWith("-v1")) {
    return serverOperation(route, request, headers)
  }
  if (route === "member" || route === "enroll-member") {
    return resolveMember(request, headers, route === "enroll-member")
  }

  if (route === "create-session") {
    return createSession(request, headers)
  }

  if (route === "private-session") {
    return createPrivateSession(request, headers)
  }

  if (route === "branded-entry") {
    return resolveBrandedEntry(request, headers)
  }

  if (route === "balance") {
    return getBalance(request, headers)
  }

  return jsonResponse({ error: "Route not found" }, 404, headers)
}
