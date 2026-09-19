import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"
import http from "node:http"
import net from "node:net"
import { fileURLToPath } from "node:url"
import WebSocket from "ws"

const cwd = fileURLToPath(new URL("..", import.meta.url))
const host = "127.0.0.1"
const cdpTimeoutMs = 8000

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm"
const viteBin = path.join(cwd, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite")

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
  console.log("Opening browser client...")
  const client = await openBrowserClient(cdpPort)

  await expectPageText(client, appPort, "/", (text) => {
    const normalizedText = text.toLowerCase()
    return normalizedText.includes("joy8")
      && normalizedText.includes("game list")
      && normalizedText.includes("featured games")
      && !normalizedText.includes("game list failed to load")
  }, "Home loads")

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

  await showSyntheticError(client)
  await waitForText(client, (text) => {
    return text.includes("JOY8-SMOKE-001") && text.includes("Smoke test error modal")
  }, "Shared error modal shows code")
  await expectErrorPresentation(client)

  client.ws.close()
  console.log("Smoke check passed.")
} finally {
  stopProcess(browser)
  stopProcess(devServer)
}

function runBuild() {
  const result = spawnSync(npmCmd, ["run", "build"], {
    cwd,
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
  const headers = readFileSync(path.join(cwd, "dist", "_headers"), "utf8")
  for (const expected of [
    "Content-Security-Policy: frame-ancestors 'none'",
    "X-Frame-Options: DENY",
    "X-Content-Type-Options: nosniff",
    "Referrer-Policy: strict-origin-when-cross-origin",
  ]) {
    if (!headers.includes(expected)) throw new Error(`Missing production security header: ${expected}`)
  }
  console.log("OK Production security headers")
}

function verifyCanonicalHostRedirect() {
  const entryFiles = [
    "index.html",
    "account/index.html",
    "admin/login/index.html",
    "admin/games/index.html",
    "admin/games/new/index.html",
    "admin/games/edit/index.html",
    "game/index.html",
    "play-test/index.html",
  ]
  for (const entryFile of entryFiles) {
    const html = readFileSync(path.join(cwd, "dist", entryFile), "utf8")
    if (!html.includes('location.hostname === "joy8.pages.dev"') || !html.includes('"https://joy8.cc"')) {
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

  await waitForHttp(`http://${host}:${cdpPort}/json/version`)
  return instance
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
  await waitForText(client, text => text.includes("目前無法進入測試，請稍後再試。"), "Test entry failure remains recoverable")
  const denied = await client.send("Runtime.evaluate", { returnByValue:true, expression:'document.querySelectorAll("iframe").length===0 && !document.getElementById("private-start").disabled' })
  if (!denied.result.value) throw new Error("Private denial mounted a game or blocked retry")
  await client.send("Runtime.evaluate", { expression:'window.privateAllowed=true;document.getElementById("private-start").click()' })
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
    return text.includes("使用 Google 登入") && text.includes("先以訪客遊玩")
  }, "Standalone callback and recovery entry remains available")
  const returnCheck = await client.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `location.pathname === "/account/" && new URLSearchParams(location.search).get("next") === "/game/?slug=test"`,
  })
  if (!returnCheck.result.value) throw new Error("Member return destination was lost")
  const controls = await client.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const loginActions = document.getElementById("reset-button").closest("#account-switch")
        && document.getElementById("account-switch").getBoundingClientRect().top >= document.getElementById("guest-notice").getBoundingClientRect().bottom
      document.getElementById("register-button").click()
      const registration = document.getElementById("password").minLength === 10
        && document.getElementById("password").autocomplete === "new-password"
        && document.getElementById("account-title").textContent === "建立帳號"
        && !document.getElementById("confirm-password-field").hidden
        && document.getElementById("register-confirm-password").required
        && document.getElementById("provider-options").hidden
        && document.getElementById("guest-button").hidden
        && document.getElementById("reset-button").hidden
      document.getElementById("email").value = "player@example.com"
      document.getElementById("password").value = "first-password"
      document.getElementById("register-confirm-password").value = "other-password"
      document.getElementById("email-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      const mismatch = document.getElementById("account-status").textContent.includes("兩次密碼不相同")
      document.getElementById("register-button").click()
      document.getElementById("reset-button").click()
      const recovery = document.getElementById("password-field").hidden
        && !document.getElementById("password").required
        && document.getElementById("account-title").textContent === "找回密碼"
        && document.getElementById("provider-options").hidden
      document.getElementById("register-button").click()
      return loginActions && registration && mismatch && recovery && !document.getElementById("password-field").hidden
        && document.getElementById("account-title").textContent === "登入"
    })()`,
  })
  if (!controls.result.value) throw new Error("Member form modes failed")
  for (const width of [320, 390, 1280]) {
    await client.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 })
    const layout = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `document.documentElement.scrollWidth <= innerWidth && getComputedStyle(document.getElementById("new-password-form")).display === "none" && document.getElementById("google-button").getBoundingClientRect().top > document.getElementById("email-submit").getBoundingClientRect().bottom && document.getElementById("guest-button").getBoundingClientRect().top - document.getElementById("google-button").getBoundingClientRect().bottom >= 17`,
    })
    if (!layout.result.value) throw new Error(`Member layout failed at ${width}px`)
    if (process.env.SMOKE_MEMBER_SCREENSHOT && width === 390) {
      const { data } = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })
      await writeFile(process.env.SMOKE_MEMBER_SCREENSHOT, Buffer.from(data, "base64"))
    }
  }
  await client.send("Emulation.clearDeviceMetricsOverride")
  const mock = await client.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `import("/src/lib/memberClient.js").then(({ memberSupabase }) => {
      memberSupabase.auth.getSession = async () => ({ data: { session: { user: { id: "smoke-guest", is_anonymous: true } } }, error: null })
      Object.defineProperty(memberSupabase, "functions", { value: {
        invoke: async () => ({ data: { member: { player_account_ref: "smoke-player", account_type: "guest" } }, error: null })
      } })
      window.dispatchEvent(new Event("focus"))
      return true
    })`,
  })
  if (mock.exceptionDetails) throw new Error("Cannot isolate member browser fixture")
  await waitForText(client, (text) => text.includes("目前以訪客身分登入") && text.includes("繼續遊玩"), "Persistent guest account UI")
  const guestControls = await client.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `document.getElementById("guest-button").hidden && document.getElementById("password-field").hidden && !document.getElementById("password").required && document.getElementById("google-button").textContent.includes("綁定")`,
  })
  if (!guestControls.result.value) throw new Error("Guest upgrade controls are unsafe")
  console.log("OK Member entry, recovery controls, guest upgrade and responsive layout")
}

async function expectMemberModal(client) {
  await client.send("Runtime.evaluate", { expression: 'document.querySelector(".member-login-link").click()' })
  await waitForText(client, (text) => text.includes("使用 Google 登入") && text.includes("先以訪客遊玩"), "Member dialog opens on the Lobby")
  const opened = await client.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const dialog = document.querySelector("#member-dialog")
      const backdrop = getComputedStyle(dialog, "::backdrop")
      return location.pathname === "/" && dialog.open
        && document.querySelector(".hero-image").isConnected
        && !dialog.querySelector(".account-kicker")
        && dialog.querySelector("#account-description").hidden
        && backdrop.backgroundColor === "rgba(0, 0, 0, 0.18)"
        && backdrop.backdropFilter === "none"
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
        const footerVisible = dialog.querySelector("#account-switch").getBoundingClientRect().bottom <= dialog.getBoundingClientRect().bottom + 1
        dialog.scrollTop = 0
        return { overflow, horizontal: dialog.scrollWidth > dialog.clientWidth, scrollbar: getComputedStyle(dialog).scrollbarWidth, footerVisible }
      })()`,
    })
    const layout = result.result.value
    if (layout.horizontal || layout.scrollbar !== "none" || !layout.footerVisible || (height >= 667 && layout.overflow > 1)) throw new Error(`Member dialog scrollbar failed at ${width}x${height}: ${JSON.stringify(layout)}`)
  }
  await client.send("Emulation.clearDeviceMetricsOverride")
  const switched = await client.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const dialog = document.querySelector("#member-dialog")
      dialog.querySelector("#register-button").click()
      const registration = dialog.open && location.pathname === "/"
        && dialog.querySelector("#account-title").textContent === "建立帳號"
        && !dialog.querySelector("#confirm-password-field").hidden
      dialog.querySelector("#register-button").click()
      return registration && dialog.open && dialog.querySelector("#account-title").textContent === "登入"
    })()`,
  })
  if (!switched.result.value) throw new Error("Member dialog form switch changed the Lobby")
  await client.send("Runtime.evaluate", { awaitPromise: true, expression: 'new Promise(resolve => { document.querySelector("#member-dialog").addEventListener("close", resolve, { once: true }); document.querySelector(".member-dialog-close").click() })' })
  await client.send("Runtime.evaluate", { expression: 'document.querySelector(".member-login-link").click()' })
  await waitForText(client, (text) => text.includes("使用 Google 登入"), "Member dialog reopens")
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
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    const count = await client.send("Runtime.evaluate", { returnByValue: true, expression: 'document.querySelectorAll("#gameGrid .game-tile-poster").length' })
    if (count.result.value >= 2) break
    await sleep(100)
  }
  const gameLinks = await client.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `[...document.querySelectorAll("#gameGrid .game-tile-poster")].slice(0, 2).map(link => ({ path: new URL(link.href).pathname + new URL(link.href).search, name: link.closest(".game-tile").querySelector(".game-tile-title").textContent }))`,
  })
  const games = gameLinks.result.value
  if (games.length < 2) throw new Error("Game selection smoke needs two published catalog entries")
  await client.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `import("/src/lib/memberClient.js").then(({ memberSupabase }) => {
      memberSupabase.auth.signInWithOAuth = async ({ options }) => {
        window.smokeCallback = options.redirectTo
        return { error: { code: "smoke_provider_disabled" } }
      }
    })`,
  })
  for (let index = 0; index < games.length; index++) {
    await client.send("Runtime.evaluate", { expression: `document.querySelectorAll("#gameGrid .game-tile-poster")[${index}].click()` })
    await waitForText(client, (text) => text.includes(`遊玩「${games[index].name}」`) && text.includes("先以訪客遊玩"), "Selected game opens login over the Lobby")
    const path = await client.send("Runtime.evaluate", { returnByValue: true, expression: "location.pathname + location.search" })
    if (path.result.value !== "/") throw new Error("Selecting a game removed the Lobby")
    await client.send("Runtime.evaluate", { expression: 'document.getElementById("google-button").click()' })
    await waitForText(client, (text) => text.includes("目前無法完成操作"), "Provider fixture stays offline")
    const target = await client.send("Runtime.evaluate", { returnByValue: true, expression: 'new URL(window.smokeCallback).searchParams.get("next")' })
    if (target.result.value !== games[index].path) throw new Error("Authentication lost the selected game")
    await client.send("Runtime.evaluate", { expression: 'document.querySelector(".member-dialog-close").click()' })
  }
  await client.send("Runtime.evaluate", { expression: 'document.querySelector(".member-login-link").click()' })
  await waitForText(client, (text) => text.includes("使用 Google 登入") && !text.includes("遊玩「"), "Top-bar entry clears previous game choice")
  await client.send("Runtime.evaluate", { expression: 'document.getElementById("google-button").click()' })
  await waitForText(client, (text) => text.includes("目前無法完成操作"), "Top-bar provider fixture")
  const headerTarget = await client.send("Runtime.evaluate", { returnByValue: true, expression: 'new URL(window.smokeCallback).searchParams.get("next")' })
  if (headerTarget.result.value !== "/") throw new Error("Top-bar login retained a cancelled game")
  await expectPageText(client, appPort, games[0].path, (text) => text.includes(`遊玩「${games[0].name}」`) && text.includes("先以訪客遊玩"), "Direct game link returns to the Lobby login dialog")
  const deepLinkPath = await client.send("Runtime.evaluate", { returnByValue: true, expression: "location.pathname + location.search" })
  if (deepLinkPath.result.value !== "/") throw new Error("Direct link did not clear the pending game URL")
  await client.send("Runtime.evaluate", { expression: 'document.querySelector(".member-dialog-close").click()' })
  console.log("OK Game selection, callback destination, cancellation and direct-link entry")
}

async function expectMemberContinuation(client) {
  const result = await client.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `Promise.all([import("/src/member/page.js"), import("/src/member/template.js"), import("/src/lib/memberClient.js")]).then(async ([{ initMemberPanel }, { memberCardMarkup }, { memberSupabase }]) => {
      const auth = memberSupabase.auth
      const saved = Object.fromEntries(["getSession", "signInWithPassword", "signInAnonymously", "signUp", "resetPasswordForEmail", "exchangeCodeForSession"].map(key => [key, auth[key]]))
      const descriptor = Object.getOwnPropertyDescriptor(memberSupabase, "functions")
      let user = null
      const paths = []
      const roots = []
      const panels = []
      auth.getSession = async () => ({ data: { session: user ? { user } : null }, error: null })
      auth.signInWithPassword = async () => { user = { id: "fixture-member", is_anonymous: false }; return { data: { user }, error: null } }
      auth.signInAnonymously = async () => { user = { id: "fixture-guest", is_anonymous: true }; return { data: { user }, error: null } }
      auth.signUp = async () => ({ data: { user: { id: "pending-member" }, session: null }, error: null })
      auth.resetPasswordForEmail = async () => ({ data: {}, error: null })
      auth.exchangeCodeForSession = async () => { user = { id: "fixture-google", is_anonymous: false }; return { data: { user }, error: null } }
      Object.defineProperty(memberSupabase, "functions", { configurable: true, value: { invoke: async () => ({ data: { member: { player_account_ref: "fixture-player", account_type: user?.is_anonymous ? "guest" : "registered" } }, error: null }) } })
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
          captcha: { ready: Promise.resolve(), token: async () => "fixture-captcha", reset() {}, dispose() {} },
        })
        panels.push(panel)
        return { root, panel, continued }
      }
      const submit = root => {
        root.querySelector("#email").value = "fixture@example.invalid"
        root.querySelector("#password").value = "fixture-password"
        root.querySelector("#email-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      }
      try {
        const signup = mount("/")
        await signup.panel.ready
        signup.root.querySelector("#register-button").click()
        signup.root.querySelector("#email").value = "fixture@example.invalid"
        signup.root.querySelector("#password").value = "fixture-password"
        signup.root.querySelector("#register-confirm-password").value = "fixture-password"
        signup.root.querySelector("#email-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
        await new Promise(resolve => setTimeout(resolve, 0))
        const signupComplete = signup.root.querySelector("#account-title").textContent === "請查看信箱"
          && !signup.root.querySelector("#completion-panel").hidden
          && signup.root.querySelector("#signin-options").hidden
          && signup.root.querySelector("#completion-message").textContent.includes("驗證信")
        signup.root.querySelector("#completion-action").click()
        const signupReturned = signup.root.querySelector("#account-title").textContent === "登入"
          && signup.root.querySelector("#completion-panel").hidden
          && !signup.root.querySelector("#signin-options").hidden
        signup.panel.dispose()
        user = null
        const reset = mount("/")
        await reset.panel.ready
        reset.root.querySelector("#reset-button").click()
        reset.root.querySelector("#email").value = "fixture@example.invalid"
        reset.root.querySelector("#email-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
        await new Promise(resolve => setTimeout(resolve, 0))
        const resetComplete = reset.root.querySelector("#account-title").textContent === "請查看信箱"
          && !reset.root.querySelector("#completion-panel").hidden
          && reset.root.querySelector("#signin-options").hidden
          && reset.root.querySelector("#completion-message").textContent.includes("重設密碼信")
        reset.panel.dispose()
        user = null
        auth.exchangeCodeForSession = async () => ({ data: { user: null, session: null }, error: { code: "pkce_code_verifier_not_found" } })
        const verified = mount("/", { code: "fixture-code", flow: "signup" })
        await verified.panel.ready
        const verifiedComplete = verified.root.querySelector("#account-title").textContent === "信箱驗證完成"
          && !verified.root.querySelector("#completion-panel").hidden
          && verified.root.querySelector("#signin-options").hidden
        verified.panel.dispose()
        auth.exchangeCodeForSession = async () => { user = { id: "fixture-google", is_anonymous: false }; return { data: { user }, error: null } }
        user = null
        const password = mount("/game/?slug=password-game")
        await password.panel.ready
        submit(password.root)
        await password.continued
        password.panel.dispose()
        user = null
        const guest = mount("/game/?slug=guest-game")
        await guest.panel.ready
        guest.root.querySelector("#guest-button").click()
        await guest.continued
        guest.panel.dispose()
        user = null
        let release
        let didStart
        const started = new Promise(resolve => { didStart = resolve })
        auth.signInWithPassword = () => { didStart(); return new Promise(resolve => { release = () => { user = { id: "late-member", is_anonymous: false }; resolve({ data: { user }, error: null }) } }) }
        const cancelled = mount("/game/?slug=cancelled-game")
        await cancelled.panel.ready
        submit(cancelled.root)
        await started
        cancelled.panel.dispose()
        cancelled.root.remove()
        release()
        await new Promise(resolve => setTimeout(resolve, 0))
        user = null
        const callback = mount("/game/?slug=callback-game", { code: "fixture-code", flow: "signin" })
        await callback.panel.ready
        return { paths, signupComplete, signupReturned, resetComplete, verifiedComplete }
      } finally {
        for (const panel of panels) panel.dispose()
        for (const root of roots) root.remove()
        Object.assign(auth, saved)
        if (descriptor) Object.defineProperty(memberSupabase, "functions", descriptor)
        else delete memberSupabase.functions
      }
    })`,
  })
  const expectedPaths = ["/game/?slug=password-game", "/game/?slug=guest-game", "/game/?slug=callback-game"]
  const value = result.result.value
  if (result.exceptionDetails || JSON.stringify(value?.paths) !== JSON.stringify(expectedPaths) || !value?.signupComplete || !value?.signupReturned || !value?.resetComplete || !value?.verifiedComplete) {
    throw new Error(`Member continuation fixture failed: ${JSON.stringify(result)}`)
  }
  console.log("OK Member completion states, password, guest and callback continuation; late completion cannot launch a cancelled game")
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

        const poster = root.querySelector(".game-tile-poster")

        return {
          hasImage: Boolean(root.querySelector("img")),
          hasFallback: poster?.classList.contains("is-empty") || false,
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
