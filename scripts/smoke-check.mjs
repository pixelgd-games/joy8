import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"
import http from "node:http"
import net from "node:net"
import { fileURLToPath } from "node:url"
import WebSocket from "ws"
import { expectMailbox } from "./mailbox-browser-check.mjs"
import { expectAllowlistAdmin } from "./allowlist-browser-check.mjs"
import { expectProductionCsp } from "./production-csp-check.mjs"
import { expectLobbyRecovery } from "./lobby-regression-check.mjs"

const cwd = fileURLToPath(new URL("..", import.meta.url))
const host = "127.0.0.1"
const cdpTimeoutMs = 8000

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm"
const viteBin = path.join(cwd, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite")
const smokeEnv = { ...process.env,
  VITE_SUPABASE_URL: "https://lsazydefvnuqglultqii.supabase.co",
  VITE_SUPABASE_ANON_KEY: "sb_publishable_joy8_smoke_only",
}

let devServer
let browser

try {
  console.log("Running build...")
  runBuild()
  verifySecurityHeaders()
  verifyCanonicalHostRedirect()

  const appPort = await getFreePort()
  const cdpPort = await getFreePort()
  console.log(`Starting Vite on ${appPort}...`)
  devServer = startDevServer(appPort)
  await waitForHttp(`http://${host}:${appPort}/`)

  const browserPath = findBrowser()
  console.log(`Starting browser on ${cdpPort}...`)
  browser = await startBrowser(browserPath, cdpPort)
  await waitForHttp(`http://${host}:${cdpPort}/json/version`)
  console.log("Opening browser client...")
  const client = await openBrowserClient(cdpPort)
  await client.send("Page.enable")
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    const smokeFetch = window.fetch;
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url || input.href, location.origin);
      if (!url.hostname.endsWith('.supabase.co')) return smokeFetch(input, options);
      if (url.pathname === '/rest/v1/public_games_v1') return Promise.resolve(Response.json(JSON.parse(localStorage.getItem('joy8-smoke-catalog') || '[]')));
      return Promise.resolve(Response.json({error:'Smoke external request blocked'}, {status:403}));
    };
  ` })

  await expectPageText(client, appPort, "/", (text) => {
    const normalizedText = text.toLowerCase()
    return normalizedText.includes("joy8")
      && normalizedText.includes("全部遊戲")
      && normalizedText.includes("最新公告")
      && !normalizedText.includes("遊戲列表讀取失敗")
  }, "Home loads")

  await expectLobbyLayouts(client, appPort)
  await expectMemberModal(client)
  await expectGameSelection(client, appPort)
  await expectMemberContinuation(client)

  await expectLaunchUrlPolicy(client)
  await expectGameIframeSecurity(client)
  await expectLobbyThumbnailFallback(client)
  await expectPrivateEntry(client, appPort)

  await expectPageText(client, appPort, "/game/", (text) => {
    return text.includes("JOY8-GAME-001")
  }, "Loader missing slug shows error")

  await expectMemberEntry(client, appPort)

  await expectPageText(client, appPort, "/admin/login/", (text) => {
    return text.includes("Joy8 Admin") && text.includes("Google")
  }, "Admin login loads")
  await expectPageText(client, appPort, "/canonical-host.js", text => text.includes("joy8.pages.dev"), "Isolated browser fixture loads")
  await expectAdminFormSafety(client)
  await expectGatewayCors(client)

  await showSyntheticError(client)
  await waitForText(client, (text) => {
    return text.includes("JOY8-SMOKE-001") && text.includes("Smoke test error modal")
  }, "Shared error modal shows code")
  await expectErrorPresentation(client)
  await expectMailbox(client, appPort)
  await expectAllowlistAdmin(client, appPort)
  await expectPageText(client, appPort, "/account/?error=access_denied&error_description=JOY8_EMAIL_NOT_ALLOWED&provider=google&flow=signin", text => text.includes("尚未開放") && text.includes("白名單 Google"), "Signup-hook rejection survives the Auth trampoline")

  await expectLobbyRecovery(client, appPort)
  await expectProductionCsp(client, cwd)
  client.ws.close()
  console.log("Smoke check passed.")
} finally {
  await stopBrowser(browser)
  stopProcess(devServer)
}

function runBuild() {
  const result = spawnSync(npmCmd, ["run", "build", "--", "--mode", "smoke"], {
    cwd,
    env: smokeEnv,
    stdio: "inherit",
    shell: process.platform === "win32",
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`Build failed with status ${result.status}.`)
  }
}

function verifySecurityHeaders() {
  const headers = readFileSync(path.join(cwd, ".smoke-dist.local", "_headers"), "utf8")
  for (const expected of [
    "Content-Security-Policy: frame-ancestors 'none'",
    "X-Frame-Options: DENY",
    "X-Content-Type-Options: nosniff",
    "Referrer-Policy: no-referrer", "script-src 'self'", "object-src 'none'", "base-uri 'none'",
  ]) {
    if (!headers.includes(expected)) throw new Error(`Missing production security header: ${expected}`)
  }
  console.log("OK Production security headers")
}

function verifyCanonicalHostRedirect() {
  const script = readFileSync(path.join(cwd, ".smoke-dist.local", "canonical-host.js"), "utf8")
  if (!script.includes('location.hostname === "joy8.pages.dev"') || !script.includes('"https://joy8.cc"')) {
    throw new Error("Missing canonical-host redirect script")
  }
  const entryFiles = [
    "index.html",
    "account/index.html",
    "admin/mail/index.html",
    "admin/login/index.html",
    "admin/games/index.html",
    "admin/games/new/index.html",
    "admin/games/edit/index.html",
    "game/index.html",
    "play-test/index.html",
  ]
  for (const entryFile of entryFiles) {
    const html = readFileSync(path.join(cwd, ".smoke-dist.local", entryFile), "utf8")
    if (!html.includes('src="/canonical-host.js"')) {
      throw new Error(`Missing canonical-host redirect: ${entryFile}`)
    }
  }
  console.log("OK Canonical production-host redirect")
}

function startDevServer(port) {
  const server = spawn(viteBin, [
    "--host",
    host,
    "--port",
    String(port),
    "--strictPort",
  ], {
    cwd,
    env: smokeEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  })

  server.stdout.on("data", (chunk) => {
    process.stdout.write(chunk)
  })
  server.stderr.on("data", (chunk) => {
    process.stderr.write(chunk)
  })

  return server
}

async function startBrowser(browserPath, cdpPort) {
  const profile = await mkdtemp(path.join(tmpdir(), "joy8-smoke-browser-"))
  const instance = spawn(browserPath, [
    "--headless",
    "--disable-gpu",
    "--disable-extensions",
    "--no-default-browser-check",
    "--no-first-run",
    "--remote-allow-origins=*",
    `--remote-debugging-address=${host}`,
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], {
    stdio: "ignore",
    shell: false,
  })

  return { instance, profile }
}

async function openBrowserClient(cdpPort) {
  const versionResponse = await fetchWithTimeout(`http://${host}:${cdpPort}/json/version`)
  if (!versionResponse.ok) {
    throw new Error(`Cannot read browser version: ${versionResponse.status}`)
  }

  const version = await versionResponse.json()
  const ws = new WebSocket(version.webSocketDebuggerUrl)

  await waitForWebSocketOpen(ws)

  let id = 0
  let targetMessageId = 0
  const pending = new Map()
  const targetPending = new Map()

  ws.on("message", async (data) => {
    const message = JSON.parse(await readWebSocketData(data))
    if (message.method === "Target.receivedMessageFromTarget") {
      const targetMessage = JSON.parse(message.params.message)
      if (!targetMessage.id || !targetPending.has(targetMessage.id)) return

      const { resolve, reject, timeout } = targetPending.get(targetMessage.id)
      targetPending.delete(targetMessage.id)
      clearTimeout(timeout)

      if (targetMessage.error) {
        reject(new Error(targetMessage.error.message))
      } else {
        resolve(targetMessage.result || {})
      }
      return
    }

    if (!message.id || !pending.has(message.id)) return

    const { resolve, reject, timeout } = pending.get(message.id)
    pending.delete(message.id)
    clearTimeout(timeout)

    if (message.error) {
      reject(new Error(message.error.message))
    } else {
      resolve(message.result || {})
    }
  })

  const sendRaw = (method, params = {}, sessionId = null) => {
    return new Promise((resolve, reject) => {
      const callId = ++id
      const timeout = setTimeout(() => {
        pending.delete(callId)
        reject(new Error(`CDP call timed out: ${method}`))
      }, cdpTimeoutMs)

      pending.set(callId, { resolve, reject, timeout })
      ws.send(JSON.stringify({
        id: callId,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }))
    })
  }

  const { targetId } = await sendRaw("Target.createTarget", { url: "about:blank" })
  const { sessionId } = await sendRaw("Target.attachToTarget", {
    targetId,
  })
  const send = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const callId = ++targetMessageId
      const timeout = setTimeout(() => {
        targetPending.delete(callId)
        reject(new Error(`CDP target call timed out: ${method}`))
      }, cdpTimeoutMs)

      targetPending.set(callId, { resolve, reject, timeout })
      sendRaw("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({ id: callId, method, params }),
      }).catch((error) => {
        targetPending.delete(callId)
        clearTimeout(timeout)
        reject(error)
      })
    })
  }

  return { ws, send }
}

