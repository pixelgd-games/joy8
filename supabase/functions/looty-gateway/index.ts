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

type RateLimitConfig = {
  limit: number
  windowSeconds: number
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
const POINT_CURRENCY = "POINT"
const MAX_BODY_BYTES = 16 * 1024
const AUTH_REQUEST_TIMEOUT_MS = 5000
const RPC_REQUEST_TIMEOUT_MS = 8000
const UPSTREAM_UNAVAILABLE_CODE = "LOOTY_UPSTREAM_UNAVAILABLE"
const DEFAULT_ALLOWED_ORIGINS = [
  "https://looty-git.pages.dev",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]
const ROUTES = new Set([
  "health",
  "server-exchange-v1",
  "server-renew-v1",
  "server-open-v1",
  "server-settle-v1",
  "server-status-v1",
  "server-cancel-v1",
  "member",
  "enroll-member",
  "create-session",
  "private-session",
  "balance",
])
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  health: { limit: 30, windowSeconds: 60 },
  "server-exchange-v1": { limit: 120, windowSeconds: 60 },
  "server-renew-v1": { limit: 120, windowSeconds: 60 },
  "server-open-v1": { limit: 120, windowSeconds: 60 },
  "server-settle-v1": { limit: 120, windowSeconds: 60 },
  "server-status-v1": { limit: 120, windowSeconds: 60 },
  "server-cancel-v1": { limit: 120, windowSeconds: 60 },
  member: { limit: 120, windowSeconds: 60 },
  "enroll-member": { limit: 30, windowSeconds: 300 },
  "create-session": { limit: 30, windowSeconds: 300 },
  "private-session": { limit: 30, windowSeconds: 300 },
  balance: { limit: 120, windowSeconds: 60 },
}
const PUBLIC_RPC_MESSAGES = new Set([
  "game is not available", "game session is not active", "player account is not active",
  "player membership is required", "verified member identity is required",
  "LOOTY_GAME_NOT_READY", "LOOTY_PLAYER_INACTIVE", "LOOTY_WALLET_INACTIVE", "LOOTY_INVALID_REQUEST",
  "LOOTY_PRIVATE_ENTRY_DENIED",
])

const allowedOrigins = (Deno.env.get("LOOTY_ALLOWED_ORIGINS") ?? "")
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
      const rateLimitResponse = await enforceRateLimit(route, request, corsHeaders)
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
    const result = await callRpc("looty_platform_health_v1", {})
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

  if (route === "balance") {
    return getBalance(request, headers)
  }

  return jsonResponse({ error: "Route not found" }, 404, headers)
}

async function serverOperation(route: string, request: Request, headers: HeadersInit): Promise<Response> {
  const match = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)
  if (!match) return jsonResponse({ error: "LOOTY_BACKEND_UNAUTHORIZED" }, 401, headers)
  const body = await readJsonBody(request)
  if (!body.ok) return jsonResponse({ error: "LOOTY_INVALID_REQUEST" }, 400, headers)
  const action = route.slice(7, -3)
  const args: Record<string, unknown> = { p_secret: match[1], p_request: body.value }
  let name: string
  if (action === "exchange" || action === "renew") {
    name = "looty_server_session_v1"
    args.p_action = action
  } else if (action === "open" || action === "settle") {
    name = action === "open" ? "looty_open_match_v1" : "looty_settle_match_v1"
  } else {
    name = "looty_match_status_v1"
    args.p_cancel = action === "cancel"
  }
  const result = await callRpc(name, args)
  if (!result.ok) {
    const error = result.body as { message?: string; code?: string } | null
    const code = error?.message ?? ""
    const statuses: Record<string, number> = {
      LOOTY_BACKEND_UNAUTHORIZED: 401, LOOTY_GAME_NOT_READY: 403, LOOTY_PLAYER_INACTIVE: 403,
      LOOTY_WALLET_INACTIVE: 403, LOOTY_SESSION_INVALID: 403, LOOTY_ADAPTER_UNAVAILABLE: 503,
      LOOTY_ADAPTER_REJECTED: 409, LOOTY_INVALID_REQUEST: 400, LOOTY_INVALID_AMOUNT: 400,
      LOOTY_INVALID_ENTRY: 400, LOOTY_LIMIT_EXCEEDED: 400, LOOTY_RULE_MISMATCH: 409,
      LOOTY_IDEMPOTENCY_CONFLICT: 409, LOOTY_MATCH_FINALIZED: 409, LOOTY_MATCH_NOT_FOUND: 404,
      LOOTY_UNBALANCED_SETTLEMENT: 400, LOOTY_WALLET_OCCUPIED: 409, LOOTY_INSUFFICIENT_BALANCE: 409,
      LOOTY_SETTLEMENT_SEQUENCE: 409,
    }
    if (statuses[code]) return jsonResponse({ error: code }, statuses[code], headers)
    if (error?.code === "22P02") return jsonResponse({ error: "LOOTY_INVALID_REQUEST" }, 400, headers)
    return jsonResponse({ error: "LOOTY_UPSTREAM_UNAVAILABLE" }, 503, headers)
  }
  if (!result.body || typeof result.body !== "object" || Array.isArray(result.body)) {
    return jsonResponse({ error: "LOOTY_UPSTREAM_UNAVAILABLE" }, 502, headers)
  }
  return jsonResponse(result.body as JsonValue, 200, headers)
}

