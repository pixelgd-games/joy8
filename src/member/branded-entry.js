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
  const current = await service.session()
  if (current && !current.user?.is_anonymous) {
    if (method === "guest") throw Object.assign(new Error("Registered session cannot enter as guest"), { code: "registered_session" })
    await service.membership(true)
    return onLaunch()
  }
  if (method === "google") return onGoogle()
  try {
    await service.guest(current ? undefined : await captcha.token())
    return await onLaunch()
  } finally {
    captcha.reset()
  }
}
