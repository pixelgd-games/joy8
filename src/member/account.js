import "../styles/theme.css"
import { safeReturnPath } from "./service.js"
import { forwardCallback } from "./callback.js"

const params = new URLSearchParams(location.search)
const next = safeReturnPath(params.get("next"), location.origin)
const target = new URL(next.startsWith("/entry/") ? next : "/", location.origin)
const callback = params.has("code") || params.has("error") || params.has("error_code")
const restriction = ["JOY8_EMAIL_NOT_ALLOWED", "JOY8_GUEST_DISABLED"].find(code => params.get("error_description")?.includes(code))
if (restriction) params.set("error_code", restriction)
if (!next.startsWith("/entry/")) {
  target.searchParams.set("member", callback ? "callback" : "open")
  target.searchParams.set("next", next)
}
history.replaceState(null, "", "/account/")
location.replace(forwardCallback(params, target))
