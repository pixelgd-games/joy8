const callbackKeys = ["flow", "provider", "code", "error", "error_code"]

export function forwardCallback(params, target) {
  const callback = new URLSearchParams()
  for (const key of callbackKeys) {
    if (params.has(key)) callback.set(key, params.get(key))
  }
  target.hash = callback.toString()
  return target
}

export function readEntryParams(location, history) {
  const params = new URLSearchParams(location.search)
  const callback = new URLSearchParams(location.hash.slice(1))
  for (const key of callbackKeys) {
    if (callback.has(key)) params.set(key, callback.get(key))
  }
  if (callback.has("code") || callback.has("error") || callback.has("error_code")) {
    history.replaceState(null, "", `${location.pathname}${location.search}`)
  }
  return params
}
