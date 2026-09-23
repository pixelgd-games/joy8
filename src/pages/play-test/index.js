import { memberSupabase } from "../../lib/memberClient.js"
import { normalizeLaunchUrl } from "../../lib/urls.js"
import { createMemberService } from "../../member/service.js"
import { openMemberModal } from "../../member/modal.js"
import { renderLoader, mountSession, failedGame, showGameError } from "../game/loader.js"
import { gameFailure } from "../game/errors.js"
import { GAME_SLUG_PATTERN } from "../../../packages/joy8-game-sdk/policy.js"

const slug = new URLSearchParams(location.search).get("slug")
renderLoader()
if (!GAME_SLUG_PATTERN.test(slug || "")) {
  showGameError({ code: "JOY8-GAME-001", title: "缺少有效遊戲代碼", message: "請使用完整的測試入口網址。" })
} else {
  const service = createMemberService(memberSupabase, { origin: location.origin })
  const card = document.querySelector(".loader-card")
  card.querySelector(".loader-ring").remove()
  card.querySelector(".loader-copy").textContent = "登入 Joy8 或使用快速登入，即可進入測試。"
  const button = document.createElement("button")
  button.id = "private-start"
  button.textContent = "進入測試"
  const status = document.createElement("p")
  status.id = "private-status"
  status.setAttribute("role", "status")
  card.append(button, status)
  button.addEventListener("click", async () => {
    button.disabled = true
    try {
      if (!await service.membership()) {
        await openMemberModal(button, { next: `/play-test/?slug=${encodeURIComponent(slug)}` })
        status.textContent = "登入完成後，按「進入測試」繼續。"
        return
      }
      const { data, error } = await memberSupabase.functions.invoke("joy8-gateway/private-session", { body: { slug } })
      if (error) {
        const failure = await gameFailure(error)
        status.textContent = `${failure.title}：${failure.message}（${failure.code}）`
        return
      }
      const url = normalizeLaunchUrl(data?.launch_url)
      if (!url) throw new Error("Invalid private launch URL")
      mountSession(url, data.game_name, data)
    } catch (error) { await failedGame(error) }
    finally { button.disabled = false }
  })
}
