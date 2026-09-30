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

  const playerFlow = async layout => {
    const mobile = layout === "mobile"
    await client.send("Emulation.setUserAgentOverride", { ...(mobile ? { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36", userAgentMetadata: { platform: "Android", platformVersion: "14", architecture: "", model: "Pixel 8", mobile: true } } : { userAgent: "" }) })
    await client.send("Emulation.setDeviceMetricsOverride", mobile ? { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } : { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
    await client.send("Page.navigate", { url: `http://127.0.0.1:${appPort}/` })
    for (let i = 0; i < 80; i++) {
      if (await evaluate("Boolean(document.querySelector('#gameGrid .empty-state, #gameGrid .card'))")) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return evaluate(`(${async function (layout) {
      const { memberSupabase } = await import("/src/lib/memberClient.js")
      const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))
      const check = (value, message) => { if (!value) throw new Error(message) }
      const $ = selector => document.querySelector(selector)
      const user = { id: "player", email: "player@example.test", created_at: "2026-09-28T02:00:00Z" }
      const state = window.mailFixture = { calls: [], pending: null, balance: "1200.00" }
      const mail = { id: "mail", kind: "compensation", title: '牌局異常補償通知<img src=x onerror="window.injected=1">', body: "親愛的玩家：\n我們已確認你回報的牌局異常，本次補回 500 POINT。<script>window.injected=1</script>", amount: "500", game_name: "16 張麻將", sent_at: new Date().toISOString(), read_at: null, claimed_at: null }
      memberSupabase.auth.getSession = async () => ({ data: { session: { user } }, error: null })
      Object.defineProperty(memberSupabase, "functions", { configurable: true, value: {} })
      memberSupabase.functions.invoke = async (route, { body }) => {
        state.calls.push({ route, body })
        if (route.endsWith("/member")) return { data: { member: { player_account_ref: "fixture-player", public_id: "482731", account_type: "registered" } } }
        if (route.endsWith("/wallet")) return { data: { wallet: { currency: "POINT", status: "active", balance: state.balance, available_balance: state.balance } } }
        const { action, request } = body
        if (action === "list") return { data: { items: [mail], unread: mail.read_at ? 0 : 1, offset: request.offset } }
        if (action === "read") return { data: { id: mail.id, read_at: new Date().toISOString() } }
        if (action === "claim") return new Promise(resolve => { state.pending = resolve })
        throw new Error("Unexpected member action")
      }
      window.dispatchEvent(new CustomEvent("joy8:membership", { detail: { auth_user_id: user.id, player_account_ref: "fixture-player", public_id: "482731", account_type: "registered" } }))
      for (let i = 0; i < 40 && $("[data-wallet]").textContent !== "1,200"; i++) await wait(25)
      check(document.documentElement.dataset.auth === "member", "Member state did not apply")
      check($("[data-wallet]").textContent === "1,200", "Wallet balance was not shown")
      check($("[data-unread]").textContent === "1" && !$("[data-unread]").hidden, "Unread badge was not shown")
      check(!$(".member-login-link").checkVisibility(), "Login button stayed visible for a member")
      if (layout === "pc") check($("[data-player-name]").textContent === "Player 482731", "Player ID missing from top bar")
      $(".account").click()
      check(!$("#memberProfile").hidden && $("#memberProfile").textContent.includes("482731") && $("#memberProfile").textContent.includes("p***@example.test"), "Member card did not open")
      document.body.click()
      check($("#memberProfile").hidden, "Member card did not close on outside click")

      $('.topbar [data-action="mail"]').click()
      for (let i = 0; i < 40 && !$(".mail-item"); i++) await wait(25)
      const sheet = $(".sheet--mail")
      check(sheet.open && $(".mail-item"), "Mailbox drawer did not list mail")
      check(!document.querySelector(".sheet--mail img") && !window.injected && $(".mail-item__title").textContent.includes("<img"), "Mail list rendered HTML")
      await wait(400)
      const bounds = sheet.getBoundingClientRect()
      const placed = layout === "pc" ? Math.abs(bounds.right - innerWidth) <= 1 && bounds.width <= 440 : Math.abs(bounds.bottom - innerHeight) <= 1 && bounds.width <= innerWidth
      check(placed, `Mailbox drawer misplaced: ${JSON.stringify(bounds)}`)
      $(".mail-item").click()
      await wait()
      check(state.calls.every(call => call.body.action !== "claim"), "Opening mail auto-claimed reward")
      check(!document.querySelector(".mail-detail img, .mail-detail script") && $(".mail-detail__body").textContent.includes("<script>"), "Mail detail rendered HTML")
      await wait(20)
      check($("[data-unread]").hidden, "Read mail kept the unread badge")
      const claim = $(".mail-reward .btn")
      claim.click(); claim.click()
      check(state.calls.filter(call => call.body.action === "claim").length === 1 && claim.disabled, "Duplicate claim allowed")
      state.pending({ error: { context: Response.json({ error: "JOY8_WALLET_OCCUPIED" }) } })
      await wait(); await wait()
      check(!claim.disabled && $(".mail-detail").textContent.includes("完成目前的牌局"), "Busy wallet was not recoverable")
      claim.click()
      state.balance = "1700.00"
      state.pending({ data: { id: mail.id, claimed_at: new Date().toISOString(), amount: "500" } })
      await wait(); await wait()
      check(claim.disabled && claim.textContent === "已領取", "Successful claim stayed active")
      for (let i = 0; i < 60 && $("[data-wallet]").textContent !== "1,700"; i++) await wait(25)
      check($("[data-wallet]").textContent === "1,700", "Wallet did not refresh after claim")
      $('[data-mail="back"]').click()
      check($(".mail-item__chip").textContent === "已領取", "Claimed mail still shows a reward chip")
      check(document.documentElement.scrollWidth <= innerWidth, "Lobby overflows the viewport")
      return true
    }.toString()})(${JSON.stringify(layout)})`)
  }
  await playerFlow("mobile")
  await screenshot("player-mobile")
  await client.send("Emulation.setUserAgentOverride", { userAgent: "" })
  await playerFlow("pc")
  await screenshot("player-desktop")
  await evaluate(`(${async function () {
    document.querySelector(".sheet--mail").close()
    document.querySelector(".account").click()
    document.querySelector('#memberProfile [data-action="logout"]').click()
    for (let i = 0; i < 40 && document.documentElement.dataset.auth !== "guest"; i++) await new Promise(resolve => setTimeout(resolve, 25))
    if (document.documentElement.dataset.auth !== "guest") throw new Error("Logout kept the member state")
    const leaked = [...document.querySelectorAll("[data-wallet]")].map(node => node.textContent).filter(text => text !== "—").concat([...document.querySelectorAll(".mail-item")].map(node => node.textContent))
    if (leaked.length) throw new Error(`Member data survived logout: ${JSON.stringify(leaked)}`)
    return true
  }.toString()})()`)
  await client.send("Emulation.clearDeviceMetricsOverride")
  console.log("OK Mailbox admin previews before sending and audits recipients; Lobby member card, wallet, drawer read/claim, duplicate block, wallet refresh, HTML escaping, layouts and logout")
}
