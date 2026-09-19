import { buildGameUrl, getGameTypeLabel } from "./utils.js"
import { normalizeCoverPath } from "../../lib/urls.js"

const TEXT = {
  openGame: "Open game",
  emptyTitle: "No games available",
  emptyCopy: "Published games will appear here.",
  errorTitle: "Game list failed to load",
  errorCopy: "Please try again later or contact an administrator.",
}

export function renderGameGrid(gridElement, games) {
  if (!gridElement) return

  if (games.length === 0) {
    gridElement.replaceChildren(createEmptyState())
    return
  }

  const tileGrid = document.createElement("div")
  tileGrid.className = "game-tile-grid"
  tileGrid.append(...games.map(createGameTile))

  gridElement.replaceChildren(tileGrid)
}

export function renderGameGridError(gridElement) {
  if (!gridElement) return

  gridElement.replaceChildren(createGridState({
    className: "empty-state is-error",
    title: TEXT.errorTitle,
    copy: TEXT.errorCopy,
  }))
}

function createEmptyState() {
  return createGridState({
    className: "empty-state",
    title: TEXT.emptyTitle,
    copy: TEXT.emptyCopy,
  })
}

function createGridState({ className, title: titleText, copy: copyText }) {
  const wrapper = document.createElement("div")
  wrapper.className = className

  const title = document.createElement("div")
  title.className = "empty-title"
  title.textContent = titleText

  const copy = document.createElement("div")
  copy.className = "empty-copy"
  copy.textContent = copyText

  wrapper.append(title, copy)
  return wrapper
}

function createGameTile(game) {
  const card = document.createElement("article")
  card.className = "game-tile"

  const gameUrl = getGameUrl(game)
  card.append(
    createTilePoster(game, gameUrl),
    createTileBody(game),
  )

  return card
}

function createTilePoster(game, gameUrl) {
  const displayName = getDisplayName(game)
  const thumbnail = normalizeCoverPath(game.thumbnail, game.slug)
  const poster = document.createElement("a")
  poster.className = "game-tile-poster"
  poster.href = gameUrl
  poster.setAttribute("aria-label", `${TEXT.openGame}: ${displayName}`)

  if (thumbnail) {
    const image = document.createElement("img")
    image.className = "game-tile-poster-image"
    image.alt = ""
    image.loading = "lazy"
    image.decoding = "async"
    image.addEventListener("error", () => {
      image.remove()
      poster.classList.add("is-empty")
    }, { once: true })
    image.src = thumbnail
    poster.append(image)
  } else {
    poster.classList.add("is-empty")
  }

  return poster
}

function createTileBody(game) {
  const displayName = getDisplayName(game)
  const body = document.createElement("div")
  body.className = "game-tile-body"

  const title = document.createElement("h3")
  title.className = "game-tile-title"
  title.textContent = displayName

  const tags = document.createElement("div")
  tags.className = "game-tile-tags"

  const type = document.createElement("span")
  type.className = "game-tile-tag"
  type.textContent = getGameTypeLabel(game.type)

  tags.append(type)

  body.append(title, tags)
  return body
}

function getGameUrl(game) {
  return buildGameUrl(game.slug)
}

function getDisplayName(game) {
  const name = String(game.name || "").trim()
  if (name) {
    return name
  }

  const slugName = String(game.slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")

  return slugName || "Untitled Game"
}
