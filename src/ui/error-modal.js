import "../styles/error-modal.css"

export const ERROR_CODES = Object.freeze({
  LOBBY_GAMES_READ_FAILED: "LOOTY-LOBBY-001",

  GAME_MISSING_SLUG: "LOOTY-GAME-001",
  GAME_NOT_FOUND: "LOOTY-GAME-002",
  GAME_URL_MISSING: "LOOTY-GAME-003",
  GAME_READ_FAILED: "LOOTY-GAME-004",
  GAME_URL_INVALID: "LOOTY-GAME-005",
  GAME_LOAD_TIMEOUT: "LOOTY-GAME-006",

  ADMIN_AUTH_READ_FAILED: "LOOTY-ADMIN-001",
  ADMIN_NOT_ALLOWED: "LOOTY-ADMIN-002",
  ADMIN_GAMES_READ_FAILED: "LOOTY-ADMIN-003",
  ADMIN_DELETE_FAILED: "LOOTY-ADMIN-004",
  ADMIN_GAME_READ_FAILED: "LOOTY-ADMIN-005",
  ADMIN_GAME_NOT_FOUND: "LOOTY-ADMIN-006",
  ADMIN_GAME_SAVE_FAILED: "LOOTY-ADMIN-007",
  ADMIN_FORM_INVALID: "LOOTY-ADMIN-008",
  ADMIN_SIGN_OUT_FAILED: "LOOTY-ADMIN-009",
  ADMIN_OAUTH_FAILED: "LOOTY-ADMIN-010",
  ADMIN_GAME_ID_MISSING: "LOOTY-ADMIN-011",
})

const MODAL_ID = "looty-error-modal"

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
  modal.className = "looty-error-modal"
  modal.setAttribute("role", "presentation")

  const dialog = document.createElement("div")
  dialog.className = "looty-error-dialog"
  dialog.setAttribute("role", "dialog")
  dialog.setAttribute("aria-modal", "true")
  dialog.setAttribute("aria-labelledby", "looty-error-title")
  dialog.setAttribute("aria-describedby", "looty-error-message")

  const kicker = document.createElement("p")
  kicker.className = "looty-error-kicker"
  kicker.textContent = "ERROR"

  const title = document.createElement("h2")
  title.id = "looty-error-title"
  title.className = "looty-error-title"
  title.textContent = config.title

  const message = document.createElement("p")
  message.id = "looty-error-message"
  message.className = "looty-error-message"
  message.textContent = config.message

  const code = document.createElement("p")
  code.className = "looty-error-code"
  code.textContent = `Error code: ${config.code}`

  const actions = document.createElement("div")
  actions.className = "looty-error-actions"

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
  document.body.classList.add("looty-error-modal-open")

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
    document.body.classList.remove("looty-error-modal-open")
    activeCleanup = null
  }

  dialog.querySelector("button")?.focus()

  return { close: closeErrorModal }
}

export function closeErrorModal() {
  activeCleanup?.()
}

function normalizeOptions(options) {
  return {
    code: options.code || "LOOTY-UNKNOWN-000",
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
  button.className = modifier ? `looty-error-action ${modifier}` : "looty-error-action"
  button.textContent = action.label || "OK"
  button.addEventListener("click", () => {
    closeErrorModal()
    action.onClick?.()
  })
  return button
}
