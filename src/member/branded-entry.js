import { ENTRY_REQUEST_ID_PATTERN } from "../lib/entryProtocol.js"

export function createBrandedEntryRequests({ canRequest, enter, onError }) {
  let busy = false
  let lastRequestId = null
  return async data => {
    if (busy || !canRequest() || data?.type !== "joy8-entry-request-v1" ||
      !["google", "guest"].includes(data.method) || typeof data.requestId !== "string" ||
      !ENTRY_REQUEST_ID_PATTERN.test(data.requestId) || data.requestId === lastRequestId) return
    busy = true
    lastRequestId = data.requestId
    try { await enter(data.method, data.requestId) }
    catch (error) { onError(error, data.requestId) }
    finally { busy = false }
  }
}

export async function enterBrandedMember({ method, service, captcha, onGoogle, onLaunch }) {
  if (!["google", "guest"].includes(method)) return
  if (method === "guest") throw Object.assign(new Error("Guest entry is disabled"), { code: "JOY8_GUEST_DISABLED" })
  const current = await service.session()
  if (current && !current.user?.is_anonymous) {
    await service.membership(true)
    return onLaunch()
  }
  return onGoogle()
}
