import { postJson } from "./http.js"
import {
  CURRENCY,
  PROTOCOL,
  normalizeGatewayUrl,
  normalizeParentOrigins,
  rejectUrlCredentials,
  requireExactKeys,
  requireText,
  requireUuid,
} from "./validation.js"
import { Joy8SdkError } from "./errors.js"

const LAUNCH_KEYS = [
  "joy8_session_id",
  "joy8_launch_code",
  "joy8_game_id",
  "joy8_currency",
  "joy8_protocol",
  "joy8_gateway_url",
]

export function receiveJoy8Launch({
  parentOrigins,
  expectedGameId,
  gatewayUrl,
  timeoutMs = 30000,
  signal,
  windowObject = globalThis.window,
  locationHref = windowObject?.location?.href,
} = {}) {
  const origins = normalizeParentOrigins(parentOrigins)
  const gameId = requireUuid(expectedGameId, "expectedGameId")
  const expectedGatewayUrl = normalizeGatewayUrl(gatewayUrl)
  if (!windowObject?.parent || windowObject.parent === windowObject || typeof windowObject.addEventListener !== "function") {
    throw new Joy8SdkError("JOY8_PARENT_REQUIRED", "Joy8 launch requires an embedded browser context")
  }
  rejectUrlCredentials(locationHref)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    throw new Joy8SdkError("JOY8_SDK_INVALID_CONFIGURATION", "timeoutMs must be from 1000 to 60000")
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, launch) => {
      if (settled) return
      settled = true
      windowObject.clearTimeout(timeoutId)
      windowObject.removeEventListener("message", onMessage)
      signal?.removeEventListener("abort", onAbort)
      if (error) reject(error)
      else resolve(Object.freeze(launch))
    }
    const onAbort = () => finish(new Joy8SdkError("JOY8_LAUNCH_ABORTED", "Joy8 launch was aborted"))
    const onMessage = event => {
      if (event.source !== windowObject.parent || !origins.includes(event.origin)) return
      if (event.data?.type !== "joy8-launch-v1") return
      try {
        requireExactKeys(event.data, ["type", "launch"], "launch message")
        requireExactKeys(event.data.launch, LAUNCH_KEYS, "launch payload")
        const launch = event.data.launch
        requireUuid(launch.joy8_session_id, "joy8_session_id")
        requireText(launch.joy8_launch_code, "joy8_launch_code", 64, 64)
        if (!/^[a-f0-9]{64}$/.test(launch.joy8_launch_code)) throw new Joy8SdkError("JOY8_INVALID_LAUNCH", "joy8_launch_code is invalid")
        if (requireUuid(launch.joy8_game_id, "joy8_game_id") !== gameId
          || launch.joy8_currency !== CURRENCY
          || launch.joy8_protocol !== PROTOCOL
          || normalizeGatewayUrl(launch.joy8_gateway_url) !== expectedGatewayUrl) {
          throw new Joy8SdkError("JOY8_INVALID_LAUNCH", "Joy8 launch does not match trusted game configuration")
        }
        finish(null, { ...launch, joy8_gateway_url: expectedGatewayUrl })
      } catch (error) {
        finish(error instanceof Joy8SdkError ? error : new Joy8SdkError("JOY8_INVALID_LAUNCH", "Joy8 launch is invalid", { cause: error }))
      }
    }
    const timeoutId = windowObject.setTimeout(() => finish(new Joy8SdkError("JOY8_LAUNCH_TIMEOUT", "Joy8 launch timed out")), timeoutMs)
    windowObject.addEventListener("message", onMessage)
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    try {
      for (const origin of origins) {
        windowObject.parent.postMessage({ type: "joy8-launch-ready-v1", protocol: PROTOCOL }, origin)
      }
    } catch {
      finish(new Joy8SdkError("JOY8_LAUNCH_HANDOFF_FAILED", "Joy8 launch readiness could not be sent"))
    }
  })
}

export async function getJoy8Balance({ gatewayUrl, gatewayToken, timeoutMs = 8000, fetch: fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = normalizeGatewayUrl(gatewayUrl)
  requireText(gatewayToken, "gatewayToken", 1, 256)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new Joy8SdkError("JOY8_SDK_INVALID_CONFIGURATION", "timeoutMs must be from 1000 to 30000")
  }
  const payload = await postJson({ fetchImpl, url: `${baseUrl}/balance`, body: { gateway_token: gatewayToken }, timeoutMs })
  try {
    requireExactKeys(payload, ["session_id", "player_account_ref", "currency", "balance", "locked_balance"], "balance response")
    requireUuid(payload.session_id, "session_id")
    requireUuid(payload.player_account_ref, "player_account_ref")
    if (payload.currency !== CURRENCY || !["string", "number"].includes(typeof payload.balance)
      || !["string", "number"].includes(typeof payload.locked_balance)) {
      throw new Joy8SdkError("JOY8_INVALID_RESPONSE", "Joy8 balance response is invalid")
    }
  } catch (error) {
    if (error instanceof Joy8SdkError && error.code === "JOY8_SDK_INVALID_ARGUMENT") {
      throw new Joy8SdkError("JOY8_INVALID_RESPONSE", "Joy8 balance response is invalid")
    }
    throw error
  }
  if (!Number.isFinite(Number(payload.balance)) || !Number.isFinite(Number(payload.locked_balance))) {
    throw new Joy8SdkError("JOY8_INVALID_RESPONSE", "Joy8 balance response is invalid")
  }
  return Object.freeze({
    sessionId: payload.session_id,
    playerAccountRef: payload.player_account_ref,
    currency: payload.currency,
    balance: String(payload.balance),
    lockedBalance: String(payload.locked_balance),
  })
}
