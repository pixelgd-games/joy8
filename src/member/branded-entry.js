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
