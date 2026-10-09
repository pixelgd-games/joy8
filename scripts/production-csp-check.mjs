import assert from "node:assert/strict"
import http from "node:http"
import path from "node:path"
import { readFile } from "node:fs/promises"

export async function expectProductionCsp(client, cwd) {
  const root = path.join(cwd, ".smoke-dist.local")
  const headers = Object.fromEntries((await readFile(path.join(root, "_headers"), "utf8")).split(/\r?\n/)
    .filter(line => line.startsWith("  ")).map(line => { const index = line.indexOf(":"); return [line.slice(0, index).trim(), line.slice(index + 1).trim()] }))
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" }
  const server = http.createServer(async (request, response) => {
    try {
      let name = new URL(request.url, "http://localhost").pathname
      if (name === "/built-game/") {
        response.writeHead(200, { "Content-Type": "text/html" })
        response.end('<!doctype html><script src="/built-game.js"></script>')
        return
      }
      if (name === "/built-game.js") {
        response.writeHead(200, { "Content-Type": "text/javascript" })
        response.end('window.addEventListener("message", event => { if (event.source === parent && event.data?.type === "joy8-launch-v1") parent.postMessage({type:"built-received",protocol:event.data.launch.joy8_protocol}, "*") }); parent.postMessage({type:"joy8-launch-ready-v1",protocol:"server-v1"}, "*")')
        return
      }
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
    if (window === window.top) {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
    window.builtFixture = { claims: 0, read: false, claimed: false, handedOff: false };
    if (location.search.includes('built=stale')) sessionStorage.setItem('joy8-game-visit-v1', JSON.stringify({slug:'built-game',at:Date.now()-120000}));
    if (location.search.includes('built=missing')) sessionStorage.removeItem('joy8-game-visit-v1');
    window.addEventListener('message', event => {
      if (event.source === document.querySelector('#game iframe')?.contentWindow && event.data?.type === 'built-received' && event.data.protocol === 'server-v1') builtFixture.handedOff = true;
    });
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'built@example.test', is_anonymous: false, aud: 'authenticated', created_at: '2026-09-30' };
    if (location.search.includes('built=member')) {
      const exp = Math.floor(Date.now()/1000) + 3600;
      const token = btoa(JSON.stringify({alg:'HS256',typ:'JWT'})) + '.' + btoa(JSON.stringify({sub:user.id,exp,role:'authenticated'})) + '.fixture';
      localStorage.setItem('joy8-member-auth-v1', JSON.stringify({access_token:token,refresh_token:'fixture-only',token_type:'bearer',expires_in:3600,expires_at:exp,user}));
    }
    const fetchOriginal = window.fetch;
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (!url.hostname.endsWith('.supabase.co')) return fetchOriginal(input, options);
      if (url.pathname === '/rest/v1/public_games_v1') return Response.json([{id:'00000000-0000-4000-8000-000000000002',slug:'built-game',name:'Built Game',type:'arcade',thumbnail:null,launch_url:location.origin+'/built-game/'}]);
      if (url.pathname === '/auth/v1/user') return Response.json(user);
      const mailPage = () => ({items:[{id:'built-mail',kind:'reward',title:'Built reward',body:'Built mail body',amount:'500',read_at:builtFixture.read?'2026-09-30':null,claimed_at:builtFixture.claimed?'2026-09-30':null}],unread:builtFixture.read?0:1});
      if (url.pathname.endsWith('/lobby')) return Response.json({member:{player_account_ref:user.id,public_id:'482731',account_type:'registered'},wallet:{balance:builtFixture.claimed?'1500':'1000'},mail:mailPage()});
      if (url.pathname.endsWith('/member')) return Response.json({member:{player_account_ref:user.id,public_id:'482731',account_type:'registered'}});
      if (url.pathname.endsWith('/wallet')) return Response.json({wallet:{balance:builtFixture.claimed?'1500':'1000'}});
      if (url.pathname.endsWith('/create-session')) {
        sessionStorage.setItem('built-session-requests', String(Number(sessionStorage.getItem('built-session-requests') || 0)+1));
        return Response.json({session_id:'00000000-0000-4000-8000-000000000003',game_id:'00000000-0000-4000-8000-000000000002',launch_code:'a'.repeat(64),currency:'POINT',protocol:'server-v1'});
      }
      if (url.pathname.endsWith('/mailbox')) {
        const {action} = JSON.parse(options.body);
        if (action === 'read') { builtFixture.read = true; return Response.json({read_at:'2026-09-30'}); }
        if (action === 'claim') { builtFixture.claims++; builtFixture.claimed = true; return Response.json({claimed_at:'2026-09-30'}); }
        return Response.json(mailPage());
      }
      return Response.json({error:'Blocked isolated request'}, {status:403});
    };
    }
  ` })
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    const evaluate = async expression => {
      const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const until = async expression => {
      for (let i = 0; i < 80; i++) {
        if (await evaluate(expression)) return
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert.fail(`Built interaction timed out: ${expression}`)
    }
    for (const route of ["/", "/admin/login/"]) {
      await client.send("Page.navigate", { url: origin + route })
      let rendered = false
      for (let i = 0; i < 60; i++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        const result = await client.send("Runtime.evaluate", { returnByValue: true, expression: "({text:document.body?.innerText || '',violations:window.cspViolations})" })
        const state = result.result.value
        if (state?.text.includes(route === "/" ? "全部遊戲" : "Joy8 Admin")) {
          assert.deepEqual(state.violations, [])
          rendered = true
          break
        }
      }
      assert.ok(rendered, `Built page did not render under CSP: ${route}`)
    }
    await client.send("Page.navigate", { url: origin + "/" })
    await until("Boolean(document.querySelector('#gameGrid .card'))")
    await evaluate("document.querySelector('.member-login-link').click()")
    await until("Boolean(document.querySelector('#member-dialog[open] #google-button:not(:disabled)'))")
    assert.deepEqual(await evaluate("cspViolations"), [])

    await client.send("Page.navigate", { url: origin + "/?built=member" })
    await until("document.querySelector('[data-wallet]')?.textContent === '1,000'")
    await evaluate("document.querySelector('.topbar [data-action=mail]').click()")
    await until("Boolean(document.querySelector('.mail-item'))")
    await evaluate("document.querySelector('.mail-item').click()")
    await until("builtFixture.read")
    assert.equal(await evaluate("builtFixture.claims"), 0)
    await evaluate("document.querySelector('.mail-reward button').click(); document.querySelector('.mail-reward button').click()")
    await until("document.querySelector('[data-wallet]')?.textContent === '1,500'")
    assert.equal(await evaluate("builtFixture.claims"), 1)
    assert.deepEqual(await evaluate("cspViolations"), [])

    await evaluate("document.querySelector('.sheet--mail [data-mail=close]').click(); sessionStorage.setItem('built-session-requests', '0'); document.querySelector('#gameGrid [data-play=built-game]').click()")
    await until("window.builtFixture?.handedOff && !document.querySelector('#loading')")
    assert.equal(await evaluate("new URL(document.querySelector('#game iframe').src).search"), "")
    assert.equal(await evaluate("sessionStorage.getItem('built-session-requests')"), "1")
    await client.send("Page.reload")
    await until("window.builtFixture?.handedOff && !document.querySelector('#loading') && sessionStorage.getItem('built-session-requests') === '2'")
    for (const state of ["stale", "missing"]) {
      await client.send("Page.navigate", { url: origin + `/game/?slug=built-game&built=${state}` })
      await until("location.pathname === '/' && location.search === '' && document.querySelector('[data-wallet]')?.textContent === '1,000'")
      assert.equal(await evaluate("sessionStorage.getItem('built-session-requests')"), "2")
      assert.equal(await evaluate("document.querySelectorAll('iframe, #member-dialog[open]').length"), 0)
    }
    await evaluate("document.querySelector('#gameGrid [data-play=built-game]').click()")
    await until("window.builtFixture?.handedOff && sessionStorage.getItem('built-session-requests') === '3'")
    assert.deepEqual(await evaluate("cspViolations"), [])
    await evaluate("localStorage.removeItem('joy8-member-auth-v1')")
    const result = await client.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `new Promise(resolve => {
      const script = document.createElement('script'); script.textContent = 'window.inlineScriptExecuted = true'; document.body.append(script);
      setTimeout(() => resolve({executed:!!window.inlineScriptExecuted,violations:window.cspViolations}),100);
    })` })
    assert.equal(result.result.value.executed, false)
    assert.ok(result.result.value.violations.some(value => value.startsWith("script-src")))
    console.log("OK Built Lobby/Admin, lazy sign-in, mailbox claim, explicit game entry and recent reload work under CSP; stale/missing visits return without a session; inline scripts are blocked")
  } finally {
    await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected.identifier })
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