async function readWebSocketData(data) {
  if (typeof data === "string") return data

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8")
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8")
  }

  if (typeof data?.text === "function") {
    return data.text()
  }

  return String(data)
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out opening browser WebSocket."))
    }, cdpTimeoutMs)

    const handleOpen = () => {
      cleanup()
      resolve()
    }

    const handleError = () => {
      cleanup()
      reject(new Error("Browser WebSocket failed to open."))
    }

    const cleanup = () => {
      clearTimeout(timeout)
      ws.off("open", handleOpen)
      ws.off("error", handleError)
    }

    ws.once("open", handleOpen)
    ws.once("error", handleError)
  })
}

async function expectPageText(client, appPort, route, predicate, label) {
  await client.send("Page.navigate", {
    url: `http://${host}:${appPort}${route}`,
  })

  await waitForText(client, predicate, label)
}

async function showSyntheticError(client) {
  await client.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `
      import("/src/ui/error-modal.js").then(({ showErrorModal }) => {
        showErrorModal({
          code: "JOY8-SMOKE-001",
          title: "Smoke test error",
          message: "Smoke test error modal",
          reload: false,
        })
      })
    `,
  })
}

async function expectPrivateEntry(client, appPort) {
  await expectPageText(client, appPort, "/play-test/?slug=mahjong-clash", text => text.includes("進入測試"), "Private entry waits for explicit start")
  const bar = await client.send("Runtime.evaluate", { awaitPromise:true, returnByValue:true, expression:`(async () => {
    const confirm = document.querySelector(".game-confirm")
    document.querySelector('.game-bar [data-bar="home"]').click()
    const asked = confirm.open
    confirm.querySelector('[value="stay"]').click()
    await new Promise(resolve => setTimeout(resolve, 50))
    return { asked, closed: !confirm.open, path: location.pathname, fullscreen: Boolean(document.querySelector('.game-bar [data-bar="fullscreen"]')), loaderTop: document.getElementById("loading").getBoundingClientRect().top >= document.querySelector(".game-bar").getBoundingClientRect().bottom - 1 }
  })()` })
  if (!bar.result.value.asked || !bar.result.value.closed || bar.result.value.path !== "/play-test/" || !bar.result.value.fullscreen || !bar.result.value.loaderTop) throw new Error(`Game top bar failed: ${JSON.stringify(bar.result.value)}`)
  console.log("OK Game top bar asks before leaving and keeps the loader below it")
  await client.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `import("/src/lib/memberClient.js").then(({memberSupabase}) => {
      memberSupabase.auth.getSession = async () => ({data:{session:{user:{id:"fixture"}}},error:null})
      window.privateAllowed=false
      window.privateCalls=[]
      Object.defineProperty(memberSupabase,"functions",{configurable:true,value:{invoke:async (route,args) => {
        window.privateCalls.push({route,args})
        if(route.endsWith("/member")) return {data:{member:{player_account_ref:"fixture-player",account_type:"registered"}},error:null}
        if(!window.privateAllowed) return {data:null,error:new Error("denied")}
        return {data:{session_id:"fixture-session",game_id:"fixture-game",protocol:"server-v1",currency:"POINT",game_name:"Private fixture",launch_code:"fixture-only-code",launch_url:location.origin+"/icons/joy8-app-icon-192.png"},error:null}
      }}})
      document.getElementById("private-start").click()
    })`,
  })
  await waitForText(client, text => text.includes("目前無法載入遊戲，請稍後再試。"), "Test entry failure remains recoverable")
  const denied = await client.send("Runtime.evaluate", { returnByValue:true, expression:'document.querySelectorAll("iframe").length===0 && !document.getElementById("private-start").disabled' })
  if (!denied.result.value) throw new Error("Private denial mounted a game or blocked retry")
  await client.send("Runtime.evaluate", { expression:`window.privateTimer=window.setTimeout;
    window.setTimeout=(fn,ms,...args)=>window.privateTimer(fn,ms===30000?500:ms,...args);
    window.privateAllowed=true;document.getElementById("private-start").click()` })
  await waitForText(client, () => true, "Private retry dispatched")
  const launched = await client.send("Runtime.evaluate", { awaitPromise:true, returnByValue:true, expression:`new Promise(resolve=>setTimeout(()=>{
    const iframe=document.querySelector("iframe")
    const url=iframe && new URL(iframe.src)
    resolve(Boolean(url && ![...url.searchParams.keys()].some(key=>key.startsWith("joy8_"))
      && !iframe.src.includes("fixture-only-code") && !url.searchParams.has("access_token") && iframe.referrerPolicy==="no-referrer"
      && window.privateCalls.filter(x=>x.route.endsWith("/private-session")).length===2
      && !JSON.stringify({...localStorage,...sessionStorage}).includes("fixture-only-code")))
  },100))` })
  if (!launched.result.value) throw new Error("Private entry did not preserve the Loader credential boundary")
  await waitForText(client, text => text.includes("遊戲連線未完成") && text.includes("JOY8-GAME-006"), "Missing game handshake shows a recoverable platform error")
  const timedOut = await client.send("Runtime.evaluate", { returnByValue:true, expression:'window.setTimeout=window.privateTimer;document.querySelectorAll("iframe").length===0' })
  if (!timedOut.result.value) throw new Error("Handshake timeout left the unauthenticated game mounted")
  console.log("OK Private entry, denied access, retry, shared iframe and in-memory launch credential")
}

