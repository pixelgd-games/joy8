import { buildGameUrl, getGameTypeLabel } from "./utils.js"
import { normalizeCoverPath } from "../../lib/urls.js"

const TEXT = {
  openGame: "開啟遊戲",
  playable: "可遊玩",
  trial: "試玩",
  emptyTitle: "目前沒有開放的遊戲",
  emptyCopy: "遊戲上架後會顯示在這裡。",
  errorTitle: "遊戲列表讀取失敗",
  errorCopy: "請稍後再試，或聯絡管理員。",
}

export function renderGameGrid(gridElement, games) {
  if (!gridElement) return
  gridElement.removeAttribute("aria-busy")
  setCount(gridElement, games.length)
  if (games.length === 0) {
    gridElement.replaceChildren(createGridState("empty-state", TEXT.emptyTitle, TEXT.emptyCopy))
    return
  }
  gridElement.replaceChildren(...games.map(createGameCard))
}

export function renderGameGridError(gridElement) {
  if (!gridElement) return
  gridElement.removeAttribute("aria-busy")
  setCount(gridElement, 0)
  gridElement.replaceChildren(createGridState("empty-state is-error", TEXT.errorTitle, TEXT.errorCopy))
}

export function getGameCover(game) {
  return normalizeCoverPath(game.thumbnail, game.slug)
}

export function getDisplayName(game) {
  const name = String(game.name || "").trim()
  if (name) return name
  const slugName = String(game.slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
  return slugName || "未命名遊戲"
}

function setCount(gridElement, count) {
  const counter = gridElement.closest(".shelf")?.querySelector("[data-grid-count]")
  if (counter) counter.textContent = count ? `共 ${count} 款` : ""
}

function createGridState(className, titleText, copyText) {
  const wrapper = element("div", className)
  wrapper.append(element("div", "empty-title", titleText), element("div", "empty-copy", copyText))
  return wrapper
}

function createGameCard(game) {
  const displayName = getDisplayName(game)
  const card = element("a", "card game-card")
  card.href = buildGameUrl(game.slug)
  card.dataset.play = game.slug
  card.setAttribute("aria-label", `${TEXT.openGame}: ${displayName}`)

  const art = element("span", "card__art")
  const cover = getGameCover(game)
  if (cover) {
    const image = document.createElement("img")
    image.alt = ""
    image.loading = "lazy"
    image.decoding = "async"
    image.addEventListener("error", () => {
      image.remove()
      art.classList.add("is-empty")
      art.append(element("span", "card__fallback", displayName))
    }, { once: true })
    image.src = cover
    art.append(image)
  } else {
    art.classList.add("is-empty")
    art.append(element("span", "card__fallback", displayName))
  }

  const meta = element("span", "card__meta")
  meta.append(document.createElement("i"), `${game.launch_mode === "trial" ? TEXT.trial : TEXT.playable} · ${getGameTypeLabel(game.type)}`)
  card.append(art, element("span", "card__name game-card-title", displayName), meta)
  return card
}

function element(tag, className, text) {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
