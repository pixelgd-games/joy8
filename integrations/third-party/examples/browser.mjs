import { getJoy8Balance, receiveJoy8Launch } from "@joy8/game-sdk/browser"

const launch = await receiveJoy8Launch({
  parentOrigins: ["https://joy8.cc", "https://www.joy8.cc"],
  expectedGameId: globalThis.GAME_CONFIG.joy8GameId,
  gatewayUrl: globalThis.GAME_CONFIG.joy8GatewayUrl,
})

const exchangeResponse = await fetch("/api/joy8/exchange", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ launchCode: launch.joy8_launch_code }),
})

if (!exchangeResponse.ok) throw new Error("Joy8 exchange failed")

const { gatewayToken } = await exchangeResponse.json()
const balance = await getJoy8Balance({ gatewayUrl: launch.joy8_gateway_url, gatewayToken })

globalThis.startGame({ balance })
