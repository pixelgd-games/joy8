import { safeReturnPath } from "./service.js"

export function createGameEntry({ origin, membership, openMember, navigate }) {
  let pending = false

  return async ({ trigger, next, gameName }) => {
    const path = safeReturnPath(next, origin)
    if (pending || (next != null && path === "/")) return
    pending = true
    trigger?.setAttribute("aria-busy", "true")
    try {
      if (next == null) {
        await openMember(trigger)
        return
      }
      const member = await membership()
      if (member) navigate(path)
      else await openMember(trigger, { next: path, gameName })
    } finally {
      pending = false
      trigger?.removeAttribute("aria-busy")
    }
  }
}
