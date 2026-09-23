import { mountGameFrame } from "./iframe.js"
import { gameLaunchPayload } from "./launch.js"
import { gameFailure } from "./errors.js"

export function renderLoader() {
  document.body.innerHTML = `<div id="loading" class="loader" role="status" aria-live="polite"><div class="loader-card"><div class="loader-brand">Joy8</div><div class="loader-ring" aria-hidden="true"></div><p class="loader-copy">正在進入遊戲…</p></div></div><div id="game"></div><div class="scroll-handoff" aria-hidden="true"></div>`
}

export function showGameError({ code, title, message, reload = true }) {
  document.body.replaceChildren()
  const box = document.createElement("div")
  box.className = "error"
  box.setAttribute("role", "alert")
  for (const [tag, text] of [["h1", title], ["p", message], ["p", `錯誤代碼：${code}`]]) {
    const element = document.createElement(tag)
    element.textContent = text
    box.append(element)
  }
  if (reload) {
    const retry = document.createElement("button")
    retry.type = "button"
    retry.textContent = "重新整理"
    retry.addEventListener("click", () => location.reload())
    box.append(retry)
  }
  const home = document.createElement("a")
  home.href = "/"
  home.textContent = "返回大廳"
  box.append(home)
  document.body.append(box)
}

export async function failedGame(error) { showGameError(await gameFailure(error)) }

export function mountSession(gameUrl, gameName, session) {
  document.getElementById("private-start")?.remove()
  const copy = document.querySelector(".loader-copy")
  if (copy) copy.textContent = "正在進入遊戲…"
  mountGameFrame({
    gameRoot: document.getElementById("game"), gameUrl, gameName,
    launch: gameLaunchPayload(session, import.meta.env.VITE_SUPABASE_URL),
    onLoad: () => {
      const loading = document.getElementById("loading")
      loading?.classList.add("is-hidden")
      window.setTimeout(() => loading?.remove(), 320)
    },
    onTimeout: reason => showGameError({ code: "JOY8-GAME-006", title: reason === "handshake" ? "遊戲連線未完成" : "遊戲載入逾時", message: "遊戲未能完成連線，請重新整理後再試。" }),
  })
  if (window.scrollY === 0 && document.documentElement.scrollHeight > window.innerHeight) window.requestAnimationFrame(() => window.scrollTo(0, 1))
}
