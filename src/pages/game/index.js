import { catalogSupabase } from "../../lib/catalogClient.js"
import { memberSupabase } from "../../lib/memberClient.js"
import { normalizeLaunchUrl } from "../../lib/urls.js"
import { lobbyGamePath, createMemberService } from "../../member/service.js"
import { renderLoader, mountSession, failedGame, showGameError } from "./loader.js"
import { GAME_SLUG_PATTERN } from "../../../packages/joy8-game-sdk/policy.js"

renderLoader()
async function main() {
  const slug = new URLSearchParams(location.search).get("slug")
  if (!GAME_SLUG_PATTERN.test(slug || "")) return showGameError({ code: "JOY8-GAME-001", title: "缺少有效遊戲代碼", message: "請從遊戲列表重新進入。" })
  const service = createMemberService(memberSupabase, { origin: location.origin })
  if (!await service.membership()) {
    location.replace(lobbyGamePath(location.pathname + location.search, location.origin))
    return
  }
  const { data: game, error } = await catalogSupabase.from("public_games_v1").select("id,slug,name,launch_url").eq("slug", slug).maybeSingle()
  if (error) throw error
  if (!game) return showGameError({ code: "JOY8-GAME-002", title: "找不到遊戲", message: "請回大廳選擇目前開放的遊戲。", reload: false })
  const url = normalizeLaunchUrl(game.launch_url)
  if (!url) return showGameError({ code: "JOY8-GAME-005", title: "遊戲網址設定錯誤", message: "請聯絡平台。", reload: false })
  const result = await memberSupabase.functions.invoke("joy8-gateway/create-session", { body: { slug } })
  if (result.error) throw result.error
  mountSession(url, game.name, result.data)
}
main().catch(failedGame)
