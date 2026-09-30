import "./styles/lobby.css"
import { renderLobbyShell } from "./pages/lobby/lobby.js"
import { showErrorModal } from "./ui/error-modal.js"

const appRoot = document.querySelector("#app")
const renderHero = renderLobbyShell(appRoot)
import("./pages/lobby/index.js")
  .then(({ initLobbyPage }) => initLobbyPage(appRoot, { renderHero }))
  .catch(() => showErrorModal({ title: "大廳載入未完成", message: "請重新整理後再試。" }))
