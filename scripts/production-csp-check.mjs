import assert from "node:assert/strict"
import http from "node:http"
import path from "node:path"
import { readFile } from "node:fs/promises"

export async function expectProductionCsp(client, cwd) {
  const root = path.join(cwd, ".smoke-dist.local")
  const headers = Object.fromEntries((await readFile(path.join(root, "_headers"), "utf8")).split(/\r?\n/)
    .filter(line => line.startsWith("  ")).map(line => { const index = line.indexOf(":"); return [line.slice(0, index).trim(), line.slice(index + 1).trim()] }))
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" }
  const server = http.createServer(async (request, response) => {
    try {
      let name = new URL(request.url, "http://localhost").pathname
      if (name.endsWith("/")) name += "index.html"
      const file = path.resolve(root, `.${decodeURIComponent(name)}`)
      if (!file.startsWith(root + path.sep)) throw new Error("Outside fixture")
      const content = await readFile(file)
      response.writeHead(200, { ...headers, "Content-Type": types[path.extname(file)] || "application/octet-stream" })
      response.end(content)
    } catch { response.writeHead(404); response.end() }
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  await client.send("Page.enable")
  const injected = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
    const fetchOriginal = window.fetch;
    window.fetch = (input, options) => String(input).includes('.supabase.co/') ? Promise.resolve(Response.json([])) : fetchOriginal(input, options);
  ` })
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    for (const route of ["/", "/admin/login/"]) {
      await client.send("Page.navigate", { url: origin + route })
      let rendered = false
      for (let i = 0; i < 60; i++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        const result = await client.send("Runtime.evaluate", { returnByValue: true, expression: "({text:document.body?.innerText || '',violations:window.cspViolations})" })
        const state = result.result.value
        if (state?.text.includes(route === "/" ? "精選遊戲" : "Joy8 Admin")) {
          assert.deepEqual(state.violations, [])
          rendered = true
          break
        }
      }
      assert.ok(rendered, `Built page did not render under CSP: ${route}`)
    }
    const result = await client.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `new Promise(resolve => {
      const script = document.createElement('script'); script.textContent = 'window.inlineScriptExecuted = true'; document.body.append(script);
      setTimeout(() => resolve({executed:!!window.inlineScriptExecuted,violations:window.cspViolations}),100);
    })` })
    assert.equal(result.result.value.executed, false)
    assert.ok(result.result.value.violations.some(value => value.startsWith("script-src")))
    console.log("OK Built Lobby/Admin render with enforced production CSP; inline script injection is blocked")
  } finally {
    await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected.identifier })
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
