type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

type CreateSessionRow = {
  session_id: string
  player_account_id: string
  wallet_account_id: string
  game_id: string
  launch_code: string
  launch_code_expires_at: string
  account_type: string
  currency: string
  wallet_mode: string
  expires_at: string
}

type ExchangeSessionRow = {
  session_id: string
  player_account_id: string
  wallet_account_id: string
  game_id: string
  gateway_token: string
  gateway_token_expires_at: string
  gateway_token_scopes: string[]
  account_type: string
  currency: string
  wallet_mode: string
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

type WalletTransactionRow = {
  transaction_id: string
  wallet_account_id: string
  game_session_id: string
  game_id: string
  round_id: string
  transaction_type: string
  amount: number | string
  balance_before: number | string
  balance_after: number | string
  currency: string
}

type CloseRoundRow = {
  game_round_id: string
  game_session_id: string
  game_id: string
  round_id: string
  status: string
  bet_amount: number | string
  payout_amount: number | string
  refund_amount: number | string
  settled_at: string
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
const DEMO_CURRENCY = "POINT"
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
  "member",
  "enroll-member",
  "create-session",
  "exchange",
  "balance",
  "bet",
  "payout",
  "refund",
  "close-round",
])
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  member: { limit: 120, windowSeconds: 60 },
  "enroll-member": { limit: 30, windowSeconds: 300 },
  "create-session": { limit: 30, windowSeconds: 300 },
  exchange: { limit: 60, windowSeconds: 300 },
  balance: { limit: 120, windowSeconds: 60 },
  bet: { limit: 120, windowSeconds: 60 },
  payout: { limit: 120, windowSeconds: 60 },
  refund: { limit: 120, windowSeconds: 60 },
  "close-round": { limit: 120, windowSeconds: 60 },
}
const PUBLIC_RPC_MESSAGES = new Set([
  "amount must be greater than zero",
  "expires_in_seconds must be between 60 and 86400",
  "game is not available",
  "game round is already closed",
  "game round was not found",
  "game session is not active",
  "game slug is required",
  "gateway token expiry must be between 300 and 86400",
  "idempotency_key conflicts with another transaction",
  "idempotency_key is required",
  "insufficient wallet balance",
  "launch code is invalid or expired",
  "launch_code is required",
  "metadata must be a json object",
  "player account is not active",
  "player membership is required",
  "verified member identity is required",
  "round_id is required",
  "unsupported wallet transaction type",
  "wallet account is not active",
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
  if (route === "member" || route === "enroll-member") {
    return resolveMember(request, headers, route === "enroll-member")
  }

  if (route === "create-session") {
    return createSession(request, headers)
  }

  if (route === "exchange") {
    return exchangeLaunchCode(request, headers)
  }

  if (route === "balance") {
    return getBalance(request, headers)
  }

  if (route === "bet" || route === "payout" || route === "refund") {
    return applyWalletTransaction(route, request, headers)
  }

  if (route === "close-round") {
    return closeRound(request, headers)
  }

  return jsonResponse({ error: "Route not found" }, 404, headers)
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

  if (currency !== DEMO_CURRENCY) {
    return jsonResponse({ error: "Demo wallet only supports POINT" }, 400, headers)
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

  if (!row?.session_id || !row.launch_code) {
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
    wallet_mode: row.wallet_mode,
    expires_at: row.expires_at,
  }, 200, headers)
}

async function exchangeLaunchCode(request: Request, headers: HeadersInit): Promise<Response> {
  const body = await readJsonBody(request)

  if (!body.ok) {
    return jsonResponse({ error: body.error }, 400, headers)
  }

  const launchCode = normalizeRequiredText(body.value.launch_code, 128)

  if (!launchCode) {
    return jsonResponse({ error: "launch_code is required" }, 400, headers)
  }

  const rpcResult = await callRpc("exchange_game_launch_code", {
    p_launch_code: launchCode,
    p_gateway_expires_in_seconds: 3600,
  })

  if (!rpcResult.ok) {
    return jsonResponse(toPublicRpcError(rpcResult.body), statusFromRpcError(rpcResult.body), headers)
  }

  const row = firstRpcRow<ExchangeSessionRow>(rpcResult.body)

  if (!row?.session_id || !row.gateway_token) {
    return jsonResponse({ error: "Gateway token was not created" }, 502, headers)
  }

  return jsonResponse({
    session_id: row.session_id,
    game_id: row.game_id,
    player_account_ref: row.player_account_id,
    gateway_token: row.gateway_token,
    gateway_token_expires_at: row.gateway_token_expires_at,
    scopes: row.gateway_token_scopes,
    account_type: row.account_type,
    currency: row.currency,
    wallet_mode: row.wallet_mode,
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

async function applyWalletTransaction(
  transactionType: "bet" | "payout" | "refund",
  request: Request,
  headers: HeadersInit,
): Promise<Response> {
  const body = await readJsonBody(request)

  if (!body.ok) {
    return jsonResponse({ error: body.error }, 400, headers)
  }

  const gatewayToken = normalizeRequiredText(body.value.gateway_token, 256)
  const roundId = normalizeRequiredText(body.value.round_id, 120)
  const idempotencyKey = normalizeRequiredText(body.value.idempotency_key, 180)
  const amount = normalizeAmount(body.value.amount)
  const metadata = normalizeMetadata(body.value.metadata)

  if (!gatewayToken) {
    return jsonResponse({ error: "gateway_token is required" }, 400, headers)
  }

  if (!roundId) {
    return jsonResponse({ error: "round_id is required" }, 400, headers)
  }

  if (!amount) {
    return jsonResponse({ error: "amount must be greater than zero" }, 400, headers)
  }

  if (!idempotencyKey) {
    return jsonResponse({ error: "idempotency_key is required" }, 400, headers)
  }

  if (!metadata.ok) {
    return jsonResponse({ error: metadata.error }, 400, headers)
  }

  const rpcResult = await callRpc(`wallet_${transactionType}`, {
    p_gateway_token: gatewayToken,
    p_round_id: roundId,
    p_amount: amount,
    p_idempotency_key: idempotencyKey,
    p_metadata: metadata.value,
  })

  if (!rpcResult.ok) {
    return jsonResponse(toPublicRpcError(rpcResult.body), statusFromRpcError(rpcResult.body), headers)
  }

  const row = firstRpcRow<WalletTransactionRow>(rpcResult.body)

  if (!row?.transaction_id) {
    return jsonResponse({ error: "Wallet transaction was not created" }, 502, headers)
  }

  return jsonResponse({
    transaction_id: row.transaction_id,
    session_id: row.game_session_id,
    game_id: row.game_id,
    round_id: row.round_id,
    type: row.transaction_type,
    amount: row.amount,
    balance_before: row.balance_before,
    balance_after: row.balance_after,
    currency: row.currency,
  }, 200, headers)
}

async function closeRound(request: Request, headers: HeadersInit): Promise<Response> {
  const body = await readJsonBody(request)

  if (!body.ok) {
    return jsonResponse({ error: body.error }, 400, headers)
  }

  const gatewayToken = normalizeRequiredText(body.value.gateway_token, 256)
  const roundId = normalizeRequiredText(body.value.round_id, 120)

  if (!gatewayToken) {
    return jsonResponse({ error: "gateway_token is required" }, 400, headers)
  }

  if (!roundId) {
    return jsonResponse({ error: "round_id is required" }, 400, headers)
  }

  const rpcResult = await callRpc("close_game_round", {
    p_gateway_token: gatewayToken,
    p_round_id: roundId,
  })

  if (!rpcResult.ok) {
    return jsonResponse(toPublicRpcError(rpcResult.body), statusFromRpcError(rpcResult.body), headers)
  }

  const row = firstRpcRow<CloseRoundRow>(rpcResult.body)

  if (!row?.game_round_id) {
    return jsonResponse({ error: "Game round was not found" }, 404, headers)
  }

  return jsonResponse({
    game_round_id: row.game_round_id,
    session_id: row.game_session_id,
    game_id: row.game_id,
    round_id: row.round_id,
    status: row.status,
    bet_amount: row.bet_amount,
    payout_amount: row.payout_amount,
    refund_amount: row.refund_amount,
    settled_at: row.settled_at,
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

function normalizeAmount(value: unknown): number | null {
  const text = typeof value === "number"
    ? String(value)
    : typeof value === "string"
      ? value.trim()
      : ""

  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(text)) {
    return null
  }

  const amount = Number(text)

  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }

  return amount
}

function normalizeMetadata(value: unknown): (
  | { ok: true; value: Record<string, JsonValue> }
  | { ok: false; error: string }
) {
  if (value === undefined || value === null) {
    return { ok: true, value: {} }
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "metadata must be an object" }
  }

  return { ok: true, value: value as Record<string, JsonValue> }
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
