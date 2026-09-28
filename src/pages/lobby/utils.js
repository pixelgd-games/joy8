const GAME_TYPE_LABELS = {
  slot: "老虎機",
  fish: "捕魚",
  card: "桌上遊戲",
  arcade: "街機",
  casual: "休閒益智",
  adult: "精選",
}

export function buildGameUrl(slug) {
  return "/game/?slug=" + encodeURIComponent(slug)
}

export function getGameTypeLabel(type) {
  return GAME_TYPE_LABELS[type] || "遊戲"
}