async function expectErrorPresentation(client) {
  await client.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true })
  const result = await client.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const modal = document.querySelector(".joy8-error-modal")
      const dialog = document.querySelector(".joy8-error-dialog")
      const bounds = dialog.getBoundingClientRect()
      const positioned = getComputedStyle(modal).position === "fixed"
      document.documentElement.style.setProperty("--text", "rgb(23, 45, 67)")
      const shared = getComputedStyle(modal).color === "rgb(23, 45, 67)"
      document.documentElement.style.removeProperty("--text")
      dialog.querySelector("button").click()
      const closed = !document.querySelector(".joy8-error-modal") && !document.body.classList.contains("joy8-error-modal-open")
      return positioned && shared && bounds.left >= 0 && bounds.right <= innerWidth && closed
    })()`,
  })
  if (!result.result.value) throw new Error("Error modal theme, mobile layout or close action failed")
  for (const dismiss of [
    'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))',
    'document.querySelector(".joy8-error-modal").click()',
  ]) {
    await showSyntheticError(client)
    const dismissal = await client.send("Runtime.evaluate", { returnByValue: true, expression: `${dismiss}; !document.querySelector(".joy8-error-modal") && !document.body.classList.contains("joy8-error-modal-open")` })
    if (!dismissal.result.value) throw new Error("Error modal dismissal failed")
  }
  await client.send("Emulation.clearDeviceMetricsOverride")
  console.log("OK Shared error theme, mobile layout and close/button/overlay behavior")
}

async function expectMemberEntry(client, appPort) {
  await expectPageText(client, appPort, "/account/?next=%2Fgame%2F%3Fslug%3Dtest", (text) => {
    return text.includes("使用 Google 繼續") && text.includes("白名單")
  }, "Account entry returns to the Lobby member dialog")
  const returnCheck = await client.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `location.pathname === "/" && location.search === "" && document.querySelector("#member-dialog")?.open && document.querySelector(".hero")?.isConnected`,
  })
  if (!returnCheck.result.value) throw new Error("Account entry left a standalone page behind")
  const controls = await client.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const google = document.getElementById("google-button").getBoundingClientRect()


      return document.getElementById("account-title").textContent === "登入開始遊戲"
        && google.width > 0 && !document.getElementById("facebook-button")
        && !document.getElementById("guest-button")
        && !document.getElementById("email-form")
        && !document.getElementById("register-button")
        && !document.getElementById("reset-button")
        && !document.getElementById("new-password-form")
    })()`,
  })
  if (!controls.result.value) throw new Error("Retired email account controls remain visible")
  for (const width of [320, 390, 1280]) {
    await client.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 })
    const layout = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `document.documentElement.scrollWidth <= innerWidth && document.getElementById("google-button").getBoundingClientRect().width > 0 && !document.getElementById("guest-button")`,
    })
    if (!layout.result.value) throw new Error(`Member layout failed at ${width}px`)
    if (process.env.SMOKE_MEMBER_SCREENSHOT && width === 390) {
      const { data } = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })
      await writeFile(process.env.SMOKE_MEMBER_SCREENSHOT, Buffer.from(data, "base64"))
    }
  }
  await client.send("Emulation.clearDeviceMetricsOverride")
  console.log("OK Google-only member entry and responsive layout")
}

