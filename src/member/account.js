import "../styles/theme.css"
import { memberCardMarkup } from "./template.js"
import { initMemberPanel } from "./page.js"

const root = document.getElementById("member-entry-root")
root.innerHTML = memberCardMarkup
initMemberPanel(root, { standalone: true, params: new URLSearchParams(location.search) })
