import "./styles/lobby.css"
import "./pages/lobby/install.js"
import { renderLobbyShell } from "./pages/lobby/lobby.js"
import { showErrorModal } from "./ui/error-modal.js"

const entryParams = new URLSearchParams(location.search)
if (["play", "member", "code", "error", "error_code"].some(key => entryParams.has(key))) history.replaceState(null, "", "/")
const appRoot = document.querySelector("#app")
const renderHero = renderLobbyShell(appRoot)
import("./pages/lobby/index.js")
  .then(({ initLobbyPage }) => initLobbyPage(appRoot, { renderHero, entryParams }))
  .catch(() => showErrorModal({ title: "大廳載入未完成", message: "請重新整理後再試。" }))
