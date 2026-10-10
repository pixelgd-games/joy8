import { catalogSupabase } from "../../lib/catalogClient.js"
import { memberSupabase } from "../../lib/memberClient.js"
import { normalizeLaunchUrl } from "../../lib/urls.js"
import { lobbyGamePath, createMemberService } from "../../member/service.js"
import { renderLoader, mountSession, mountTrial, failedGame, showGameError } from "./loader.js"
import { GAME_SLUG_PATTERN } from "../../../packages/joy8-game-sdk/contract.js"
import { trackGameVisit } from "../../member/game-visit.js"

async function main() {
  const slug = new URLSearchParams(location.search).get("slug")
  if (!GAME_SLUG_PATTERN.test(slug || "")) return showGameError({ code: "JOY8-GAME-001", title: "缺少有效遊戲代碼", message: "請從遊戲列表重新進入。" })
  if (!trackGameVisit(slug)) {
    location.replace("/")
    return
  }
  renderLoader()
  const service = createMemberService(memberSupabase, { origin: location.origin })
  const returnToLobby = () => location.replace(lobbyGamePath(location.pathname + location.search, location.origin))
  const catalog = catalogSupabase.from("public_games_v1").select("id,slug,name,launch_url,launch_mode").eq("slug", slug).maybeSingle()
  const signedIn = Boolean(await service.session())
  const pending = signedIn ? memberSupabase.functions.invoke("joy8-gateway/create-session", { body: { slug } }) : null
  const { data: game, error } = await catalog
  if (game?.launch_mode !== "trial" && !signedIn) return returnToLobby()
  if (error) throw error
  if (!game) return showGameError({ code: "JOY8-GAME-002", title: "找不到遊戲", message: "請回大廳選擇目前開放的遊戲。", reload: false })
  const url = normalizeLaunchUrl(game.launch_url)
  if (!url) return showGameError({ code: "JOY8-GAME-005", title: "遊戲網址設定錯誤", message: "請聯絡平台。", reload: false })
  if (game.launch_mode === "trial") return mountTrial(url, game.name)
  const launch = await pending
  if (await requiresMembership(launch.error)) return returnToLobby()
  if (launch.error) throw launch.error
  mountSession(url, game.name, launch.data)
}

async function requiresMembership(error) {
  if (error?.context?.status !== 403) return false
  try { return (await error.context.clone().json()).error === "player membership is required" }
  catch { return false }
}
main().catch(failedGame)
