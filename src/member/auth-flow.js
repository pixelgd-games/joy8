import { providerLabel } from "./service.js"

export function createMemberAuthFlow(service, { storage = sessionStorage, navigate = url => location.assign(url), confirmSwitch = message => window.confirm(message), onRetained = () => {}, isActive = () => true } = {}) {
  const pendingKey = "joy8-member-link-user"
  async function switchProvider(provider) {
    const result = await service.switchGuestProvider(provider, storage.getItem(pendingKey), () => isActive() && confirmSwitch(
      `這個 ${providerLabel(provider)} 已綁定其他 Joy8 玩家。繼續會離開目前訪客帳號，登入既有帳號；訪客進度、POINT 與錢包不會合併或轉移。`))
    storage.removeItem(pendingKey)
    if (!isActive()) return
    if (result) navigate(result.url)
    else await onRetained()
  }
  async function begin(provider) {
    if (!isActive()) return
    const current = await service.session()
    if (current?.user?.is_anonymous) storage.setItem(pendingKey, current.user.id)
    else storage.removeItem(pendingKey)
    try {
      const result = await service.oauth(provider)
      if (!isActive()) return
      if (result.expectedUserId) storage.setItem(pendingKey, result.expectedUserId)
      navigate(result.url)
    } catch (error) {
      if (error?.code === "identity_already_exists" && current?.user?.is_anonymous) return switchProvider(provider)
      storage.removeItem(pendingKey)
      throw error
    }
  }
  async function complete(params) {
    const provider = params.get("provider")
    const flow = params.get("flow")
    const error = params.get("error_code") || (params.has("error") ? "auth_callback_failed" : null)
    if (error) {
      if (error === "identity_already_exists" && flow === "link" && ["google", "facebook"].includes(provider)) {
        await switchProvider(provider)
        return false
      }
      storage.removeItem(pendingKey)
      throw Object.assign(new Error("Authentication callback failed"), { code: error })
    }
    if (!params.has("code")) return false
    await service.completeCallback(params.get("code"), storage.getItem(pendingKey), flow)
    storage.removeItem(pendingKey)
    await service.membership(true)
    return true
  }
  async function signOut() {
    await service.signOut()
    storage.removeItem(pendingKey)
  }
  return { begin, complete, signOut }
}
