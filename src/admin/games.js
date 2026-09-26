import { supabase } from "../lib/supabaseClient.js"
import { normalizeCoverPath, normalizeLaunchUrl } from "../lib/urls.js"
import { ERROR_CODES, showErrorModal } from "../ui/error-modal.js"
import { requireAdmin, signOut } from "./auth.js"

const GAME_FIELDS = "id,name,slug,thumbnail,type,published,launch_url,sort_order,created_at"

let gameRows = []

function $(selector) {
  return document.querySelector(selector)
}

async function main() {
  const admin = await requireAdmin()
  if (!admin) return

  $("#btnLogout")?.addEventListener("click", signOut)
  setStatus("讀取 games 中...")

  const { data, error } = await supabase
    .from("games")
    .select(GAME_FIELDS)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })

  if (error) {
    setStatus(`讀取失敗：${error.message}`)
    showErrorModal({
      code: ERROR_CODES.ADMIN_GAMES_READ_FAILED,
      title: "後台遊戲列表讀取失敗",
      message: "目前無法取得遊戲列表，請稍後再試。",
      error,
    })
    return
  }

  gameRows = data || []
  updateStatus()
  renderGameList()
  $("#list")?.addEventListener("click", handleListClick)
}

function renderGameList() {
  const list = $("#list")
  if (!list) return

  list.replaceChildren()

  if (gameRows.length === 0) {
    list.textContent = "目前沒有遊戲。"
    return
  }

  list.append(createGamesTable(gameRows))
}

function createGamesTable(games) {
  const table = document.createElement("table")
  table.border = "1"
  table.cellPadding = "6"
  table.style.borderCollapse = "collapse"

  table.append(
    createTableHead([
      "名稱",
      "slug",
      "縮圖",
      "類型",
      "上架",
      "排序",
      "launch url",
      "建立時間",
      "操作",
    ]),
    createTableBody(games),
  )

  return table
}

function createTableHead(labels) {
  const thead = document.createElement("thead")
  const row = document.createElement("tr")

  for (const label of labels) {
    const th = document.createElement("th")
    th.textContent = label
    row.append(th)
  }

  thead.append(row)
  return thead
}

function createTableBody(games) {
  const tbody = document.createElement("tbody")
  tbody.append(...games.map(createGameRow))
  return tbody
}

function createGameRow(game) {
  const row = document.createElement("tr")
  row.append(
    createTextCell(game.name),
    createTextCell(game.slug),
    createLinkCell(normalizeCoverPath(game.thumbnail, game.slug), "thumbnail", Boolean(game.thumbnail)),
    createTextCell(game.type),
    createTextCell(game.published ? "是" : "否"),
    createTextCell(game.sort_order ?? ""),
    createLinkCell(game.launch_url, game.launch_url),
    createTextCell(game.created_at),
    createActionsCell(game),
  )
  return row
}

function createTextCell(value) {
  const cell = document.createElement("td")
  cell.textContent = value == null ? "" : String(value)
  return cell
}

function createLinkCell(rawUrl, label, invalid = false) {
  const cell = document.createElement("td")
  const href = normalizeLaunchUrl(rawUrl)

  if (!href) {
    if (rawUrl || invalid) cell.textContent = "URL 格式不支援"
    return cell
  }

  cell.append(createAnchor(href, label || href, true))
  return cell
}

function createActionsCell(game) {
  const cell = document.createElement("td")
  const slug = String(game.slug || "")
  const editUrl = `/admin/games/edit/?id=${encodeURIComponent(game.id)}`
  const loaderUrl = `/game/?slug=${encodeURIComponent(slug)}`
  const launchUrl = normalizeLaunchUrl(game.launch_url)

  const actions = [
    createAnchor(editUrl, "編輯"),
    createAnchor(loaderUrl, "Loader", true),
  ]

  if (launchUrl) {
    actions.push(createAnchor(launchUrl, "啟動", true))
  }

  appendSeparated(cell, actions)
  cell.append(document.createTextNode(" | "))
  cell.append(createUnpublishButton(game.id))

  return cell
}

function createAnchor(href, label, openInNewTab = false) {
  const anchor = document.createElement("a")
  anchor.href = href
  anchor.textContent = label

  if (openInNewTab) {
    anchor.target = "_blank"
    anchor.rel = "noopener"
  }

  return anchor
}

function createUnpublishButton(id) {
  const button = document.createElement("button")
  button.type = "button"
  button.dataset.unpublish = id
  button.textContent = "下架"
  button.disabled = !gameRows.find(game => game.id === id)?.published
  return button
}

function appendSeparated(parent, nodes) {
  nodes.forEach((node, index) => {
    if (index > 0) parent.append(document.createTextNode(" | "))
    parent.append(node)
  })
}

async function handleListClick(event) {
  if (!(event.target instanceof Element)) return

  const button = event.target.closest("button[data-unpublish]")
  if (!button) return

  const id = button.dataset.unpublish
  if (!id) return

  if (!confirm("確定從大廳下架這個遊戲？遊戲資料與紀錄會保留；此操作不會取消進行中的對局或停用測試入口。")) return

  const { error } = await supabase.from("games").update({ published: false }).eq("id", id)

  if (error) {
    showErrorModal({
      code: ERROR_CODES.ADMIN_UNPUBLISH_FAILED,
      title: "下架遊戲失敗",
      message: "目前無法下架這款遊戲，請稍後再試。",
      error,
      reload: false,
    })
    return
  }

  gameRows = gameRows.map(game => game.id === id ? { ...game, published: false } : game)
  renderGameList()
  updateStatus()
}

function updateStatus() {
  setStatus(`共 ${gameRows.length} 筆遊戲`)
}

function setStatus(message) {
  const status = $("#status")
  if (status) status.textContent = message
}

main()
