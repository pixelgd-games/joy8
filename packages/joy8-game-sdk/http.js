import { Joy8ApiError, Joy8SdkError } from "./errors.js"
import { isRecord } from "./validation.js"

export async function postJson({ fetchImpl, url, headers = {}, body, timeoutMs }) {
  if (typeof fetchImpl !== "function") throw new Joy8SdkError("JOY8_SDK_INVALID_CONFIGURATION", "fetch is unavailable")
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    const timeout = controller.signal.aborted
    throw new Joy8SdkError(timeout ? "JOY8_REQUEST_TIMEOUT" : "JOY8_NETWORK_ERROR", timeout ? "Joy8 request timed out" : "Joy8 request failed")
  } finally {
    clearTimeout(timeoutId)
  }
  const requestId = response.headers.get("x-joy8-request-id")
  const retryAfter = Number(response.headers.get("retry-after"))
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Joy8ApiError("JOY8_INVALID_RESPONSE", "Joy8 returned invalid JSON", { status: response.status, requestId })
  }
  if (!response.ok) {
    const code = isRecord(payload) && typeof payload.error === "string" ? payload.error : "JOY8_REQUEST_FAILED"
    throw new Joy8ApiError(code, `Joy8 request failed with ${code}`, {
      status: response.status,
      requestId,
      retryAfterSeconds: Number.isInteger(retryAfter) && retryAfter > 0 ? retryAfter : null,
    })
  }
  if (!isRecord(payload)) {
    throw new Joy8ApiError("JOY8_INVALID_RESPONSE", "Joy8 returned an invalid response", { status: response.status, requestId })
  }
  return payload
}
