export async function gameFailure(error) {
  let code = error?.code
  const status = error?.context?.status
  try { code = (await error.context.clone().json()).error || code } catch {}
  if (["member_inactive", "JOY8_PLAYER_INACTIVE", "player account is not active", "JOY8_WALLET_INACTIVE"].includes(code)) {
    return { code: "JOY8-GAME-007", title: "玩家目前無法進入", message: "玩家帳號或錢包目前無法使用，請聯絡平台。", reload: false }
  }
  if (status === 429 || code === "Too many requests") {
    const seconds = Number(error?.context?.headers?.get("Retry-After"))
    return { code: "JOY8-GAME-008", title: "操作太頻繁", message: Number.isInteger(seconds) && seconds > 0 && seconds <= 86400 ? `請等候 ${seconds} 秒後再試。` : "請稍候再試。" }
  }
  if (["JOY8_GAME_NOT_READY", "JOY8_PRIVATE_ENTRY_DENIED", "game is not available"].includes(code)) {
    return { code: "JOY8-GAME-009", title: "遊戲尚未開放", message: "這款遊戲目前未開放，請回大廳選擇其他遊戲。", reload: false }
  }
  if (status === 401 || ["verification_required", "player membership is required", "User session is required"].includes(code)) {
    return { code: "JOY8-GAME-010", title: "請重新登入", message: "登入狀態已失效，請回大廳重新登入。", reload: false }
  }
  if (status >= 500 || code === "JOY8_UPSTREAM_UNAVAILABLE" || code === "member_unavailable") {
    return { code: "JOY8-GAME-011", title: "平台暫時無法連線", message: "目前無法連線至平台服務，請稍後再試。" }
  }
  return { code: "JOY8-GAME-004", title: "遊戲載入失敗", message: "目前無法載入遊戲，請稍後再試。" }
}
