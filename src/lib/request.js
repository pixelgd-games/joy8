import { GATEWAY_REGION } from "../../packages/joy8-game-sdk/contract.js"

export function withGatewayRegion(input) {
  if (typeof input !== "string" || !input.includes("/functions/v1/joy8-gateway/")) return input
  const url = new URL(input)
  url.searchParams.set("forceFunctionRegion", GATEWAY_REGION)
  return url.href
}

export async function fetchWithTimeout(input, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const signal = options.signal ?? input?.signal
  const abort = () => controller.abort(signal.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs)
  try {
    const response = await fetch(withGatewayRegion(input), { ...options, signal: controller.signal })
    const body = await response.arrayBuffer()
    return new Response(response.status === 204 || response.status === 205 || response.status === 304 ? null : body, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", abort)
  }
}
