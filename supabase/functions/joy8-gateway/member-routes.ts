import { GAME_SLUG_PATTERN } from "../../../packages/joy8-game-sdk/contract.js"
import { resolveAuthUser } from "./auth.ts"
import { callRpc, firstRpcRow, statusFromRpcError, toPublicRpcError } from "./rpc.ts"
import { enforceCounterRateLimit, enforceSubjectRateLimit } from "./rate-limit.ts"
import { jsonResponse, readJsonBody, normalizeRequiredText } from "./http.ts"
import type { JsonValue } from "./http.ts"

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

async function enforcePlayAccess(userId: string, headers: HeadersInit): Promise<Response | null> {
  const result = await callRpc("joy8_assert_play_access", { p_auth_user_id: userId })
  if (!result.ok) return jsonResponse(toPublicRpcError(result.body), statusFromRpcError(result.body), headers)
  if (result.body !== true) return jsonResponse({ error: "JOY8_UPSTREAM_UNAVAILABLE" }, 503, headers)
  return null
}

export async function resolveMember(request: Request, headers: HeadersInit, enroll: boolean): Promise<Response> {
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
  if (!row.player_account_id || row.account_type !== "registered" || !/^[1-9][0-9]{5}$/.test(row.public_id)) {
    return jsonResponse({ error: "Gateway returned an invalid member" }, 502, headers)
  }
  return jsonResponse({ member: { player_account_ref: row.player_account_id, public_id: row.public_id, account_type: row.account_type } }, 200, headers)
}

export async function createPrivateSession(request: Request, headers: HeadersInit): Promise<Response> {
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

export async function resolveBrandedEntry(request: Request, headers: HeadersInit): Promise<Response> {
  const auth = await resolveAuthUser(request)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, headers)
  if (!auth.userId) return jsonResponse({ error: "User session is required" }, 401, headers)
  const body = await readJsonBody(request)
  if (!body.ok) return jsonResponse({ error: body.error }, 400, headers)
  const slug = body.value.slug
  if (Object.keys(body.value).length !== 1 || typeof slug !== "string" || !GAME_SLUG_PATTERN.test(slug)) {
    return jsonResponse({ error: "JOY8_INVALID_REQUEST" }, 400, headers)
  }
  const denied = await enforcePlayAccess(auth.userId, headers)
  if (denied) return denied
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

export async function createSession(request: Request, headers: HeadersInit): Promise<Response> {
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

export async function getBalance(request: Request, headers: HeadersInit): Promise<Response> {
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

export async function getMemberWallet(request: Request, headers: HeadersInit): Promise<Response> {
  const auth = await resolveAuthUser(request)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, headers)
  if (!auth.userId) return jsonResponse({ error: "User session is required" }, 401, headers)
  const body = await readJsonBody(request)
  if (!body.ok) return jsonResponse({ error: body.error }, 400, headers)
  if (Object.keys(body.value).length) return jsonResponse({ error: "JOY8_INVALID_REQUEST" }, 400, headers)
  const admission = await enforceCounterRateLimit(`wallet:${auth.userId}`, headers)
  if (admission) return admission
  const result = await callRpc("joy8_member_wallet_v1", { p_auth_user_id: auth.userId })
  if (!result.ok) return jsonResponse(toPublicRpcError(result.body), statusFromRpcError(result.body), headers)
  const wallet = (result.body as { wallet?: JsonValue } | null)?.wallet
  if (wallet === undefined || (wallet !== null && (typeof wallet !== "object" || Array.isArray(wallet)))) {
    return jsonResponse({ error: "JOY8_UPSTREAM_UNAVAILABLE" }, 502, headers)
  }
  return jsonResponse({ wallet }, 200, headers)
}
