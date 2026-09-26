import { renderGameForm } from "./form-template.js"
import { supabase } from "../lib/supabaseClient.js"
import { normalizeCoverPath, normalizeLaunchUrl } from "../lib/urls.js"
import { ERROR_CODES, showErrorModal } from "../ui/error-modal.js"
import { requireAdmin } from "./auth.js"
import "../styles/admin-form.css"
import { GAME_SLUG_PATTERN } from "../../packages/joy8-game-sdk/policy.js"

const params = new URLSearchParams(window.location.search)
const isEditPage = window.location.pathname.startsWith("/admin/games/edit/")
const gameId = isEditPage ? params.get("id") : null
document.getElementById("admin-form").innerHTML = renderGameForm(isEditPage)
const form = document.getElementById("gameForm")
const fields = form.querySelector("fieldset")
let canSubmit = false
form.addEventListener("submit", submitForm)

function slugSanity(slug) {
  const s = String(slug || "").trim()
  if (!s) return { ok: false, msg: "slug 不能為空" }
  if (/\s/.test(s)) return { ok: false, msg: "slug 不能包含空格" }
  if (!GAME_SLUG_PATTERN.test(s))
    return { ok: false, msg: "slug 必須為 1 至 80 個小寫英數或 -" }
  return { ok: true, slug: s }
}

function val(id) {
  return document.getElementById(id)?.value ?? ""
}
function checked(id) {
  return !!document.getElementById(id)?.checked
}

function parseSortOrder(rawValue) {
  const value = String(rawValue || "").trim()

  if (!value) return { ok: true, value: 0 }
  if (!/^-?\d+$/.test(value)) {
    return { ok: false, msg: "sort order 只能填整數" }
  }

  return { ok: true, value: Number(value) }
}

async function loadGame() {
  const { data, error } = await supabase
    .from("games")
    .select("id,name,slug,thumbnail,type,published,launch_url,sort_order")
    .eq("id", gameId)
    .maybeSingle()

  if (error) {
    showFormError({
      code: ERROR_CODES.ADMIN_GAME_READ_FAILED,
      title: "遊戲資料讀取失敗",
      message: "目前無法取得這筆遊戲資料，請稍後再試。",
      error,
      reload: true,
    })
    return false
  }
  if (!data) {
    showFormError({
      code: ERROR_CODES.ADMIN_GAME_NOT_FOUND,
      title: "找不到遊戲",
      message: "找不到這筆遊戲資料，可能已經被刪除。",
      primaryAction: {
        label: "回遊戲列表",
        onClick: () => {
          window.location.href = "/admin/games/"
        },
      },
    })
    return false
  }

  document.getElementById("name").value = data.name ?? ""
  document.getElementById("slug").value = data.slug ?? ""
  document.getElementById("thumbnail").value = data.thumbnail ?? ""
  document.getElementById("type").value = data.type ?? "slot"
  document.getElementById("published").checked = !!data.published
  document.getElementById("launch_url").value = data.launch_url ?? ""
  document.getElementById("sort_order").value = data.sort_order ?? ""

  const loading = document.getElementById("loading")
  if (loading) loading.style.display = "none"
  return true
}

async function submitForm(e) {
  e.preventDefault()
  if (!canSubmit) return

  const name = val("name").trim()
  const slugCheck = slugSanity(val("slug"))
  if (!slugCheck.ok) return showValidationError(slugCheck.msg)
  const sortOrderCheck = parseSortOrder(val("sort_order"))
  if (!sortOrderCheck.ok) return showValidationError(sortOrderCheck.msg)
  const launchUrlInput = val("launch_url").trim()
  const launchUrl = normalizeLaunchUrl(launchUrlInput)
  const thumbnailInput = val("thumbnail").trim()
  const thumbnail = normalizeCoverPath(thumbnailInput, slugCheck.slug)

  if (launchUrlInput && !launchUrl) {
    return showValidationError("launch url 只能使用 https://、/ 開頭的站內路徑或本機開發網址")
  }
  if (thumbnailInput && !thumbnail) {
    return showValidationError(`封面必須使用 /games/${slugCheck.slug}/cover.webp`)
  }

  const payload = {
    name,
    slug: slugCheck.slug,
    thumbnail,
    type: val("type"),
    published: checked("published"),
    launch_url: launchUrl || null,
    sort_order: sortOrderCheck.value,
  }

  if (!payload.name) return showValidationError("名稱不能為空")
  if (payload.published && !launchUrl) {
    return showValidationError("已上架遊戲需要 launch url")
  }
  if (payload.published && !thumbnail) {
    return showValidationError("已上架遊戲需要符合規格的 Joy8 封面")
  }

  canSubmit = false
  fields.disabled = true

  try {
    if (gameId) {
      const { error } = await supabase.from("games").update(payload).eq("id", gameId)
      if (error) {
        showSaveError("更新遊戲失敗", error)
        return
      }
    } else {
      const { error } = await supabase.from("games").insert([payload])
      if (error) {
        showSaveError("新增遊戲失敗", error)
        return
      }
    }

    window.location.href = "/admin/games/"
  } finally {
    canSubmit = true
    fields.disabled = false
  }
}

async function initFormPage() {
  const ok = await requireAdmin()
  if (!ok) return

  if (isEditPage && !gameId) {
    showFormError({
      code: ERROR_CODES.ADMIN_GAME_ID_MISSING,
      title: "缺少遊戲編號",
      message: "這個編輯網址不完整，請回遊戲列表重新選擇。",
      primaryAction: {
        label: "回遊戲列表",
        onClick: () => {
          window.location.href = "/admin/games/"
        },
      },
    })
    return
  }

  if (gameId) {
    if (!await loadGame()) return
  } else {
    const loading = document.getElementById("loading")
    if (loading) loading.style.display = "none"
  }

  canSubmit = true
  fields.disabled = false
}

initFormPage()

function showValidationError(message) {
  showFormError({
    code: ERROR_CODES.ADMIN_FORM_INVALID,
    title: "資料格式錯誤",
    message,
    reload: false,
  })
}

function showSaveError(title, error) {
  showFormError({
    code: ERROR_CODES.ADMIN_GAME_SAVE_FAILED,
    title,
    message: "目前無法儲存遊戲資料，請稍後再試。",
    error,
    reload: false,
  })
}

function showFormError(options) {
  showErrorModal({
    reload: false,
    ...options,
  })
}
