import { Joy8ServerClient } from "@joy8/game-sdk/server"

const joy8 = new Joy8ServerClient({
  gatewayUrl: process.env.JOY8_GATEWAY_URL,
  gameId: process.env.JOY8_GAME_ID,
  backendKey: process.env.JOY8_BACKEND_KEY,
})

export async function exchange(launchCode) {
  return joy8.exchangeLaunchCode({ launchCode })
}

export async function settleSpin({ spin, session, playerDelta }) {
  await joy8.openMatch({
    matchRef: spin.id,
    ruleVersion: process.env.JOY8_RULE_VERSION,
    participants: [{ sessionId: session.sessionId, reserve: spin.bet }],
  })

  return joy8.settleMatch({
    matchRef: spin.id,
    ruleVersion: process.env.JOY8_RULE_VERSION,
    operationKey: `${spin.id}:settlement:1`,
    settlementNo: 1,
    final: true,
    entries: playerDelta === "0.00" ? [] : [{
      kind: "player",
      accountRef: session.playerAccountRef,
      amount: playerDelta,
      source: "gameplay",
    }],
  })
}
