import { resolveAuthUser } from "./auth.ts"
import { callRpc, callUserRpc, statusFromRpcError } from "./rpc.ts"
import { jsonResponse, readJsonBody } from "./http.ts"
import type { JsonValue } from "./http.ts"

export async function mailboxOperation(route: string, request: Request, headers: HeadersInit): Promise<Response> {
  const auth = await resolveAuthUser(request)
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, headers)
  if (!auth.userId) return jsonResponse({ error: "User session is required" }, 401, headers)
  const body = await readJsonBody(request)
  if (!body.ok) return jsonResponse({ error: body.error }, 400, headers)
  const admin = route === "admin-mailbox"
  const { action, request: payload } = body.value
  const actions = admin ? ["prepare", "send", "cancel", "list", "recipients"] : ["list", "read", "claim"]
  if (Object.keys(body.value).some(key => !["action", "request"].includes(key)) || typeof action !== "string"
    || !actions.includes(action) || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonResponse({ error: "JOY8_INVALID_REQUEST" }, 400, headers)
  }
  const admission = await callRpc("joy8_consume_gateway_rate_limit", {
    p_key: `mail:${route}:${auth.userId}`, p_limit: admin ? 30 : 120, p_window_seconds: 60,
  })
  if (!admission.ok || typeof admission.body !== "boolean") return jsonResponse({ error: "Gateway rate limit is unavailable" }, 503, headers)
  if (!admission.body) return jsonResponse({ error: "Too many requests" }, 429, { ...headers, "Retry-After": "60" })
  const args = { p_action: action, p_request: payload }
  const result = admin
    ? await callUserRpc("joy8_admin_mail", args, request.headers.get("authorization")!)
    : await callRpc("joy8_member_mail", { ...args, p_auth_user_id: auth.userId })
  if (!result.ok) {
    const error = result.body as { message?: string; code?: string } | null
    const allowed = new Set(["JOY8_INVALID_REQUEST", "JOY8_MAIL_FORBIDDEN", "JOY8_MAIL_NOT_FOUND", "JOY8_MAIL_NO_REWARD",
      "JOY8_MAIL_NO_RECIPIENTS", "JOY8_MAIL_AUDIENCE_LIMIT", "JOY8_MAIL_STATE_CONFLICT", "JOY8_IDEMPOTENCY_CONFLICT",
      "JOY8_WALLET_INACTIVE", "JOY8_WALLET_OCCUPIED"])
    if (error?.code === "22P02" || error?.code === "22003") return jsonResponse({ error: "JOY8_INVALID_REQUEST" }, 400, headers)
    if (allowed.has(error?.message ?? "")) return jsonResponse({ error: error!.message! }, statusFromRpcError(error), headers)
    return jsonResponse({ error: "JOY8_UPSTREAM_UNAVAILABLE" }, 503, headers)
  }
  if (!result.body || typeof result.body !== "object" || Array.isArray(result.body)) return jsonResponse({ error: "JOY8_UPSTREAM_UNAVAILABLE" }, 502, headers)
  return jsonResponse(result.body as JsonValue, 200, headers)
}