async function resolveMember(request: Request, headers: HeadersInit, enroll: boolean): Promise<Response> {
  const auth = await resolveAuthUser(request)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, headers)
  if (!auth.userId) return jsonResponse({ error: "User session is required" }, 401, headers)
  const body = await readJsonBody(request)
  if (!body.ok) return jsonResponse({ error: body.error }, 400, headers)
  if (Object.keys(body.value).length) return jsonResponse({ error: "Member request must be empty" }, 400, headers)
  const result = await callRpc("looty_resolve_member", { p_auth_user_id: auth.userId, p_enroll: enroll })
  if (!result.ok) return jsonResponse(toPublicRpcError(result.body), statusFromRpcError(result.body), headers)
  const row = firstRpcRow<{ player_account_id: string; account_type: string }>(result.body)
  if (!row) {
    if (enroll) return jsonResponse({ error: "Gateway returned an empty member" }, 502, headers)
    return jsonResponse({ member: null }, 200, headers)
  }
  if (!row.player_account_id || !["guest", "registered"].includes(row.account_type)) {
    return jsonResponse({ error: "Gateway returned an invalid member" }, 502, headers)
  }
  return jsonResponse({ member: { player_account_ref: row.player_account_id, account_type: row.account_type } }, 200, headers)
}

async function createPrivateSession(request: Request, headers: HeadersInit): Promise<Response> {
  const auth = await resolveAuthUser(request)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, headers)
  if (!auth.userId) return jsonResponse({ error: "User session is required" }, 401, headers)
  const body = await readJsonBody(request)
  if (!body.ok) return jsonResponse({ error: body.error }, 400, headers)
  const slug = body.value.slug
  if (Object.keys(body.value).length !== 1 || typeof slug !== "string" || !/^[a-z0-9-]{1,80}$/.test(slug)) {
    return jsonResponse({ error: "LOOTY_INVALID_REQUEST" }, 400, headers)
  }
  const result = await callRpc("looty_create_private_session", {
    p_game_slug: slug, p_auth_user_id: auth.userId, p_origin: request.headers.get("origin"),
  })
  if (!result.ok) return jsonResponse(toPublicRpcError(result.body), statusFromRpcError(result.body), headers)
  const row = result.body as Record<string, JsonValue> | null
  if (!row || Array.isArray(row) || !row.session_id || !row.launch_code || !row.game_id || !row.launch_url || row.protocol !== "server-v1") {
    return jsonResponse({ error: "Gateway returned an empty session" }, 502, headers)
  }
  return jsonResponse(row, 200, { ...headers, "Cache-Control": "no-store" })
}

async function createSession(request: Request, headers: HeadersInit): Promise<Response> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Gateway is not configured" }, 500, headers)
  }

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

  const slug = typeof body.value.slug === "string" ? body.value.slug.trim() : ""
  const currency = typeof body.value.currency === "string" ? body.value.currency.trim().toUpperCase() : "POINT"
  const expiresInSeconds = normalizeInteger(body.value.expires_in_seconds, 3600)
  const displayName = typeof body.value.display_name === "string" ? body.value.display_name.trim() : ""

  if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
    return jsonResponse({ error: "Invalid game slug" }, 400, headers)
  }

  if (!/^[A-Z0-9_]{1,16}$/.test(currency)) {
    return jsonResponse({ error: "Invalid currency" }, 400, headers)
  }

  if (currency !== POINT_CURRENCY) {
    return jsonResponse({ error: "Wallet only supports POINT" }, 400, headers)
  }

  if (expiresInSeconds < 60 || expiresInSeconds > 86400) {
    return jsonResponse({ error: "Invalid session expiry" }, 400, headers)
  }

  if (displayName.length > 120) {
    return jsonResponse({ error: "Display name is too long" }, 400, headers)
  }

  const memberResult = await callRpc("looty_resolve_member", { p_auth_user_id: auth.userId, p_enroll: false })
  if (!memberResult.ok) {
    return jsonResponse(toPublicRpcError(memberResult.body), statusFromRpcError(memberResult.body), headers)
  }
  if (!firstRpcRow<{ player_account_id: string }>(memberResult.body)?.player_account_id) {
    return jsonResponse({ error: "player membership is required" }, 403, headers)
  }

  const rpcResult = await callRpc("create_game_session", {
    p_game_slug: slug,
    p_currency: currency,
    p_expires_in_seconds: expiresInSeconds,
    p_display_name: displayName || null,
    p_auth_user_id: auth.userId,
  })

  if (!rpcResult.ok) {
    return jsonResponse(toPublicRpcError(rpcResult.body), statusFromRpcError(rpcResult.body), headers)
  }

  const row = firstRpcRow<CreateSessionRow>(rpcResult.body)

  if (!row?.session_id || !row.launch_code || row.protocol !== "server-v1") {
    return jsonResponse({ error: "Gateway returned an empty session" }, 502, headers)
  }

  await callRpc("looty_cleanup_gateway_runtime", {})

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
  const config = RATE_LIMITS[route]

  if (!config) {
    return null
  }

  const clientAddress = getClientAddress(request)
  const rpcResult = await callRpc("looty_consume_gateway_rate_limit", {
    p_key: `${route}:${clientAddress}`,
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

  if (last === "looty-gateway") {
    return "create-session"
  }

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
    "Content-Type": "application/json; charset=utf-8",
    "X-Looty-Request-Id": requestId,
    Vary: "Origin",
  }

  if (isCorsOriginAllowed(origin, route) && origin) {
    headers["Access-Control-Allow-Origin"] = origin
  }

  return headers
}

function isCorsOriginAllowed(origin: string | null, route: string): boolean {
  if (route.startsWith("server-") && route.endsWith("-v1")) return !origin
  if (route === "private-session") return Boolean(origin && allowedOrigins.includes(origin))
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
      || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
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

function normalizeInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value)
  }

  return fallback
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