async function expectAdminFormSafety(client) {
  const result = await client.send("Runtime.evaluate", {
    awaitPromise: true, returnByValue: true,
    expression: `(async () => {
      const { supabase } = await import("/src/lib/supabaseClient.js")
      const tick = () => new Promise(resolve => setTimeout(resolve, 0))
      const check = (condition, message) => { if (!condition) throw new Error(message) }
      const writes = []
      let resolveRead, resolveWrite
      supabase.auth.getSession = async () => ({ data: { session: { user: { id: "test-admin" } } }, error: null })
      supabase.rpc = async name => ({ data: name === "joy8_game_readiness" ? [] : true, error: null })
      supabase.from = table => {
        check(table === "games", "Unexpected admin table")
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => new Promise(resolve => { resolveRead = resolve }) }) }),
          update: payload => ({ eq: (_, id) => ({ select: () => ({ single: () => { writes.push({ payload, id }); return new Promise(resolve => { resolveWrite = resolve }) } }) }) }),
          insert: payload => { writes.push({ payload }); return Promise.resolve({ error: { message: "Save rejected" } }) },
        }
      }
      const start = async (name, path) => {
        document.querySelector(".joy8-error-action")?.click()
        history.replaceState(null, "", path)
        document.body.innerHTML = '<div id="admin-form"></div>'
        resolveRead = null
        await import("/src/admin/game-form.js?smoke=" + name)
        await tick()
        return document.getElementById("gameForm")
      }
      const submit = form => form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }))
      for (const [name, result] of [
        ["read-error", { error: { message: "Read failed" }, data: null }],
        ["not-found", { error: null, data: null }],
      ]) {
        const form = await start(name, "/admin/games/edit/?id=test-game")
        check(form.querySelector("fieldset").disabled, "Form enabled before load")
        submit(form)
        resolveRead(result)
        await tick()
        document.querySelector(".joy8-error-action:last-child")?.click()
        document.getElementById("name").value = "Manual title"
        document.getElementById("slug").value = "test-game"
        submit(form)
        await tick()
        check(form.querySelector("fieldset").disabled && writes.length === 0, "Failed load allowed a write")
      }
      const form = await start("loaded", "/admin/games/edit/?id=test-game")
      resolveRead({ error: null, data: { name: "Original", slug: "test-game", thumbnail: "/games/test-game/cover.webp",
        type: "card", published: true, launch_url: "https://game.example/", sort_order: 7 } })
      await tick()
      check(!form.querySelector("fieldset").disabled, "Loaded form stayed disabled")
      document.getElementById("name").value = "Updated"
      submit(form)
      submit(form)
      await tick()
      check(writes.length === 1 && form.querySelector("fieldset").disabled, "Duplicate save was allowed")
      check(writes[0].payload.name === "Updated" && writes[0].payload.published === true
        && writes[0].payload.type === "card" && writes[0].payload.sort_order === 7
        && writes[0].payload.thumbnail === "/games/test-game/cover.webp"
        && writes[0].payload.launch_url === "https://game.example/", "Existing metadata was lost")
      resolveWrite({ error: { message: "Save rejected" } })
      await tick()
      check(!form.querySelector("fieldset").disabled, "Failed save prevented retry")
      document.querySelector(".joy8-error-action:last-child")?.click()
      submit(form)
      await tick()
      check(writes.length === 2, "Explicit retry did not run")
      resolveWrite({ error: null, data: null })
      await tick()
      check(location.pathname === "/admin/games/edit/" && document.querySelector(".joy8-error-title")?.textContent === "更新遊戲失敗", "Zero-row update was treated as success")
      const newForm = await start("new", "/admin/games/new/")
      check(!newForm.querySelector("fieldset").disabled, "New game form stayed disabled")
      history.replaceState(null, "", "/admin/login/")
      return true
    })()`,
  })
  if (result.exceptionDetails || !result.result.value) throw new Error(`Admin form safety failed: ${JSON.stringify(result.exceptionDetails)}`)
  console.log("OK Admin form rejects unloaded/missing data, preserves metadata, blocks duplicate saves and allows explicit retry")
}

