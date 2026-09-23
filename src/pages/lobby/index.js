import { fetchPublicGames } from "./data.js"
import { renderGameGrid, renderGameGridError } from "./game-grid.js"
import { renderLobby } from "./lobby.js"
import { ERROR_CODES, showErrorModal } from "../../ui/error-modal.js"
import { createMemberService, memberErrorMessage } from "../../member/service.js"
import { createGameEntry } from "../../member/game-entry.js"
import { memberSupabase } from "../../lib/memberClient.js"

let deferredInstallPrompt = null

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault()
  deferredInstallPrompt = event
})

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null
})

export async function initLobbyPage(appRoot) {
  if (!appRoot) return

  appRoot.innerHTML = renderLobby()
  setupInstallButton(appRoot)
  const openEntry = setupMemberEntry(appRoot)
  const entryParams = new URLSearchParams(location.search)
  const memberMode = ["open", "callback"].includes(entryParams.get("member")) ? entryParams.get("member") : null
  const memberParams = memberMode ? new URLSearchParams(entryParams) : null
  const requestedGame = memberMode ? null : entryParams.get("play")
  if (entryParams.has("play") || memberMode) history.replaceState(null, "", "/")

  if (memberParams) {
    const { openMemberModal } = await import("../../member/modal.js")
    void openMemberModal(appRoot.querySelector(".member-login-link"), { params: memberParams })
  }

  const gameGrid = appRoot.querySelector("#gameGrid")

  try {
    const games = await fetchPublicGames()
    renderGameGrid(gameGrid, games)
    if (requestedGame) {
      const game = games.find((item) => item.slug === requestedGame)
      const trigger = [...gameGrid.querySelectorAll("a")].find((link) => new URL(link.href).searchParams.get("slug") === requestedGame)
      if (game && trigger) await openEntry(trigger, trigger.href, game.name)
      else showErrorModal({ code: ERROR_CODES.GAME_NOT_FOUND, title: "找不到遊戲", message: "請從大廳選擇目前開放的遊戲。", reload: false })
    }
  } catch (error) {
    renderGameGridError(gameGrid)
    showErrorModal({
      code: ERROR_CODES.LOBBY_GAMES_READ_FAILED,
      title: "遊戲列表讀取失敗",
      message: "目前無法載入遊戲列表，請稍後再試或聯絡管理員。",
      error,
    })
  }
}

function setupMemberEntry(appRoot) {
  const service = createMemberService(memberSupabase, { origin: location.origin })
  const accountLink = appRoot.querySelector(".member-login-link")
  let accountRevision = 0

  const renderAccount = (label, publicId = "") => {
    accountLink.replaceChildren()
    accountLink.classList.toggle("is-member", Boolean(publicId))
    accountLink.removeAttribute("aria-busy")
    if (!publicId) {
      accountLink.textContent = label
      accountLink.setAttribute("aria-label", label)
      return
    }
    const prefix = document.createElement("span")
    prefix.className = "member-login-prefix"
    prefix.textContent = "Player"
    const id = document.createElement("span")
    id.className = "member-login-id"
    id.textContent = publicId
    accountLink.append(prefix, id)
    accountLink.setAttribute("aria-label", `玩家帳號 Player ${publicId}`)
  }

  const refreshAccount = (session, knownMember = null) => {
    const revision = ++accountRevision
    const user = session?.user
    if (!user) {
      renderAccount("登入")
      return
    }
    const fallback = user.is_anonymous ? "訪客帳號" : "我的帳號"
    if (knownMember?.public_id) {
      renderAccount("", knownMember.public_id)
      return
    }
    renderAccount(fallback)
    accountLink.setAttribute("aria-busy", "true")
    setTimeout(async () => {
      try {
        const member = await service.membership()
        if (revision !== accountRevision) return
        renderAccount(fallback, member?.public_id)
      } catch {
        if (revision === accountRevision) renderAccount(fallback)
      }
    }, 0)
  }

  const enterGame = createGameEntry({
    origin: location.origin,
    membership: () => service.membership(),
    openMember: async (...args) => {
      const { openMemberModal } = await import("../../member/modal.js")
      await openMemberModal(...args)
    },
    navigate: (path) => location.assign(path),
  })
  memberSupabase.auth.onAuthStateChange((_event, session) => {
    refreshAccount(session)
  })
  window.addEventListener("joy8:membership", async (event) => {
    refreshAccount(await service.session(), event.detail)
  })

  const openEntry = async (trigger, next, gameName) => {
    try {
      await enterGame({ trigger, next, gameName })
    } catch (error) {
      showErrorModal({ title: "目前無法進入", message: memberErrorMessage(error), reload: false })
    }
  }

  appRoot.addEventListener("click", (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const trigger = event.target.closest("a")
    if (!trigger || !appRoot.contains(trigger)) return
    const isLogin = trigger.matches(".member-login-link")
    const isGame = trigger.matches("#gameGrid .game-tile-poster")
    if (!isLogin && !isGame) return
    event.preventDefault()
    const gameName = trigger.closest(".game-tile")?.querySelector(".game-tile-title")?.textContent || ""
    void openEntry(trigger, isGame ? trigger.href : null, gameName)
  })
  return openEntry
}

function setupInstallButton(appRoot) {
  const button = appRoot.querySelector("#installAppButton")
  const help = appRoot.querySelector("#installHelp")
  const actions = appRoot.querySelector(".header-actions")
  if (!button || !help || !actions) return

  if (isStandaloneApp()) {
    hideInstallUi(button, help)
    return
  }

  button.hidden = false

  button.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      help.hidden = true
      button.setAttribute("aria-expanded", "false")
      button.disabled = true

      try {
        deferredInstallPrompt.prompt()
        const choice = await deferredInstallPrompt.userChoice
        if (choice.outcome === "accepted") {
          hideInstallUi(button, help)
        }
      } finally {
        button.disabled = false
        deferredInstallPrompt = null
      }
      return
    }

    const isOpen = help.hidden
    help.hidden = !isOpen
    button.setAttribute("aria-expanded", String(isOpen))
  })

  document.addEventListener("click", (event) => {
    if (actions.contains(event.target)) return

    help.hidden = true
    button.setAttribute("aria-expanded", "false")
  })
}

function hideInstallUi(button, help) {
  button.hidden = true
  help.hidden = true
  button.setAttribute("aria-expanded", "false")
}

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true
}
