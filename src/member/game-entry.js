import { safeReturnPath } from "./service.js"
import { prepareGameEntry } from "./game-visit.js"

export function createGameEntry({ origin, membership, openMember, navigate }) {
  let pending = false

  return async ({ trigger, next, gameName, cover = "" }) => {
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
      if (member) {
        prepareGameEntry(path)
        navigate(path)
      } else await openMember(trigger, { next: path, gameName, cover })
    } finally {
      pending = false
      trigger?.removeAttribute("aria-busy")
    }
  }
}
