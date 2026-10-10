import { fetchPublicGames } from "./data.js"
import { getDisplayName, getGameCover, renderGameGrid, renderGameGridError } from "./game-grid.js"
import { noticeMarkup, renderLobbyShell } from "./lobby.js"
import { createMemberMenu } from "./member-menu.js"
import { createMailSheet } from "./mail-sheet.js"
import { formatPoint } from "../../lib/format.js"
import { createSettingsSheet } from "./settings-sheet.js"
import { HERO_SLIDES, NOTICES, PLACEHOLDERS } from "./content.js"
import { buildGameUrl } from "./utils.js"
import { ERROR_CODES, showErrorModal } from "../../ui/error-modal.js"
import { createMemberService, memberErrorMessage } from "../../member/service.js"
import { createGameEntry } from "../../member/game-entry.js"
import { memberSupabase } from "../../lib/memberClient.js"
import { createMailboxService } from "../../mailbox/service.js"
import { createMemberState } from "../../member/state.js"
import { prepareGameEntry } from "../../member/game-visit.js"

export async function initLobbyPage(appRoot, { renderHero = null, entryParams = new URLSearchParams() } = {}) {
  if (!appRoot) return
  renderHero ??= renderLobbyShell(appRoot)
  setupTicker(appRoot)
  const lobby = setupMember(appRoot)
  appRoot.inert = false
  appRoot.removeAttribute("aria-busy")

  const memberParams = entryParams.get("member") === "callback" ? new URLSearchParams(entryParams) : null
  const requestedGame = memberParams ? null : entryParams.get("play")

  if (memberParams) {
    const { openMemberModal } = await import("../../member/modal.js")
    void openMemberModal(appRoot.querySelector(".member-login-link"), { params: memberParams })
  }

  const gameGrid = appRoot.querySelector("#gameGrid")

  try {
    const games = await fetchPublicGames()
    lobby.setGames(games)
    renderGameGrid(gameGrid, games)
    renderHero(HERO_SLIDES.filter((slide) => !slide.play || games.some((game) => game.slug === slide.play))
      .map((slide) => slide.play ? { ...slide, href: buildGameUrl(slide.play) } : slide))
    if (requestedGame) {
      const trigger = gameGrid.querySelector(`[data-play="${CSS.escape(requestedGame)}"]`)
      if (trigger) await lobby.openGame(trigger, requestedGame)
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

function setupMember(appRoot) {
  const root = document.documentElement
  const service = createMemberService(memberSupabase, { origin: location.origin })
  const toast = createToast(appRoot, appRoot.querySelector("[data-toast]"))
  const loginButton = appRoot.querySelector(".member-login-link")
  const games = new Map()
  let walletRevision = 0
  let walletFrame = 0
  let publicId = ""
  let walletValue = null

  const isMember = () => root.dataset.auth === "member"

  const renderWallet = (value, from) => {
    walletValue = value
    const frame = ++walletFrame
    for (const node of document.querySelectorAll("[data-wallet]")) {
      if (value == null) node.textContent = "—"
      else if (from == null || from === value) node.textContent = formatPoint(value)
      else countUp(node, from, value, () => frame === walletFrame)
    }
  }

  const renderUnread = (count) => {
    for (const node of document.querySelectorAll("[data-unread]")) {
      node.textContent = String(count)
      node.hidden = !count
    }
    for (const node of document.querySelectorAll("[data-unread-text]")) node.textContent = count ? ` (${count})` : ""
    for (const node of appRoot.querySelectorAll('[data-action="mail"]')) node.setAttribute("aria-label", count ? `信箱，${count} 封未讀` : "信箱")
  }

  const refreshWallet = async (animate = false) => {
    const revision = ++walletRevision
    const before = walletValue
    try {
      const wallet = await service.wallet()
      if (revision !== walletRevision || !isMember()) return
      const value = wallet ? Number(wallet.balance) : null
      renderWallet(value, animate ? before : null)
    } catch {
      if (revision === walletRevision && isMember()) renderWallet(null)
    }
  }

  const menu = createMemberMenu(appRoot, { onAction: (action, trigger) => runAction(action, trigger) })
  const mail = createMailSheet({
    api: createMailboxService(memberSupabase),
    toast,
    onUnread: renderUnread,
    onClaimed: () => refreshWallet(true),
  })
  const settings = createSettingsSheet({ toast, onAction: (action, trigger) => runAction(action, trigger) })

  const applyGuest = () => {
    root.dataset.auth = "guest"
    publicId = ""
    walletRevision++
    menu.close()
    mail.reset()
    renderWallet(null)
    loginButton.removeAttribute("aria-busy")
  }

  const applyMember = (user, member) => {
    root.dataset.auth = "member"
    publicId = member.public_id
    loginButton.removeAttribute("aria-busy")
    for (const node of document.querySelectorAll("[data-player-name]")) node.textContent = `Player ${publicId}`
    for (const node of appRoot.querySelectorAll(".account")) node.setAttribute("aria-label", `會員資料 Player ${publicId}`)
    menu.render({ publicId, email: user.email, joinedAt: user.created_at })
    settings.render({ publicId })
    const snapshot = member.lobby
    delete member.lobby
    if (!snapshot) {
      void refreshWallet()
      void mail.refreshUnread()
      return
    }
    ++walletRevision
    renderWallet(snapshot.wallet ? Number(snapshot.wallet.balance) : null)
    if (snapshot.mail) mail.prime(snapshot.mail)
    else void mail.refreshUnread()
  }

  const account = createMemberState({
    readMember: async () => {
      const snapshot = await service.lobby()
      return snapshot?.member ? { ...snapshot.member, lobby: snapshot } : null
    },
    onReset: applyGuest,
    onMember: applyMember,
    onPending: () => loginButton.setAttribute("aria-busy", "true"),
  })

  const enterGame = createGameEntry({
    origin: location.origin,
    membership: async () => account.member ?? (await account.pending, account.member) ?? service.membership(),
    openMember: async (...args) => {
      const { openMemberModal } = await import("../../member/modal.js")
      await openMemberModal(...args)
    },
    navigate: (path) => location.assign(path),
  })
  memberSupabase.auth.onAuthStateChange((event, session) => {
    void account.update(session, null, event === "TOKEN_REFRESHED" || event === "USER_UPDATED")
  })
  window.addEventListener("joy8:membership", async (event) => {
    const session = await service.session()
    if (session?.user.id === event.detail.auth_user_id) void account.update(session, event.detail)
  })

  const openEntry = async (trigger, next, game) => {
    try {
      await enterGame({ trigger, next, gameName: game ? getDisplayName(game) : "", cover: game ? getGameCover(game) : "" })
    } catch (error) {
      showErrorModal({ title: "目前無法進入", message: memberErrorMessage(error), reload: false })
    }
  }

  const openGame = (trigger, slug) => {
    const game = games.get(slug)
    if (!game) return toast("這款遊戲目前沒有開放")
    if (game.launch_mode === "trial") {
      prepareGameEntry(buildGameUrl(slug))
      return location.assign(buildGameUrl(slug))
    }
    return openEntry(trigger, buildGameUrl(slug), game)
  }

  const runAction = (action, trigger) => {
    if (action === "login") return openEntry(trigger, null)
    if (action === "welcome") return isMember() ? appRoot.querySelector("#gamesSection").scrollIntoView({ behavior: "smooth" }) : openEntry(trigger, null)
    if (action === "profile") return menu.toggle()
    if (action === "mail") return isMember() ? mail.open() : openEntry(trigger, null)
    if (action === "settings") return settings.open()
    if (action === "logout") {
      return service.signOut().then(() => toast("已登出"), () => toast("目前無法登出，請稍後再試"))
    }
    if (action === "copy-id") {
      return navigator.clipboard?.writeText(publicId).then(() => toast("已複製玩家 ID"), () => toast(`玩家 ID：${publicId}`))
        ?? toast(`玩家 ID：${publicId}`)
    }
    if (action === "home") return window.scrollTo({ top: 0, behavior: "smooth" })
    if (PLACEHOLDERS[action]) toast(PLACEHOLDERS[action])
  }

  appRoot.addEventListener("click", (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const player = event.target.closest("[data-play]")
    if (player && appRoot.contains(player)) {
      event.preventDefault()
      void openGame(player, player.dataset.play)
      return
    }
    const trigger = event.target.closest("[data-action]")
    if (!trigger || !appRoot.contains(trigger) || trigger.closest(".profile")) return
    if (trigger.tagName === "A") event.preventDefault()
    void runAction(trigger.dataset.action, trigger)
  })

  return {
    openGame,
    setGames(list) {
      games.clear()
      for (const game of list) games.set(game.slug, game)
    },
  }
}

function setupTicker(appRoot) {
  const ticker = appRoot.querySelector("[data-ticker]")
  if (!ticker || !NOTICES.length) return
  let index = 0
  const show = () => {
    ticker.innerHTML = noticeMarkup(NOTICES[index])
    index = (index + 1) % NOTICES.length
  }
  show()
  if (NOTICES.length > 1) setInterval(show, 3500)
}

function createToast(appRoot, node) {
  let timer = 0
  return (message) => {
    const host = document.querySelector("dialog[open]") || appRoot
    host.append(node)
    node.textContent = message
    node.classList.add("is-show")
    clearTimeout(timer)
    timer = setTimeout(() => node.classList.remove("is-show"), 2600)
  }
}

function countUp(node, from, to, isCurrent) {
  const start = performance.now()
  const step = (now) => {
    if (!isCurrent()) return
    const t = Math.min(1, (now - start) / 900)
    node.textContent = formatPoint(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))))
    if (t < 1) requestAnimationFrame(step)
    else node.textContent = formatPoint(to)
  }
  requestAnimationFrame(step)
}
