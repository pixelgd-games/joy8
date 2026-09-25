import { GAME_SLUG_PATTERN, isLoopbackHostname } from "../../../packages/joy8-game-sdk/policy.js"

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

type CreateSessionRow = {
  protocol: string
  session_id: string
  player_account_id: string
  wallet_account_id: string
  game_id: string
  launch_code: string
  launch_code_expires_at: string
  account_type: string
  currency: string
  expires_at: string
}

type BalanceRow = {
  session_id: string
  player_account_id: string
  wallet_account_id: string
  currency: string
  balance: number | string
  locked_balance: number | string
}

type RpcResult = {
  ok: boolean
  body: unknown
}

type BodyResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

type AuthResult =
  | { ok: true; userId: string | null }
  | { ok: false; error: string; status: number }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
const MAX_BODY_BYTES = 16 * 1024
const AUTH_REQUEST_TIMEOUT_MS = 5000
const RPC_REQUEST_TIMEOUT_MS = 8000
const UPSTREAM_UNAVAILABLE_CODE = "JOY8_UPSTREAM_UNAVAILABLE"
const DEFAULT_ALLOWED_ORIGINS = [
  "https://joy8.cc",
  "https://www.joy8.cc",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]
const INGRESS_LIMIT = { limit: 10000, windowSeconds: 60 }
const ROUTES = new Set([
  "health", "server-exchange-v1", "server-renew-v1", "server-open-v1",
  "server-settle-v1", "server-status-v1", "server-cancel-v1", "member",
  "enroll-member", "create-session", "private-session", "branded-entry",
  "balance",
])
export const SERVER_ERROR_STATUSES: Readonly<Record<string, number>> = Object.freeze({
  JOY8_BACKEND_UNAUTHORIZED: 401,
  JOY8_GAME_NOT_READY: 403,
  JOY8_PLAYER_INACTIVE: 403,
  JOY8_WALLET_INACTIVE: 403,
  JOY8_SESSION_INVALID: 403,
  JOY8_ADAPTER_UNAVAILABLE: 503,
  JOY8_ADAPTER_REJECTED: 409,
  JOY8_INVALID_REQUEST: 400,
  JOY8_INVALID_AMOUNT: 400,
  JOY8_INVALID_ENTRY: 400,
  JOY8_LIMIT_EXCEEDED: 400,
  JOY8_RULE_MISMATCH: 409,
  JOY8_IDEMPOTENCY_CONFLICT: 409,
  JOY8_MATCH_FINALIZED: 409,
  JOY8_MATCH_NOT_FOUND: 404,
  JOY8_UNBALANCED_SETTLEMENT: 400,
  JOY8_WALLET_OCCUPIED: 409,
  JOY8_INSUFFICIENT_BALANCE: 409,
  JOY8_SETTLEMENT_SEQUENCE: 409,
  JOY8_UPSTREAM_UNAVAILABLE: 503,
})
const PUBLIC_RPC_MESSAGES = new Set([
  "game is not available", "game session is not active", "player account is not active",
  "player membership is required", "verified member identity is required",
  "JOY8_GAME_NOT_READY", "JOY8_PLAYER_INACTIVE", "JOY8_WALLET_INACTIVE", "JOY8_INVALID_REQUEST",
  "JOY8_PRIVATE_ENTRY_DENIED",
])