async function expectGatewayCors(client) {
  const result = await client.send("Runtime.evaluate", {
    awaitPromise: true, returnByValue: true,
    expression: `(async () => {
      const original = { fetch: window.fetch, deno: window.Deno }
      let handler
      window.Deno = { env: { get: name => ({ SUPABASE_URL: "https://fixture.example", SUPABASE_SERVICE_ROLE_KEY: "test" })[name] }, serve: value => { handler = value } }
      try {
        await import("/supabase/functions/joy8-gateway/index.ts?cors-smoke")
        window.fetch = async () => Response.json(true)
        const request = new Request(location.origin + "/balance", { method: "POST", body: "{}" })
        Object.defineProperty(request, "headers", { value: new Headers({ Origin: location.origin, "Content-Type": "application/json" }) })
        const response = await handler(request)
        return Object.fromEntries(response.headers)
      } finally {
        window.fetch = original.fetch
        if (original.deno === undefined) delete window.Deno
        else window.Deno = original.deno
      }
    })()`,
  })
  if (result.exceptionDetails) throw new Error("Cannot capture Gateway CORS headers")
  const headers = result.result.value
  const server = http.createServer((request, response) => {
    response.writeHead(request.method === "OPTIONS" ? 204 : 429, { ...headers, "Retry-After": "60" })
    response.end(request.method === "OPTIONS" ? undefined : JSON.stringify({ error: "Too many requests" }))
  })
  await new Promise(resolve => server.listen(0, host, resolve))
  try {
    const check = await client.send("Runtime.evaluate", {
      awaitPromise: true, returnByValue: true,
      expression: `(async () => {
        const { getJoy8Balance } = await import("/packages/joy8-game-sdk/browser.js")
        try {
          await getJoy8Balance({ gatewayUrl: "http://${host}:${server.address().port}/joy8-gateway", gatewayToken: "fixture-token" })
          return false
        } catch (error) {
          return { status: error.status, retry: error.retryAfterSeconds, requestId: error.requestId, code: error.code }
        }
      })()`,
    })
    const observed = check.result.value
    if (check.exceptionDetails || observed?.status !== 429 || observed.retry !== 60 || !observed.requestId) {
      throw new Error(`Browser cannot read Gateway retry/correlation headers across origins: ${JSON.stringify(observed)}`)
    }
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
  console.log("OK Cross-origin browser SDK reads Gateway Retry-After and request ID")
}

async function expectMemberModal(client) {
  await client.send("Runtime.evaluate", { expression: 'document.querySelector(".member-login-link").click()' })
  await waitForText(client, (text) => text.includes("使用 Google 繼續") && text.includes("白名單"), "Member dialog opens on the Lobby")
  const opened = await client.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const dialog = document.querySelector("#member-dialog")
      const backdrop = getComputedStyle(dialog, "::backdrop")
      return location.pathname === "/" && dialog.open
        && document.querySelector(".hero").isConnected
        && dialog.querySelector("#account-cover").hidden
        && !dialog.querySelector("#account-description").hidden
        && backdrop.backgroundColor === "rgba(6, 4, 14, 0.72)"
        && backdrop.backdropFilter.includes("blur(4px)")
    })()`,
  })
  if (!opened.result.value) throw new Error("Member dialog replaces or obscures the Lobby")
  for (const [width, height] of [[390, 844], [375, 667], [320, 568]]) {
    await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true })
    const result = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const dialog = document.querySelector("#member-dialog")
        const overflow = dialog.scrollHeight - dialog.clientHeight
        dialog.scrollTop = dialog.scrollHeight
        const footerVisible = dialog.querySelector(".account-note").getBoundingClientRect().bottom <= dialog.getBoundingClientRect().bottom + 1
        dialog.scrollTop = 0
        return { overflow, horizontal: dialog.scrollWidth > dialog.clientWidth, scrollbar: getComputedStyle(dialog).scrollbarWidth, footerVisible }
      })()`,
    })
    const layout = result.result.value
    if (layout.horizontal || layout.scrollbar !== "none" || !layout.footerVisible || (height >= 667 && layout.overflow > 1)) throw new Error(`Member dialog scrollbar failed at ${width}x${height}: ${JSON.stringify(layout)}`)
  }
  await client.send("Emulation.clearDeviceMetricsOverride")
  await client.send("Runtime.evaluate", { awaitPromise: true, expression: 'new Promise(resolve => { document.querySelector("#member-dialog").addEventListener("close", resolve, { once: true }); document.querySelector(".member-dialog-close").click() })' })
  await client.send("Runtime.evaluate", { expression: 'document.querySelector(".member-login-link").click()' })
  await waitForText(client, (text) => text.includes("使用 Google 繼續"), "Member dialog reopens")
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })
  const closed = await client.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({ open: document.querySelector("#member-dialog").open, scrollLocked: document.body.classList.contains("member-dialog-open"), focusRestored: document.activeElement === document.querySelector(".member-login-link"), count: document.querySelectorAll("#member-dialog").length }))))`,
  })
  const dismissal = closed.result.value
  if (dismissal.open || dismissal.scrollLocked || !dismissal.focusRestored || dismissal.count !== 1) throw new Error(`Member dialog dismissal failed: ${JSON.stringify(dismissal)}`)
  console.log("OK Member dialog preserves the Lobby and dismisses with focus restored")
}

async function expectGameSelection(client, appPort) {
  const readCatalog = async () => {
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      const state = await client.send("Runtime.evaluate", { returnByValue: true, expression: '({ games: [...document.querySelectorAll("#gameGrid .card")].map(card => ({ path: new URL(card.href).pathname + new URL(card.href).search, name: card.querySelector(".card__name").textContent })), empty: Boolean(document.querySelector("#gameGrid .empty-state")), title: document.querySelector("#gameGrid .empty-title")?.textContent || "", copy: document.querySelector("#gameGrid .empty-copy")?.textContent || "", error: document.querySelector("#gameGrid .empty-state")?.classList.contains("is-error") || false, count: document.querySelector("[data-grid-count]")?.textContent || "" })' })
      if (state.result.value.games.length > 0 || state.result.value.empty) return state.result.value
      await sleep(100)
    }
    throw new Error("Catalog did not render")
  }
  const empty = await readCatalog()
  if (empty.title !== "目前沒有開放的遊戲" || empty.copy !== "遊戲上架後會顯示在這裡。" || empty.error || empty.count) {
    throw new Error(`Empty catalog state failed: ${JSON.stringify(empty)}`)
  }
  await expectPageText(client, appPort, "/?play=smoke-game-one", (text) => text.includes("JOY8-GAME-002") && text.includes("目前沒有開放的遊戲"), "Empty catalog rejects direct game link")
  const emptyPath = await client.send("Runtime.evaluate", { returnByValue: true, expression: "location.pathname + location.search" })
  if (emptyPath.result.value !== "/") throw new Error("Rejected direct link did not clear the pending game URL")

  await client.send("Runtime.evaluate", { expression: `localStorage.setItem("joy8-smoke-catalog", ${JSON.stringify(JSON.stringify([
    { name: "Smoke Mahjong", slug: "mahjong-clash", thumbnail: "/games/mahjong-clash/cover.webp", type: "card" },
    { name: "Smoke Game Two", slug: "smoke-game-two", thumbnail: "", type: "arcade" },
  ]))})` })
  await client.send("Page.navigate", { url: `http://${host}:${appPort}/` })
  await sleep(300)
  const catalog = await readCatalog()
  const games = catalog.games
  if (games.length !== 2 || catalog.count !== "共 2 款") throw new Error(`Catalog fixture failed: ${JSON.stringify(catalog)}`)
  const hero = await client.send("Runtime.evaluate", { returnByValue: true, expression: '[...document.querySelectorAll(".hero__slide")].map(slide => slide.dataset.play || slide.dataset.action)' })
  if (JSON.stringify(hero.result.value) !== JSON.stringify(["welcome", "mahjong-clash"])) throw new Error(`Hero did not follow the published catalog: ${JSON.stringify(hero.result.value)}`)
  await client.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `import("/src/lib/memberClient.js").then(({ memberSupabase }) => {
      memberSupabase.auth.signInWithOAuth = async ({ provider, options }) => {
        window.smokeProvider = provider
        window.smokeCallback = options.redirectTo
        return { error: { code: "smoke_provider_disabled" } }
      }
    })`,
  })
  const selectors = ['#gameGrid .card:nth-child(1)', '#gameGrid .card:nth-child(2)', '.hero__slide[data-play="mahjong-clash"]']
  for (const [index, selector] of selectors.entries()) {
    const game = games[index % games.length]
    await client.send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(selector)}).click()` })
    await waitForText(client, (text) => text.includes(`遊玩《${game.name}》`) && text.includes("白名單"), "Selected game opens login over the Lobby")
    const state = await client.send("Runtime.evaluate", { returnByValue: true, expression: '({ path: location.pathname + location.search, cover: document.querySelector("#account-cover:not([hidden]) img")?.getAttribute("src") || "" })' })
    if (state.result.value.path !== "/") throw new Error("Selecting a game removed the Lobby")
    if (state.result.value.cover !== (game.path.includes("mahjong-clash") ? "/games/mahjong-clash/cover.webp" : "")) throw new Error(`Login dialog cover mismatch: ${JSON.stringify(state.result.value)}`)
    const provider = "google"
    await client.send("Runtime.evaluate", { expression: `document.getElementById("${provider}-button").click()` })
    await waitForText(client, (text) => text.includes("目前無法完成操作"), "Provider fixture stays offline")
    const target = await client.send("Runtime.evaluate", { returnByValue: true, expression: '({ next: new URL(window.smokeCallback).searchParams.get("next"), provider: new URL(window.smokeCallback).searchParams.get("provider"), attempted: window.smokeProvider })' })
    if (target.result.value.next !== game.path || target.result.value.provider !== provider || target.result.value.attempted !== provider) throw new Error("Authentication lost the selected game or provider")
    await client.send("Runtime.evaluate", { expression: 'document.querySelector(".member-dialog-close").click()' })
  }
  await client.send("Runtime.evaluate", { expression: 'document.querySelector(".member-login-link").click()' })
  await waitForText(client, (text) => text.includes("使用 Google 繼續") && !text.includes("遊玩《"), "Top-bar entry clears previous game choice")
  await client.send("Runtime.evaluate", { expression: 'document.getElementById("google-button").click()' })
  await waitForText(client, (text) => text.includes("目前無法完成操作"), "Top-bar provider fixture")
  const headerTarget = await client.send("Runtime.evaluate", { returnByValue: true, expression: 'new URL(window.smokeCallback).searchParams.get("next")' })
  if (headerTarget.result.value !== "/") throw new Error("Top-bar login retained a cancelled game")
  await expectPageText(client, appPort, games[1].path, text => text.includes("全部遊戲") && !text.includes("遊玩《"), "Game URL without a recent entry returns to the plain Lobby")
  const plainLobby = await client.send("Runtime.evaluate", { returnByValue: true, expression: "location.pathname === '/' && location.search === '' && !document.querySelector('#member-dialog[open]')" })
  if (!plainLobby.result.value) throw new Error("Missing game visit retained an automatic game continuation")
  await client.send("Runtime.evaluate", { awaitPromise: true, expression: `import('/src/member/game-visit.js').then(({prepareGameEntry}) => prepareGameEntry(${JSON.stringify(games[1].path)}))` })
  await expectPageText(client, appPort, games[1].path, (text) => text.includes(`遊玩《${games[1].name}》`) && text.includes("白名單"), "Recent game entry without membership returns to the Lobby login dialog")
  const deepLinkPath = await client.send("Runtime.evaluate", { returnByValue: true, expression: "location.pathname + location.search" })
  if (deepLinkPath.result.value !== "/") throw new Error("Direct link did not clear the pending game URL")
  await client.send("Runtime.evaluate", { expression: 'document.querySelector(".member-dialog-close").click(); localStorage.removeItem("joy8-smoke-catalog")' })
  console.log("OK Game cards, hero game slides, callback destination, cancellation, empty-catalog rejection and direct-link entry")
}

async function expectLobbyLayouts(client, appPort) {
  const layoutState = 'new Promise(resolve => setTimeout(() => resolve({ layout: document.documentElement.dataset.layout, side: Boolean(document.querySelector(".side")), float: Boolean(document.querySelector(".float-reward")), ticker: Boolean(document.querySelector("[data-ticker]")?.textContent), overflow: document.documentElement.scrollWidth > innerWidth, path: location.pathname, dialogs: document.querySelectorAll("dialog.sheet").length }), 300))'
  const pc = await client.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: layoutState })
  if (pc.result.value.layout !== "pc" || !pc.result.value.side || pc.result.value.float || pc.result.value.dialogs !== 2) throw new Error(`Desktop layout failed: ${JSON.stringify(pc.result.value)}`)
  await client.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36", userAgentMetadata: { platform: "Android", platformVersion: "14", architecture: "", model: "Pixel 8", mobile: true } })
  await client.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
  const { identifier: blockInstallPrompt } = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: 'addEventListener("beforeinstallprompt", event => event.stopImmediatePropagation())' })
  try {
    await client.send("Page.navigate", { url: `http://${host}:${appPort}/` })
    await waitForText(client, (text) => text.includes("全部遊戲"), "Mobile Lobby loads")
    const mobile = await client.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: layoutState })
    const value = mobile.result.value
    if (value.layout !== "mobile" || value.side || !value.float || !value.ticker || value.overflow || value.path !== "/") throw new Error(`Mobile layout failed: ${JSON.stringify(value)}`)
    await client.send("Runtime.evaluate", { expression: 'document.querySelector(".float-reward").click()' })
    await waitForText(client, (text) => text.includes("每日獎勵即將開放"), "Mobile placeholder shows a notice")
    const install = await client.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => {
      document.querySelector('[data-action="settings"]').click()
      const settings = document.querySelector(".sheet--settings")
      const button = settings.querySelector('[data-setting="install"]')
      const help = settings.querySelector("#installHelp")
      button?.click()
      await new Promise(resolve => setTimeout(resolve, 50))
      const result = { button: Boolean(button), help: help ? !help.hidden : false, expanded: button?.getAttribute("aria-expanded") }
      settings.querySelector('[data-setting="close"]').click()
      return result
    })()` })
    if (!install.result.value.button || !install.result.value.help || install.result.value.expanded !== "true") throw new Error(`Mobile install entry failed: ${JSON.stringify(install.result.value)}`)
  } finally {
    await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: blockInstallPrompt })
    await client.send("Emulation.setUserAgentOverride", { userAgent: "" })
    await client.send("Emulation.clearDeviceMetricsOverride")
  }
  await client.send("Page.navigate", { url: `http://${host}:${appPort}/` })
  await waitForText(client, (text) => text.includes("全部遊戲"), "Desktop Lobby reloads")
  const placeholders = await client.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => {
    const seen = []
    for (const action of ["daily", "store", "social", "promo", "link"]) {
      document.querySelector('[data-action="' + action + '"]').click()
      seen.push(document.querySelector("[data-toast]").textContent)
    }
    document.querySelector('[data-action="settings"]').click()
    const settings = document.querySelector(".sheet--settings")
    const settingsOpen = settings.open
    const pcInstall = Boolean(settings.querySelector('[data-setting="install"]'))
    settings.querySelector('[data-setting="link"]').click()
    const settingsToast = settings.contains(document.querySelector("[data-toast]"))
    settings.querySelector('[data-setting="close"]').click()
    document.querySelector('[data-action="mail"]').click()
    await new Promise(resolve => setTimeout(resolve, 300))
    const login = document.querySelector("#member-dialog")?.open
    document.querySelector(".member-dialog-close")?.click()
    return { seen, settingsOpen, pcInstall, settingsToast, login, path: location.pathname + location.search }
  })()` })
  const result = placeholders.result.value
  if (result.seen.some(text => !text.includes("即將") && !text.includes("準備中")) || !result.settingsOpen || result.pcInstall || !result.settingsToast || !result.login || result.path !== "/") throw new Error(`Lobby placeholders failed: ${JSON.stringify(result)}`)
  console.log("OK Device-selected PC/mobile layouts on one URL, placeholder notices, settings sheet, mobile-only install entry and guest mailbox login")
}

async function expectMemberContinuation(client) {
  const result = await client.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `Promise.all([import("/src/member/page.js"), import("/src/member/template.js"), import("/src/lib/memberClient.js")]).then(async ([{ initMemberPanel }, { memberCardMarkup }, { memberSupabase }]) => {
      const auth = memberSupabase.auth
      const saved = Object.fromEntries(["getSession", "exchangeCodeForSession"].map(key => [key, auth[key]]))
      const descriptor = Object.getOwnPropertyDescriptor(memberSupabase, "functions")
      let user = null
      const paths = []
      const roots = []
      const panels = []
      auth.getSession = async () => ({ data: { session: user ? { user } : null }, error: null })
      auth.exchangeCodeForSession = async () => { user = { id: "fixture-google", is_anonymous: false }; return { data: { user }, error: null } }
      Object.defineProperty(memberSupabase, "functions", { configurable: true, value: { invoke: async () => ({ data: { member: { player_account_ref: "fixture-player", account_type: "registered" } }, error: null }) } })
      const mount = (next, extra = {}) => {
        const root = document.createElement("div")
        root.hidden = true
        root.innerHTML = memberCardMarkup
        document.body.append(root)
        roots.push(root)
        let complete
        const continued = new Promise(resolve => { complete = resolve })
        const panel = initMemberPanel(root, {
          params: new URLSearchParams({ next, ...extra }),
          onContinue: path => { paths.push(path); complete(path) },
        })
        panels.push(panel)
        return { root, panel, continued }
      }
      try {
        const restricted = mount("/game/?slug=restricted-game")
        await restricted.panel.ready
        const guestAbsent = !restricted.root.querySelector("#guest-button")
        restricted.panel.dispose()
        user = null
        const callback = mount("/game/?slug=callback-game", { code: "fixture-code", flow: "signin", provider: "google" })
        await callback.panel.ready
        user = null
        const retired = mount("/", { code: "fixture-code", flow: "signup" })
        await retired.panel.ready
        const retiredFlowRejected = retired.root.querySelector("#account-status").dataset.error === "true"
          && retired.root.querySelector("#account-status").textContent.includes("目前無法完成操作")
        retired.panel.dispose()
        return { paths, retiredFlowRejected, guestAbsent, visit: JSON.parse(sessionStorage.getItem('joy8-game-visit-v1')) }
      } finally {
        for (const panel of panels) panel.dispose()
        for (const root of roots) root.remove()
        Object.assign(auth, saved)
        if (descriptor) Object.defineProperty(memberSupabase, "functions", descriptor)
        else delete memberSupabase.functions
      }
    })`,
  })
  const expectedPaths = ["/game/?slug=callback-game"]
  const value = result.result.value
  if (result.exceptionDetails || JSON.stringify(value?.paths) !== JSON.stringify(expectedPaths) || !value?.retiredFlowRejected || !value?.guestAbsent || value?.visit?.slug !== "callback-game") {
    throw new Error(`Member continuation fixture failed: ${JSON.stringify(result)}`)
  }
  console.log("OK Google callback continuation, guest entry absent, invalid callbacks fail closed")
}

async function expectGameIframeSecurity(client) {
  const evaluation = await client.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `
      Promise.all([
        import("/src/pages/game/iframe.js"),
        import("/src/ui/error-modal.js"),
      ]).then(async ([{ createGameIframe, mountGameFrame }, { ERROR_CODES }]) => {
        const external = createGameIframe({
          gameUrl: "https://game.example/",
          gameName: "External Game",
        })
        const sameOrigin = createGameIframe({
          gameUrl: "/game/local/",
          gameName: "Local Game",
        })
        const timeoutTriggered = await new Promise((resolve) => {
          mountGameFrame({
            gameRoot: { append() {} },
            gameUrl: "https://game.example/",
            gameName: "Timeout Game",
            timeoutMs: 10,
            onLoad: () => resolve(false),
            onTimeout: () => resolve(true),
          })
        })

        return {
          externalSandbox: external.getAttribute("sandbox"),
          sameOriginSandbox: sameOrigin.getAttribute("sandbox"),
          permissions: external.getAttribute("allow"),
          referrerPolicy: external.referrerPolicy,
          allowFullscreen: external.hasAttribute("allowfullscreen"),
          timeoutTriggered,
          timeoutCode: ERROR_CODES.GAME_LOAD_TIMEOUT,
        }
      })
    `,
  })

  if (evaluation.exceptionDetails) {
    throw new Error(`Game iframe security check failed: ${evaluation.exceptionDetails.text}`)
  }

  const result = evaluation.result.value || {}
  const externalTokens = new Set(String(result.externalSandbox || "").split(/\s+/).filter(Boolean))
  const sameOriginTokens = new Set(String(result.sameOriginSandbox || "").split(/\s+/).filter(Boolean))
  const requiredTokens = [
    "allow-forms",
    "allow-orientation-lock",
    "allow-pointer-lock",
    "allow-scripts",
  ]

  if (
    !requiredTokens.every((token) => externalTokens.has(token) && sameOriginTokens.has(token))
    || externalTokens.has("allow-modals")
    || sameOriginTokens.has("allow-modals")
    || !externalTokens.has("allow-same-origin")
    || sameOriginTokens.has("allow-same-origin")
    || result.permissions !== "autoplay; fullscreen; gamepad"
    || result.referrerPolicy !== "no-referrer"
    || result.allowFullscreen !== true
    || result.timeoutTriggered !== true
    || result.timeoutCode !== "JOY8-GAME-006"
  ) {
    throw new Error(`Game iframe security check failed: ${JSON.stringify(result)}`)
  }

  console.log("OK Game iframe security attributes")
}

async function expectLaunchUrlPolicy(client) {
  const evaluation = await client.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `
      import("/src/lib/urls.js").then(({ normalizeCoverPath, normalizeLaunchUrl }) => ({
        secure: normalizeLaunchUrl("https://game.example/play") === "https://game.example/play",
        rootRelative: normalizeLaunchUrl("/game/local/?mode=test") === "/game/local/?mode=test",
        localHttp: normalizeLaunchUrl("http://localhost:8080/play") === "http://localhost:8080/play",
        externalHttpBlocked: normalizeLaunchUrl("http://game.example/play") === "",
        protocolRelativeBlocked: normalizeLaunchUrl("//game.example/play") === "",
        validCover: normalizeCoverPath("/games/test-game/cover.webp", "test-game") === "/games/test-game/cover.webp",
        externalCoverBlocked: normalizeCoverPath("https://game.example/cover.webp", "test-game") === "",
        wrongSlugCoverBlocked: normalizeCoverPath("/games/other/cover.webp", "test-game") === "",
      }))
    `,
  })

  if (evaluation.exceptionDetails) {
    throw new Error(`Launch URL policy check failed: ${evaluation.exceptionDetails.text}`)
  }

  const result = evaluation.result.value || {}
  if (!Object.values(result).every(Boolean)) {
    throw new Error(`Launch URL policy check failed: ${JSON.stringify(result)}`)
  }

  console.log("OK Launch URL policy")
}

async function expectLobbyThumbnailFallback(client) {
  const evaluation = await client.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `
      import("/src/pages/lobby/game-grid.js").then(({ renderGameGrid }) => {
        const root = document.createElement("div")
        renderGameGrid(root, [{
          name: "Broken Cover",
          slug: "broken-cover",
          thumbnail: "https://invalid.example/cover.webp",
          type: "arcade",
        }])

        const art = root.querySelector(".card__art")

        return {
          hasImage: Boolean(root.querySelector("img")),
          hasFallback: (art?.classList.contains("is-empty") && art.textContent === "Broken Cover") || false,
        }
      })
    `,
  })

  if (evaluation.exceptionDetails) {
    throw new Error(`Lobby thumbnail fallback check failed: ${evaluation.exceptionDetails.text}`)
  }

  const result = evaluation.result.value || {}
  if (result.hasImage || !result.hasFallback) {
    throw new Error(`Lobby thumbnail fallback check failed: ${JSON.stringify(result)}`)
  }

  console.log("OK Lobby thumbnail fallback")
}

async function waitForText(client, predicate, label) {
  const deadline = Date.now() + 12000
  let lastText = ""

  while (Date.now() < deadline) {
    const result = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: "document.body ? document.body.innerText : ''",
    })

    lastText = result.result.value || ""
    if (predicate(lastText)) {
      console.log(`OK ${label}`)
      return lastText
    }

    await sleep(250)
  }

  throw new Error(`${label} failed. Last text: ${lastText.slice(0, 300)}`)
}

async function waitForHttp(url) {
  const deadline = Date.now() + 12000

  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(url)
      if (response.ok) return
    } catch {
      // Retry until server/browser is ready.
    }

    await sleep(250)
  }

  throw new Error(`Timed out waiting for ${url}`)
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: options.method || "GET",
      timeout: timeoutMs,
    }, (response) => {
      let body = ""
      response.setEncoding("utf8")
      response.on("data", (chunk) => {
        body += chunk
      })
      response.on("end", () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          json: async () => JSON.parse(body),
          text: async () => body,
        })
      })
    })

    request.on("timeout", () => {
      request.destroy(new Error(`Timed out fetching ${url}`))
    })
    request.on("error", reject)
    request.end(options.body)
  })
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, host, () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

function findBrowser() {
  const candidates = [
    process.env.SMOKE_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  throw new Error("Smoke check needs Chrome or Edge. Set SMOKE_BROWSER_PATH to a Chromium browser executable.")
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stopProcess(child) {
  if (!child?.pid) return

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    })
    return
  }

  child.kill("SIGTERM")
}

async function stopBrowser(browser) {
  if (!browser) return

  stopProcess(browser.instance)
  if (process.platform === "win32") {
    spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${browser.profile}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ], { stdio: "ignore" })
  }
  await rm(browser.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
}
