export function createMemberState({ readMember, onReset, onMember, onPending }) {
  let userId = null
  let revision = 0
  let member = null
  let resolved = false
  let pending = null

  function update(session, knownMember = null, force = false) {
    const user = session?.user
    if ((user?.id ?? null) !== userId) {
      userId = user?.id ?? null
      ++revision
      pending = null
      member = null
      resolved = false
      onReset()
    }
    if (!user) return Promise.resolve(null)
    if (knownMember?.public_id) {
      ++revision
      pending = null
      resolved = true
      member = knownMember
      onMember(user, member)
      return Promise.resolve(member)
    }
    if (pending) return pending
    if (resolved && !force) return Promise.resolve(member)
    const current = ++revision
    onPending()
    pending = Promise.resolve().then(readMember).then(value => {
      if (current !== revision) return null
      member = value?.public_id ? value : null
      resolved = true
      if (member) onMember(user, member)
      else onReset()
      return member
    }).catch(() => {
      if (current === revision) {
        member = null
        resolved = false
        onReset()
      }
      return null
    }).finally(() => {
      if (current === revision) pending = null
    })
    return pending
  }

  return { update, get member() { return member } }
}
