export function createMemberAuthFlow(service, { navigate = url => location.assign(url), isActive = () => true } = {}) {
  async function begin(provider = "google") {
    if (!isActive()) return
    const result = await service.oauth(provider)
    if (isActive()) navigate(result.url)
  }
  async function complete(params) {
    const restriction = ["JOY8_EMAIL_NOT_ALLOWED", "JOY8_GUEST_DISABLED"].find(code => params.get("error_description")?.includes(code))
    const error = restriction || params.get("error_code") || (params.has("error") ? "auth_callback_failed" : null)
    if (error) throw Object.assign(new Error("Authentication callback failed"), { code: error })
    if (!params.has("code")) return false
    if (params.get("provider") !== "google") throw new Error("Unsupported authentication provider")
    await service.completeCallback(params.get("code"), params.get("flow"))
    await service.membership(true)
    return true
  }
  return { begin, complete, signOut: () => service.signOut() }
}
