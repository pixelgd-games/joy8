import "../styles/theme.css"
import { safeReturnPath } from "./service.js"

const params = new URLSearchParams(location.search)
const next = safeReturnPath(params.get("next"), location.origin)
const target = new URL(next.startsWith("/entry/") ? next : "/", location.origin)
const callback = params.has("code") || params.has("error") || params.has("error_code")
if (!next.startsWith("/entry/")) {
  target.searchParams.set("member", callback ? "callback" : "open")
  target.searchParams.set("next", next)
}
for (const key of ["flow", "provider", "code", "error", "error_code"]) {
  if (params.has(key)) target.searchParams.set(key, params.get(key))
}
location.replace(target)
