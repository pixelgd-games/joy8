import "../styles/theme.css"
import { safeReturnPath } from "./service.js"

const params = new URLSearchParams(location.search)
const target = new URL("/", location.origin)
const callback = params.has("code") || params.has("error") || params.has("error_code")
target.searchParams.set("member", callback ? "callback" : "open")
target.searchParams.set("next", safeReturnPath(params.get("next"), location.origin))
for (const key of ["flow", "code", "error", "error_code"]) {
  if (params.has(key)) target.searchParams.set(key, params.get(key))
}
location.replace(target)
