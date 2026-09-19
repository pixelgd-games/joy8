import "../styles/error-modal.css"

export const ERROR_CODES = Object.freeze({
  LOBBY_GAMES_READ_FAILED: "JOY8-LOBBY-001",

  GAME_MISSING_SLUG: "JOY8-GAME-001",
  GAME_NOT_FOUND: "JOY8-GAME-002",
  GAME_URL_MISSING: "JOY8-GAME-003",
  GAME_READ_FAILED: "JOY8-GAME-004",
  GAME_URL_INVALID: "JOY8-GAME-005",
  GAME_LOAD_TIMEOUT: "JOY8-GAME-006",

  ADMIN_AUTH_READ_FAILED: "JOY8-ADMIN-001",
  ADMIN_NOT_ALLOWED: "JOY8-ADMIN-002",
  ADMIN_GAMES_READ_FAILED: "JOY8-ADMIN-003",
  ADMIN_DELETE_FAILED: "JOY8-ADMIN-004",
  ADMIN_GAME_READ_FAILED: "JOY8-ADMIN-005",
  ADMIN_GAME_NOT_FOUND: "JOY8-ADMIN-006",
  ADMIN_GAME_SAVE_FAILED: "JOY8-ADMIN-007",
  ADMIN_FORM_INVALID: "JOY8-ADMIN-008",
  ADMIN_SIGN_OUT_FAILED: "JOY8-ADMIN-009",
  ADMIN_OAUTH_FAILED: "JOY8-ADMIN-010",
  ADMIN_GAME_ID_MISSING: "JOY8-ADMIN-011",
})

const MODAL_ID = "joy8-error-modal"

let activeCleanup = null

export function showErrorModal(options = {}) {
  const config = normalizeOptions(options)

  if (config.error) {
    console.error(`[${config.code}] ${config.title}`, config.error)
  } else {
    console.warn(`[${config.code}] ${config.title}: ${config.message}`)
  }

  closeErrorModal()

  const modal = document.createElement("section")
  modal.id = MODAL_ID
  modal.className = "joy8-error-modal"
  modal.setAttribute("role", "presentation")

  const dialog = document.createElement("div")
  dialog.className = "joy8-error-dialog"
  dialog.setAttribute("role", "dialog")
  dialog.setAttribute("aria-modal", "true")
  dialog.setAttribute("aria-labelledby", "joy8-error-title")
  dialog.setAttribute("aria-describedby", "joy8-error-message")

  const kicker = document.createElement("p")
  kicker.className = "joy8-error-kicker"
  kicker.textContent = "ERROR"

  const title = document.createElement("h2")
  title.id = "joy8-error-title"
  title.className = "joy8-error-title"
  title.textContent = config.title

  const message = document.createElement("p")
  message.id = "joy8-error-message"
  message.className = "joy8-error-message"
  message.textContent = config.message

  const code = document.createElement("p")
  code.className = "joy8-error-code"
  code.textContent = `Error code: ${config.code}`

  const actions = document.createElement("div")
  actions.className = "joy8-error-actions"

  if (config.primaryAction) {
    actions.append(createActionButton(config.primaryAction, "primary"))
  } else if (config.reload !== false) {
    actions.append(createActionButton({
      label: "Reload",
      onClick: () => location.reload(),
    }, "primary"))
  }

  actions.append(createActionButton({ label: "Close" }))

  dialog.append(kicker, title, message, code, actions)
  modal.append(dialog)
  document.body.append(modal)
  document.body.classList.add("joy8-error-modal-open")

  const handleKeydown = (event) => {
    if (event.key === "Escape") {
      closeErrorModal()
    }
  }

  const handleOverlayClick = (event) => {
    if (event.target === modal) {
      closeErrorModal()
    }
  }

  document.addEventListener("keydown", handleKeydown)
  modal.addEventListener("click", handleOverlayClick)

  activeCleanup = () => {
    document.removeEventListener("keydown", handleKeydown)
    modal.removeEventListener("click", handleOverlayClick)
    modal.remove()
    document.body.classList.remove("joy8-error-modal-open")
    activeCleanup = null
  }

  dialog.querySelector("button")?.focus()

  return { close: closeErrorModal }
}

function closeErrorModal() {
  activeCleanup?.()
}

function normalizeOptions(options) {
  return {
    code: options.code || "JOY8-UNKNOWN-000",
    title: options.title || "Something went wrong",
    message: options.message || "The system is having trouble right now. Please try again later.",
    error: options.error,
    reload: options.reload,
    primaryAction: options.primaryAction,
  }
}

function createActionButton(action, modifier = "") {
  const button = document.createElement("button")
  button.type = "button"
  button.className = modifier ? `joy8-error-action ${modifier}` : "joy8-error-action"
  button.textContent = action.label || "OK"
  button.addEventListener("click", () => {
    closeErrorModal()
    action.onClick?.()
  })
  return button
}