const allowedOrigins = (Deno.env.get("JOY8_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)

if (allowedOrigins.length === 0) {
  allowedOrigins.push(...DEFAULT_ALLOWED_ORIGINS)
}

Deno.serve(async (request) => {
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
})

async function dispatchRoute(
  route: string,
  request: Request,
  headers: HeadersInit,
): Promise<Response> {
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

async function serverOperation(route: string, request: Request, headers: HeadersInit): Promise<Response> {
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

async function resolveMember(request: Request, headers: HeadersInit, enroll: boolean): Promise<Response> {
  const auth = await resolveAuthUser(request)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, headers)
  if (!auth.userId) return jsonResponse({ error: "User session is required" }, 401, headers)
  const body = await readJsonBody(request)
  if (!body.ok) return jsonResponse({ error: body.error }, 400, headers)
  if (Object.keys(body.value).length) return jsonResponse({ error: "Member request must be empty" }, 400, headers)
  const admission = await enforceSubjectRateLimit(enroll ? "enroll-member" : "member", {}, headers, null, auth.userId)
  if (admission) return admission
  const result = await callRpc("joy8_resolve_member_profile", { p_auth_user_id: auth.userId, p_enroll: enroll })
  if (!result.ok) return jsonResponse(toPublicRpcError(result.body), statusFromRpcError(result.body), headers)
  const row = firstRpcRow<{ player_account_id: string; account_type: string; public_id: string }>(result.body)
  if (!row) {
    if (enroll) return jsonResponse({ error: "Gateway returned an empty member" }, 502, headers)
    return jsonResponse({ member: null }, 200, headers)
  }
  if (!row.player_account_id || !["guest", "registered"].includes(row.account_type) || !/^[1-9][0-9]{5}$/.test(row.public_id)) {
    return jsonResponse({ error: "Gateway returned an invalid member" }, 502, headers)
  }
  return jsonResponse({ member: { player_account_ref: row.player_account_id, public_id: row.public_id, account_type: row.account_type } }, 200, headers)
}

async function createPrivateSession(request: Request, headers: HeadersInit): Promise<Response> {
  const auth = await resolveAuthUser(request)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, headers)
  if (!auth.userId) return jsonResponse({ error: "User session is required" }, 401, headers)
  const body = await readJsonBody(request)
  if (!body.ok) return jsonResponse({ error: body.error }, 400, headers)
  const slug = body.value.slug
  if (Object.keys(body.value).length !== 1 || typeof slug !== "string" || !GAME_SLUG_PATTERN.test(slug)) {
    return jsonResponse({ error: "JOY8_INVALID_REQUEST" }, 400, headers)
  }
  const admission = await enforceSubjectRateLimit("private-session", {}, headers, null, auth.userId)
  if (admission) return admission
  const result = await callRpc("joy8_create_private_session", {
    p_game_slug: slug, p_auth_user_id: auth.userId, p_origin: request.headers.get("origin"),
  })
  if (!result.ok) return jsonResponse(toPublicRpcError(result.body), statusFromRpcError(result.body), headers)
  const row = result.body as Record<string, JsonValue> | null
  if (!row || Array.isArray(row) || !row.session_id || !row.launch_code || !row.game_id || !row.launch_url || row.protocol !== "server-v1") {
    return jsonResponse({ error: "Gateway returned an empty session" }, 502, headers)
  }
  return jsonResponse(row, 200, headers)
}

async function resolveBrandedEntry(request: Request, headers: HeadersInit): Promise<Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return jsonResponse({ error: body.error }, 400, headers)
  const slug = body.value.slug
  if (Object.keys(body.value).length !== 1 || typeof slug !== "string" || !GAME_SLUG_PATTERN.test(slug)) {
    return jsonResponse({ error: "JOY8_INVALID_REQUEST" }, 400, headers)
  }
  const result = await callRpc("joy8_resolve_branded_entry", {
    p_game_slug: slug, p_origin: request.headers.get("origin"),
  })
  if (!result.ok) return jsonResponse(toPublicRpcError(result.body), statusFromRpcError(result.body), headers)
  const row = result.body as Record<string, JsonValue> | null
  if (!row || Array.isArray(row) || !row.game_id || !row.game_name || !row.launch_url || row.protocol !== "server-v1") {
    return jsonResponse({ error: "Gateway returned an empty entry" }, 502, headers)
  }
  return jsonResponse(row, 200, headers)
}

async function createSession(request: Request, headers: HeadersInit): Promise<Response> {
  const auth = await resolveAuthUser(request)

  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status, headers)
  }

  if (!auth.userId) {
    return jsonResponse({ error: "User session is required" }, 401, headers)
  }

  const body = await readJsonBody(request)

  if (!body.ok) {
    return jsonResponse({ error: body.error }, 400, headers)
  }

  const slug = body.value.slug
  if (Object.keys(body.value).length !== 1 || typeof slug !== "string" || !GAME_SLUG_PATTERN.test(slug)) {
    return jsonResponse({ error: "JOY8_INVALID_REQUEST" }, 400, headers)
  }

  const admission = await enforceSubjectRateLimit("create-session", {}, headers, null, auth.userId)
  if (admission) return admission
  const memberResult = await callRpc("joy8_resolve_member", { p_auth_user_id: auth.userId, p_enroll: false })
  if (!memberResult.ok) {
    return jsonResponse(toPublicRpcError(memberResult.body), statusFromRpcError(memberResult.body), headers)
  }
  if (!firstRpcRow<{ player_account_id: string }>(memberResult.body)?.player_account_id) {
    return jsonResponse({ error: "player membership is required" }, 403, headers)
  }

  const rpcResult = await callRpc("create_game_session", {
    p_game_slug: slug,
    p_auth_user_id: auth.userId,
  })

  if (!rpcResult.ok) {
    return jsonResponse(toPublicRpcError(rpcResult.body), statusFromRpcError(rpcResult.body), headers)
  }

  const row = firstRpcRow<CreateSessionRow>(rpcResult.body)

  if (!row?.session_id || !row.launch_code || row.protocol !== "server-v1") {
    return jsonResponse({ error: "Gateway returned an empty session" }, 502, headers)
  }

  await callRpc("joy8_cleanup_gateway_runtime", {})

  return jsonResponse({
    session_id: row.session_id,
    game_id: row.game_id,
    player_account_ref: row.player_account_id,
    launch_code: row.launch_code,
    launch_code_expires_at: row.launch_code_expires_at,
    account_type: row.account_type,
    currency: row.currency,
    protocol: row.protocol,
    expires_at: row.expires_at,
  }, 200, headers)
}

