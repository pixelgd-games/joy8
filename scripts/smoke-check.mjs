import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
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
    return normalizedText.includes("looty")
      && normalizedText.includes("game list")
      && normalizedText.includes("featured games")
      && !normalizedText.includes("game list failed to load")
  }, "Home loads")

  await expectLaunchUrlPolicy(client)
  await expectGameIframeSecurity(client)
  await expectLobbyThumbnailFallback(client)

  await expectPageText(client, appPort, "/game/", (text) => {
    return text.includes("LOOTY-GAME-001")
  }, "Loader missing slug shows error")

  await expectPageText(client, appPort, "/admin/login/", (text) => {
    return text.includes("Looty Admin") && text.includes("Google")
  }, "Admin login loads")

  await showSyntheticError(client)
  await waitForText(client, (text) => {
    return text.includes("LOOTY-SMOKE-001") && text.includes("Smoke test error modal")
  }, "Shared error modal shows code")

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
  const profile = await mkdtemp(path.join(tmpdir(), "looty-smoke-browser-"))
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
          code: "LOOTY-SMOKE-001",
          title: "Smoke test error",
          message: "Smoke test error modal",
          reload: false,
        })
      })
    `,
  })
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
    || result.timeoutCode !== "LOOTY-GAME-006"
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
      import("/src/lib/urls.js").then(({ appendQueryParams, normalizeLaunchUrl }) => ({
        secure: normalizeLaunchUrl("https://game.example/play") === "https://game.example/play",
        rootRelative: normalizeLaunchUrl("/game/local/?mode=test") === "/game/local/?mode=test",
        localHttp: normalizeLaunchUrl("http://localhost:8080/play") === "http://localhost:8080/play",
        externalHttpBlocked: normalizeLaunchUrl("http://game.example/play") === "",
        protocolRelativeBlocked: normalizeLaunchUrl("//game.example/play") === "",
        insecureAppendBlocked: appendQueryParams("http://game.example/play", { session: "test" }) === "",
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

        const image = root.querySelector("img")
        image.dispatchEvent(new Event("error"))
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
