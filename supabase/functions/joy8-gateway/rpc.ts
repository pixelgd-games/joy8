import { SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY, RPC_REQUEST_TIMEOUT_MS } from "./config.ts"

export type RpcResult = {
  ok: boolean
  body: unknown
}

const UPSTREAM_UNAVAILABLE_CODE = "JOY8_UPSTREAM_UNAVAILABLE"

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

export async function callRpc(name: string, args: Record<string, unknown>): Promise<RpcResult> {
  return requestRpc(name, args, SERVICE_ROLE_KEY, `Bearer ${SERVICE_ROLE_KEY}`)
}

export async function callUserRpc(name: string, args: Record<string, unknown>, authorization: string): Promise<RpcResult> {
  return requestRpc(name, args, ANON_KEY, authorization)
}

async function requestRpc(name: string, args: Record<string, unknown>, apiKey: string, authorization: string): Promise<RpcResult> {
  if (!SUPABASE_URL || !apiKey) {
    return {
      ok: false,
      body: { message: "Gateway is not configured" },
    }
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        Authorization: authorization,
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

export function firstRpcRow<T>(body: unknown): T | undefined {
  return Array.isArray(body) ? body[0] as T | undefined : undefined
}

export function statusFromRpcError(error: unknown): number {
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

export function toPublicRpcError(error: unknown): { error: string } {
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
