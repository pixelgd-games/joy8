export async function expectLobbyRecovery(client, appPort) {
  const evaluate = async expression => {
    const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await client.send("Page.navigate", { url: `http://127.0.0.1:${appPort}/canonical-host.js?lobby-recovery` })
  for (let i = 0; i < 80; i++) {
    if (await evaluate("location.search === '?lobby-recovery' && document.readyState === 'complete'")) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await evaluate(`(${async function () {
    const check = (value, message) => { if (!value) throw new Error(message) }
    const tick = () => new Promise(resolve => setTimeout(resolve, 0))
    const { createMailSheet } = await import("/src/pages/lobby/mail-sheet.js")
    const calls = []
    let finish
    const rows = Array.from({ length: 45 }, (_, index) => ({ id: String(index), title: `Mail ${index}`, body: "Body", kind: "notification", amount: "0", read_at: "2026-09-30" }))
    const sheet = createMailSheet({ api: async (_action, { offset }) => {
      calls.push(offset)
      if (offset === 20 && calls.length === 2) return new Promise((resolve, reject) => { finish = () => reject(new Error("Network failure")) })
      return { items: rows.slice(offset, offset + 21), unread: 0 }
    }, toast() {}, onUnread() {}, onClaimed() {} })
    await sheet.refreshUnread()
    sheet.open()
    await tick()
    const dialog = document.querySelector(".sheet--mail")
    const more = dialog.querySelector("[data-mail=more]")
    check(calls.length === 1, "Opening discarded the fresh unread/list response")
    more.click()
    more.click()
    check(calls.length === 2, "Pagination admitted duplicate requests")
    finish()
    await tick()
    check(dialog.querySelectorAll(".mail-item").length === 20 && !more.hidden, "Pagination failure lost the list or retry")
    more.click()
    await tick()
    check(JSON.stringify(calls) === "[0,20,20]" && dialog.querySelectorAll(".mail-item").length === 40, "Retry skipped a page")
    sheet.reset()
    dialog.remove()

    let finishRead, unread
    const reward = { ...rows[0], amount: "500", read_at: null }
    const claiming = createMailSheet({ api: async action => {
      if (action === "list") return { items: [reward], unread: 1 }
      if (action === "read") return new Promise(resolve => { finishRead = resolve })
      return { claimed_at: "2026-09-30" }
    }, toast() {}, onUnread(value) { unread = value }, onClaimed() {} })
    claiming.open()
    await tick()
    document.querySelector(".mail-item").click()
    document.querySelector(".mail-reward button").click()
    await tick()
    check(unread === 0, "Claim completing before read retained unread count")
    finishRead({ read_at: "2026-09-30" })
    await tick()
    check(unread === 0, "Late read changed the claimed unread count")
    claiming.reset()
    document.querySelector(".sheet--mail").remove()

    const { memberSupabase } = await import("/src/lib/memberClient.js")
    const { catalogSupabase } = await import("/src/lib/catalogClient.js")
    let identity = "A", authChanged, resolveWallet
    let apiCalls = []
    memberSupabase.auth.getSession = async () => ({ data: { session: { user: { id: identity, email: `${identity}@example.test` } } } })
    memberSupabase.auth.onAuthStateChange = callback => { authChanged = callback }
    Object.defineProperty(memberSupabase, "functions", { configurable: true, value: { invoke: async (route, { body }) => {
      apiCalls.push(route)
      if (route.endsWith("/member")) return { data: { member: { public_id: identity === "A" ? "111111" : "222222" } } }
      if (route.endsWith("/wallet")) {
        if (identity === "A") return new Promise(resolve => { resolveWallet = resolve })
        return { data: { wallet: { balance: "2000" } } }
      }
      if (body.action === "list") return { data: { items: [{ ...rows[0], title: `Private ${identity}`, body: `Body ${identity}` }], unread: 0 } }
      throw new Error("Unexpected request")
    } } })
    catalogSupabase.from = () => ({ select: () => ({ order: () => ({ order: async () => ({ data: [] }) }) }) })
    document.body.innerHTML = '<div id="app"></div>'
    const { initLobbyPage } = await import("/src/pages/lobby/index.js")
    await initLobbyPage(document.getElementById("app"))
    authChanged("INITIAL_SESSION", { user: { id: identity } })
    await tick(); await tick()
    document.querySelector('.topbar [data-action="mail"]').click()
    await tick()
    document.querySelector(".mail-item").click()
    check(document.querySelector(".mail-detail").textContent.includes("Private A"), "Initial mail did not open")
    identity = "B"
    authChanged("SIGNED_IN", { user: { id: identity } })
    check(!document.querySelector(".sheet--mail").open && !document.querySelector(".mail-detail").textContent, "Identity switch retained private mail")
    await tick(); await tick()
    resolveWallet({ data: { wallet: { balance: "9999" } } })
    await tick()
    check(document.querySelector("[data-wallet]").textContent === "2,000", "Old wallet response overwrote the new user")
    window.dispatchEvent(new CustomEvent("joy8:membership", { detail: { auth_user_id: "A", public_id: "111111" } }))
    await tick()
    check(document.querySelector("[data-player-name]").textContent === "Player 222222", "Late enrollment restored a previous account")
    apiCalls = []
    authChanged("SIGNED_IN", { user: { id: identity } })
    await tick(); await tick()
    check(apiCalls.length === 0, "Same-user sign-in repeated requests")
    authChanged("SIGNED_OUT", null)
    check(document.querySelector("[data-wallet]").textContent === "—", "Sign-out retained wallet")
  }.toString()})()`)
  console.log("OK Lobby clears switched identities and stale replies; mailbox reuses reads and retries the same page without losing rows")
}
