import { mkdir, readFile, writeFile } from "node:fs/promises"

export async function expectMailbox(client, appPort) {
  const evaluate = async expression => {
    const result = await client.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression })
    if (result.exceptionDetails) throw new Error(`Mailbox browser check: ${JSON.stringify(result.exceptionDetails)}`)
    return result.result.value
  }
  const start = async page => {
    await client.send("Page.navigate", { url: `http://127.0.0.1:${appPort}/canonical-host.js?mailbox=${page}` })
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`location.search === '?mailbox=${page}' && document.readyState === 'complete'`)) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const html = await readFile(new URL(`../${page}/index.html`, import.meta.url), "utf8")
    await evaluate(`document.body.innerHTML = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html').body.innerHTML`)
    await evaluate(`const viewport = document.createElement('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width,initial-scale=1'; document.head.append(viewport); document.documentElement.lang = 'zh-Hant'`)
  }
  const screenshot = async name => {
    if (process.env.JOY8_MAILBOX_SCREENSHOTS !== "1") return
    const directory = new URL("../.mailbox-preview.local/", import.meta.url)
    await mkdir(directory, { recursive: true })
    const { data } = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })
    await writeFile(new URL(`${name}.png`, directory), Buffer.from(data, "base64"))
  }
  await start("admin/mail")
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false })
  await evaluate(`(${async function () {
    const { supabase } = await import("/src/lib/supabaseClient.js")
    const tick = () => new Promise(resolve => setTimeout(resolve, 0))
    const check = (value, message) => { if (!value) throw new Error(message) }
    const state = window.mailFixture = { mail: null, calls: [], pending: null }
    supabase.auth.getSession = async () => ({ data: { session: { user: { id: "admin" } } }, error: null })
    supabase.auth.onAuthStateChange = callback => { state.authChange = callback }
    supabase.rpc = async () => ({ data: true, error: null })
    Object.defineProperty(supabase, "functions", { configurable: true, value: {} })
    supabase.from = () => ({ select: () => ({ order: async () => ({ data: [{ id: "game", name: "16 張麻將", slug: "mahjong" }] }) }) })
    supabase.functions.invoke = async (_route, { body: { action, request } }) => {
      state.calls.push({ action, request })
      if (action === "prepare") {
        state.mail = { ...request, status: "draft", created_by: "admin", recipient_count: 1, total_amount: "500", created_at: new Date().toISOString() }
        return { data: state.mail }
      }
      if (action === "send") return new Promise(resolve => { state.pending = resolve })
      if (action === "list") return { data: { items: state.mail ? [{ ...state.mail, read_count: 0, claim_count: 0 }] : [] } }
      if (action === "recipients") return { data: { items: [{ public_id: "482731", read_at: null, claimed_at: null, transaction_id: null }] } }
      throw new Error("Unexpected mock action")
    }
    await import("/src/admin/mail.js")
    for (let i = 0; i < 20 && document.querySelector("#fields").disabled; i++) await tick()
    check(!document.querySelector("#fields").disabled, "Admin form did not load")
    const form = document.querySelector("#compose")
    const values = { kind: "compensation", audience: "player", public_id: "482731", game_id: "game", title: "牌局異常補償通知", body: "親愛的玩家：\n我們已確認你回報的牌局異常，本次補回 500 POINT。\n感謝你的耐心等候，祝你遊戲愉快！", amount: "500", source_ref: "CS-20260926-001" }
    for (const [key, value] of Object.entries(values)) { form.elements.namedItem(key).value = value; form.elements.namedItem(key).dispatchEvent(new Event("change")) }
    form.requestSubmit()
    await tick(); await tick()
    check(document.querySelector("#preview").textContent.includes("Player 482731"), "Preview lacks player ID")
    check(state.calls.filter(call => call.action === "send").length === 0, "Preview sent automatically")
    let send = document.querySelector("#preview .mail-primary")
    send.click(); send.click()
    check(state.calls.filter(call => call.action === "send").length === 1 && send.disabled, "Duplicate send allowed")
    state.pending({ error: { context: Response.json({ error: "temporary" }) } })
    await tick(); await tick()
    check(!send.disabled, "Send failure prevented explicit retry")
    send.click()
    check(state.calls.filter(call => call.action === "send").every(call => call.request.id === state.mail.id), "Retry changed mail identity")
    state.mail.status = "sent"; state.mail.sent_at = new Date().toISOString()
    state.pending({ data: state.mail })
    await tick(); await tick()
    check(!document.querySelector("#preview .mail-primary"), "Sent draft still offers send")
    document.querySelector("#preview button").click()
    await tick()
    check(document.querySelector("#recipients").textContent.includes("482731"), "Recipient audit did not load")
    check(document.querySelector("#previous").disabled && document.querySelector("#next").disabled, "Pagination was incorrectly enabled")
    return true
  }.toString()})()`)
  await screenshot("admin-desktop")
  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  if (!(await evaluate("document.documentElement.scrollWidth <= innerWidth"))) throw new Error("Admin mailbox overflows mobile viewport")
  await screenshot("admin-mobile")
  await evaluate("mailFixture.authChange('SIGNED_OUT', null); if (!document.querySelector('#fields').disabled || document.querySelector('#history').children.length) throw new Error('Admin data survived logout')")

  await start("mailbox")
  await evaluate(`(${async function () {
    const { memberSupabase } = await import("/src/lib/memberClient.js")
    const tick = () => new Promise(resolve => setTimeout(resolve, 0))
    const check = (value, message) => { if (!value) throw new Error(message) }
    const state = window.mailFixture = { calls: [], pending: null, session: { user: { id: "player" } } }
    const mail = { id: "mail", kind: "compensation", title: "牌局異常補償通知", body: "親愛的玩家：\n我們已確認你回報的牌局異常，本次補回 500 POINT。\n請先完成目前的牌局，再領取補償。", amount: "500", game_name: "16 張麻將", sent_at: new Date().toISOString(), read_at: null, claimed_at: null }
    memberSupabase.auth.getSession = async () => ({ data: { session: state.session } })
    memberSupabase.auth.onAuthStateChange = callback => { state.authChange = callback }
    Object.defineProperty(memberSupabase, "functions", { configurable: true, value: {} })
    memberSupabase.functions.invoke = async (_route, { body: { action, request } }) => {
      state.calls.push({ action, request })
      if (action === "list") return { data: { items: [mail], unread: mail.read_at ? 0 : 1 } }
      if (action === "read") return { data: { id: mail.id, read_at: new Date().toISOString() } }
      if (action === "claim") return new Promise(resolve => { state.pending = resolve })
      throw new Error("Unexpected member action")
    }
    await import("/src/mailbox/page.js")
    await tick(); await tick()
    document.querySelector("#mail-list button").click()
    await tick()
    check(state.calls.every(call => call.action !== "claim"), "Opening mail auto-claimed reward")
    const claim = document.querySelector("#detail button")
    claim.click(); claim.click()
    check(state.calls.filter(call => call.action === "claim").length === 1 && claim.disabled, "Duplicate claim allowed")
    state.pending({ error: { context: Response.json({ error: "JOY8_WALLET_OCCUPIED" }) } })
    await tick(); await tick()
    check(!claim.disabled && document.querySelector("#detail").textContent.includes("完成目前的牌局"), "Busy wallet was not recoverable")
    claim.click()
    state.pending({ data: { id: mail.id, claimed_at: new Date().toISOString(), amount: "500" } })
    await tick(); await tick()
    check(claim.disabled && claim.textContent === "已領取", "Successful claim stayed active")
    const { renderMailDetail } = await import("/src/mailbox/service.js")
    const probe = document.createElement("div")
    renderMailDetail(probe, { ...mail, title: '<img src=x onerror="alert(1)">', body: "<script>alert(1)</script>" })
    check(!probe.querySelector("img,script") && probe.textContent.includes("<script>"), "Mail content rendered as executable HTML")
    return true
  }.toString()})()`)
  if (!(await evaluate("document.documentElement.scrollWidth <= innerWidth"))) throw new Error("Player mailbox overflows mobile viewport")
  await screenshot("player-mobile")
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await screenshot("player-desktop")
  await evaluate("mailFixture.session = null; mailFixture.authChange('SIGNED_OUT', null)")
  await new Promise(resolve => setTimeout(resolve, 50))
  if (!(await evaluate("!document.querySelector('#mail-list').children.length && !document.querySelector('#detail button') && !document.querySelector('#login').hidden"))) throw new Error("Player mailbox leaked data after logout")
  console.log("OK Mailbox UI previews before sending, retries same message, audits recipients, separates read/claim, blocks duplicates, clears logout, escapes HTML and fits mobile")
}