async function getBalance(request: Request, headers: HeadersInit): Promise<Response> {
  const body = await readJsonBody(request)

  if (!body.ok) {
    return jsonResponse({ error: body.error }, 400, headers)
  }

  const gatewayToken = normalizeRequiredText(body.value.gateway_token, 256)

  if (!gatewayToken) {
    return jsonResponse({ error: "gateway_token is required" }, 400, headers)
  }

  const admission = await enforceSubjectRateLimit("balance", { gateway_token: gatewayToken }, headers)
  if (admission) return admission
  const rpcResult = await callRpc("wallet_get_balance", {
    p_gateway_token: gatewayToken,
  })

  if (!rpcResult.ok) {
    return jsonResponse(toPublicRpcError(rpcResult.body), statusFromRpcError(rpcResult.body), headers)
  }

  const row = firstRpcRow<BalanceRow>(rpcResult.body)

  if (!row?.session_id) {
    return jsonResponse({ error: "Wallet balance was not found" }, 404, headers)
  }

  return jsonResponse({
    session_id: row.session_id,
    player_account_ref: row.player_account_id,
    currency: row.currency,
    balance: row.balance,
    locked_balance: row.locked_balance,
  }, 200, headers)
}

export async function resolveAuthUser(request: Request): Promise<AuthResult> {
  const authorization = request.headers.get("authorization")?.trim() ?? ""
  const apiKey = request.headers.get("apikey")?.trim() ?? ""

  if (!authorization) {
    return { ok: true, userId: null }
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    return { ok: false, error: "Invalid authorization header", status: 401 }
  }

  const token = match[1].trim()

  if (!token || token === ANON_KEY || (apiKey && token === apiKey)) {
    return { ok: true, userId: null }
  }

  if (!SUPABASE_URL || !ANON_KEY) {
    return { ok: false, error: "Gateway authentication is not configured", status: 500 }
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      return { ok: false, error: "User session is not valid", status: 401 }
    }

    const user = await response.json()
    const userId = user && typeof user === "object" && "id" in user && typeof user.id === "string"
      ? user.id
      : ""

    if (!userId) {
      return { ok: false, error: "User session is not valid", status: 401 }
    }

    return { ok: true, userId }
  } catch {
    return { ok: false, error: "Gateway authentication is unavailable", status: 503 }
  }
}

async function enforceRateLimit(
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

async function enforceSubjectRateLimit(
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

export async function callRpc(name: string, args: Record<string, unknown>): Promise<RpcResult> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return {
      ok: false,
      body: { message: "Gateway is not configured" },
    }
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(RPC_REQUEST_TIMEOUT_MS),
    })

    return {
      ok: response.ok,
      body: await response.json(),
    }
  } catch {
    return {
      ok: false,
      body: {
        code: UPSTREAM_UNAVAILABLE_CODE,
        message: "Gateway upstream request failed",
      },
    }
  }
}

function getRoute(url: string): string {
  const pathname = new URL(url).pathname
  const parts = pathname.split("/").filter(Boolean)
  const last = parts[parts.length - 1] ?? ""

  return last
}

function buildCorsHeaders(
  origin: string | null,
  route: string,
  requestId: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function isCorsOriginAllowed(origin: string | null, route: string): boolean {
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

function getClientAddress(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()

  return request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || forwardedFor
    || "unknown"
}

function jsonResponse(payload: JsonValue, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers,
  })
}

async function readJsonBody(request: Request): Promise<BodyResult> {
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

function normalizeRequiredText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return ""
  }

  const text = value.trim()
  if (!text || text.length > maxLength) {
    return ""
  }

  return text
}

function firstRpcRow<T>(body: unknown): T | undefined {
  return Array.isArray(body) ? body[0] as T | undefined : undefined
}

function statusFromRpcError(error: unknown): number {
  if (!error || typeof error !== "object") {
    return 502
  }

  const code = "code" in error ? error.code : null

  if (code === UPSTREAM_UNAVAILABLE_CODE) {
    return 503
  }

  if (code === "22023") {
    return 400
  }

  if (code === "42501") {
    return 403
  }

  if (code === "P0002") {
    return 404
  }

  if (code === "P0001" || code === "23505") {
    return 409
  }

  return 502
}

function toPublicRpcError(error: unknown): { error: string } {
  if (!error || typeof error !== "object") {
    return { error: "Gateway RPC failed" }
  }

  const message = "message" in error && typeof error.message === "string"
    ? error.message
    : "Gateway RPC failed"

  if ("code" in error && error.code === UPSTREAM_UNAVAILABLE_CODE) {
    return { error: "Gateway service is unavailable" }
  }

  return { error: PUBLIC_RPC_MESSAGES.has(message) ? message : "Gateway RPC failed" }
}
